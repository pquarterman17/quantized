// What a plot's "Create subset from region" asks before it copies rows (ROW_RANGE_CONTRACT section 4): which of the
// plotted source series go into the subset, and which workbook it lands in. Pure: no store, no React.
//
// The checklist drops only PLOTTED series the user unticked. Every other column rides along as it does in the
// worksheet's Extract, so ticking everything (the default) is byte-for-byte the subset made before the choice
// existed. Dropping a column has to renumber every channel-indexed field of the data, so it FAILS CLOSED: a sheet
// that carries a channel-indexed sidecar this module does not renumber refuses to drop any series (and says which),
// rather than hand back a subset whose per-column fields describe different columns. The sidecars a plain CSV or
// spreadsheet import carries (`all_column_names`, `label_rows`) and the cell notes are renumbered here, so the
// checklist works on an ordinary file; only the parser declarations of a channel list stay refused.

import { CELL_NOTES_KEY } from "./rowSidecars";
import type { DataStruct } from "./types";

/** Metadata that is indexed by channel and that a column drop does NOT renumber (so a drop is refused): a
 *  parser's own declaration of which columns are y / error columns. */
const CHANNEL_INDEXED_KEYS = ["y_column_indices", "error_roles"] as const;

/** A header as the importers split it: "Temp (K)" and "Temp" name one column (worksheetTable.ts's rule). */
const bare = (name: string): string => name.replace(/\s*[([][^)\]]*[)\]]\s*$/, "").trim();

/** One plotted series of a region: the channel, its name, and how many of the region's rows hold a value in it. */
export interface SubsetSeries {
  channel: number;
  label: string;
  rows: number;
}

/** The plotted `channels` with the number of `rows` (source rows of the region) that hold a finite value in each. */
export function subsetSeries(data: DataStruct, channels: readonly number[], rows: readonly number[]): SubsetSeries[] {
  return channels.map((channel) => ({
    channel,
    label: data.labels[channel] || `Column ${channel + 1}`,
    rows: rows.filter((r) => Number.isFinite(data.values[r]?.[channel])).length,
  }));
}

const renumber = <T>(record: Record<number, T> | undefined, at: (c: number) => number | null): Record<number, T> | undefined => {
  if (!record) return undefined;
  const out: Record<number, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const to = at(Number(key));
    if (to !== null) out[to] = value;
  }
  return Object.keys(out).length ? out : undefined;
};

/** `metadata` for the data left after dropping `drop`: the file's column roster (and its parallel units list), each
 *  label row's per-channel cells, and the cell notes follow the surviving columns. A channel is matched to its place
 *  in the roster the way the worksheet orders its columns (bare name, left to right, x first). Null when a dropped
 *  channel cannot be found in the roster or a list is not the length it should be: the caller then refuses. */
function renumberMetadata(data: DataStruct, keep: readonly number[], drop: ReadonlySet<number>, at: (c: number) => number | null): Record<string, unknown> | null {
  const meta: Record<string, unknown> = { ...data.metadata };
  const names = meta["all_column_names"];
  if ("all_column_names" in meta && !Array.isArray(names)) return null;
  if (Array.isArray(names)) {
    const free = new Map<string, number[]>();
    names.forEach((n, i) => free.set(bare(String(n)), [...(free.get(bare(String(n))) ?? []), i]));
    const claim = (name: string): number | undefined => free.get(bare(name))?.shift();
    claim(String(meta["x_column_long"] || meta["x_column_name"] || "x"));
    const gone = new Set<number>();
    for (let c = 0; c < data.labels.length; c++) {
      const place = claim(data.labels[c]);
      if (drop.has(c)) {
        if (place === undefined) return null;
        gone.add(place);
      }
    }
    const units = meta["all_column_units"];
    if (Array.isArray(units) && units.length !== names.length) return null;
    meta["all_column_names"] = names.filter((_n, i) => !gone.has(i));
    if (Array.isArray(units)) meta["all_column_units"] = units.filter((_u, i) => !gone.has(i));
  }
  const rows = meta["label_rows"];
  if ("label_rows" in meta && !Array.isArray(rows)) return null;
  if (Array.isArray(rows)) {
    const ok = rows.every((r) => Array.isArray((r as { cells?: unknown })?.cells) && (r as { cells: unknown[] }).cells.length === data.labels.length);
    if (!ok) return null;
    meta["label_rows"] = rows.map((r) => ({ ...(r as object), cells: (r as { cells: unknown[] }).cells.filter((_c, i) => keep.includes(i)) }));
  }
  const notes = meta[CELL_NOTES_KEY];
  if (notes && typeof notes === "object") {
    const moved = renumber(notes as Record<number, unknown>, (c) => (c < 0 ? c : at(c)));
    if (moved) meta[CELL_NOTES_KEY] = moved;
    else delete meta[CELL_NOTES_KEY];
  }
  return meta;
}

/** `data` without the channels `drop`, or the reason that cannot be done safely. Nothing to drop returns `data` itself. */
export function dropChannels(data: DataStruct, drop: ReadonlySet<number>): { data: DataStruct } | { refusal: string } {
  if (drop.size === 0) return { data };
  const sidecar = CHANNEL_INDEXED_KEYS.find((key) => key in data.metadata);
  if (sidecar) return { refusal: `this worksheet carries per-column metadata (${sidecar}) that a subset of its columns cannot keep; tick every series, or extract the rows from the worksheet` };
  const keep = data.labels.map((_l, c) => c).filter((c) => !drop.has(c));
  const at = (c: number): number | null => { const i = keep.indexOf(c); return i < 0 ? null : i; };
  const metadata = renumberMetadata(data, keep, drop, at);
  if (!metadata) return { refusal: "this worksheet's per-column metadata does not line up with its columns, so a subset of them cannot keep it; tick every series, or extract the rows from the worksheet" };
  const cat = renumber(data.cat_levels, at);
  const order = renumber(data.level_order, at);
  const { cat_levels: _cat, level_order: _order, ...rest } = data;
  return {
    data: {
      ...rest,
      metadata: metadata as DataStruct["metadata"],
      values: data.values.map((row) => keep.map((c) => row[c])),
      labels: keep.map((c) => data.labels[c]),
      units: keep.map((c) => data.units[c]),
      ...(cat ? { cat_levels: cat } : {}),
      ...(order ? { level_order: order } : {}),
    },
  };
}

/** Where the subset lands. */
export type SubsetDestination = { kind: "source" } | { kind: "new" } | { kind: "workbook"; id: string };

/** The destination a dialog answer names: `"source"`, `"new"`, or `"wb:<id>"`; anything else fails closed to the source's. */
export function parseSubsetDestination(answer: string, workbookIds: readonly string[]): SubsetDestination {
  if (answer === "new") return { kind: "new" };
  const id = answer.startsWith("wb:") ? answer.slice(3) : "";
  return workbookIds.includes(id) ? { kind: "workbook", id } : { kind: "source" };
}
