import {
  CENTERLINE_COMFY_BASE_URL,
  CENTERLINE_JOB_TIMEOUT_MS,
  CENTERLINE_MAX_UPLOAD_PIXELS,
  CENTERLINE_OUTPUT_BASENAME,
  CENTERLINE_POLL_INTERVAL_MS,
  CENTERLINE_REQUEST_TIMEOUT_MS,
  CENTERLINE_REQUIRED_NODES,
  CENTERLINE_WORKFLOW_PADDING_PX
} from "./config";
import type {
  CenterlineJob,
  CenterlinePixelSource,
  CenterlineReport,
  CenterlineResult,
  CenterlineVectorSettings
} from "./types";
import {
  makeAutomaticOutlinePrompt,
  makeOutlineRefitPrompt,
  type CenterlineWorkflow
} from "./workflow";
import { removeCenterlineCanvasPadding, validatePathJson } from "./pathJson";

type JsonRecord = Record<string, unknown>;

interface CenterlineRefitContext {
  savedOutputImageName?: string;
}

const CENTERLINE_SAVE_OUTPUT_NODE_ID = "4";
const CENTERLINE_REFIT_SOURCE_OUTPUT_NODE_ID = "29";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

async function parseJsonResponse<T>(response: Response, label = "ComfyUI"): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`${label} 返回了非 JSON 内容：${text.slice(0, 240)}`);
    }
  }
  if (!response.ok) {
    const record = asRecord(payload);
    const error = asRecord(record?.error);
    const detail = error?.message
      ?? error?.details
      ?? record?.detail
      ?? `${label} HTTP ${response.status}`;
    throw new Error(String(detail));
  }
  return payload as T;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = CENTERLINE_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`连接 ComfyUI 超时（${Math.round(timeoutMs / 1000)} 秒）。`);
    }
    throw new Error(`无法连接 ComfyUI（${CENTERLINE_COMFY_BASE_URL}）：${errorMessage(error)}`);
  } finally {
    window.clearTimeout(timer);
  }
}

function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }
  return bytes;
}

export function pixelsToPpm(pixelSource: CenterlinePixelSource): Uint8Array {
  const { width, height, components, bytes: source } = pixelSource;
  const pixelCount = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Photoshop 返回了无效的图层尺寸。");
  }
  if (pixelCount > CENTERLINE_MAX_UPLOAD_PIXELS) {
    throw new Error(`图层像素数超过安全上限 ${CENTERLINE_MAX_UPLOAD_PIXELS}。`);
  }
  if (!(source instanceof Uint8Array) || !Number.isInteger(components) || components < 1) {
    throw new Error("Photoshop 返回了无效的图层像素。");
  }
  if (source.byteLength < pixelCount * components) {
    throw new Error("Photoshop 返回的图层像素长度不足。");
  }

  const header = asciiBytes(`P6\n${width} ${height}\n255\n`);
  const ppm = new Uint8Array(header.length + pixelCount * 3);
  ppm.set(header, 0);
  let outputOffset = header.length;
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const sourceOffset = pixelIndex * components;
    const red = source[sourceOffset]!;
    const grayscale = components < 3;
    const green = grayscale ? red : source[sourceOffset + 1]!;
    const blue = grayscale ? red : source[sourceOffset + 2]!;
    const hasAlpha = components === 2 || components >= 4;
    const alpha = hasAlpha
      ? source[sourceOffset + (components === 2 ? 1 : 3)]! / 255
      : 1;
    ppm[outputOffset] = Math.round(red * alpha + 255 * (1 - alpha));
    ppm[outputOffset + 1] = Math.round(green * alpha + 255 * (1 - alpha));
    ppm[outputOffset + 2] = Math.round(blue * alpha + 255 * (1 - alpha));
    outputOffset += 3;
  }
  return ppm;
}

