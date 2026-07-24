import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("diagnostics log UI", () => {
  it("renders logs as explicitly selectable text for mouse selection and native copy", () => {
    const app = readFileSync(resolve("src/app/App.tsx"), "utf8");
    const styles = readFileSync(resolve("src/styles.css"), "utf8");
    const logsRule = styles.match(/\.logs\s*\{([\s\S]*?)\}/)?.[1] ?? "";

    expect(app).toContain('<pre className="logs">{formattedLogs || "尚无日志。"}</pre>');
    expect(logsRule).toContain("cursor: text;");
    expect(logsRule).toContain("-webkit-user-select: text;");
    expect(logsRule).toContain("user-select: text;");
    expect(logsRule).not.toContain("user-select: none;");
    expect(app).toContain("发现 {pluginUpdate.latestVersion}。");
    expect(app).not.toContain("更新会自动使用当前插件注册位置");
    expect(app).not.toContain("diagnostics-update-note");
  });
});
