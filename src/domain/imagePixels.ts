export function rgbOrRgbaToRgba(
  pixels: Uint8Array,
  width: number,
  height: number,
  components: number
): Uint8Array {
  const pixelCount = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("PSD 参考图原始像素尺寸无效。");
  }
  if ((components !== 3 && components !== 4) || pixels.byteLength !== pixelCount * components) {
    throw new Error("PSD 参考图原始像素格式无效。");
  }
  if (components === 4) return new Uint8Array(pixels);
  const rgba = new Uint8Array(pixelCount * 4);
  for (let source = 0, target = 0; source < pixels.length; source += 3, target += 4) {
    rgba[target] = pixels[source]!;
    rgba[target + 1] = pixels[source + 1]!;
    rgba[target + 2] = pixels[source + 2]!;
    rgba[target + 3] = 255;
  }
  return rgba;
}
