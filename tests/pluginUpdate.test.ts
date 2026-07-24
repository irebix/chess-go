import { beforeEach, describe, expect, it, vi } from "vitest";

const uxpMocks = vi.hoisted(() => ({
  openPath: vi.fn(),
  getPluginFolder: vi.fn(),
  getTemporaryFolder: vi.fn(),
  getNativePath: vi.fn()
}));

vi.mock("uxp", () => ({
  shell: {
    openPath: uxpMocks.openPath
  },
  storage: {
    formats: { utf8: "utf8", binary: "binary" },
    localFileSystem: {
      getPluginFolder: uxpMocks.getPluginFolder,
      getTemporaryFolder: uxpMocks.getTemporaryFolder,
      getNativePath: uxpMocks.getNativePath
    }
  }
}));

import {
  CHESSGO_BUNDLED_INSTALLER,
  CHESSGO_PLUGIN_ID,
  CHESSGO_RELEASE_API_URL,
  CHESSGO_UPDATE_CHECK_INTERVAL_MS,
  CHESSGO_UPDATE_LAUNCHER,
  CHESSGO_UPDATE_STATUS_FILE,
  checkPluginUpdate,
  comparePluginVersions,
  launchPluginUpdate
} from "../src/update/pluginUpdate";

describe("UXP plugin update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("compares three-part release versions numerically", () => {
    expect(CHESSGO_UPDATE_CHECK_INTERVAL_MS).toBe(10 * 60 * 1000);
    expect(comparePluginVersions("0.8.8", "0.8.7")).toBeGreaterThan(0);
    expect(comparePluginVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(comparePluginVersions("1.0.0", "1.0.0")).toBe(0);
    expect(comparePluginVersions("0.8.6", "0.8.7")).toBeLessThan(0);
    expect(() => comparePluginVersions("0.8", "0.8.7")).toThrow("三段式版本号");
  });

  it("pins the manifest read to the checked release commit", async () => {
    const releaseSha = "a".repeat(40);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ sha: releaseSha }))
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: 1,
        pluginId: CHESSGO_PLUGIN_ID,
        pluginVersion: "0.8.8"
      }));

    await expect(checkPluginUpdate(fetchImpl, "0.8.7")).resolves.toEqual({
      currentVersion: "0.8.7",
      latestVersion: "0.8.8",
      releaseSha,
      updateAvailable: true
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      CHESSGO_RELEASE_API_URL,
      expect.objectContaining({ cache: "no-store", credentials: "omit" })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `https://raw.githubusercontent.com/irebix/chess-go/${releaseSha}/release-manifest.json`,
      expect.objectContaining({ cache: "no-store", credentials: "omit" })
    );
  });

  it("does not offer a downgrade and rejects an unrelated manifest", async () => {
    const releaseSha = "b".repeat(40);
    const currentFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ sha: releaseSha }))
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: 1,
        pluginId: CHESSGO_PLUGIN_ID,
        pluginVersion: "0.8.7"
      }));
    await expect(checkPluginUpdate(currentFetch, "0.8.8")).resolves.toMatchObject({
      updateAvailable: false,
      latestVersion: "0.8.7"
    });

    const unrelatedFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ sha: releaseSha }))
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: 1,
        pluginId: "com.example.other",
        pluginVersion: "9.9.9"
      }));
    await expect(checkPluginUpdate(unrelatedFetch, "0.8.7"))
      .rejects.toThrow("不属于棋子go");
  });

  it("copies the bundled installer to UXP temp and opens a hidden internal update launcher", async () => {
    const installerContent = [
      "@echo off",
      ":__CHESSGO_SELF_UPDATE_POWERSHELL__",
      ":__CHESSGO_POWERSHELL__",
      `$pluginId = "${CHESSGO_PLUGIN_ID}"`,
      "x".repeat(10_000)
    ].join("\r\n");
    const installerWrites: unknown[] = [];
    const launcherWrites: unknown[] = [];
    const statusWrites: unknown[] = [];
    const progressEvents: unknown[] = [];
    const temporaryInstaller = {
      name: CHESSGO_BUNDLED_INSTALLER,
      isFile: true,
      write: vi.fn((value: unknown) => {
        installerWrites.push(value);
        return Promise.resolve();
      })
    };
    const launcher = {
      name: CHESSGO_UPDATE_LAUNCHER,
      isFile: true,
      nativePath: "C:\\Temp\\StartChessGoUpdate.vbs",
      write: vi.fn((value: unknown) => {
        launcherWrites.push(value);
        return Promise.resolve();
      })
    };
    const statusFile = {
      name: CHESSGO_UPDATE_STATUS_FILE,
      isFile: true,
      nativePath: "C:\\Temp\\ChessGoUpdateStatus.jsonl",
      write: vi.fn((value: unknown) => {
        statusWrites.push(value);
        return Promise.resolve();
      }),
      read: vi.fn().mockResolvedValue(JSON.stringify({
        id: "a".repeat(32),
        kind: "success",
        stage: "completed",
        detail: "0.8.10"
      }))
    };
    const temporaryFolder = {
      createFile: vi.fn((name: string) => {
        if (name === CHESSGO_BUNDLED_INSTALLER) return Promise.resolve(temporaryInstaller);
        if (name === CHESSGO_UPDATE_STATUS_FILE) return Promise.resolve(statusFile);
        return Promise.resolve(launcher);
      })
    };
    uxpMocks.getPluginFolder.mockResolvedValue({
      getEntry: vi.fn().mockResolvedValue({
        name: CHESSGO_BUNDLED_INSTALLER,
        isFile: true,
        read: vi.fn().mockResolvedValue(installerContent)
      })
    });
    uxpMocks.getTemporaryFolder.mockResolvedValue(temporaryFolder);
    uxpMocks.openPath.mockResolvedValue("");

    await expect(launchPluginUpdate((progress) => {
      progressEvents.push(progress);
    })).resolves.toEqual({
      outcome: "success",
      message: "棋子go 0.8.10 更新完成，请重启 Photoshop。"
    });

    expect(installerWrites).toEqual([installerContent]);
    expect(statusWrites).toEqual(["\r\n"]);
    expect(statusWrites[0]).not.toBe("");
    expect(temporaryFolder.createFile).toHaveBeenCalledWith(
      CHESSGO_UPDATE_LAUNCHER,
      { overwrite: true }
    );
    expect(String(launcherWrites[0])).toContain('CreateObject("WScript.Shell")');
    expect(String(launcherWrites[0])).toContain(CHESSGO_BUNDLED_INSTALLER);
    expect(String(launcherWrites[0])).toContain(statusFile.nativePath);
    expect(String(launcherWrites[0])).toContain("CHESSGO_UPDATE_STATUS_FILE");
    expect(String(launcherWrites[0])).toContain("--internal-update");
    expect(String(launcherWrites[0])).toContain("shell.Run command, 0, False");
    expect(uxpMocks.openPath).toHaveBeenCalledWith(
      launcher.nativePath,
      "启动棋子go更新程序。"
    );
    expect(progressEvents).toEqual([
      { kind: "progress", message: "更新程序已启动。" },
      {
        kind: "success",
        message: "棋子go 0.8.10 更新完成，请重启 Photoshop。"
      }
    ]);
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as Response;
}
