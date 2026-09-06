/**
 * Ticket #72 (Opus review, PR #132): minimal, dependency-free parsing of
 * JPEG/PNG/WebP width/height directly from the raw file header bytes.
 *
 * `PhotonImage.new_from_byteslice()` fully decodes an image into a raw RGBA
 * buffer in WASM memory *before* any dimension check on the decoded image can
 * run -- a maliciously crafted, tiny-on-disk JPEG/PNG/WebP that declares huge
 * dimensions (e.g. 30000x30000) already allocates the full-resolution buffer
 * (~3.6 GB for that example) by the time `get_width()`/`get_height()` are
 * available. Checking dimensions on the *decoded* `PhotonImage` therefore
 * cannot prevent the very allocation it's meant to guard against.
 *
 * This module reads width/height straight out of each format's header
 * (JPEG SOF0/SOF2 marker, PNG IHDR chunk, WebP VP8/VP8L/VP8X chunk) without
 * decoding any pixel data, so the pixel-budget check in
 * `re-encode-dish-image.ts` can reject an oversized image before
 * `new_from_byteslice` (and therefore any decode allocation) ever runs.
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

/**
 * JPEG: scans marker segments after the SOI (0xFFD8) marker for a
 * start-of-frame marker (SOF0 = baseline, SOF2 = progressive -- the two
 * variants real photo uploads use) and reads its big-endian height/width
 * fields. Markers with no length field (RST0-7, TEM) are skipped without
 * a length lookup; every other marker's segment is skipped via its own
 * declared length so the scan never needs to understand a segment's payload.
 */
function parseJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let pos = 2;
  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff) {
      return null;
    }

    let marker = bytes[pos + 1] ?? 0;
    pos += 2;
    // JPEG allows arbitrary 0xFF fill bytes before a real marker code.
    while (marker === 0xff && pos < bytes.length) {
      marker = bytes[pos] ?? 0;
      pos += 1;
    }

    if (marker === 0xd9 /* EOI */) {
      return null;
    }
    // Markers with no length field: TEM (0x01) and RST0-RST7 (0xd0-0xd7).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (pos + 1 >= bytes.length) {
      return null;
    }
    const segmentLength = readUint16BE(bytes, pos);

    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 /* DHT */ &&
      marker !== 0xc8 /* JPG (reserved) */ &&
      marker !== 0xcc; /* DAC */

    if (isSof) {
      // Segment layout: length(2) precision(1) height(2) width(2) ...
      if (pos + 6 >= bytes.length) {
        return null;
      }
      const height = readUint16BE(bytes, pos + 3);
      const width = readUint16BE(bytes, pos + 5);
      if (!width || !height) {
        return null;
      }
      return { width, height };
    }

    if (segmentLength < 2) {
      return null;
    }
    pos += segmentLength;
  }

  return null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG: the IHDR chunk is always the first chunk, immediately after the 8-byte signature. */
function parsePngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) {
    return null;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return null;
    }
  }

  // Bytes 8-11: chunk length, bytes 12-15: chunk type, expected "IHDR".
  const chunkType = String.fromCharCode(
    bytes[12] ?? 0,
    bytes[13] ?? 0,
    bytes[14] ?? 0,
    bytes[15] ?? 0,
  );
  if (chunkType !== "IHDR") {
    return null;
  }

  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  if (!width || !height) {
    return null;
  }
  return { width, height };
}

/** WebP: RIFF/WEBP container with a VP8 (lossy), VP8L (lossless), or VP8X (extended) chunk. */
function parseWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) {
    return null;
  }

  const riff = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  const webp = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0);
  if (riff !== "RIFF" || webp !== "WEBP") {
    return null;
  }

  const chunkFourCc = String.fromCharCode(
    bytes[12] ?? 0,
    bytes[13] ?? 0,
    bytes[14] ?? 0,
    bytes[15] ?? 0,
  );
  const chunkDataStart = 20; // 12 (RIFF header + WEBP) + 4 (fourCC) + 4 (chunk size)

  if (chunkFourCc === "VP8 ") {
    // Frame tag (3 bytes) + start code (0x9d 0x01 0x2a) + width/height (2 bytes each, 14-bit LE).
    if (
      bytes[chunkDataStart + 3] !== 0x9d ||
      bytes[chunkDataStart + 4] !== 0x01 ||
      bytes[chunkDataStart + 5] !== 0x2a
    ) {
      return null;
    }
    const widthField = (bytes[chunkDataStart + 6] ?? 0) | ((bytes[chunkDataStart + 7] ?? 0) << 8);
    const heightField = (bytes[chunkDataStart + 8] ?? 0) | ((bytes[chunkDataStart + 9] ?? 0) << 8);
    const width = widthField & 0x3fff;
    const height = heightField & 0x3fff;
    if (!width || !height) {
      return null;
    }
    return { width, height };
  }

  if (chunkFourCc === "VP8L") {
    if (bytes[chunkDataStart] !== 0x2f) {
      return null;
    }
    const b0 = bytes[chunkDataStart + 1] ?? 0;
    const b1 = bytes[chunkDataStart + 2] ?? 0;
    const b2 = bytes[chunkDataStart + 3] ?? 0;
    const b3 = bytes[chunkDataStart + 4] ?? 0;
    const bits = (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return { width, height };
  }

  if (chunkFourCc === "VP8X") {
    const width = readUint24LE(bytes, chunkDataStart + 4) + 1;
    const height = readUint24LE(bytes, chunkDataStart + 7) + 1;
    if (!width || !height) {
      return null;
    }
    return { width, height };
  }

  return null;
}

/**
 * Reads width/height from a JPEG, PNG, or WebP file's header, without
 * decoding any pixel data. Returns `null` if the bytes don't look like a
 * recognized header (the caller should fall back to the (slower, but
 * post-decode-checked) decode path in that case rather than treat this as a
 * hard rejection -- some genuinely valid images use header layouts this
 * minimal parser doesn't recognize).
 */
export function readImageDimensionsFromHeader(bytes: Uint8Array): ImageDimensions | null {
  return parseJpegDimensions(bytes) ?? parsePngDimensions(bytes) ?? parseWebpDimensions(bytes);
}
