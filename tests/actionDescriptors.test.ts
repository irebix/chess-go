import { describe, expect, it } from "vitest";
import {
  convertSelectedLayerToEmbeddedSmartObjectDescriptor,
  getArtboardDescriptor,
  makeArtboardBackgroundBatchDescriptors,
  makeArtboardColorDescriptor,
  makeArtboardTransparentDescriptor,
  moveLayerDescriptor,
  replacePlacedLayerContentsDescriptor,
  selectLayerDescriptor,
  setLayerGroupExpandedDescriptor
} from "../src/photoshop/actionDescriptors";

describe("artboard action descriptors", () => {
  it("targets an artboard property by stable layer id", () => {
    expect(getArtboardDescriptor(42)).toEqual({
      _obj: "get",
      _target: [
        { _property: "artboard" },
        { _ref: "layer", _id: 42 }
      ],
      _options: { dialogOptions: "dontDisplay" }
    });
  });

  it("moves a layer by a pixel offset without changing its id", () => {
    expect(moveLayerDescriptor(42, 80, -30)).toEqual({
      _obj: "move",
      _target: [{ _ref: "layer", _id: 42 }],
      to: {
        _obj: "offset",
        horizontal: { _unit: "pixelsUnit", _value: 80 },
        vertical: { _unit: "pixelsUnit", _value: -30 }
      },
      _options: { dialogOptions: "dontDisplay" }
    });
  });

  it("selects an artboard by stable layer id without revealing it", () => {
    expect(selectLayerDescriptor(42)).toEqual({
      _obj: "select",
      _target: [{ _ref: "layer", _id: 42 }],
      makeVisible: false,
      _options: { dialogOptions: "dontDisplay" }
    });
    expect(selectLayerDescriptor(43, true)).toEqual({
      _obj: "select",
      _target: [{ _ref: "layer", _id: 43 }],
      selectionModifier: {
        _enum: "selectionModifierType",
        _value: "addToSelection"
      },
      makeVisible: false,
      _options: { dialogOptions: "dontDisplay" }
    });
  });

  it("sets the selected artboard's own background to transparent", () => {
    expect(makeArtboardTransparentDescriptor()).toEqual({
      _obj: "editArtboardEvent",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      artboard: {
        _obj: "artboard",
        artboardBackgroundType: 3
      },
      changeBackground: 1,
      _options: { dialogOptions: "dontDisplay" }
    });
  });

  it("sets the selected artboard's own custom background color", () => {
    expect(makeArtboardColorDescriptor({ red: 199, green: 212, blue: 226 })).toEqual({
      _obj: "editArtboardEvent",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      artboard: {
        _obj: "artboard",
        color: {
          _obj: "RGBColor",
          red: 199,
          grain: 212,
          blue: 226
        },
        artboardBackgroundType: 4
      },
      changeBackground: 1,
      _options: { dialogOptions: "dontDisplay" }
    });
  });

  it("selects every artboard immediately before editing its background", () => {
    const descriptors = makeArtboardBackgroundBatchDescriptors(
      [42, 43],
      { red: 10, green: 20, blue: 30 }
    );

    expect(descriptors).toHaveLength(4);
    expect(descriptors[0]).toEqual(selectLayerDescriptor(42));
    expect(descriptors[1]).toEqual(makeArtboardColorDescriptor({ red: 10, green: 20, blue: 30 }));
    expect(descriptors[2]).toEqual(selectLayerDescriptor(43));
    expect(descriptors[3]).toEqual(makeArtboardColorDescriptor({ red: 10, green: 20, blue: 30 }));
  });

  it("collapses one layer group without changing the selected layer", () => {
    expect(setLayerGroupExpandedDescriptor(84, false)).toEqual({
      _obj: "set",
      _target: {
        _ref: [
          { _property: "layerSectionExpanded" },
          { _ref: "layer", _id: 84 }
        ]
      },
      to: false,
      _options: { dialogOptions: "dontDisplay" }
    });
  });

  it("replaces the selected placed layer from a UXP session token", () => {
    expect(replacePlacedLayerContentsDescriptor("session-token")).toEqual({
      _obj: "placedLayerReplaceContents",
      null: {
        _path: "session-token",
        _kind: "local"
      },
      _options: { dialogOptions: "dontDisplay" }
    });
  });

  it("wraps the selected placed file in a native embedded PSB smart object", () => {
    expect(convertSelectedLayerToEmbeddedSmartObjectDescriptor()).toEqual({
      _obj: "newPlacedLayer",
      _options: { dialogOptions: "dontDisplay" }
    });
  });
});
