import { describe, expect, it } from "vitest";
import {
  findEditableCanvasTargets,
  listPsdAiTargetNodes,
  listUniqueEditableCanvasAssetCodes,
  preferredEditableCanvasLayerName,
  scopePsdAiTargetNodes,
  type CandidateTargetDocument,
  type CandidateTargetLayer
} from "../src/photoshop/aiCandidateTarget";
import type { GroupLayoutMetadataGroup } from "../src/domain/groupLayoutMetadata";

function layer(
  id: number,
  name: string,
  layers?: CandidateTargetLayer[]
): CandidateTargetLayer {
  return { id, name, ...(layers ? { layers } : {}) };
}

describe("AI candidate target discovery", () => {
  it("keeps reference artboards visible even when the editable smart object is missing", () => {
    const artboards = [
      layer(1, "c_cleaning1", [
        layer(11, "1024x1024_空白智能对象"),
        layer(12, "参考图")
      ]),
      layer(2, "c_cleaning2", [layer(21, "参考图")]),
      layer(3, "c_duplicate", [layer(31, "1024x1024_空白智能对象")]),
      layer(4, "c_duplicate", [layer(41, "1024x1024_空白智能对象")])
    ];
    const document: CandidateTargetDocument = { layers: artboards, artboards };

    expect(listUniqueEditableCanvasAssetCodes(document)).toEqual(["c_cleaning1"]);
    expect(listPsdAiTargetNodes(document)).toEqual([
      {
        assetCode: "c_cleaning1",
        artboardId: 1,
        referenceLayerId: 12,
        targetLayerId: 11
      },
      {
        assetCode: "c_cleaning2",
        artboardId: 2,
        referenceLayerId: 21,
        targetIssue: "missing"
      }
    ]);
    expect(findEditableCanvasTargets(document, "c_duplicate")).toHaveLength(2);
  });

  it("finds an editable smart object nested below an item artboard", () => {
    const artboard = layer(1, "dish_1", [
      layer(10, "内容", [layer(11, "2048x2048_空白智能对象")])
    ]);
    const document: CandidateTargetDocument = { layers: [artboard], artboards: [artboard] };

    expect(listUniqueEditableCanvasAssetCodes(document)).toEqual(["dish_1"]);
  });

  it("uses stored member artboard ids to avoid unrelated duplicate names", () => {
    const expected = layer(1, "c_cleaning1", [
      layer(11, "512x512_空白智能对象"),
      layer(12, "参考图")
    ]);
    const unrelated = layer(2, "c_cleaning1", [
      layer(21, "512x512_空白智能对象"),
      layer(22, "参考图")
    ]);
    const document: CandidateTargetDocument = {
      layers: [expected, unrelated],
      artboards: [expected, unrelated]
    };

    expect(listPsdAiTargetNodes(document)).toEqual([]);
    expect(listPsdAiTargetNodes(document, "参考图", [1])).toEqual([{
      assetCode: "c_cleaning1",
      artboardId: 1,
      referenceLayerId: 12,
      targetLayerId: 11
    }]);
  });

  it("keeps the row without a target while Photoshop reports it outside the artboard collection", () => {
    const reference = layer(12, "参考图");
    const artboard = layer(1, "c_cleaning1", [reference]);
    const target = layer(11, "1024x1024_空白智能对象");
    const temporaryContainer = layer(90, "Photoshop temporary topology", [target]);
    const document: CandidateTargetDocument = {
      layers: [artboard, temporaryContainer],
      artboards: [artboard]
    };
    expect(listPsdAiTargetNodes(document, "参考图", [1])).toEqual([{
      assetCode: "c_cleaning1",
      artboardId: 1,
      referenceLayerId: 12,
      targetIssue: "missing"
    }]);
  });

  it("keeps the old row but does not associate a moved target id with it", () => {
    const first = layer(1, "c_cleaning1", [layer(12, "参考图")]);
    const movedTarget = layer(11, "1024x1024_空白智能对象");
    const second = layer(2, "c_cleaning2", [layer(22, "参考图"), movedTarget]);
    const document: CandidateTargetDocument = {
      layers: [first, second],
      artboards: [first, second]
    };

    expect(listPsdAiTargetNodes(document, "参考图", [1, 2])).toEqual([
      {
        assetCode: "c_cleaning1",
        artboardId: 1,
        referenceLayerId: 12,
        targetIssue: "missing"
      },
      {
        assetCode: "c_cleaning2",
        artboardId: 2,
        referenceLayerId: 22,
        targetLayerId: 11
      }
    ]);
  });

  it("reports a replacement target as a different stable identity", () => {
    const artboard = layer(1, "c_cleaning1", [
      layer(99, "1024x1024_空白智能对象"),
      layer(12, "参考图")
    ]);
    const document: CandidateTargetDocument = { layers: [artboard], artboards: [artboard] };

    expect(listPsdAiTargetNodes(document, "参考图", [1])).toEqual([{
      assetCode: "c_cleaning1",
      artboardId: 1,
      referenceLayerId: 12,
      targetLayerId: 99
    }]);
  });

  it("marks multiple editable smart objects as ambiguous without removing the row", () => {
    const artboard = layer(1, "c_cleaning1", [
      layer(11, "512x512_空白智能对象"),
      layer(13, "512x512_空白智能对象"),
      layer(12, "参考图")
    ]);
    const document: CandidateTargetDocument = { layers: [artboard], artboards: [artboard] };

    expect(listPsdAiTargetNodes(document)).toEqual([{
      assetCode: "c_cleaning1",
      artboardId: 1,
      referenceLayerId: 12,
      targetIssue: "ambiguous"
    }]);
  });

  it("uses the most common existing editable-canvas size for a repaired row", () => {
    const document: CandidateTargetDocument = {
      layers: [
        layer(1, "a", [layer(11, "512x512_空白智能对象")]),
        layer(2, "b", [layer(21, "512x512_空白智能对象")]),
        layer(3, "c", [layer(31, "1024x1024_空白智能对象")])
      ]
    };

    expect(preferredEditableCanvasLayerName(document, 1024)).toBe("512x512_空白智能对象");
    expect(preferredEditableCanvasLayerName({ layers: [] }, 1024)).toBe("1024x1024_空白智能对象");
  });

  it("restores chain labels and layout order from generated PSD metadata", () => {
    const groups: GroupLayoutMetadataGroup[] = [
      {
        artboardId: 101,
        label: "清洁工具",
        rect: { left: 0, top: 0, right: 100, bottom: 100 },
        members: [
          { artboardId: 2, row: 0, col: 1, name: "海绵块" },
          { artboardId: 1, row: 0, col: 0, name: "清洁布" }
        ]
      },
      {
        artboardId: 102,
        label: "厨房工具",
        rect: { left: 0, top: 100, right: 100, bottom: 200 },
        members: [{ artboardId: 3, row: 1, col: 0 }]
      }
    ];
    const nodes = [
      { assetCode: "cleaning_2", artboardId: 2, referenceLayerId: 22, targetLayerId: 21 },
      { assetCode: "cleaning_1", artboardId: 1, referenceLayerId: 12, targetLayerId: 11 },
      { assetCode: "kitchen_1", artboardId: 3, referenceLayerId: 32, targetLayerId: 31 }
    ];

    expect(scopePsdAiTargetNodes(77, nodes, groups)).toEqual([
      expect.objectContaining({
        assetCode: "cleaning_1",
        groupId: "psd:77:group:101",
        groupLabel: "清洁工具",
        memberRow: 0,
        memberCol: 0,
        itemName: "清洁布"
      }),
      expect.objectContaining({
        assetCode: "cleaning_2",
        groupId: "psd:77:group:101",
        groupLabel: "清洁工具",
        memberRow: 0,
        memberCol: 1,
        itemName: "海绵块"
      }),
      expect.objectContaining({
        assetCode: "kitchen_1",
        groupId: "psd:77:group:102",
        groupLabel: "厨房工具",
        memberRow: 1,
        memberCol: 0
      })
    ]);
  });
});