function safeUploadedImageName(uploaded: unknown): string {
  const record = asRecord(uploaded);
  if (typeof record?.name !== "string" || !record.name) {
    throw new Error("ComfyUI 上传图层后没有返回文件名。");
  }
  const filename = record.name.replace(/\\/g, "/").split("/").pop();
  const subfolder = String(record.subfolder ?? "").replace(/\\/g, "/");
  if (!filename || subfolder.includes("..")) {
    throw new Error("ComfyUI 返回了不安全的上传路径。");
  }
  return subfolder ? `${subfolder}/${filename}` : filename;
}

function queueContains(queue: unknown, promptId: string): boolean {
  return Array.isArray(queue) && queue.some((item) => Array.isArray(item) && item[1] === promptId);
}

function findExecutionError(entry: JsonRecord): string | null {
  const status = asRecord(entry.status);
  const messages = status?.messages;
  if (!Array.isArray(messages)) return null;
  for (const message of messages) {
    if (!Array.isArray(message) || message.length < 2) continue;
    if (message[0] === "execution_error") {
      const detail = asRecord(message[1]) ?? {};
      return String(
        detail.exception_message
        ?? detail.exception_type
        ?? `节点 ${detail.node_id ?? "未知"} 执行失败`
      );
    }
    if (message[0] === "execution_interrupted") return "任务已中止。";
  }
  return null;
}

function savedOutputImageName(entry: JsonRecord, nodeId: string): string | null {
  const outputs = asRecord(entry.outputs);
  const nodeOutput = asRecord(outputs?.[nodeId]);
  const images = nodeOutput?.images;
  if (!Array.isArray(images) || !images.length) return null;
  const image = asRecord(images[0]);
  const filename = typeof image?.filename === "string"
    ? image.filename.replace(/\\/g, "/")
    : "";
  const subfolder = typeof image?.subfolder === "string"
    ? image.subfolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
    : "";
  if (
    !filename
    || filename.includes("/")
    || filename === ".."
    || subfolder.split("/").includes("..")
    || image?.type !== "output"
  ) {
    return null;
  }
  const relativePath = subfolder ? `${subfolder}/${filename}` : filename;
  return `${relativePath} [output]`;
}

export class CenterlineComfyClient {
  private readonly baseUrl: string;
  private readonly canceledJobs = new Set<string>();
  private readonly refitContexts = new Map<string, CenterlineRefitContext>();
  private lastRequestNonce = 0;

  constructor(baseUrl = CENTERLINE_COMFY_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async json<T>(path: string, options: RequestInit = {}, timeoutMs?: number): Promise<T> {
    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, options, timeoutMs);
    return parseJsonResponse<T>(response);
  }

  async health(): Promise<void> {
    const nodeInfos = await Promise.all(
      CENTERLINE_REQUIRED_NODES.map((node) => this.json<JsonRecord>(
        `/object_info/${encodeURIComponent(node)}`,
        {},
        8000
      ))
    );
    const missingNodes = CENTERLINE_REQUIRED_NODES.filter((node, index) => !nodeInfos[index]?.[node]);
    if (missingNodes.length) {
      throw new Error(`自动外轮廓工作流缺少节点：${missingNodes.join("、")}`);
    }
    const birefnetInfo = nodeInfos[CENTERLINE_REQUIRED_NODES.indexOf("BiRefNetRMBG")];
    const birefnetNode = asRecord(birefnetInfo?.BiRefNetRMBG);
    const input = asRecord(birefnetNode?.input);
    const required = asRecord(input?.required);
    const model = required?.model;
    const models = Array.isArray(model) && Array.isArray(model[0]) ? model[0] : [];
    if (!models.includes("BiRefNet_toonout")) {
      throw new Error("自动外轮廓工作流需要 BiRefNetRMBG 与 BiRefNet_toonout 模型。");
    }
  }

