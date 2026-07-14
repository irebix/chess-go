export interface ActionDescriptor {
  _obj: string;
  [key: string]: unknown;
}

export interface ArtboardRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function makeArtboardDescriptor(name: string, rect: ArtboardRect): ActionDescriptor {
  return {
    _obj: "make",
    _target: [{ _ref: "artboardSection" }],
    using: {
      _obj: "artboardSection",
      name
    },
    artboardRect: {
      _obj: "classFloatRect",
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right
    },
    _options: { dialogOptions: "dontDisplay" }
  };
}

export function getArtboardDescriptor(layerId: number): ActionDescriptor {
  return {
    _obj: "get",
    _target: [
      { _property: "artboard" },
      { _ref: "layer", _id: layerId }
    ],
    _options: { dialogOptions: "dontDisplay" }
  };
}

export function moveLayerDescriptor(
  layerId: number,
  horizontal: number,
  vertical: number
): ActionDescriptor {
  return {
    _obj: "move",
    _target: [{ _ref: "layer", _id: layerId }],
    to: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: horizontal },
      vertical: { _unit: "pixelsUnit", _value: vertical }
    },
    _options: { dialogOptions: "dontDisplay" }
  };
}

export function selectLayerDescriptor(
  layerId: number,
  addToSelection = false
): ActionDescriptor {
  return {
    _obj: "select",
    _target: [{ _ref: "layer", _id: layerId }],
    ...(addToSelection ? {
      selectionModifier: {
        _enum: "selectionModifierType",
        _value: "addToSelection"
      }
    } : {}),
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" }
  };
}

export function makeArtboardTransparentDescriptor(): ActionDescriptor {
  return {
    _obj: "editArtboardEvent",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    artboard: {
      _obj: "artboard",
      artboardBackgroundType: 3
    },
    changeBackground: 1,
    _options: { dialogOptions: "dontDisplay" }
  };
}

export function makeArtboardColorDescriptor(
  color: { red: number; green: number; blue: number }
): ActionDescriptor {
  return {
    _obj: "editArtboardEvent",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    artboard: {
      _obj: "artboard",
      color: {
        _obj: "RGBColor",
        red: color.red,
        grain: color.green,
        blue: color.blue
      },
      artboardBackgroundType: 4
    },
    changeBackground: 1,
    _options: { dialogOptions: "dontDisplay" }
  };
}

export function makeArtboardBackgroundBatchDescriptors(
  layerIds: number[],
  color: { red: number; green: number; blue: number } | null
): ActionDescriptor[] {
  return layerIds.flatMap((layerId) => [
    selectLayerDescriptor(layerId),
    color
      ? makeArtboardColorDescriptor(color)
      : makeArtboardTransparentDescriptor()
  ]);
}

export function setLayerGroupExpandedDescriptor(
  layerId: number,
  expanded: boolean
): ActionDescriptor {
  return {
    _obj: "set",
    _target: {
      _ref: [
        { _property: "layerSectionExpanded" },
        { _ref: "layer", _id: layerId }
      ]
    },
    to: expanded,
    _options: { dialogOptions: "dontDisplay" }
  };
}

export function placeEmbeddedDescriptor(sessionToken: string): ActionDescriptor {
  return {
    _obj: "placeEvent",
    null: {
      _path: sessionToken,
      _kind: "local"
    },
    freeTransformCenterState: {
      _enum: "quadCenterState",
      _value: "QCSAverage"
    },
    _options: { dialogOptions: "dontDisplay" }
  };
}
