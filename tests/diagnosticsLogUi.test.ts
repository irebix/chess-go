import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("diagnostics log UI", () => {
  it("renders logs as explicitly selectable text for mouse selection and native copy", () => {
    const app = readFileSync(resolve("src/app/App.tsx"), "utf8");
    const styles = readFileSync(resolve("src/styles.css"), "utf8");
    const logsRule = styles.match(/\.logs\s*\{([\s\S]*?)\}/)?.[1] ?? "";

    expect(app).toContain("<textarea");
    expect(app).toContain('className="logs"');
    expect(app).toContain("readOnly");
    expect(app).toContain("value={displayedLogs}");
    expect(app).not.toContain('<pre className="logs">');
    expect(logsRule).toContain("cursor: text;");
    expect(logsRule).toContain("width: 100%;");
    expect(logsRule).toContain("resize: none;");
    expect(logsRule).toContain("background-color: var(--uxp-host-widget-background-color, #444);");
    expect(logsRule).toContain("-webkit-user-select: text;");
    expect(logsRule).toContain("user-select: text;");
    expect(logsRule).not.toContain("user-select: none;");
    expect(app).toContain("发现 {pluginUpdate.latestVersion}。");
    expect(app).not.toContain("更新会自动使用当前插件注册位置");
    expect(app).not.toContain("diagnostics-update-note");
    expect(app).toContain('status: "idle"');
    expect(app).toContain('status: "installed"');
    expect(app).toContain("updateInstalled.current = true");
    expect(app).toContain("升级成功，重启 Photoshop 后生效。");
    expect(app).toContain("尚未检查更新。");
    expect(app).toContain("检查更新");
    expect(app).not.toContain('window.addEventListener("focus", handleWindowFocus)');
    expect(app).not.toContain("if (!showDiagnostics) void checkForPluginRelease()");
  });
});
