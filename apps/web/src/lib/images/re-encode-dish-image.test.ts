import { describe, expect, it, vi } from "vitest";
import { parse as parseExif } from "exifr";
import { PhotonImage } from "@cf-wasm/photon";
import { MAX_DECODED_PIXELS, MAX_DIMENSION_PX, reEncodeDishImage } from "./re-encode-dish-image";

/**
 * Builds a minimal, spec-valid TIFF/EXIF IFD0 block carrying the given ASCII
 * tag values (e.g. `Make`/`Model`), the same IFD0 block real camera/phone
 * uploads carry GPS tags in -- stripping it is exactly what stripping GPS
 * tags would also require. Returns the raw TIFF bytes (byte-order header +
 * IFD0 + value area), suitable for wrapping in an "Exif\0\0"-prefixed APP1
 * JPEG segment.
 */
function buildTiffIfd0(entries: Array<{ tag: number; value: string }>): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const ifd0Offset = 8; // right after the 8-byte TIFF header
  const entryCount = sorted.length;
  const ifd0Size = 2 + entryCount * 12 + 4;
  const valueAreaOffset = ifd0Offset + ifd0Size;

  const totalValueBytes = sorted.reduce((sum, e) => sum + e.value.length + 1, 0);
  const totalSize = valueAreaOffset + totalValueBytes;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // TIFF header: "II" (little-endian), magic 42, offset to IFD0.
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifd0Offset, true);

  view.setUint16(ifd0Offset, entryCount, true);

  let valueCursor = valueAreaOffset;
  sorted.forEach((entry, i) => {
    const entryOffset = ifd0Offset + 2 + i * 12;
    const strBytes = `${entry.value}\0`;
    const count = strBytes.length; // includes null terminator

    view.setUint16(entryOffset, entry.tag, true); // tag
    view.setUint16(entryOffset + 2, 2, true); // type 2 = ASCII
    view.setUint32(entryOffset + 4, count, true); // count

    if (count <= 4) {
      for (let j = 0; j < count; j++) {
        bytes[entryOffset + 8 + j] = strBytes.charCodeAt(j);
      }
    } else {
      view.setUint32(entryOffset + 8, valueCursor, true);
      for (let j = 0; j < count; j++) {
        bytes[valueCursor + j] = strBytes.charCodeAt(j);
      }
      valueCursor += count;
    }
  });

  // Next-IFD offset: 0 (no IFD1).
  view.setUint32(ifd0Offset + 2 + entryCount * 12, 0, true);

  return bytes;
}

/** Wraps TIFF/EXIF bytes in an APP1 JPEG segment (marker + length + "Exif\0\0"). */
function buildExifApp1Segment(tiff: Uint8Array): Uint8Array {
  const payload = new Uint8Array(6 + tiff.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0); // "Exif\0\0"
  payload.set(tiff, 6);

  const segment = new Uint8Array(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = 0xe1; // APP1 marker
  new DataView(segment.buffer).setUint16(2, payload.length + 2, false); // length includes itself
  segment.set(payload, 4);
  return segment;
}

/**
 * Builds a genuinely decodable JPEG (via `@cf-wasm/photon`'s raw-pixel
 * encoder) that carries a real EXIF APP1 segment with `Make`/`Model`,
 * inserted right after the SOI marker -- no external image-processing
 * dependency needed, and the fixture is verified to decode successfully with
 * `@cf-wasm/photon` before any test asserts on EXIF stripping.
 */
function makeJpegWithExif(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4).fill(120);
  const image = new PhotonImage(pixels, width, height);
  const baseJpeg = new Uint8Array(image.get_bytes_jpeg(90));

  const exifSegment = buildExifApp1Segment(
    buildTiffIfd0([
      { tag: 0x010f, value: "TestCam" },
      { tag: 0x0110, value: "X1" },
    ]),
  );

  // Insert right after the 2-byte SOI marker (FFD8).
  const withExif = new Uint8Array(2 + exifSegment.length + (baseJpeg.length - 2));
  withExif.set(baseJpeg.subarray(0, 2), 0);
  withExif.set(exifSegment, 2);
  withExif.set(baseJpeg.subarray(2), 2 + exifSegment.length);
  return withExif;
}

/**
 * Builds a valid, decodable JPEG at the given dimensions from raw pixels
 * (via photon's own `PhotonImage` raw-pixel constructor) instead of relying
 * on an embedded fixture -- avoids bloating this test file with large
 * base64 blobs for the "big image gets downscaled" case below.
 */
