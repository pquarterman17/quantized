// Ternary line and vector requests (plan item 25) — pure: a DataStruct plus the
// workshop's picks -> the `/api/export/ternary-paths-figure` body.
//
// LINE: A, B, C columns; an optional "series by" column splits the rows into
// series (one per distinct value, in first-seen order, rows kept in sheet order,
// legend entry `column = value`). A row that cannot be drawn (a non-finite or
// negative component, an all-zero row) is sent as a GAP (null cells): the line
// breaks there instead of joining across it. VECTOR: A, B, C are the START
// composition and `ea, eb, ec` the END composition (six columns; a change
// column is not offered). A row that cannot be drawn at either end is left out
// and counted, like the scatter's.

import type { DataStruct } from "../../../lib/types";
import { TERNARY_MPL_CMAP, type TernaryField } from "../../../lib/ternaryProject";
import { textColumnCells } from "../../../lib/originTextColumnCells";
import { cellValue, columnAxisLabel, columnLabel } from "./auxColumns";
import { readPathStyle, type TernaryPathStyle } from "./ternaryPathStyle";
import type { TernaryPicks } from "./ternaryRequest";

type Cell = number | null;
export type PathRow = [Cell, Cell, Cell];

export interface TernaryLineSpec {
  kind: "line";
  labels: [string, string, string];
  series: { name: string; rows: PathRow[] }[];
  color?: string;
  width: number;
  dash: string;
  markers: boolean;
  title: string;
  filename: string;
}

export interface TernaryVectorSpec {
  kind: "vector";
  labels: [string, string, string];
  start: number[][];
  end: number[][];
  values?: number[];
  z_label?: string;
  cmap?: string;
  color?: string;
  width: number;
  head_size: number;
  head_style: string;
  title: string;
  filename: string;
}

export type TernaryPathsSpec = TernaryLineSpec | TernaryVectorSpec;

export interface PathsBuild {
  spec: TernaryPathsSpec | null;
  /** Rows the figure leaves out (vector) or breaks the line at (line). */
  dropped: number;
  total: number;
}

export interface PathsOptions {
  title: string;
  filename: string;
  field: TernaryField;
}

function drawable(row: number[]): boolean {
  return row.every((v) => Number.isFinite(v) && v >= 0) && row.some((v) => v > 0);
}

const cells = (data: DataStruct, cols: number[], r: number): number[] => cols.map((c) => cellValue(data, c, r));
const labelsOf = (data: DataStruct, cols: number[]): [string, string, string] => [
  columnLabel(data, cols[0]),
  columnLabel(data, cols[1]),
  columnLabel(data, cols[2]),
];

function buildLine(data: DataStruct, picks: TernaryPicks, opts: PathsOptions, style: TernaryPathStyle): PathsBuild {
  const total = data.time.length;
  const abc = [picks.a, picks.b, picks.c];
  const groups = new Map<number | string, PathRow[]>();
  // A text series column is read by name off the (row-aligned) sidecar; a name the sheet lacks means no split.
  const text = picks.seriesText === undefined ? null : textColumnCells(data, picks.seriesText);
  let dropped = 0;
  for (let r = 0; r < total; r++) {
    const cell = text?.[r];
    const key: number | string = text ? (cell === null || cell === undefined || String(cell).trim() === "" ? Number.NaN : String(cell)) : picks.colorBy === null ? 0 : cellValue(data, picks.colorBy, r);
    if (typeof key === "number" && !Number.isFinite(key)) {
      dropped++;
      continue;
    }
    const row = cells(data, abc, r);
    const ok = drawable(row);
    if (!ok) dropped++;
    const list = groups.get(key) ?? [];
    list.push(ok ? (row as PathRow) : [null, null, null]);
    groups.set(key, list);
  }
  const series = [...groups.entries()]
    .filter(([, rows]) => rows.some((row) => row[0] !== null))
    .map(([key, rows]) => ({
      name: text ? `${picks.seriesText} = ${key}` : picks.colorBy === null ? "" : `${columnLabel(data, picks.colorBy)} = ${key}`,
      rows,
    }));
  if (series.length === 0) return { spec: null, dropped: total, total };
  return {
    spec: {
      kind: "line",
      labels: labelsOf(data, abc),
      series,
      // One colour for several series could not be told apart in the legend.
      ...(style.color && series.length === 1 ? { color: style.color } : {}),
      width: style.width,
      dash: style.dash,
      markers: style.markers,
      title: opts.title,
      filename: opts.filename,
    },
    dropped,
    total,
  };
}

function buildVector(data: DataStruct, picks: TernaryPicks, opts: PathsOptions, style: TernaryPathStyle): PathsBuild {
  const total = data.time.length;
  const start = [picks.a, picks.b, picks.c];
  const end = [picks.ea ?? -1, picks.eb ?? -1, picks.ec ?? -1];
  const s: number[][] = [];
  const e: number[][] = [];
  const values: number[] = [];
  for (let r = 0; r < total; r++) {
    const a = cells(data, start, r);
    const b = cells(data, end, r);
    if (!drawable(a) || !drawable(b)) continue;
    if (picks.colorBy !== null) {
      const v = cellValue(data, picks.colorBy, r);
      if (!Number.isFinite(v)) continue;
      values.push(v);
    }
    s.push(a);
    e.push(b);
  }
  if (s.length === 0) return { spec: null, dropped: total, total };
  const colored = picks.colorBy !== null;
  return {
    spec: {
      kind: "vector",
      labels: labelsOf(data, start),
      start: s,
      end: e,
      ...(colored
        ? { values, z_label: columnAxisLabel(data, picks.colorBy as number), cmap: TERNARY_MPL_CMAP[opts.field.cmap] }
        : style.color
          ? { color: style.color }
          : {}),
      width: style.width,
      head_size: style.headSize,
      head_style: style.head,
      title: opts.title,
      filename: opts.filename,
    },
    dropped: total - s.length,
    total,
  };
}

export function buildTernaryPathsRequest(data: DataStruct, picks: TernaryPicks, opts: PathsOptions): PathsBuild {
  const style = readPathStyle(opts.field);
  return opts.field.kind === "line" ? buildLine(data, picks, opts, style) : buildVector(data, picks, opts, style);
}

/** One sentence naming the rows a line / vector plot could not use, or null. */
export function pathsNotice(kind: "line" | "vector", dropped: number, total: number): string | null {
  if (dropped <= 0) return null;
  const one = dropped === 1;
  if (kind === "line") {
    return `${dropped} of ${total} rows ${one ? "has" : "have"} a missing, negative or all-zero value (or no series value): the line breaks there.`;
  }
  return `${dropped} of ${total} rows ${one ? "has" : "have"} an unusable start or end composition (or colour value) and ${one ? "was" : "were"} left out.`;
}
