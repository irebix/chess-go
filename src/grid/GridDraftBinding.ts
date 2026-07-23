export interface GridDraftChainItemIdentity {
  chainIndex: number;
  assetCode: string;
}

export function gridDraftChainToken(chainId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < chainId.length; index += 1) {
    hash ^= chainId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function gridDraftLayerName(
  chainId: string,
  chainIndex: number,
  assetCode: string
): string {
  if (!Number.isInteger(chainIndex) || chainIndex < 0) {
    throw new Error("AI draft chain index must be a non-negative integer.");
  }
  const normalizedAssetCode = assetCode.trim() || "未命名";
  return `AI初稿 ${normalizedAssetCode}｜${gridDraftChainToken(chainId)}-${String(chainIndex + 1).padStart(2, "0")}`;
}

export function gridDraftGroupName(
  chainId: string,
  chainLabel: string,
  row: number
): string {
  if (!Number.isInteger(row) || row < 0) {
    throw new Error("AI draft row must be a non-negative integer.");
  }
  const normalizedLabel = chainLabel.trim() || "未命名链";
  return `AI初稿 ${normalizedLabel}｜${gridDraftChainToken(chainId)}-R${String(row + 1).padStart(2, "0")}`;
}

export function gridDraftGroupRow(name: string, chainId?: string): number | undefined {
  const token = chainId ? gridDraftChainToken(chainId) : "[0-9a-f]{8}";
  const match = name.match(new RegExp(`｜${token}-R(\\d{2})$`));
  if (!match) return undefined;
  const row = Number(match[1]) - 1;
  return Number.isInteger(row) && row >= 0 ? row : undefined;
}

export function gridDraftExpectedLayerNames(
  chainId: string,
  items: readonly GridDraftChainItemIdentity[]
): Map<string, number> {
  const names = new Map<string, number>();
  for (const item of items) {
    const name = gridDraftLayerName(chainId, item.chainIndex, item.assetCode);
    if (names.has(name)) throw new Error("AI draft chain contains duplicate layer identities.");
    names.set(name, item.chainIndex);
  }
  return names;
}
