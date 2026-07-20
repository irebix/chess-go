import { describe, expect, it } from "vitest";
import {
  describeComfyExecutionMessage,
  describeComfyNode,
  describeComfyQueueStatus
} from "../src/ai/comfyPromptStatus";
import type { ComfyWorkflow } from "../src/ai/holopixWorkflow";

const workflow: ComfyWorkflow = {
  "12": {
    inputs: {},
    class_type: "AILab_QwenVL",
    _meta: { title: "QwenVL 提示词生成" }
  },
  "18": {
    inputs: {},
    class_type: "HolopixGenerate"
  }
};

describe("ComfyUI prompt status", () => {
  it("reports the live pending position for the submitted prompt", () => {
    expect(describeComfyQueueStatus({
      queue_running: [[1, "other-running"]],
      queue_pending: [[2, "first"], [3, "target"], [4, "last"]]
    }, "target")).toEqual({
      kind: "queued",
      text: "ComfyUI 排队中 · 第 2/3 位"
    });
  });

  it("reports a running prompt while waiting for websocket node events", () => {
    expect(describeComfyQueueStatus({
      queue_running: [[1, "target"]],
      queue_pending: []
    }, "target")).toEqual({
      kind: "running",
      text: "ComfyUI 正在执行 · 等待节点状态"
    });
  });

  it("describes executing nodes by id and workflow title", () => {
    expect(describeComfyExecutionMessage({
      type: "executing",
      data: { prompt_id: "target", node: "12" }
    }, "target", workflow)).toEqual({
      kind: "node",
      text: "ComfyUI 节点 12 · QwenVL 提示词生成"
    });
    expect(describeComfyNode(workflow, "18")).toBe("节点 18 · HolopixGenerate");
  });

  it("includes node progress and ignores messages from another prompt", () => {
    expect(describeComfyExecutionMessage({
      type: "progress",
      data: { prompt_id: "target", node: "18", value: 3, max: 8 }
    }, "target", workflow)).toEqual({
      kind: "progress",
      text: "ComfyUI 节点 18 · HolopixGenerate · 3/8"
    });
    expect(describeComfyExecutionMessage({
      type: "executing",
      data: { prompt_id: "other", node: "12" }
    }, "target", workflow)).toBeNull();
  });

  it("reports workflow completion when ComfyUI clears the executing node", () => {
    expect(describeComfyExecutionMessage({
      type: "executing",
      data: { prompt_id: "target", node: null }
    }, "target", workflow)).toEqual({
      kind: "complete",
      text: "ComfyUI 工作流执行完成"
    });
  });
});
