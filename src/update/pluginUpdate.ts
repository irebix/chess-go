import { shell, storage } from "uxp";
import { PLUGIN_VERSION } from "../pluginMetadata";

export const CHESSGO_PLUGIN_ID = "com.linkdesks.chess-archive-psd-generator";
export const CHESSGO_RELEASE_API_URL =
  "https://api.github.com/repos/irebix/chess-go/commits/release";
export const CHESSGO_BUNDLED_INSTALLER = "ChessGoInstaller.cmd";
export const CHESSGO_UPDATE_LAUNCHER = "StartChessGoUpdate.vbs";
export const CHESSGO_UPDATE_STATUS_FILE = "ChessGoUpdateStatus.jsonl";
export const CHESSGO_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
export const CHESSGO_UPDATE_CHECK_MIN_GAP_MS = 60 * 1000;
const CHESSGO_UPDATE_STATUS_POLL_INTERVAL_MS = 500;
const CHESSGO_UPDATE_STATUS_START_TIMEOUT_MS = 60 * 1000;
const CHESSGO_UPDATE_STATUS_TOTAL_TIMEOUT_MS = 20 * 60 * 1000;

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

export interface PluginUpdateProgress {
  kind: "progress" | "success" | "error";
  message: string;
}

export interface PluginUpdateLaunchResult {
  outcome: "success" | "error" | "detached";
  message: string;
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

export async function launchPluginUpdate(
  onProgress?: (progress: PluginUpdateProgress) => void
): Promise<PluginUpdateLaunchResult> {
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

  const statusFile = await temporaryFolder.createFile(
    CHESSGO_UPDATE_STATUS_FILE,
    { overwrite: true }
  );
  await statusFile.write("", { format: storage.formats.utf8 });
  const statusPath = statusFile.nativePath ?? provider.getNativePath?.(statusFile);
  if (!statusPath) {
    throw new Error("无法取得棋子go更新状态文件的系统路径。");
  }

  const launcher = await temporaryFolder.createFile(
    CHESSGO_UPDATE_LAUNCHER,
    { overwrite: true }
  );
  await launcher.write(
    createInternalUpdateLauncher(statusPath),
    { format: storage.formats.utf8 }
  );
  const launcherPath = launcher.nativePath ?? provider.getNativePath?.(launcher);
  if (!launcherPath) {
    throw new Error("无法取得棋子go更新启动文件的系统路径。");
  }

  const result = await shell.openPath(
    launcherPath,
    "启动棋子go更新程序。"
  );
  if (result) {
    throw new Error(`系统未能启动棋子go更新程序：${result}`);
  }

  onProgress?.({ kind: "progress", message: "更新程序已启动。" });
  return monitorPluginUpdateStatus(statusFile, onProgress);
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

function createInternalUpdateLauncher(statusPath: string): string {
  if (/[\r\n]/.test(statusPath)) {
    throw new Error("棋子go更新状态文件路径无效。");
  }
  const escapedStatusPath = statusPath.replace(/"/g, '""');
  return [
    "Option Explicit",
    "Dim shell, fileSystem, processEnvironment, installerPath, statusPath, command",
    'Set shell = CreateObject("WScript.Shell")',
    'Set fileSystem = CreateObject("Scripting.FileSystemObject")',
    'Set processEnvironment = shell.Environment("Process")',
    `installerPath = fileSystem.BuildPath(fileSystem.GetParentFolderName(WScript.ScriptFullName), "${CHESSGO_BUNDLED_INSTALLER}")`,
    `statusPath = "${escapedStatusPath}"`,
    'processEnvironment("CHESSGO_UPDATE_STATUS_FILE") = statusPath',
    'command = Chr(34) & shell.ExpandEnvironmentStrings("%ComSpec%") & Chr(34) & " /d /c " & Chr(34) & Chr(34) & installerPath & Chr(34) & " --internal-update" & Chr(34)',
    "shell.Run command, 0, False"
  ].join("\r\n");
}

async function monitorPluginUpdateStatus(
  statusFile: storage.File,
  onProgress?: (progress: PluginUpdateProgress) => void
): Promise<PluginUpdateLaunchResult> {
  const startedAt = Date.now();
  const emittedIds = new Set<string>();
  let receivedInstallerStatus = false;

  while (Date.now() - startedAt < CHESSGO_UPDATE_STATUS_TOTAL_TIMEOUT_MS) {
    let content = "";
    try {
      const value = await statusFile.read({ format: storage.formats.utf8 });
      content = typeof value === "string" ? value : "";
    } catch {
      // The elevated installer may briefly hold the file while appending.
    }

    for (const record of parsePluginUpdateStatus(content)) {
      if (emittedIds.has(record.id)) continue;
      emittedIds.add(record.id);
      receivedInstallerStatus = true;
      const message = formatPluginUpdateStatus(record);
      const progress: PluginUpdateProgress = {
        kind: record.kind,
        message
      };
      onProgress?.(progress);
      if (record.kind === "success" || record.kind === "error") {
        return {
          outcome: record.kind,
          message
        };
      }
    }

    if (
      !receivedInstallerStatus &&
      Date.now() - startedAt >= CHESSGO_UPDATE_STATUS_START_TIMEOUT_MS
    ) {
      return {
        outcome: "detached",
        message: "更新程序已在后台运行。"
      };
    }
    await delay(CHESSGO_UPDATE_STATUS_POLL_INTERVAL_MS);
  }

  return {
    outcome: "detached",
    message: "更新程序仍在后台运行。"
  };
}

interface PluginUpdateStatusRecord {
  id: string;
  kind: PluginUpdateProgress["kind"];
  stage: PluginUpdateStatusStage;
  detail: string;
}

function parsePluginUpdateStatus(content: string): PluginUpdateStatusRecord[] {
  const records: PluginUpdateStatusRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as Partial<PluginUpdateStatusRecord>;
      if (
        typeof value.id === "string" &&
        value.id.length >= 8 &&
        (value.kind === "progress" || value.kind === "success" || value.kind === "error") &&
        typeof value.stage === "string" &&
        isPluginUpdateStatusStage(value.stage) &&
        (value.detail === undefined || typeof value.detail === "string")
      ) {
        records.push({
          id: value.id,
          kind: value.kind,
          stage: value.stage,
          detail: typeof value.detail === "string" ? value.detail.slice(0, 1000) : ""
        });
      }
    } catch {
      // Ignore an incomplete line until the next poll.
    }
  }
  return records;
}

type PluginUpdateStatusStage =
  | "awaiting-admin"
  | "admin-denied"
  | "admin-granted"
  | "checking-environment"
  | "installing-git"
  | "reading-release"
  | "downloading-release"
  | "release-verified"
  | "preparing-registration"
  | "installing-files"
  | "completed"
  | "failed";

const PLUGIN_UPDATE_STATUS_MESSAGES: Record<PluginUpdateStatusStage, string> = {
  "awaiting-admin": "等待 Windows 管理员授权。",
  "admin-denied": "Windows 管理员授权未完成。",
  "admin-granted": "已获得 Windows 管理员授权。",
  "checking-environment": "正在检查更新环境。",
  "installing-git": "正在安装 Git。",
  "reading-release": "正在读取最新发布版本。",
  "downloading-release": "正在下载并校验最新发布包。",
  "release-verified": "发布包校验通过。",
  "preparing-registration": "正在准备 UXP 插件注册。",
  "installing-files": "正在写入插件文件并更新注册。",
  "completed": "更新完成，请重启 Photoshop。",
  "failed": "更新失败。"
};

function isPluginUpdateStatusStage(value: string): value is PluginUpdateStatusStage {
  return Object.prototype.hasOwnProperty.call(PLUGIN_UPDATE_STATUS_MESSAGES, value);
}

function formatPluginUpdateStatus(record: PluginUpdateStatusRecord): string {
  switch (record.stage) {
    case "release-verified":
      return record.detail
        ? `发布包校验通过：棋子go ${record.detail}。`
        : PLUGIN_UPDATE_STATUS_MESSAGES[record.stage];
    case "completed":
      return record.detail
        ? `棋子go ${record.detail} 更新完成，请重启 Photoshop。`
        : PLUGIN_UPDATE_STATUS_MESSAGES[record.stage];
    case "failed":
      return record.detail
        ? `更新失败：${record.detail}`
        : PLUGIN_UPDATE_STATUS_MESSAGES[record.stage];
    default:
      return PLUGIN_UPDATE_STATUS_MESSAGES[record.stage];
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