  async uploadPixels(pixelSource: CenterlinePixelSource, requestNonce: number): Promise<unknown> {
    const ppm = pixelsToPpm(pixelSource);
    const form = new FormData();
    const filename = `centerline-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.ppm`;
    const buffer = ppm.buffer.slice(ppm.byteOffset, ppm.byteOffset + ppm.byteLength) as ArrayBuffer;
    form.append("image", new Blob([buffer], { type: "image/x-portable-pixmap" }), filename);
    form.append("type", "input");
    form.append("subfolder", `centerline_forge/run-${requestNonce}`);
    form.append("overwrite", "false");
    return this.json("/upload/image", { method: "POST", body: form }, 60_000);
  }

  async createJob(
    pixelSource: CenterlinePixelSource,
    settings: CenterlineVectorSettings
  ): Promise<CenterlineJob> {
    const requestNonce = this.nextRequestNonce();
    const uploaded = await this.uploadPixels(pixelSource, requestNonce);
    const uploadedImageName = safeUploadedImageName(uploaded);
    const promptId = await this.submitPrompt(
      makeAutomaticOutlinePrompt(uploadedImageName, settings, requestNonce),
      `chessgo-centerline-${Date.now()}`
    );
    this.refitContexts.set(promptId, {});
    return {
      id: promptId,
      status: "queued",
      stage: "已进入 ComfyUI 队列",
      progress: 12
    };
  }

  async createRefitJob(
    sourcePromptId: string,
    settings: CenterlineVectorSettings
  ): Promise<CenterlineJob> {
    const context = this.refitContexts.get(sourcePromptId);
    if (!context) {
      throw new Error("当前就绪描边缺少可复用的 ComfyUI 重拟合上下文，请重新生成描边。");
    }
    if (!context.savedOutputImageName) {
      throw new Error("当前就绪描边缺少已保存的重拟合输入，请重新生成描边。");
    }
    const promptId = await this.submitPrompt(
      makeOutlineRefitPrompt(context.savedOutputImageName, settings),
      `chessgo-centerline-refit-${Date.now()}`,
      [CENTERLINE_SAVE_OUTPUT_NODE_ID]
    );
    this.refitContexts.set(promptId, context);
    return {
      id: promptId,
      status: "queued",
      stage: "已提交缓存路径重新拟合",
      progress: 36
    };
  }

