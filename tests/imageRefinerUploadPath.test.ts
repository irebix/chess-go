import { describe, expect, it } from "vitest";
import { resolveImageRefinerUploadPath } from "../src/imageRefiner/uploadPath";

describe("AI image refiner upload paths", () => {
  it("uses the UXP-returned blob name inside an isolated layer directory", () => {
    expect(resolveImageRefinerUploadPath(
      { name: "blob", subfolder: "chessgo_image_refiner/run-101/001" },
      "chessgo_image_refiner/run-101",
      "chessgo_image_refiner/run-101/001"
    )).toEqual({ filename: "001/blob" });
  });

  it("rejects renamed directories and traversal-like server names", () => {
    expect(() => resolveImageRefinerUploadPath(
      { name: "blob", subfolder: "chessgo_image_refiner/run-101/002" },
      "chessgo_image_refiner/run-101",
      "chessgo_image_refiner/run-101/001"
    )).toThrow(/意外目录/);
    expect(() => resolveImageRefinerUploadPath(
      { name: "../blob", subfolder: "chessgo_image_refiner/run-101/001" },
      "chessgo_image_refiner/run-101",
      "chessgo_image_refiner/run-101/001"
    )).toThrow(/不安全/);
  });
});
