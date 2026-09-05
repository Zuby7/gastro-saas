import { describe, expect, it } from "vitest";
import { parse as parseExif } from "exifr";
import { PhotonImage } from "@cf-wasm/photon";
import { MAX_DIMENSION_PX, reEncodeDishImage } from "./re-encode-dish-image";

// Tiny (20x20) JPEG fixture generated once with `sharp`
// (`withExif({ IFD0: { Make: "TestCam", Model: "X1" } })`) and embedded as
// base64, so this suite doesn't need an image-processing tool of its own
// beyond `exifr` (used only to *read back* metadata for assertions). Real
// camera/phone uploads carry EXIF/GPS metadata in the same IFD0 block that
// `Make`/`Model` live in here -- stripping this block is exactly what
// stripping GPS tags would also require.
const FIXTURE_WITH_EXIF_B64 =
  "/9j/4QDcRXhpZgAASUkqAAgAAAAIAA8BAgAIAAAAfgAAABABAgADAAAAWDEAABIBAwABAAAAAQAAABoBBQABAAAAbgAAABsBBQABAAAAdgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAhgAAAAAAAAA4YwAA6AMAADhjAADoAwAAVGVzdENhbQAGAACQBwAEAAAAMDIxMAGRBwAEAAAAAQIDAACgBwAEAAAAMDEwMAGgAwABAAAA//8AAAKgBAABAAAAFAAAAAOgBAABAAAAFAAAAAAAAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAUABQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AkwEJqwAAAAAD/9k=";

function bytesFromBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
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
    const original = bytesFromBase64(FIXTURE_WITH_EXIF_B64);

    const originalExif = await parseExif(Buffer.from(original));
    expect(originalExif?.Make).toBe("TestCam");

    const result = reEncodeDishImage(original);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reEncodedExif = await parseExif(result.buffer).catch(() => undefined);
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
});
