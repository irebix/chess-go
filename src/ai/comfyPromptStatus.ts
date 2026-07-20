import type { ComfyWorkflow } from "./holopixWorkflow";

export interface ComfyPromptStatus {
  kind: "queued" | "running" | "starting" | "node" | "progress" | "complete" | "error";
  text: string;
}

export function describeComfyQueueStatus(
  value: unknown,
  promptId: string
): ComfyPromptStatus | null {
  if (!isRecord(value)) return null;
  const pending = Array.isArray(value.queue_pending) ? value.queue_pending : [];
  const pendingIndex = pending.findIndex((entry) => comfyQueueEntryPromptId(entry) === promptId);
  if (pendingIndex >= 0) {
    return {
      kind: "queued",
      text: `ComfyUI 排队中 · 第 ${pendingIndex + 1}/${pending.length} 位`
    };
  }
  const running = Array.isArray(value.queue_running) ? value.queue_running : [];
  if (running.some((entry) => comfyQueueEntryPromptId(entry) === promptId)) {
    return { kind: "running", text: "ComfyUI 正在执行 · 等待节点状态" };
  }
  return null;
}

export function describeComfyExecutionMessage(
  value: unknown,
  promptId: string | undefined,
  workflow: ComfyWorkflow
): ComfyPromptStatus | null {
  if (!isRecord(value) || typeof value.type !== "string" || !isRecord(value.data)) return null;
  const messagePromptId = typeof value.data.prompt_id === "string" ? value.data.prompt_id : undefined;
  if (promptId && messagePromptId && messagePromptId !== promptId) return null;

  if (value.type === "execution_start") {
    return { kind: "starting", text: "ComfyUI 已开始执行" };
  }
  if (value.type === "executing") {
    if (value.data.node === null) return { kind: "complete", text: "ComfyUI 工作流执行完成" };
    const nodeId = nodeIdFrom(value.data.node);
    return nodeId
      ? { kind: "node", text: `ComfyUI ${describeComfyNode(workflow, nodeId)}` }
      : null;
  }
  if (value.type === "progress") {
    const nodeId = nodeIdFrom(value.data.node);
    if (!nodeId) return null;
    const valueNumber = finiteNumber(value.data.value);
    const maxNumber = finiteNumber(value.data.max);
    const suffix = valueNumber !== null && maxNumber !== null && maxNumber > 0
      ? ` · ${Math.max(0, Math.round(valueNumber))}/${Math.round(maxNumber)}`
      : "";
    return {
      kind: "progress",
      text: `ComfyUI ${describeComfyNode(workflow, nodeId)}${suffix}`
    };
  }
  if (value.type === "execution_error") {
    const nodeId = nodeIdFrom(value.data.node_id ?? value.data.node);
    return {
      kind: "error",
      text: nodeId
        ? `ComfyUI ${describeComfyNode(workflow, nodeId)} · 执行失败`
        : "ComfyUI 工作流执行失败"
    };
  }
  return null;
}

export function describeComfyNode(workflow: ComfyWorkflow, nodeId: string): string {
  const node = workflow[nodeId];
  const title = node?._meta?.title?.trim();
  const classType = node?.class_type?.trim();
  if (title) return `节点 ${nodeId} · ${title}`;
  if (classType) return `节点 ${nodeId} · ${classType}`;
  return `节点 ${nodeId}`;
}

function comfyQueueEntryPromptId(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[1] === "string" ? value[1] : undefined;
}

function nodeIdFrom(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
