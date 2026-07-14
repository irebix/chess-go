export const GROUP_LAYOUT_METADATA_SCHEMA = "chess-go-layout";
export const GROUP_LAYOUT_METADATA_VERSION = 5;
export const GROUP_LAYOUT_METADATA_TEXT_PREFIX = "chess-go-layout-v5:";

export interface GroupLayoutBackground {
  color: {
    red: number;
    green: number;
    blue: number;
  };
  visible: boolean;
}

export interface NumericRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface GroupLayoutMetadataMember {
  artboardId: number;
  row: number;
  col: number;
}

export interface GroupLayoutMetadataGroup {
  artboardId: number;
  label: string;
  rect: NumericRect;
  members: GroupLayoutMetadataMember[];
}

export interface GroupLayoutMetadata {
  schema: typeof GROUP_LAYOUT_METADATA_SCHEMA;
  version: typeof GROUP_LAYOUT_METADATA_VERSION;
  spacing: number;
  itemCount: number;
  background: GroupLayoutBackground;
  groups: GroupLayoutMetadataGroup[];
}

type CompactRect = [number, number, number, number];
type CompactMember = [number, number, number];
type CompactGroup = [number, string, CompactRect, CompactMember[]];

interface CompactGroupLayoutMetadata {
  schema: typeof GROUP_LAYOUT_METADATA_SCHEMA;
  version: typeof GROUP_LAYOUT_METADATA_VERSION;
  spacing: number;
  itemCount: number;
  background: [number, number, number, 0 | 1];
  groups: CompactGroup[];
}

export function serializeGroupLayoutMetadata(
  groups: GroupLayoutMetadataGroup[],
  spacing: number,
  background: GroupLayoutBackground
): string {
  const metadata = normalizeAndValidate({
    schema: GROUP_LAYOUT_METADATA_SCHEMA,
    version: GROUP_LAYOUT_METADATA_VERSION,
    spacing,
    itemCount: groups.reduce((count, group) => count + group.members.length, 0),
    background,
    groups
  });
  const compact: CompactGroupLayoutMetadata = {
    schema: metadata.schema,
    version: metadata.version,
    spacing: metadata.spacing,
    itemCount: metadata.itemCount,
    background: [
      metadata.background.color.red,
      metadata.background.color.green,
      metadata.background.color.blue,
      metadata.background.visible ? 1 : 0
    ],
    groups: metadata.groups.map((group) => [
      group.artboardId,
      group.label,
      [group.rect.left, group.rect.top, group.rect.right, group.rect.bottom],
      group.members.map((member) => [member.artboardId, member.row, member.col])
    ])
  };
  return `${GROUP_LAYOUT_METADATA_TEXT_PREFIX}${utf8ToBase64Url(JSON.stringify(compact))}`;
}

export function parseGroupLayoutMetadata(value: string): GroupLayoutMetadata | undefined {
  try {
    if (!value.startsWith(GROUP_LAYOUT_METADATA_TEXT_PREFIX)) return undefined;
    const payload = value
      .slice(GROUP_LAYOUT_METADATA_TEXT_PREFIX.length)
      .replace(/\s+/g, "");
    if (!payload) return undefined;
    const compact = JSON.parse(base64UrlToUtf8(payload)) as Partial<CompactGroupLayoutMetadata>;
    if (
      compact.schema !== GROUP_LAYOUT_METADATA_SCHEMA ||
      compact.version !== GROUP_LAYOUT_METADATA_VERSION ||
      !Array.isArray(compact.groups)
    ) {
      return undefined;
    }
    const groups = compact.groups.map((group) => compactGroup(group));
    if (groups.some((group) => group === undefined)) return undefined;
    return normalizeAndValidate({
      schema: compact.schema,
      version: compact.version,
      spacing: compact.spacing as number,
      itemCount: compact.itemCount as number,
      background: compactBackground(compact.background),
      groups: groups as GroupLayoutMetadataGroup[]
    });
  } catch {
    return undefined;
  }
}

