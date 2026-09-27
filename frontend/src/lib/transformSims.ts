// SIMS depth-profile processing as a recordable transform (audit P2.3). The
// `sims` op of lib/transformRun: its params, their validation for replay, the
// request it posts to `/api/sims/process` (calc.sims_process), and the ONE
// compute both the workshop's live preview and the commit/replay path call —
// so what the preview shows is what is created.
//
// Stages (each optional, applied by the backend in this fixed order):
// depth calibration (sputter time -> depth, from a rate or a crater depth),
// region-mean background, reference normalization (C = RSF * I / I_ref),
// smoothing. The result is a NEW dataset; the source is never touched. Undo is
// the transform runner's one `addDataset` entry; the recorded pipeline step
// replays the same stages (the saved recipe), and the dataset persists in
// `.dwk` like any other.
//
// The reference species and the RSFs are recorded BY COLUMN NAME, never by
// index: a template batch over a file whose columns come in another order
// would otherwise divide by the wrong species silently. A replay onto a
// dataset without that column is refused, naming it.
//
// Provenance: the backend appends every stage (with the sputter rate actually
// used and each background level) to `metadata.sims_processing`; this module
// adds `sims_source` (the input's id + name), which the Library's derived
// mark reads. Lazy: only the workshop and the transform runner import this.

import { processSims, type SimsProcessRequest, type SimsWarningWire } from "./api/sims";
import { analysisData } from "./rowstate";
import type { TransformWarning, TransformWarningCode } from "./transformWarnings";
import type { DataStruct, Dataset } from "./types";

export type SimsCalMethod = "rate" | "crater";
export type SimsSmoothMethod = "moving" | "gaussian" | "savitzky-golay";

export const SIMS_SMOOTH_METHODS: readonly SimsSmoothMethod[] = ["moving", "gaussian", "savitzky-golay"];
export const SIMS_LENGTH_UNITS = ["nm", "A", "um"] as const;
export const SIMS_TIME_UNITS = ["s", "min", "h"] as const;

export interface SimsCalibration {
  method: SimsCalMethod;
  /** `rate`: the sputter rate in `rateUnit` (length/time, e.g. "nm/s"). */
  sputterRate?: number;
  rateUnit?: string;
  /** `crater`: the measured crater depth in `craterUnit`. */
  craterDepth?: number;
  craterUnit?: string;
  /** `crater`: total sputter time in x's unit; absent = the last time point. */
  totalTime?: number;
  depthUnit: string;
  /** The time unit x is in, stated by the user; absent = the recorded unit. */
  timeUnit?: string;
}

export interface SimsParams {
  op: "sims";
  calibration?: SimsCalibration;
  /** Region (x after calibration) whose per-species mean is subtracted. */
  background?: { lo: number; hi: number };
  /** Reference species by column NAME; RSFs by column name (absent = ratio). */
  normalization?: { reference: string; rsf?: Record<string, number>; rsfUnit?: string };
  smoothing?: { method: SimsSmoothMethod; window: number; polyOrder: number };
}

export interface SimsComputed {
  data: DataStruct;
  name: string;
  warnings: TransformWarning[];
  stages: Record<string, unknown>[];
}

const stem = (name: string): string => name.replace(/\.[^.]+$/, "");

/** The rows SIMS processing reads: the dataset's ANALYSIS rows. */
export const simsSource = (ds: Dataset): DataStruct => analysisData(ds) ?? ds.data;

/** Which stages `p` runs, in the backend's order ("depth · bg · norm · smooth"). */
export function simsStagesText(p: SimsParams): string {
  const parts: string[] = [];
  if (p.calibration) parts.push(`depth (${p.calibration.method})`);
  if (p.background) parts.push("background");
  if (p.normalization) parts.push(`÷ ${p.normalization.reference}`);
  if (p.smoothing) parts.push(`smooth (${p.smoothing.method})`);
  return parts.join(" · ");
}

export function simsLabel(p: SimsParams, primaryName: string): string {
  return `SIMS ${primaryName}: ${simsStagesText(p)}`;
}

export function simsOutputName(primaryName: string): string {
  return `${stem(primaryName)} (SIMS processed)`;
}

/** The column index a recorded name refers to — refused when absent or when
 *  two columns share it (either would make the choice a guess). */
function columnIndex(labels: readonly string[], name: string): number {
  const hits = labels.flatMap((l, i) => (l === name ? [i] : []));
  if (!hits.length) throw new Error(`this dataset has no column "${name}"`);
  if (hits.length > 1) throw new Error(`this dataset has ${hits.length} columns named "${name}"`);
  return hits[0];
}

