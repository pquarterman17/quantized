// Project-wide search (MAIN_PLAN #38).
//
// The plan deferred this until the home/recent/path model was validated in real
// use — that has now happened, so it is built.
//
// The point is REVEAL, not filtering. A Library filter already narrows the
// dataset list; what was missing is finding the thing when you do not remember
// which dataset it lives in — a column called `Rxy`, a note mentioning a sample
// id, a report or figure by name — and being taken to it. So every hit carries
// where it lives and which surface can show it.
//
// Pure: the caller passes the workspace slices in, and gets ranked hits back.
// No store import, no React — the ranking is the part that can be wrong, and it
// is testable on its own.

import type { Dataset, FolderNode } from "./types";

/** Which surface can reveal a hit — the Library tree, the worksheet grid, or a
 *  document (report / figure). */
export type RevealIn = "library" | "worksheet" | "figure" | "report";

export interface SearchHit {
  /** Stable identity for React keys and for de-duplication. */
  id: string;
  /** What matched: the human-readable label shown in the results list. */
  label: string;
  /** Where it lives, e.g. the owning dataset's name. */
  context: string;
  /** What kind of thing matched, for the result's leading chip. */
  kind: "dataset" | "column" | "note" | "tag" | "metadata" | "report" | "figure" | "folder";
  reveal: RevealIn;
  /** Dataset to activate when revealing (null for a folder/report with none). */
  datasetId: string | null;
  /** Column index for a `column` hit, so the worksheet can scroll to it. */
  channel?: number;
  /** Lower sorts first. */
  rank: number;
}

export interface SearchSources {
  datasets: readonly Dataset[];
  folders?: readonly FolderNode[];
  reports?: readonly { id: string; name: string; datasetId: string | null }[];
  figures?: readonly { id: string; name: string }[];
}

/** Rank tiers. A name match beats a column match beats a body-text match:
 *  when someone types "Rxy" they almost always mean the column called Rxy, not
 *  a note that happens to mention it. */
const RANK = {
  nameExact: 0,
  namePrefix: 1,
  column: 2,
  tag: 3,
  nameSubstring: 4,
  note: 5,
  metadata: 6,
} as const;

function score(haystack: string, needle: string): number | null {
  const h = haystack.toLowerCase();
  if (!h.includes(needle)) return null;
  if (h === needle) return RANK.nameExact;
  if (h.startsWith(needle)) return RANK.namePrefix;
  return RANK.nameSubstring;
}

/** Flatten metadata to searchable "key: value" strings, skipping the bulky
 *  decoded-Origin blobs — matching inside a 10 kB book inventory produces hits
 *  nobody can act on and drowns the ones they can. */
function metadataEntries(meta: Record<string, unknown> | undefined): [string, string][] {
  if (!meta) return [];
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (k === "origin_books" || k === "text_columns" || k === "label_rows") continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out.push([k, String(v)]);
    }
  }
  return out;
}

/** Search the whole project. Returns ranked hits; empty for a blank query. */
export function searchProject(query: string, src: SearchSources, limit = 50): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];

  for (const ds of src.datasets) {
    const nameRank = score(ds.name, needle);
    if (nameRank !== null) {
      hits.push({
        id: `ds:${ds.id}`,
        label: ds.name,
        context: "dataset",
        kind: "dataset",
        reveal: "library",
        datasetId: ds.id,
        rank: nameRank,
      });
    }

    ds.data.labels.forEach((label, channel) => {
      if (score(label, needle) === null) return;
      hits.push({
        id: `col:${ds.id}:${channel}`,
        label,
        context: ds.name,
        kind: "column",
        // A column is revealed in the WORKSHEET — that is where you can see and
        // act on it, unlike the Library which only shows the dataset.
        reveal: "worksheet",
        datasetId: ds.id,
        channel,
        rank: RANK.column,
      });
    });

    for (const tag of ds.tags ?? []) {
      if (score(tag, needle) === null) continue;
      hits.push({
        id: `tag:${ds.id}:${tag}`,
        label: tag,
        context: ds.name,
        kind: "tag",
        reveal: "library",
        datasetId: ds.id,
        rank: RANK.tag,
      });
    }

    if (ds.notes && ds.notes.toLowerCase().includes(needle)) {
      hits.push({
        id: `note:${ds.id}`,
        label: excerpt(ds.notes, needle),
        context: ds.name,
        kind: "note",
        reveal: "library",
        datasetId: ds.id,
        rank: RANK.note,
      });
    }

    for (const [k, v] of metadataEntries(ds.data.metadata as Record<string, unknown>)) {
      if (!`${k} ${v}`.toLowerCase().includes(needle)) continue;
      hits.push({
        id: `meta:${ds.id}:${k}`,
        label: `${k}: ${v}`,
        context: ds.name,
        kind: "metadata",
        reveal: "library",
        datasetId: ds.id,
        rank: RANK.metadata,
      });
    }
  }

  for (const f of src.folders ?? []) {
    const r = score(f.name, needle);
    if (r === null) continue;
    hits.push({
      id: `folder:${f.id}`,
      label: f.name,
      context: "folder",
      kind: "folder",
      reveal: "library",
      datasetId: null,
      rank: r,
    });
  }

  for (const r of src.reports ?? []) {
    const s = score(r.name, needle);
    if (s === null) continue;
    hits.push({
      id: `report:${r.id}`,
      label: r.name,
      context: "report",
      kind: "report",
      reveal: "report",
      datasetId: r.datasetId,
      rank: s,
    });
  }

  for (const f of src.figures ?? []) {
    const s = score(f.name, needle);
    if (s === null) continue;
    hits.push({
      id: `figure:${f.id}`,
      label: f.name,
      context: "figure",
      kind: "figure",
      reveal: "figure",
      datasetId: null,
      rank: s,
    });
  }

  // Stable within a rank: alphabetical, so repeating a search does not reshuffle
  // results under the cursor.
  hits.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  return hits.slice(0, limit);
}

/** A short window of `text` around the match, so a note hit shows WHY it
 *  matched rather than its first 60 characters. */
export function excerpt(text: string, needle: string, width = 48): string {
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return text.slice(0, width);
  const start = Math.max(0, at - Math.floor(width / 3));
  const slice = text.slice(start, start + width).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + slice + (start + width < text.length ? "…" : "");
}