function compactBackground(value: unknown): GroupLayoutBackground {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.slice(0, 3).every(colorChannel) ||
    (value[3] !== 0 && value[3] !== 1)
  ) {
    throw new Error("Invalid group layout background.");
  }
  return {
    color: { red: value[0], green: value[1], blue: value[2] },
    visible: value[3] === 1
  };
}

function utf8ToBase64Url(value: string): string {
  const binary = encodeURIComponent(value).replace(
    /%([0-9A-F]{2})/g,
    (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))
  );
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToUtf8(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid group layout encoding.");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  let percentEncoded = "";
  for (let index = 0; index < binary.length; index += 1) {
    percentEncoded += `%${binary.charCodeAt(index).toString(16).padStart(2, "0")}`;
  }
  return decodeURIComponent(percentEncoded);
}

function compactGroup(value: unknown): GroupLayoutMetadataGroup | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const [artboardId, label, rect, members] = value;
  if (
    !positiveInteger(artboardId) ||
    typeof label !== "string" ||
    !Array.isArray(rect) ||
    rect.length !== 4 ||
    !rect.every(finiteNumber) ||
    !Array.isArray(members)
  ) {
    return undefined;
  }
  const parsedMembers = members.map((member) => compactMember(member));
  if (parsedMembers.some((member) => member === undefined)) return undefined;
  return {
    artboardId,
    label,
    rect: { left: rect[0]!, top: rect[1]!, right: rect[2]!, bottom: rect[3]! },
    members: parsedMembers as GroupLayoutMetadataMember[]
  };
}

function compactMember(value: unknown): GroupLayoutMetadataMember | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [artboardId, row, col] = value;
  if (!positiveInteger(artboardId) || !nonNegativeInteger(row) || !nonNegativeInteger(col)) {
    return undefined;
  }
  return { artboardId, row, col };
}

function normalizeAndValidate(metadata: GroupLayoutMetadata): GroupLayoutMetadata {
  if (!nonNegativeInteger(metadata.spacing) || !nonNegativeInteger(metadata.itemCount)) {
    throw new Error("Invalid group layout totals.");
  }
  if (
    !metadata.background ||
    typeof metadata.background.visible !== "boolean" ||
    !colorChannel(metadata.background.color?.red) ||
    !colorChannel(metadata.background.color?.green) ||
    !colorChannel(metadata.background.color?.blue)
  ) {
    throw new Error("Invalid group layout background.");
  }
  if (!metadata.groups.length) throw new Error("Group layout metadata has no groups.");

  const groupIds = new Set<number>();
  const itemIds = new Set<number>();
  const cells = new Set<string>();
  let itemCount = 0;
  for (const group of metadata.groups) {
    if (!positiveInteger(group.artboardId) || groupIds.has(group.artboardId)) {
      throw new Error("Group layout metadata contains duplicate group artboards.");
    }
    if (!group.label || !validRect(group.rect) || !group.members.length) {
      throw new Error("Group layout metadata contains an invalid group.");
    }
    groupIds.add(group.artboardId);
    for (const member of group.members) {
      const cell = `${member.row}:${member.col}`;
      if (
        !positiveInteger(member.artboardId) ||
        !nonNegativeInteger(member.row) ||
        !nonNegativeInteger(member.col) ||
        itemIds.has(member.artboardId) ||
        cells.has(cell)
      ) {
        throw new Error("Group layout metadata contains duplicate item artboards or cells.");
      }
      itemIds.add(member.artboardId);
      cells.add(cell);
      itemCount += 1;
    }
  }
  if (itemCount !== metadata.itemCount) throw new Error("Group layout item count does not match.");
  return metadata;
}

function validRect(rect: NumericRect): boolean {
  return [rect.left, rect.top, rect.right, rect.bottom].every(finiteNumber) &&
    rect.right > rect.left && rect.bottom > rect.top;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function colorChannel(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 255;
}
