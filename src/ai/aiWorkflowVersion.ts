export const AI_WORKFLOW_VERSIONS = ["flux", "gpt-image-2"] as const;

export type AiWorkflowVersion = typeof AI_WORKFLOW_VERSIONS[number];

export function aiWorkflowVersionLabel(version: AiWorkflowVersion): string {
  return version === "flux" ? "Flux" : "GPT Image 2";
}

export function normalizedAiWorkflowVersion(value: string | undefined): AiWorkflowVersion {
  return value === "gpt-image-2" ? "gpt-image-2" : "flux";
}
