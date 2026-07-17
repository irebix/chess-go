import { describe, expect, it } from "vitest";
import {
  isStablePsdDocumentIdentity,
  normalizePsdDocumentPath,
  psdDocumentIdentity
} from "../src/photoshop/psdDocumentIdentity";

describe("PSD document identity", () => {
  it("normalizes a saved local path independently of slash and case", () => {
    expect(psdDocumentIdentity({ id: 1, path: "D:\\Work\\Cleaning.PSD" }, "session-a"))
      .toBe("file:d:/work/cleaning.psd");
    expect(psdDocumentIdentity({ id: 99, path: "d:/work/cleaning.psd" }, "session-b"))
      .toBe("file:d:/work/cleaning.psd");
  });

  it("does not treat a filename as a stable saved-document identity", () => {
    expect(normalizePsdDocumentPath("cleaning.psd")).toBeUndefined();
    expect(psdDocumentIdentity({ id: 7, path: "cleaning.psd" }, "session-a"))
      .toBe("session:session-a:document:7");
  });

  it("keeps unsaved document identities inside one plugin session", () => {
    expect(psdDocumentIdentity({ id: 7 }, "session-a"))
      .toBe("session:session-a:document:7");
    expect(psdDocumentIdentity({ id: 7 }, "session-b"))
      .not.toBe(psdDocumentIdentity({ id: 7 }, "session-a"));
    expect(isStablePsdDocumentIdentity("session:session-a:document:7")).toBe(false);
  });

  it("uses a cloud identifier as the stable identity", () => {
    expect(psdDocumentIdentity({ id: 3, path: "cloud-folder/ChessGo", cloudDocument: true }))
      .toBe("cloud:cloud-folder/ChessGo");
    expect(isStablePsdDocumentIdentity("cloud:cloud-folder/ChessGo")).toBe(true);
    expect(isStablePsdDocumentIdentity("file:d:/work/cleaning.psd")).toBe(true);
  });
});
