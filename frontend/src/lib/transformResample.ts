// Resample / align onto a common grid as a recordable transform (audit P2.5,
// "previewed ... align/interpolate"). The `resample` op of lib/transformRun:
// its params, their validation for replay, the request it posts to
// `/api/transform/resample` (calc.resample_align over the golden
// calc.resample), and the ONE compute both the workshop's live preview and
// the commit/replay path call — so what the preview shows is what is created.
//
// Grids: `n_points` / `step` over the source's finite x-range, an explicit
// `range` (start:step:stop, MATLAB colon), or `match` another dataset's x.
// Matching records that dataset like every second input of a transform — a
// dataset id (`with`), resolved or refused on replay, never guessed by name.
// The match grid is that dataset's STORED x (`data.time`, the grid it is on);
// the source is its analysis rows (exclusions/filters pruned), as for the
// reshape transforms.
//
// Out-of-range target points are left blank or dropped, never extrapolated.
// An x unit mismatch is refused by the backend unless it was explicitly
// acknowledged. The acknowledgment is recorded as the exact unit PAIR the
// user accepted (`acceptedXUnits`, e.g. ["K", "Oe"]), never a blanket flag:
// a replay or template run whose units differ in any OTHER way is refused
// again, by name. The preview always asks with the mismatch allowed, so the
// warning can be SHOWN before the user decides. Lazy: only the workshop and
// the transform runner import this.

import { resampleDataset, type ResampleRequest, type ResampleWarningWire } from "./api/resample";
import { analysisData } from "./rowstate";
import type { DatasetRef } from "./transformRun";
import type { TransformWarning, TransformWarningCode } from "./transformWarnings";
import type { DataStruct, Dataset } from "./types";

export type ResampleMode = "n_points" | "step" | "range" | "match";
export type ResampleMethod = "linear" | "pchip" | "spline" | "makima";
export type OutOfRange = "nan" | "clip";

export const RESAMPLE_MODES: readonly ResampleMode[] = ["n_points", "step", "range", "match"];
export const RESAMPLE_METHODS: readonly ResampleMethod[] = ["linear", "pchip", "spline", "makima"];

export interface ResampleParams {
  op: "resample";
  mode: ResampleMode;
  /** `n_points` */
  nPoints?: number;
  /** `step` (> 0) and `range` (signed) */
  step?: number;
  /** `range` */
  start?: number;
  stop?: number;
  /** `match`: the dataset whose x is the target grid. */
  with?: DatasetRef;
  method: ResampleMethod;
  outOfRange: OutOfRange;
  /** Sort an x that changes direction (merging loop branches) instead of
   *  refusing it. */
  sortUnsorted: boolean;
  /** `match`: the [source, matched] x-unit pair the user explicitly accepted
   *  as different. Only that exact pair is let through on replay. */
  acceptedXUnits?: [string, string];
}

/** What one resample produces, before anything is committed. */
export interface ResampleComputed {
  data: DataStruct;
  name: string;
  warnings: TransformWarning[];
  rowsIn: number;
  rowsOut: number;
  sourceRange: [number, number];
}

const stem = (name: string): string => name.replace(/\.[^.]+$/, "");

/** The rows a resample reads from a dataset: its ANALYSIS rows. */
export const resampleSource = (ds: Dataset): DataStruct => analysisData(ds) ?? ds.data;

/** A dataset's recorded x unit ("" when unknown) — the same keys, in the same
 *  order, as the backend's `calc.resample_align.x_unit_of`, so both sides
 *  agree on what the unit IS. */
