export const AI_WORKFLOW_VERSIONS = ["flux", "gpt-image-2", "g-plus-f"] as const;

export type AiWorkflowVersion = typeof AI_WORKFLOW_VERSIONS[number];

export function aiWorkflowVersionLabel(version: AiWorkflowVersion): string {
  if (version === "flux") return "Flux";
  if (version === "gpt-image-2") return "GPT Image 2";
  return "G+F";
}

export function normalizedAiWorkflowVersion(value: string | undefined): AiWorkflowVersion {
  if (value === "gpt-image-2" || value === "g-plus-f") return value;
  return "flux";
}
