import { shell, storage } from "uxp";
import { PLUGIN_VERSION } from "../pluginMetadata";

export const CHESSGO_PLUGIN_ID = "com.linkdesks.chess-archive-psd-generator";
export const CHESSGO_RELEASE_API_URL =
  "https://api.github.com/repos/irebix/chess-go/commits/release";
export const CHESSGO_BUNDLED_INSTALLER = "ChessGoInstaller.cmd";
export const CHESSGO_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
export const CHESSGO_UPDATE_CHECK_MIN_GAP_MS = 60 * 1000;

interface ReleaseCommitResponse {
  sha?: unknown;
}

interface ReleaseManifestResponse {
  schemaVersion?: unknown;
  pluginId?: unknown;
  pluginVersion?: unknown;
}

export interface PluginUpdateCheck {
  currentVersion: string;
  latestVersion: string;
  releaseSha: string;
  updateAvailable: boolean;
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export async function checkPluginUpdate(
  fetchImpl: FetchLike = fetch,
  currentVersion = PLUGIN_VERSION
): Promise<PluginUpdateCheck> {
  assertReleaseVersion(currentVersion, "当前插件版本");
  const commitResponse = await fetchImpl(CHESSGO_RELEASE_API_URL, {
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/vnd.github+json" }
  });
  const commit = await readJson<ReleaseCommitResponse>(commitResponse, "检查远端发布提交");
  const releaseSha = typeof commit.sha === "string" ? commit.sha.toLowerCase() : "";
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) {
    throw new Error("GitHub 返回了无效的 release 提交标识。");
  }

  const manifestUrl =
    `https://raw.githubusercontent.com/irebix/chess-go/${releaseSha}/release-manifest.json`;
  const manifestResponse = await fetchImpl(manifestUrl, {
    cache: "no-store",
    credentials: "omit"
  });
  const manifest = await readJson<ReleaseManifestResponse>(
    manifestResponse,
    "读取远端发布清单"
  );
  if (manifest.schemaVersion !== 1) {
    throw new Error("远端发布清单格式不受支持。");
  }
  if (manifest.pluginId !== CHESSGO_PLUGIN_ID) {
    throw new Error("远端发布清单不属于棋子go。");
  }
  const latestVersion = typeof manifest.pluginVersion === "string"
    ? manifest.pluginVersion
    : "";
  assertReleaseVersion(latestVersion, "远端插件版本");

  return {
    currentVersion,
    latestVersion,
    releaseSha,
    updateAvailable: comparePluginVersions(latestVersion, currentVersion) > 0
  };
}

export function comparePluginVersions(left: string, right: string): number {
  const leftParts = parseReleaseVersion(left, "左侧版本");
  const rightParts = parseReleaseVersion(right, "右侧版本");
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

export async function launchPluginUpdate(): Promise<void> {
  const provider = storage.localFileSystem;
  if (!provider.getPluginFolder) {
    throw new Error("当前 UXP 不支持读取插件内置更新程序。");
  }
  const pluginFolder = await provider.getPluginFolder();
  if (!pluginFolder.getEntry) {
    throw new Error("当前 UXP 不支持读取插件内置更新程序。");
  }
  const bundledEntry = await pluginFolder.getEntry(CHESSGO_BUNDLED_INSTALLER);
  if (!bundledEntry.isFile || !("read" in bundledEntry)) {
    throw new Error("插件内置更新程序不存在。");
  }
  const installerContent = await bundledEntry.read({ format: storage.formats.utf8 });
  if (typeof installerContent !== "string") {
    throw new Error("插件内置更新程序不是文本文件。");
  }
  assertBundledInstaller(installerContent);

  const temporaryFolder = await provider.getTemporaryFolder();
  const temporaryInstaller = await temporaryFolder.createFile(
    CHESSGO_BUNDLED_INSTALLER,
    { overwrite: true }
  );
  await temporaryInstaller.write(installerContent, { format: storage.formats.utf8 });

  const launcher = await temporaryFolder.createFile(
    "StartChessGoUpdate.cmd",
    { overwrite: true }
  );
  await launcher.write(createInternalUpdateLauncher(), { format: storage.formats.utf8 });
  const launcherPath = launcher.nativePath ?? provider.getNativePath?.(launcher);
  if (!launcherPath) {
    throw new Error("无法取得棋子go更新启动文件的系统路径。");
  }

  const result = await shell.openPath(
    launcherPath,
    "启动棋子go更新程序；更新完成后需要重启 Photoshop。"
  );
  if (result) {
    throw new Error(`系统未能启动棋子go更新程序：${result}`);
  }
}

async function readJson<T>(response: Response, action: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${action}失败（HTTP ${response.status}）。`);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new Error(`${action}失败：返回内容不是有效 JSON。`);
  }
}

function assertReleaseVersion(version: string, label: string): void {
  parseReleaseVersion(version, label);
}

function parseReleaseVersion(version: string, label: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`${label}不是有效的三段式版本号：${version || "空值"}`);
  }
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3])
  ];
}

function assertBundledInstaller(content: string): void {
  if (
    content.length < 10_000 ||
    !content.trimStart().startsWith("@echo off") ||
    !content.includes(":__CHESSGO_SELF_UPDATE_POWERSHELL__") ||
    !content.includes(":__CHESSGO_POWERSHELL__") ||
    !content.includes(`$pluginId = "${CHESSGO_PLUGIN_ID}"`)
  ) {
    throw new Error("插件内置更新程序校验失败。");
  }
}

function createInternalUpdateLauncher(): string {
  return [
    "@echo off",
    "setlocal EnableExtensions DisableDelayedExpansion",
    'set "CHESSGO_INTERNAL_UPDATE=1"',
    `call "%~dp0${CHESSGO_BUNDLED_INSTALLER}" --internal-update`,
    "endlocal"
  ].join("\r\n");
}
