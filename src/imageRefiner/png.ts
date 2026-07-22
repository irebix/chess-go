import type { CenterlinePixelSource } from "../centerline/types";
import { CENTERLINE_MAX_UPLOAD_PIXELS } from "../centerline/config";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export function pixelsToPng(pixelSource: CenterlinePixelSource): Uint8Array {
  const { width, height, components, bytes } = pixelSource;
  const pixelCount = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Photoshop 返回了无效的图层尺寸。");
  }
  if (pixelCount > CENTERLINE_MAX_UPLOAD_PIXELS) {
    throw new Error(`图层像素数超过安全上限 ${CENTERLINE_MAX_UPLOAD_PIXELS}。`);
  }
  if (!(bytes instanceof Uint8Array) || !Number.isInteger(components) || components < 1) {
    throw new Error("Photoshop 返回了无效的图层像素。");
  }
  if (bytes.byteLength < pixelCount * components) {
    throw new Error("Photoshop 返回的图层像素长度不足。");
  }

  const scanlines = new Uint8Array(height * (1 + width * 4));
  let sourceOffset = 0;
  let outputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    scanlines[outputOffset++] = 0;
    for (let x = 0; x < width; x += 1) {
      const grayscale = components < 3;
      const red = bytes[sourceOffset]!;
      const green = grayscale ? red : bytes[sourceOffset + 1]!;
      const blue = grayscale ? red : bytes[sourceOffset + 2]!;
      const alpha = components === 2
        ? bytes[sourceOffset + 1]!
        : components >= 4
          ? bytes[sourceOffset + 3]!
          : 255;
      scanlines[outputOffset++] = red;
      scanlines[outputOffset++] = green;
      scanlines[outputOffset++] = blue;
      scanlines[outputOffset++] = alpha;
      sourceOffset += components;
    }
  }

  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const idat = zlibStore(scanlines);
  return concatenate([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array())
  ]);
}

function zlibStore(data: Uint8Array): Uint8Array {
  const blockCount = Math.max(1, Math.ceil(data.byteLength / 65_535));
  const output = new Uint8Array(2 + data.byteLength + blockCount * 5 + 4);
  output[0] = 0x78;
  output[1] = 0x01;
  let sourceOffset = 0;
  let outputOffset = 2;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const remaining = data.byteLength - sourceOffset;
    const length = Math.min(65_535, Math.max(0, remaining));
    output[outputOffset++] = blockIndex === blockCount - 1 ? 1 : 0;
    output[outputOffset++] = length & 0xff;
    output[outputOffset++] = (length >>> 8) & 0xff;
    const inverse = (~length) & 0xffff;
    output[outputOffset++] = inverse & 0xff;
    output[outputOffset++] = (inverse >>> 8) & 0xff;
    output.set(data.subarray(sourceOffset, sourceOffset + length), outputOffset);
    outputOffset += length;
    sourceOffset += length;
  }
  writeUint32(output, outputOffset, adler32(data));
  return output;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = asciiBytes(type);
  const output = new Uint8Array(12 + data.byteLength);
  writeUint32(output, 0, data.byteLength);
  output.set(typeBytes, 4);
  output.set(data, 8);
  writeUint32(output, 8 + data.byteLength, crc32(concatenate([typeBytes, data])));
  return output;
}

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0) & 0xff);
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let index = 0; index < data.byteLength; index += 1) {
    a = (a + data[index]!) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

function crc32(data: Uint8Array): number {
  let value = 0xffffffff;
  for (let index = 0; index < data.byteLength; index += 1) {
    value ^= data[index]!;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
