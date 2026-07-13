import { describe, expect, it } from "vitest";
import { smartObjectBoundsFromDescriptor } from "../src/photoshop/smartObjectBounds";

describe("smartObjectBoundsFromDescriptor", () => {
  it("reads the transformed four corners of a transparent smart object", () => {
    expect(smartObjectBoundsFromDescriptor({
      smartObjectMore: {
        transform: [10, 20, 158, 20, 158, 168, 10, 168]
      }
    })).toEqual({ left: 10, top: 20, right: 158, bottom: 168 });
  });

  it("accepts non-affine transform data", () => {
    expect(smartObjectBoundsFromDescriptor({
      smartObjectMore: {
        nonAffineTransform: [4, 8, 152, 8, 152, 156, 4, 156]
      }
    })).toEqual({ left: 4, top: 8, right: 152, bottom: 156 });
  });

  it("rejects a missing transform", () => {
    expect(() => smartObjectBoundsFromDescriptor({ smartObjectMore: {} }))
      .toThrow("变换四角");
  });
});
