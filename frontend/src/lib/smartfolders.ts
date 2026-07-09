// Smart folders (project-organization plan item 9) — SAVED tag/name/format
// queries rendered as cross-cutting sections layered over the containment
// tree: a dataset can match several at once, and membership is derived at
// render time (never stored), so smart folders can't drift stale. Deliberately
// secondary to the folder tree — organization lives in folders; these are
// saved searches.
//
// Query grammar (whitespace-separated terms, ALL must match, case-insensitive
// substring): a bare term matches the dataset NAME or any TAG (exactly the
// Library filter's historical behavior); `tag:x` / `name:x` / `format:x`
// narrow to one field. "format" is the importing parser's identity
// (`metadata.parser_name`, e.g. `format:qd` matches import_qd_vsm). Pure —
// the Library filter box and the smart-folder sections share this matcher.

import type { Dataset } from "./types";

export interface SmartFolder {
  id: string;
  name: string;
  /** The saved query text, parsed per the grammar above at match time. */
  query: string;
}

export type QueryField = "any" | "tag" | "name" | "format";

export interface QueryTerm {
  field: QueryField;
  /** Lower-cased needle (substring match). */
  needle: string;
}

const FIELDS: readonly QueryField[] = ["tag", "name", "format"];

/** Parse query text into AND-ed terms. Empty/blank needles drop out (so a
 *  trailing `tag:` while typing never filters everything away). */
export function parseQuery(text: string): QueryTerm[] {
  const terms: QueryTerm[] = [];
  for (const raw of text.trim().split(/\s+/)) {
    if (!raw) continue;
    const at = raw.indexOf(":");
    const key = at > 0 ? raw.slice(0, at).toLowerCase() : "";
    if ((FIELDS as readonly string[]).includes(key)) {
      const needle = raw.slice(at + 1).toLowerCase();
      if (needle) terms.push({ field: key as QueryField, needle });
    } else {
      terms.push({ field: "any", needle: raw.toLowerCase() });
    }
  }
  return terms;
}

/** The dataset's format identity: the importing parser's name (empty for
 *  client-made datasets — demo, merge, extract, summaries). */
export function datasetFormat(d: Dataset): string {
  const v = d.data.metadata.parser_name;
  return typeof v === "string" ? v : "";
}

function termMatches(d: Dataset, t: QueryTerm): boolean {
  const name = d.name.toLowerCase();
  const tags = d.tags ?? [];
  switch (t.field) {
    case "name":
      return name.includes(t.needle);
    case "tag":
      return tags.some((x) => x.toLowerCase().includes(t.needle));
    case "format":
      return datasetFormat(d).toLowerCase().includes(t.needle);
    default:
      // Bare term: name OR any tag — the Library filter's historical behavior.
      return name.includes(t.needle) || tags.some((x) => x.toLowerCase().includes(t.needle));
  }
}

/** True when the dataset satisfies EVERY term (an empty query matches all). */
export function matchesQuery(d: Dataset, terms: readonly QueryTerm[]): boolean {
  return terms.every((t) => termMatches(d, t));
}

/** A smart folder's members, in library order (derived — never stored). */
export function smartFolderMembers(datasets: readonly Dataset[], sf: SmartFolder): Dataset[] {
  const terms = parseQuery(sf.query);
  return datasets.filter((d) => matchesQuery(d, terms));
}

/** Validate persisted smart folders at the untrusted .dwk boundary — drops
 *  malformed entries rather than throwing (mirrors parseFolders). */
export function sanitizeSmartFolders(v: unknown): SmartFolder[] {
  if (!Array.isArray(v)) return [];
  const out: SmartFolder[] = [];
  for (const f of v) {
    if (typeof f !== "object" || f === null) continue;
    const o = f as Record<string, unknown>;
    if (
      typeof o.id === "string" &&
      typeof o.name === "string" &&
      o.name.trim() !== "" &&
      typeof o.query === "string"
    ) {
      out.push({ id: o.id, name: o.name, query: o.query });
    }
  }
  return out;
}
