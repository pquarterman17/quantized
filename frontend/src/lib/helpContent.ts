// Shared searchable Help metadata. Curated commands own their one-sentence
// descriptions; Help and the command palette consume the same field so menu
// labels, search aliases, and explanations cannot drift into parallel catalogs.

import type { Action } from "../store/commands";
import { fuzzy } from "./fuzzy";

/** One searchable help topic, category-agnostic. Commands, formats, and Origin
 * tips all normalize to this so one search covers the whole Help surface. */
export interface HelpItem {
  key: string;
  title: string;
  detail: string;
  /** Menu path, file extension, or other compact location cue. */
  meta?: string;
  /** Search aliases not shown to the user. */
  keywords?: string;
}

export interface ScoredHelpItem extends HelpItem {
  /** Indices into `title` that matched, for highlight. */
  hits: number[];
  score: number;
}

/** Normalize shared command metadata into a searchable Help topic. */
export function actionToHelpItem(a: Action): HelpItem {
  if (!a.description) {
    throw new Error(`command "${a.id}" has no help description`);
  }
  return {
    key: a.id,
    title: a.label.replace(/…$/, ""),
    detail: a.description,
    meta: a.section ? `${a.group} ▸ ${a.section}` : a.group,
    keywords: `${a.group} ${a.section ?? ""} ${a.keywords ?? ""} ${a.shortcut ?? ""}`.trim(),
  };
}

/** Search Help in two tiers:
 *
 * 1. Fuzzy title match, with highlight indices.
 * 2. Precise case-insensitive substring in detail/keywords.
 *
 * Full-sentence fuzzy matching is intentionally avoided because almost every
 * short query becomes a noisy subsequence match. */
export function searchHelpItems(
  items: readonly HelpItem[],
  query: string,
): ScoredHelpItem[] {
  const q = query.trim();
  if (!q) return items.map((item) => ({ ...item, hits: [], score: 0 }));
  const ql = q.toLowerCase();
  const out: ScoredHelpItem[] = [];
  for (const item of items) {
    const onTitle = fuzzy(q, item.title);
    if (onTitle) {
      out.push({
        ...item,
        hits: onTitle.hits,
        score: onTitle.score + 1000,
      });
      continue;
    }
    if (`${item.detail} ${item.keywords ?? ""}`.toLowerCase().includes(ql)) {
      out.push({ ...item, hits: [], score: 0 });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
