import { describe, expect, it } from "vitest";
import manifest from "../manifest.json";

describe("UXP manifest", () => {
  it("publishes the standard-grid release without changing host startup boundaries", () => {
    expect(manifest.version).toBe("0.8.1");
    expect(manifest.host.minVersion).toBe("24.2.0");
    expect(manifest.host.data.loadEvent).toBe("use");
  });

  it("allows the local ComfyUI HTTP endpoint using the UXP-supported network form", () => {
    expect(manifest.requiredPermissions.network.domains).toBe("all");
  });

  it("allows explicit browser viewing of local HTTP candidates", () => {
    expect(manifest.requiredPermissions.launchProcess).toEqual({
      schemes: ["http"],
      extensions: []
    });
  });

  it("allows the panel to grow tall without changing its preferred size", () => {
    const panel = manifest.entrypoints[0];
    expect(panel?.preferredFloatingSize.height).toBe(720);
    expect(panel?.maximumSize.height).toBe(2000);
  });
});