export function xUnitOf(data: DataStruct): string {
  for (const key of ["x_column_unit", "xUnit", "xColumnUnit"]) {
    const raw = data.metadata?.[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return "";
}

/** The x-unit pair a `match` resample of `source` onto `match` would have to
 *  accept, or undefined when the units do not conflict (either unknown, or
 *  equal) — the backend's rule. */
export function xUnitConflict(source: DataStruct, match: DataStruct): [string, string] | undefined {
  const a = xUnitOf(source);
  const b = xUnitOf(match);
  return a && b && a !== b ? [a, b] : undefined;
}

/** "200 points", "step 0.5", "0:0.5:10", "b.dat's x". */
export function gridText(p: ResampleParams): string {
  switch (p.mode) {
    case "n_points": return `${p.nPoints ?? "?"} points`;
    case "step": return `step ${p.step ?? "?"}`;
    case "range": return `${p.start ?? "?"}:${p.step ?? "?"}:${p.stop ?? "?"}`;
    default: return `${p.with?.name ?? "?"}'s x`;
  }
}

export function resampleLabel(p: ResampleParams, primaryName: string): string {
  return `Resample ${primaryName} onto ${gridText(p)} (${p.method})`;
}

export function resampleOutputName(p: ResampleParams, primaryName: string): string {
  return p.mode === "match" && p.with
    ? `${stem(primaryName)} (on ${stem(p.with.name)} x)`
    : `${stem(primaryName)} (resampled)`;
}

/** The request body. `preview` asks with the unit mismatch allowed, so the
 *  warning can be shown; the commit (and a replay) allows it only when THIS
 *  source/match unit pair is the one recorded as accepted. */
export function resampleRequest(
  p: ResampleParams,
  source: DataStruct,
  match: DataStruct | null,
  preview = false,
): ResampleRequest {
  const body: ResampleRequest = {
    dataset: {
      time: source.time,
      values: source.values,
      labels: source.labels,
      units: source.units,
      metadata: source.metadata,
      cat_levels: source.cat_levels,
      level_order: source.level_order,
    },
    mode: p.mode,
    method: p.method,
    out_of_range: p.outOfRange,
    unsorted: p.sortUnsorted ? "sort" : "refuse",
    allow_unit_mismatch: preview,
  };
  if (p.mode === "n_points") body.n_points = p.nPoints;
  if (p.mode === "step" || p.mode === "range") body.step = p.step;
  if (p.mode === "range") {
    body.start = p.start;
    body.stop = p.stop;
  }
  if (p.mode === "match") {
    if (!match) throw new Error("pick the dataset whose x to match");
    body.match_x = match.time.map((v) => (Number.isFinite(v) ? v : null));
    body.match_x_unit = xUnitOf(match);
    const conflict = xUnitConflict(source, match);
    const ok = p.acceptedXUnits;
    if (conflict && ok && conflict[0] === ok[0] && conflict[1] === ok[1]) body.allow_unit_mismatch = true;
  }
  return body;
}

function toWarning(w: ResampleWarningWire): TransformWarning {
  const out: TransformWarning = { code: w.code as TransformWarningCode, text: w.text };
  if (w.count != null) out.count = w.count;
  if (w.columns != null) out.columns = w.columns;
  if (w.confirm) out.confirm = true;
  if (w.info) out.info = true;
  return out;
}

/** Resample `source` per `p` (`match` = the dataset whose x to match, for
 *  `mode: "match"`). Throws the backend's message on a refused input. */
export async function computeResample(
  p: ResampleParams,
  source: { name: string; data: DataStruct },
  match: { name: string; data: DataStruct } | null,
  opts: { preview?: boolean; signal?: AbortSignal } = {},
): Promise<ResampleComputed> {
  const res = await resampleDataset(resampleRequest(p, source.data, match?.data ?? null, opts.preview), opts.signal);
  const provenance: Record<string, unknown> = { resample_of: source.name, resample_grid: gridText(p) };
  if (p.mode === "match" && match) provenance.aligned_to = match.name;
  return {
    data: { ...res.dataset, metadata: { ...res.dataset.metadata, ...provenance } },
    name: resampleOutputName(p, source.name),
    warnings: res.warnings.map(toWarning),
    rowsIn: res.rows_in,
    rowsOut: res.rows_out,
    sourceRange: [res.source_range[0], res.source_range[1]],
  };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validate a recorded `resample` step's params (a .dwk / template is user-
 *  editable JSON), or throw naming what is wrong. */
export function resampleParamsOf(raw: Record<string, unknown>): ResampleParams {
  const mode = String(raw.mode ?? "") as ResampleMode;
  if (!RESAMPLE_MODES.includes(mode)) throw new Error(`unknown resample grid "${mode}"`);
  const method = String(raw.method ?? "linear") as ResampleMethod;
  if (!RESAMPLE_METHODS.includes(method)) throw new Error(`unknown resample method "${method}"`);
  const outOfRange = String(raw.outOfRange ?? "nan");
  if (outOfRange !== "nan" && outOfRange !== "clip") throw new Error(`unknown out-of-range rule "${outOfRange}"`);
  const p: ResampleParams = {
    op: "resample",
    mode,
    method,
    outOfRange,
    sortUnsorted: raw.sortUnsorted === true,
  };
  const acc = raw.acceptedXUnits;
  if (acc !== undefined) {
    if (!Array.isArray(acc) || acc.length !== 2 || !acc.every((u) => typeof u === "string" && u)) {
      throw new Error('resample "acceptedXUnits" must be two unit names');
    }
    p.acceptedXUnits = [acc[0] as string, acc[1] as string];
  }
  const need = (k: "nPoints" | "step" | "start" | "stop"): number => {
    const v = raw[k];
    if (!finite(v)) throw new Error(`resample "${mode}" needs a number "${k}"`);
    return v;
  };
  if (mode === "n_points") {
    p.nPoints = need("nPoints");
    if (!Number.isInteger(p.nPoints) || p.nPoints < 2) throw new Error('resample "nPoints" must be an integer ≥ 2');
  } else if (mode === "step") {
    p.step = need("step");
  } else if (mode === "range") {
    p.start = need("start");
    p.stop = need("stop");
    p.step = need("step");
  } else {
    const o = (raw.with ?? {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id) throw new Error('resample "match" has no recorded dataset to match');
    p.with = { id: o.id, name: typeof o.name === "string" ? o.name : o.id };
  }
  return p;
}
