import { XMLParser } from "fast-xml-parser";

export type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  allowBooleanAttributes: true
});

export function parseXml(xml: string): XmlNode {
  const parsed = parser.parse(xml) as unknown;
  if (!isRecord(parsed)) throw new Error("XML 根节点无效。");
  return parsed;
}

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function isRecord(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function child(node: unknown, key: string): unknown {
  return isRecord(node) ? node[key] : undefined;
}

export function attribute(node: unknown, key: string): string | undefined {
  const value = child(node, key);
  return value === undefined || value === null ? undefined : String(value);
}

export function textValue(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(textValue).join("");
  if (isRecord(node)) {
    if (node["#text"] !== undefined) return textValue(node["#text"]);
    return "";
  }
  return "";
}

export function collectTagText(node: unknown, tagName: string): string {
  if (node === undefined || node === null) return "";
  if (Array.isArray(node)) return node.map((item) => collectTagText(item, tagName)).join("");
  if (!isRecord(node)) return "";
  let output = "";
  for (const [key, value] of Object.entries(node)) {
    if (key === tagName) output += textValue(value);
    else if (!key.startsWith("@") && key !== "#text") output += collectTagText(value, tagName);
  }
  return output;
}
