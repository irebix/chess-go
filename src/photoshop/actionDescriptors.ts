interface ActionDescriptor {
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
