import { describe, expect, it } from "vitest";
import manifest from "../manifest.json";

describe("UXP manifest", () => {
  it("allows the local ComfyUI HTTP endpoint using the UXP-supported network form", () => {
    expect(manifest.requiredPermissions.network.domains).toBe("all");
  });
});
