// The ternary workshop's per-dataset settings (plan item 21): which columns
// are A / B / C / Z and how the composition map is drawn (scatter, filled
// contour, heatmap, colormap, levels, lines, labels). Pure — types, defaults,
// the matplotlib colormap names, the .dwk sanitizer and serializer. The live
// copy is `store/ternaryFigures.ts`; this is the file form.
//
// PERSISTENCE: top-level `ternaryFigures` in the .dwk, keyed by dataset id,
// written ONLY when a dataset has settings the user chose, so a project that
// never opened the ternary workshop is byte-identical to one saved before
// this existed, and an older build ignores the key (the parser picks fields
// by name) — no schema bump. A malformed entry, or one for a dataset this
// load did not keep, is dropped (never thrown), like `mapViews`.

import { COLORMAPS, type ColormapName } from "./colormap";

/** scatter / contour / heatmap (plan item 21) and line / vector (item 25). */
export type TernaryKind = "scatter" | "contour" | "heatmap" | "line" | "vector";

export interface TernaryPicksSaved {
  a: number;
  b: number;
  c: number;
  /** The Z / colour channel (a line's series-by column), or null. */
  colorBy: number | null;
  /** A line's series-by text column (sidecar name). */
  seriesText?: string;
  /** A vector plot's END composition columns (the A, B, C picks are its start). */
  ea?: number;
  eb?: number;
  ec?: number;
}

export interface TernaryField {
  kind: TernaryKind;
  cmap: ColormapName;
  /** Number of colour bands (contour). */
  levels: number;
  lines: boolean;
  labels: boolean;
  /** Explicit colour range of a contour / heatmap (both ends, lo < hi); absent
   *  or null = the data's own Z range. */
  zLimits?: [number, number] | null;
  /** Line / vector style (colour, width, dash, markers, head). Opaque HERE so
   *  the eager project loader stays small; the lazy workshop validates it
   *  (`workshops/ternary/ternaryPathStyle.ts`) before use. */
  path?: Record<string, unknown>;
}

export interface TernarySaved {
  picks: TernaryPicksSaved;
  field: TernaryField;
}

export type TernaryFiguresMap = Record<string, TernarySaved>;

export const TERNARY_KINDS: readonly TernaryKind[] = ["scatter", "contour", "heatmap", "line", "vector"];

/** The kinds that colour the triangle by a Z column. */
export const isMapKind = (k: TernaryKind): boolean => k === "contour" || k === "heatmap";
export const LEVELS_RANGE: readonly [number, number] = [1, 64];

export const DEFAULT_TERNARY_FIELD: TernaryField = { kind: "scatter", cmap: "viridis", levels: 8, lines: true, labels: false };

/** The export's matplotlib name for each canvas colormap (the canvas `rdbu`
 *  runs blue -> red, which matplotlib calls `RdBu_r`). */
export const TERNARY_MPL_CMAP: Record<ColormapName, string> = {
  viridis: "viridis",
  magma: "magma",
  gray: "gray",
  rdbu: "RdBu_r",
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const col = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= -1 && v < 10_000 ? v : null);

/** Clamp to the levels the export accepts. */
export function clampLevels(n: number): number {
  return Math.min(LEVELS_RANGE[1], Math.max(LEVELS_RANGE[0], Math.round(Number.isFinite(n) ? n : DEFAULT_TERNARY_FIELD.levels)));
}

/** A usable explicit Z range, or null: two finite numbers with lo < hi. */
export function validZLimits(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [lo, hi] = v as unknown[];
  return typeof lo === "number" && typeof hi === "number" && Number.isFinite(lo) && Number.isFinite(hi) && lo < hi ? [lo, hi] : null;
}

export function sanitizeTernaryField(raw: unknown): TernaryField {
  const o = isObj(raw) ? raw : {};
  const d = DEFAULT_TERNARY_FIELD;
  const zLimits = validZLimits(o.zLimits);
  return {
    ...(zLimits ? { zLimits } : {}),
    ...(isObj(o.path) ? { path: o.path } : {}),
    kind: TERNARY_KINDS.includes(o.kind as TernaryKind) ? (o.kind as TernaryKind) : d.kind,
    cmap: typeof o.cmap === "string" && o.cmap in COLORMAPS ? (o.cmap as ColormapName) : d.cmap,
    levels: typeof o.levels === "number" ? clampLevels(o.levels) : d.levels,
    lines: typeof o.lines === "boolean" ? o.lines : d.lines,
    labels: typeof o.labels === "boolean" ? o.labels : d.labels,
  };
}

/** The .dwk `ternaryFigures` field -> the entries this load keeps. */
export function sanitizeTernaryFigures(raw: unknown, datasetIds: ReadonlySet<string>): TernaryFiguresMap {
  const out: TernaryFiguresMap = {};
  if (!isObj(raw)) return out;
  for (const [id, entry] of Object.entries(raw)) {
    if (!datasetIds.has(id) || !isObj(entry) || !isObj(entry.picks)) continue;
    const a = col(entry.picks.a);
    const b = col(entry.picks.b);
    const c = col(entry.picks.c);
    const z = entry.picks.colorBy === null || entry.picks.colorBy === undefined ? null : col(entry.picks.colorBy);
    if (a === null || b === null || c === null) continue;
    const ends = [col(entry.picks.ea), col(entry.picks.eb), col(entry.picks.ec)];
    const [ea, eb, ec] = ends;
    const end = ea === null || eb === null || ec === null ? {} : { ea, eb, ec };
    const st = entry.picks.seriesText;
    out[id] = { picks: { a, b, c, colorBy: z, ...(typeof st === "string" ? { seriesText: st } : {}), ...end }, field: sanitizeTernaryField(entry.field) };
  }
  return out;
}

/** What a save writes: the entries of datasets still in the project, or
 *  undefined when there are none (the key is then omitted). */
export function ternaryFiguresForSave(
  map: TernaryFiguresMap,
  datasetIds: Iterable<string>,
): TernaryFiguresMap | undefined {
  const out: TernaryFiguresMap = {};
  for (const id of datasetIds) {
    const s = map[id];
    if (s) out[id] = { picks: { ...s.picks }, field: { ...s.field } };
  }
  return Object.keys(out).length ? out : undefined;
}
