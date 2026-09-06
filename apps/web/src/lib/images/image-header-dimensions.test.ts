import { describe, expect, it } from "vitest";
import { PhotonImage } from "@cf-wasm/photon";
import { readImageDimensionsFromHeader } from "./image-header-dimensions";

function makeRealJpeg(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4).fill(100);
  const image = new PhotonImage(pixels, width, height);
  return new Uint8Array(image.get_bytes_jpeg(85));
}

function makePngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  view.setUint32(8, 13, false); // IHDR chunk length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function makeWebpVp8xHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  // chunk data starts at 20: flags(1) + reserved(3) + width-1 (3, LE) + height-1 (3, LE)
  const w = width - 1;
  const h = height - 1;
  bytes[24] = w & 0xff;
  bytes[25] = (w >> 8) & 0xff;
  bytes[26] = (w >> 16) & 0xff;
  bytes[27] = h & 0xff;
  bytes[28] = (h >> 8) & 0xff;
  bytes[29] = (h >> 16) & 0xff;
  return bytes;
}

describe("readImageDimensionsFromHeader", () => {
  it("reads width/height from a real decodable JPEG's SOF0 header", () => {
    const result = readImageDimensionsFromHeader(makeRealJpeg(37, 51));
    expect(result).toEqual({ width: 37, height: 51 });
  });

  it("reads width/height from a maliciously huge JPEG header without any real scan data", () => {
    const bytes = new Uint8Array(11);
    const view = new DataView(bytes.buffer);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    bytes[2] = 0xff;
    bytes[3] = 0xc0;
    view.setUint16(4, 7, false);
    bytes[6] = 8;
    view.setUint16(7, 30000, false);
    view.setUint16(9, 30000, false);

    expect(readImageDimensionsFromHeader(bytes)).toEqual({ width: 30000, height: 30000 });
  });

  it("reads width/height from a PNG IHDR chunk", () => {
    expect(readImageDimensionsFromHeader(makePngHeader(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("reads width/height from a WebP VP8X chunk", () => {
    expect(readImageDimensionsFromHeader(makeWebpVp8xHeader(1024, 768))).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it("returns null for bytes that don't match any recognized header", () => {
    expect(readImageDimensionsFromHeader(new TextEncoder().encode("not an image"))).toBeNull();
  });

  it("returns null for an empty/too-short input", () => {
    expect(readImageDimensionsFromHeader(new Uint8Array(0))).toBeNull();
  });
});
