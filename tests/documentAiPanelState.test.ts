import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("document AI panel state", () => {
  it("keeps document AI panels mounted while unsupported documents hide them", () => {
    const source = readFileSync(resolve("src/app/App.tsx"), "utf8");
    const visibilityRule = /style=\{\{ display: activePhotoshopDocumentId !== null \? "block" : "none" \}\}/g;

    expect(source.match(visibilityRule)).toHaveLength(3);
    expect(source).not.toContain("key={`ai-edit-${activePhotoshopDocumentId}`}");
    expect(source).not.toContain("key={`ai-outline-${activePhotoshopDocumentId}`}");
    expect(source).not.toContain("key={`ai-refine-${activePhotoshopDocumentId}`}");
    expect(source).not.toContain("{activePhotoshopDocumentId !== null ? (");
  });
});
