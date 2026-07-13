import { asArray, child, collectTagText, parseXml } from "./xml";

export function parseSharedStrings(xml: string): string[] {
  const document = parseXml(xml);
  const stringItems = asArray(child(child(document, "sst"), "si"));
  return stringItems.map((item) => collectTagText(item, "t"));
}
