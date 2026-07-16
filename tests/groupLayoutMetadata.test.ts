import { describe, expect, it } from "vitest";
import {
  GROUP_LAYOUT_METADATA_TEXT_PREFIX,
  parseGroupLayoutMetadata,
  serializeGroupLayoutMetadata,
  type GroupLayoutMetadataGroup
} from "../src/domain/groupLayoutMetadata";

const groups: GroupLayoutMetadataGroup[] = [
  {
    artboardId: 501,
    label: "配方",
    rect: { left: 24, top: 14, right: 420, bottom: 220 },
    members: [
      { artboardId: 101, row: 0, col: 0, name: "清洁布" },
      { artboardId: 102, row: 0, col: 1, name: "海绵块" }
    ]
  },
  {
    artboardId: 502,
    label: "交通工具",
    rect: { left: 24, top: 250, right: 420, bottom: 456 },
    members: [{ artboardId: 103, row: 1, col: 0 }]
  }
];

const background = {
  color: { red: 199, green: 212, blue: 226 },
  visible: true
};

describe("single-layer group layout metadata", () => {
  it("round-trips all group and item layout data", () => {
    const encoded = serializeGroupLayoutMetadata(groups, 30, background);
    const decoded = parseGroupLayoutMetadata(encoded);

    expect(decoded).toEqual({
      schema: "chess-go-layout",
      version: 5,
      spacing: 30,
      itemCount: 3,
      background,
      groups
    });
  });

  it("uses quote-free text that Photoshop cannot smart-quote", () => {
    const encoded = serializeGroupLayoutMetadata(groups, 30, background);
    expect(encoded.startsWith(GROUP_LAYOUT_METADATA_TEXT_PREFIX)).toBe(true);
    expect(encoded).not.toMatch(/[\"'“”〝〞]/);
  });

  it("rejects truncated or foreign data", () => {
    const encoded = serializeGroupLayoutMetadata(groups, 30, background);
    expect(parseGroupLayoutMetadata(encoded.slice(0, -5))).toBeUndefined();
    expect(parseGroupLayoutMetadata('{"schema":"chess-go-layout","version":3}')).toBeUndefined();
  });

  it("rejects duplicate item ids and grid cells", () => {
    const duplicateId = structuredClone(groups);
    duplicateId[1]!.members[0]!.artboardId = 101;
    const duplicateCell = structuredClone(groups);
    duplicateCell[1]!.members[0]!.row = 0;
    expect(() => serializeGroupLayoutMetadata(duplicateId, 30, background)).toThrow();
    expect(() => serializeGroupLayoutMetadata(duplicateCell, 30, background)).toThrow();
  });

  it("persists transparent state with the chosen restore color", () => {
    const hidden = { ...background, visible: false };
    const decoded = parseGroupLayoutMetadata(serializeGroupLayoutMetadata(groups, 18, hidden));
    expect(decoded?.background).toEqual(hidden);
  });
});