  private async submitPrompt(
    prompt: CenterlineWorkflow,
    clientId: string,
    partialExecutionTargets?: string[]
  ): Promise<string> {
    const response = await this.json<JsonRecord>("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        client_id: clientId,
        ...(partialExecutionTargets ? { partial_execution_targets: partialExecutionTargets } : {})
      })
    }, 30_000);
    const nodeErrors = asRecord(response.node_errors);
    if (nodeErrors && Object.keys(nodeErrors).length) {
      throw new Error(`ComfyUI 节点校验失败：${JSON.stringify(nodeErrors)}`);
    }
    if (typeof response.prompt_id !== "string" || !response.prompt_id) {
      throw new Error("ComfyUI 未返回 prompt_id。");
    }
    return response.prompt_id;
  }

  private nextRequestNonce(): number {
    this.lastRequestNonce = Math.max(this.lastRequestNonce + 1, Date.now());
    return this.lastRequestNonce;
  }

  async getJob(promptId: string): Promise<CenterlineJob> {
    if (this.canceledJobs.has(promptId)) {
      return { id: promptId, status: "canceled", stage: "已取消", progress: 0 };
    }
    const history = await this.json<JsonRecord>(`/history/${encodeURIComponent(promptId)}`, {}, 12_000);
    const entry = asRecord(history[promptId]);
    if (entry) {
      const failure = findExecutionError(entry);
      const status = asRecord(entry.status);
      if (failure || status?.status_str === "error") {
        return {
          id: promptId,
          status: "failed",
          stage: "ComfyUI 执行失败",
          progress: 100,
          error: failure ?? "ComfyUI 工作流执行失败。"
        };
      }
      if (status?.completed === true) {
        return { id: promptId, status: "completed", stage: "路径计算完成", progress: 100 };
      }
    }

    const queue = await this.json<JsonRecord>("/queue", {}, 12_000);
    if (queueContains(queue.queue_running, promptId)) {
      return { id: promptId, status: "running", stage: "ComfyUI 正在提取外轮廓并拟合路径", progress: 58 };
    }
    if (queueContains(queue.queue_pending, promptId)) {
      return { id: promptId, status: "queued", stage: "等待 ComfyUI", progress: 18 };
    }
    return { id: promptId, status: "running", stage: "等待 ComfyUI 写入结果", progress: 82 };
  }

  async waitForJob(initialJob: CenterlineJob, onUpdate?: (job: CenterlineJob) => void): Promise<CenterlineJob> {
    const deadline = Date.now() + CENTERLINE_JOB_TIMEOUT_MS;
    let job = initialJob;
    while (true) {
      onUpdate?.(job);
      if (["completed", "failed", "canceled"].includes(job.status)) return job;
      if (Date.now() >= deadline) break;
      await sleep(CENTERLINE_POLL_INTERVAL_MS);
      job = await this.getJob(job.id);
    }
    const finalJob = await this.getJob(job.id);
    onUpdate?.(finalJob);
    if (["completed", "failed", "canceled"].includes(finalJob.status)) return finalJob;
    throw new Error(`等待 ComfyUI 处理超时（${Math.round(CENTERLINE_JOB_TIMEOUT_MS / 1000)} 秒）。`);
  }

  async cancelJob(promptId: string): Promise<CenterlineJob> {
    this.canceledJobs.add(promptId);
    try {
      await this.json("/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delete: [promptId] })
      }, 8000);
    } catch {
      // Running prompts are handled by the interrupt request below.
    }
    await fetchWithTimeout(`${this.baseUrl}/interrupt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt_id: promptId })
    }, 8000);
    return { id: promptId, status: "canceled", stage: "已发送取消请求", progress: 0 };
  }

  private viewUrl(filename: string, subfolder = "centerline_forge", type = "output"): string {
    const query = new URLSearchParams({ filename, subfolder, type });
    return `${this.baseUrl}/view?${query.toString()}`;
  }

  private async readOutputJson(filename: string): Promise<unknown> {
    const url = `${this.viewUrl(filename)}&_=${Date.now()}`;
    const response = await fetchWithTimeout(url, { cache: "no-store" }, 20_000);
    return parseJsonResponse(response, "ComfyUI 输出文件");
  }

  async getReusableResult(): Promise<CenterlineResult> {
    const paddedPathJson = validatePathJson(
      await this.readOutputJson(`${CENTERLINE_OUTPUT_BASENAME}.path.json`)
    );
    const pathJson = removeCenterlineCanvasPadding(paddedPathJson, CENTERLINE_WORKFLOW_PADDING_PX);
    return {
      pathJson,
      report: (asRecord(pathJson.report) ?? {}) as CenterlineReport,
      svgUrl: this.viewUrl(`${CENTERLINE_OUTPUT_BASENAME}.svg`)
    };
  }

  async getResult(promptId: string): Promise<CenterlineResult> {
    const history = await this.json<JsonRecord>(`/history/${encodeURIComponent(promptId)}`, {}, 12_000);
    const entry = asRecord(history[promptId]);
    const status = asRecord(entry?.status);
    if (!entry) throw new Error("ComfyUI 历史中找不到当前任务。");
    if (status?.completed !== true) throw new Error("ComfyUI 工作流尚未完成。");
    const refitContext = this.refitContexts.get(promptId);
    const savedImage = savedOutputImageName(entry, CENTERLINE_REFIT_SOURCE_OUTPUT_NODE_ID);
    if (refitContext && savedImage) refitContext.savedOutputImageName = savedImage;
    return this.getReusableResult();
  }
}
