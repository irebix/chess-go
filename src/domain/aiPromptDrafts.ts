import type { AiWorkflowVersion } from "../ai/aiWorkflowVersion";

export interface AiPromptDraftScope {
  documentId: number;
  documentIdentity: string;
  artboardId: number;
  assetCode: string;
  workflowVersion: AiWorkflowVersion;
}

export function aiPromptDraftKey(scope: AiPromptDraftScope): string {
  return [
    scope.documentId,
    scope.documentIdentity,
    scope.workflowVersion,
    scope.artboardId,
    scope.assetCode
  ].join(":");
}

export function resolveAiPromptDraft(
  drafts: ReadonlyMap<string, string>,
  key: string,
  runtimePromptText: string
): string {
  return drafts.get(key) ?? runtimePromptText;
}
