import { generateId } from "../../lib/utils";

interface SECAtomEntry {
  id: string;
  title: string;
  updated: string;
  form: string;
  company: string;
}

function extractTag(xml: string, tag: string): string | null {
  return xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))?.[1] ?? null;
}

export function parseSECAtomFeed(xml: string): SECAtomEntry[] {
  const entries: SECAtomEntry[] = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entryXml = match[1];
    if (!entryXml) continue;
    const title = extractTag(entryXml, "title") || "";
    entries.push({
      id: extractTag(entryXml, "id") || generateId(),
      title,
      updated: extractTag(entryXml, "updated") || new Date().toISOString(),
      form: title.match(/\((\d+-\w+|\w+)\)/)?.[1] ?? "",
      company: title.match(/^([^(]+)/)?.[1]?.trim() ?? "",
    });
  }
  return entries;
}