function makeSolidColorJpeg(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 200;
    pixels[i + 1] = 60;
    pixels[i + 2] = 60;
    pixels[i + 3] = 255;
  }
  const image = new PhotonImage(pixels, width, height);
  return image.get_bytes_jpeg(90);
}

describe("reEncodeDishImage", () => {
  it("re-encodes a valid image and returns JPEG bytes", () => {
    const result = reEncodeDishImage(makeSolidColorJpeg(20, 20));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.buffer.length).toBeGreaterThan(0);
    // JPEG magic bytes (SOI marker).
    expect(result.buffer[0]).toBe(0xff);
    expect(result.buffer[1]).toBe(0xd8);
  });

  it("strips EXIF metadata from a re-encoded image", async () => {
    const original = makeJpegWithExif(20, 20);

    // Verify the fixture is actually decodable by @cf-wasm/photon before
    // asserting anything about EXIF stripping below.
    expect(() => PhotonImage.new_from_byteslice(original)).not.toThrow();

    // `exifr` (bundled) checks `instanceof Uint8Array`/`ArrayBuffer` against
    // *this test file's* realm; wrapping in a Node `Buffer` (a subclass from
    // a different realm under Vitest's jsdom pool) makes that check fail
    // with an unhelpful "Invalid input argument" -- passing a plain
    // `Uint8Array` (constructed in this file) avoids that cross-realm trap.
    const originalExif = await parseExif(original);
    expect(originalExif?.Make).toBe("TestCam");

    const result = reEncodeDishImage(original);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reEncodedExif = await parseExif(new Uint8Array(result.buffer)).catch(() => undefined);
    expect(reEncodedExif).toBeUndefined();
  });

  it("rejects bytes that don't decode as a valid image", () => {
    // Plausible-looking but not actually decodable image data (e.g. a
    // non-image file whose MIME type was spoofed to pass the upload
    // action's declared-type check upstream of this function).
    const bogus = new TextEncoder().encode(
      "this is definitely not a valid jpeg/png/webp payload".repeat(5),
    );

    const result = reEncodeDishImage(bogus);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_image");
  });

  it("downscales an image larger than the max dimension, preserving aspect ratio", () => {
    const oversized = makeSolidColorJpeg(MAX_DIMENSION_PX + 400, (MAX_DIMENSION_PX + 400) / 2);

    const result = reEncodeDishImage(oversized);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const decoded = PhotonImage.new_from_byteslice(new Uint8Array(result.buffer));
    expect(decoded.get_width()).toBeLessThanOrEqual(MAX_DIMENSION_PX);
    expect(decoded.get_height()).toBeLessThanOrEqual(MAX_DIMENSION_PX);
    // Aspect ratio (2:1) preserved, within a 1px rounding tolerance.
    expect(Math.abs(decoded.get_width() / decoded.get_height() - 2)).toBeLessThan(0.05);
  });

  it("does not upscale an image already within the max dimension", () => {
    const result = reEncodeDishImage(makeSolidColorJpeg(20, 20));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const decoded = PhotonImage.new_from_byteslice(new Uint8Array(result.buffer));
    expect(decoded.get_width()).toBe(20);
    expect(decoded.get_height()).toBe(20);
  });

  it("rejects an image whose decoded pixel count exceeds the decompression-bomb budget", () => {
    // Simulates a maliciously-crafted small JPEG that decodes successfully
    // but declares huge dimensions (e.g. 30000x30000): the guard must reject
    // it based on width/height alone, *before* any resize/RGBA buffer
    // allocation is attempted. A fake decoded image (no real multi-hundred-
    // megapixel pixel buffer) keeps this test fast and memory-safe while
    // still exercising the exact `width * height > MAX_DECODED_PIXELS`
    // check in the production code.
    const hugeSide = Math.ceil(Math.sqrt(MAX_DECODED_PIXELS)) + 1000;
    const fakeDecoded = {
      get_width: () => hugeSide,
      get_height: () => hugeSide,
    } as unknown as PhotonImage;

    const decodeSpy = vi.spyOn(PhotonImage, "new_from_byteslice").mockReturnValueOnce(fakeDecoded);

    const result = reEncodeDishImage(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]));

    decodeSpy.mockRestore();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_image");
  });
});
