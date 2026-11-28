// What a plot's "Create subset from region" asks before it copies rows (ROW_RANGE_CONTRACT section 4): which of the
// plotted source series go into the subset, and which workbook it lands in. Pure: no store, no React.
//
// The checklist drops only PLOTTED series the user unticked. Every other column rides along as it does in the
// worksheet's Extract, so ticking everything (the default) is byte-for-byte the subset made before the choice
// existed. Dropping a column has to renumber every channel-indexed field of the data, so it FAILS CLOSED: a sheet
// that carries a channel-indexed sidecar this module does not renumber refuses to drop any series (and says which),
// rather than hand back a subset whose per-column fields describe different columns.

import { CELL_NOTES_KEY } from "./rowSidecars";
import type { DataStruct } from "./types";

/** Metadata that is indexed by channel and that a column drop does not renumber (so a drop is refused). */
const CHANNEL_INDEXED_KEYS = ["label_rows", "all_column_names", CELL_NOTES_KEY] as const;

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

/** `data` without the channels `drop`, or the reason that cannot be done safely. Nothing to drop returns `data` itself. */
export function dropChannels(data: DataStruct, drop: ReadonlySet<number>): { data: DataStruct } | { refusal: string } {
  if (drop.size === 0) return { data };
  const sidecar = CHANNEL_INDEXED_KEYS.find((key) => key in data.metadata);
  if (sidecar) return { refusal: `this worksheet carries per-column metadata (${sidecar}) that a subset of its columns cannot keep; tick every series, or extract the rows from the worksheet` };
  const keep = data.labels.map((_l, c) => c).filter((c) => !drop.has(c));
  const at = (c: number): number | null => { const i = keep.indexOf(c); return i < 0 ? null : i; };
  const cat = renumber(data.cat_levels, at);
  const order = renumber(data.level_order, at);
  const { cat_levels: _cat, level_order: _order, ...rest } = data;
  return {
    data: {
      ...rest,
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