/** The request body for `p` over `source`. */
export function simsRequest(p: SimsParams, source: DataStruct): SimsProcessRequest {
  const body: SimsProcessRequest = {
    dataset: {
      time: source.time,
      values: source.values,
      labels: source.labels,
      units: source.units,
      metadata: source.metadata,
      cat_levels: source.cat_levels,
      level_order: source.level_order,
    },
  };
  const c = p.calibration;
  if (c) {
    body.calibration = {
      method: c.method,
      sputter_rate: c.sputterRate ?? null,
      rate_unit: c.rateUnit ?? "nm/s",
      crater_depth: c.craterDepth ?? null,
      crater_unit: c.craterUnit ?? "nm",
      total_time: c.totalTime ?? null,
      depth_unit: c.depthUnit,
      time_unit: c.timeUnit ?? null,
    };
  }
  if (p.background) body.background = { lo: p.background.lo, hi: p.background.hi };
  const n = p.normalization;
  if (n) {
    const reference = columnIndex(source.labels, n.reference);
    const names = Object.keys(n.rsf ?? {});
    for (const name of names) columnIndex(source.labels, name);
    body.normalization = {
      reference,
      rsf: names.length ? source.labels.map((l) => n.rsf?.[l] ?? null) : null,
      rsf_unit: n.rsfUnit ?? "",
    };
  }
  if (p.smoothing) {
    body.smoothing = { method: p.smoothing.method, window: p.smoothing.window, poly_order: p.smoothing.polyOrder };
  }
  return body;
}

function toWarning(w: SimsWarningWire): TransformWarning {
  const out: TransformWarning = { code: w.code as TransformWarningCode, text: w.text };
  if (w.count != null) out.count = w.count;
  if (w.columns != null) out.columns = w.columns;
  if (w.confirm) out.confirm = true;
  if (w.info) out.info = true;
  return out;
}

/** Process `source` per `p`. Throws the backend's message on a refused input. */
export async function computeSims(
  p: SimsParams,
  source: { id: string; name: string; data: DataStruct },
  opts: { signal?: AbortSignal } = {},
): Promise<SimsComputed> {
  const res = await processSims(simsRequest(p, source.data), opts.signal);
  return {
    data: { ...res.dataset, metadata: { ...res.dataset.metadata, sims_source: { id: source.id, name: source.name } } },
    name: simsOutputName(source.name),
    warnings: res.warnings.map(toWarning),
    stages: res.stages,
  };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown, fallback: string): string => (typeof v === "string" && v.trim() ? v.trim() : fallback);

/** Validate a recorded `sims` step's params (a .dwk / template is user-
 *  editable JSON), or throw naming what is wrong. */
export function simsParamsOf(raw: Record<string, unknown>): SimsParams {
  const p: SimsParams = { op: "sims" };
  const obj = (k: string): Record<string, unknown> | undefined => {
    const v = raw[k];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "object" || Array.isArray(v)) throw new Error(`sims "${k}" must be an object`);
    return v as Record<string, unknown>;
  };
  const cal = obj("calibration");
  if (cal) {
    const method = String(cal.method ?? "");
    if (method !== "rate" && method !== "crater") throw new Error(`unknown SIMS calibration "${method}"`);
    const num = (k: string): number | undefined => (finite(cal[k]) ? (cal[k] as number) : undefined);
    p.calibration = { method, depthUnit: str(cal.depthUnit, "nm") };
    if (method === "rate") {
      const rate = num("sputterRate");
      if (rate === undefined) throw new Error('sims calibration "rate" needs a number "sputterRate"');
      Object.assign(p.calibration, { sputterRate: rate, rateUnit: str(cal.rateUnit, "nm/s") });
    } else {
      const depth = num("craterDepth");
      if (depth === undefined) throw new Error('sims calibration "crater" needs a number "craterDepth"');
      Object.assign(p.calibration, { craterDepth: depth, craterUnit: str(cal.craterUnit, "nm") });
      const total = num("totalTime");
      if (total !== undefined) p.calibration.totalTime = total;
    }
    if (typeof cal.timeUnit === "string" && cal.timeUnit.trim()) p.calibration.timeUnit = cal.timeUnit.trim();
  }
  const bg = obj("background");
  if (bg) {
    if (!finite(bg.lo) || !finite(bg.hi)) throw new Error('sims "background" needs numbers "lo" and "hi"');
    p.background = { lo: bg.lo, hi: bg.hi };
  }
  const norm = obj("normalization");
  if (norm) {
    if (typeof norm.reference !== "string" || !norm.reference) throw new Error('sims "normalization" needs a reference column name');
    p.normalization = { reference: norm.reference };
    const rsf = norm.rsf;
    if (rsf !== undefined) {
      if (typeof rsf !== "object" || rsf === null || Array.isArray(rsf)) throw new Error('sims "rsf" must map column names to numbers');
      const entries = Object.entries(rsf as Record<string, unknown>);
      if (!entries.every(([, v]) => finite(v) && v > 0)) throw new Error('sims "rsf" values must be positive numbers');
      p.normalization.rsf = Object.fromEntries(entries) as Record<string, number>;
    }
    if (typeof norm.rsfUnit === "string") p.normalization.rsfUnit = norm.rsfUnit;
  }
  const sm = obj("smoothing");
  if (sm) {
    const method = String(sm.method ?? "moving") as SimsSmoothMethod;
    if (!SIMS_SMOOTH_METHODS.includes(method)) throw new Error(`unknown SIMS smoothing "${method}"`);
    const window = sm.window;
    const poly = sm.polyOrder ?? 2;
    if (!Number.isInteger(window) || (window as number) < 1) throw new Error('sims "window" must be an integer ≥ 1');
    if (!Number.isInteger(poly) || (poly as number) < 0) throw new Error('sims "polyOrder" must be an integer ≥ 0');
    p.smoothing = { method, window: window as number, polyOrder: poly as number };
  }
  if (!p.calibration && !p.background && !p.normalization && !p.smoothing) {
    throw new Error("a sims step needs at least one stage");
  }
  return p;
}
