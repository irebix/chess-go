import { describe, expect, it } from "vitest";
import {
  isReadyResultAvailableForActiveDocument,
  shouldReportStoredOutlineAsReady
} from "../src/centerline/readyResultScope";

const source = {
  documentId: 41,
  layerId: 7
};

describe("AI outline ready-result document scope", () => {
  it("shows the ready result only in its source document", () => {
    expect(isReadyResultAvailableForActiveDocument(source, 41, true)).toBe(true);
    expect(isReadyResultAvailableForActiveDocument(source, 52, true)).toBe(false);
  });

  it("hides the ready result when no document is active or the source layer is gone", () => {
    expect(isReadyResultAvailableForActiveDocument(source, null, true)).toBe(false);
    expect(isReadyResultAvailableForActiveDocument(source, 41, false)).toBe(false);
  });

  it("keeps a completed path result ready even while Photoshop source lookup is settling", () => {
    expect(shouldReportStoredOutlineAsReady(source)).toBe(true);
    expect(shouldReportStoredOutlineAsReady(null)).toBe(false);
  });
});
