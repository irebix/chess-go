import { describe, expect, it } from "vitest";
import { parseRecentWorkbookRecord } from "../src/domain/recentWorkbook";

describe("parseRecentWorkbookRecord", () => {
  it("accepts a valid persistent-token record", () => {
    expect(parseRecentWorkbookRecord(JSON.stringify({
      version: 1,
      token: "persistent-token",
      name: "M图标月度安排2.xlsx",
      rememberedAt: "2026-07-12T00:00:00.000Z"
    }))).toMatchObject({ token: "persistent-token", name: "M图标月度安排2.xlsx" });
  });

  it("rejects malformed, stale-version and non-xlsx records", () => {
    expect(parseRecentWorkbookRecord("not-json")).toBeNull();
    expect(parseRecentWorkbookRecord(JSON.stringify({ version: 2, token: "x", name: "a.xlsx" }))).toBeNull();
    expect(parseRecentWorkbookRecord(JSON.stringify({
      version: 1,
      token: "x",
      name: "a.txt",
      rememberedAt: "2026-07-12T00:00:00.000Z"
    }))).toBeNull();
  });
});
