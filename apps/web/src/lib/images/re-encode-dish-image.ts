/**
 * Ticket #72: server-side re-encoding for uploaded dish images.
 *
 * Uses `@cf-wasm/photon` (a WASM build of the Rust `photon_rs` image library)
 * rather than `sharp`: `sharp` needs a native (non-WASM) binary per
 * platform/arch, which is not supported in this app's actual deployment
 * target -- Cloudflare Pages/Workers via `@opennextjs/cloudflare` (see
 * `docs/operations/deployment-strategy.md`). Cloudflare Workers (`workerd`)
 * cannot load native Node addons, even with the `nodejs_compat` flag, so
 * `sharp` would work in local dev/tests (plain Node) but fail in production.
 * `@cf-wasm/photon` ships separate `workerd`/`edge-light`/`node` builds
 * selected automatically via its package.json `exports` map, so the same
 * import works unmodified in both this Vitest suite (Node) and the deployed
 * Cloudflare Worker.
 *
 * Decoding the upload into `PhotonImage` and re-encoding it to JPEG:
 * - strips EXIF/GPS metadata: `photon_rs` decodes into raw RGBA pixels and
 *   the re-encode writes a fresh JPEG from those pixels only, with no
 *   metadata segments carried over from the original file;
 * - doubles as the "reject non-image files that pass the MIME-type check"
 *   guard: `PhotonImage.new_from_byteslice` throws for bytes that don't
 *   decode as one of the supported image formats;
 * - normalizes resolution: images wider/taller than `MAX_DIMENSION_PX` are
 *   downscaled (aspect ratio preserved), everything else passes through the
 *   resize step unchanged (still gets re-encoded for the metadata-stripping
 *   effect above).
 *
 * JPEG (not WebP) is the re-encode target: this photon build's
 * `get_bytes_webp()` only writes *lossless* WebP (no quality parameter),
 * which on photographic content produces files several times larger than
 * the JPEG original -- risking the 5 MB bucket/`media_assets` limit that
 * originals were already validated against. `get_bytes_jpeg(quality)`
 * gives predictable, bounded output sizes instead.
 */
import { PhotonImage, resize, SamplingFilter } from "@cf-wasm/photon";
import { readImageDimensionsFromHeader } from "./image-header-dimensions";

export const MAX_DIMENSION_PX = 1600;
export const JPEG_QUALITY = 82;

/**
 * Upper bound on decoded pixel count. Guards against a decompression-bomb
 * upload: a small-on-disk JPEG/PNG/WebP can declare huge dimensions (e.g.
 * 30000x30000), which would make `photon` allocate a full-resolution RGBA
 * buffer in WASM memory (~3.6 GB for that example) if it were ever decoded.
 * 40 megapixels comfortably covers any real dish photo (well beyond typical
 * phone camera output) while bounding worst-case memory use.
 *
 * This is checked TWICE, deliberately:
 *  1. Against `readImageDimensionsFromHeader`'s header-only parse, BEFORE
 *     `PhotonImage.new_from_byteslice` is ever called -- this is the check
 *     that actually prevents the decode allocation, since it never decodes
 *     any pixel data.
 *  2. Against the already-decoded `PhotonImage`'s own `get_width`/`get_height`
 *     (unchanged from before), as defense-in-depth for any file whose header
 *     this minimal parser fails to recognize (in which case check 1 can't
 *     run and the decode already happened) -- this second check can't undo
 *     an allocation that already happened, but still stops an oversized
 *     image from reaching the resize/re-encode step.
 */
export const MAX_DECODED_PIXELS = 40_000_000;

export const REENCODED_CONTENT_TYPE = "image/jpeg";
export const REENCODED_EXTENSION = "jpg";

export type ReEncodeResult = { ok: true; buffer: Buffer } | { ok: false; error: "invalid_image" };

/**
 * Decodes `input` as an image, downscales it to fit within
 * `MAX_DIMENSION_PX` on its longest side (if larger), and re-encodes it as a
 * JPEG. Returns `{ ok: false, error: "invalid_image" }` if `input` cannot be
 * decoded as a valid image (e.g. a non-image file with a spoofed MIME type).
 */
export function reEncodeDishImage(input: Uint8Array): ReEncodeResult {
  // Check 1 (see MAX_DECODED_PIXELS' comment above): reject based on the raw
  // header alone, before any decode call, so an oversized image never causes
  // photon to allocate a full-resolution RGBA buffer in the first place.
  const headerDimensions = readImageDimensionsFromHeader(input);
  if (headerDimensions && headerDimensions.width * headerDimensions.height > MAX_DECODED_PIXELS) {
    return { ok: false, error: "invalid_image" };
  }

  let photonImage: PhotonImage;
  try {
    photonImage = PhotonImage.new_from_byteslice(input);
  } catch {
    return { ok: false, error: "invalid_image" };
  }

  try {
    const width = photonImage.get_width();
    const height = photonImage.get_height();

    if (!width || !height) {
      return { ok: false, error: "invalid_image" };
    }

    if (width * height > MAX_DECODED_PIXELS) {
      return { ok: false, error: "invalid_image" };
    }

    const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const resized = resize(photonImage, targetWidth, targetHeight, SamplingFilter.Lanczos3);
    const jpegBytes = resized.get_bytes_jpeg(JPEG_QUALITY);

    return { ok: true, buffer: Buffer.from(jpegBytes) };
  } catch {
    return { ok: false, error: "invalid_image" };
  }
}
