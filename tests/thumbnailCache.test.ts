import { describe, expect, it } from "vitest";
import { ThumbnailCache } from "../src/services/ThumbnailCache";

describe("ThumbnailCache", () => {
  it("uses LRU order and enforces the configured limit", () => {
    const cache = new ThumbnailCache(2);
    cache.set("a", "A");
    cache.set("b", "B");
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C");

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("A");
    expect(cache.get("c")).toBe("C");
    expect(cache.size).toBe(2);
  });

  it("supports explicit removal and clearing", () => {
    const cache = new ThumbnailCache(2);
    cache.set("a", "A");
    cache.delete("a");
    expect(cache.size).toBe(0);
    cache.set("b", "B");
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
