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
// A stated calibration TIME-UNIT override (review finding 2) is likewise
// never a blanket flag: it is recorded as the exact (recorded -> stated) x
// unit pair it was accepted for (`acceptedTimeUnit`, mirroring resample's
// `acceptedXUnits`). On replay it is applied only when the target's CURRENT
// recorded x unit matches that recorded half of the pair exactly; otherwise
// it is dropped -- silently when the target's x is already a time unit (no
// override is needed there), or refused by the backend's own recorded-unit
// check otherwise. Without this, a template recorded once with an override
// would replay it unconditionally onto every future file, double-calibrating
// one whose x is already correctly in depth (e.g. already "nm").
//
// Provenance: the backend appends every stage (with the sputter rate actually
// used and each background level) to `metadata.sims_processing`; this module
// adds `sims_source` (the input's id + name), which the Library's derived
// mark reads. Lazy: only the workshop and the transform runner import this.

import { processSims, type SimsProcessRequest, type SimsWarningWire } from "./api/sims";
import { blanksToNaN } from "./blankCells";
import { analysisData } from "./rowstate";
import { xUnitOf } from "./transformResample";
import type { TransformWarning, TransformWarningCode } from "./transformWarnings";
import type { DataStruct, Dataset } from "./types";

export type SimsCalMethod = "rate" | "crater" | "scale";
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
  /** The [recorded, stated] x-unit pair `timeUnit` was explicitly accepted
   *  for (module doc). Only THAT exact pair is let through on replay. */
  acceptedTimeUnit?: [string, string];
  /** `scale`: depth = scaleFactor * x + offset. */
  scaleFactor?: number;
  offset?: number;
  /** `scale`: the exact recorded input x unit this factor was accepted for.
   *  Blank is a real value ("unit unknown"), not absence. */
  inputUnit?: string;
}

export interface SimsParams {
  op: "sims";
  calibration?: SimsCalibration;
  /** Region (x after calibration) whose per-species mean is subtracted;
   *  `keep` names columns left unchanged (the matrix signal is not a floor). */
  background?: { lo: number; hi: number; keep?: string[] };
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

/** The `DataStruct` fields the `/api/sims/*` wire actually reads -- shared by
 *  every SIMS request builder (`simsRequest` below, `computeSimsCompare`,
 *  `useSimsRegion`'s live preview) so the projection is defined once
 *  (finding 10 dedupe). Deliberately NOT the whole `DataStruct` type verbatim
 *  (structurally the same shape today, but this is the wire's own contract,
 *  not an alias for it). */
export function simsWireDataset(
  d: DataStruct,
): Pick<DataStruct, "time" | "values" | "labels" | "units" | "metadata" | "cat_levels" | "level_order"> {
  return {
    time: d.time, values: d.values, labels: d.labels, units: d.units,
    metadata: d.metadata, cat_levels: d.cat_levels, level_order: d.level_order,
  };
}

/** The species (column) names a SIMS source offers -- every non-categorical
 *  column, since a categorical one is a grouping label, not a measured
 *  signal. Shared by the Compare tab's species picker, the Region tab's
 *  species picker and dataset-switch re-seed, and the reference-normalization
 *  picker (finding 10 dedupe: this exact `cat_levels`-filter was copied three
 *  times). */
export function speciesOf(d: Pick<DataStruct, "labels" | "cat_levels">): string[] {
  const cats = new Set(Object.keys(d.cat_levels ?? {}).map(Number));
  return d.labels.filter((_, i) => !cats.has(i));
}

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

/** The time-unit override `simsRequest` actually sends for `c` over `source`
 *  (module doc): `opts.preview` always forwards a stated override so the
 *  backend's confirm warning can be shown; otherwise ONLY the exact
 *  (recorded, stated) pair `acceptedTimeUnit` names is forwarded — any other
 *  target drops the override (safe when its x is already a time unit; the
 *  backend's own recorded-unit check refuses it, by name, when it is not). */
function resolvedTimeUnit(c: SimsCalibration, source: DataStruct, preview: boolean): string | null {
  if (!c.timeUnit) return null;
  if (preview) return c.timeUnit;
  const recorded = xUnitOf(source);
  const accepted = c.acceptedTimeUnit;
  return accepted && accepted[0] === recorded && accepted[1] === c.timeUnit ? c.timeUnit : null;
}

/** A direct scale is meaningful only in the input unit it was created for.
 *  Unlike a time calibration there is no unit conversion to rescue a replay:
 *  e.g. divide-by-1000 might mean counts -> nm, while on an already-nm file it
 *  would silently shrink a correct axis. */
function assertScaleInputUnit(c: SimsCalibration, source: DataStruct, preview: boolean): void {
  if (c.method !== "scale" || preview) return;
  const current = xUnitOf(source);
  if (c.inputUnit === undefined) {
    throw new Error("a saved SIMS scale calibration is missing its input x unit; reopen it in the SIMS workshop");
  }
  if (c.inputUnit !== current) {
    const expected = c.inputUnit || "unit unknown";
    const actual = current || "unit unknown";
    throw new Error(`this SIMS scale calibration was made for x in ${expected}, not ${actual}`);
  }
}

/** The request body for `p` over `source`. `preview`: see `resolvedTimeUnit`. */
export function simsRequest(p: SimsParams, source: DataStruct, opts: { preview?: boolean } = {}): SimsProcessRequest {
  const body: SimsProcessRequest = { dataset: simsWireDataset(source) };
  const c = p.calibration;
  if (c) {
    assertScaleInputUnit(c, source, opts.preview ?? false);
    body.calibration = {
      method: c.method,
      sputter_rate: c.sputterRate ?? null,
      rate_unit: c.rateUnit ?? "nm/s",
      crater_depth: c.craterDepth ?? null,
      crater_unit: c.craterUnit ?? "nm",
      total_time: c.totalTime ?? null,
      depth_unit: c.depthUnit,
      time_unit: resolvedTimeUnit(c, source, opts.preview ?? false),
      scale_factor: c.scaleFactor ?? null,
      offset: c.offset ?? 0,
    };
  }
  if (p.background) {
    const keep = (p.background.keep ?? []).map((name) => columnIndex(source.labels, name));
    body.background = { lo: p.background.lo, hi: p.background.hi, keep };
  }
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

/** A backend SIMS warning as the transform layer's `TransformWarning` (shared by
 *  lib/transformSimsCompare.ts). */
export function simsWarningOf(w: SimsWarningWire): TransformWarning {
  const out: TransformWarning = { code: w.code as TransformWarningCode, text: w.text };
  if (w.count != null) out.count = w.count;
  if (w.columns != null) out.columns = w.columns;
  if (w.confirm) out.confirm = true;
  if (w.info) out.info = true;
  return out;
}

/** Process `source` per `p`. Throws the backend's message on a refused input.
 *  `opts.preview`: see `resolvedTimeUnit` — the live workshop preview passes
 *  `true` so a stated time-unit override's confirm warning always shows;
 *  commit/replay (the default) apply it only when accepted for this exact
 *  source. */
export async function computeSims(
  p: SimsParams,
  source: { id: string; name: string; data: DataStruct },
  opts: { preview?: boolean; signal?: AbortSignal } = {},
): Promise<SimsComputed> {
  const res = await processSims(simsRequest(p, source.data, { preview: opts.preview }), opts.signal);
  return {
    // Blanks arrive as JSON null; stored as NaN so the .dwk reopens (lib/blankCells).
    data: blanksToNaN({ ...res.dataset, metadata: { ...res.dataset.metadata, sims_source: { id: source.id, name: source.name } } }),
    name: simsOutputName(source.name),
    warnings: res.warnings.map(simsWarningOf),
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
    if (method !== "rate" && method !== "crater" && method !== "scale") throw new Error(`unknown SIMS calibration "${method}"`);
    const num = (k: string): number | undefined => (finite(cal[k]) ? (cal[k] as number) : undefined);
    p.calibration = { method, depthUnit: str(cal.depthUnit, "nm") };
    if (method === "scale") {
      const factor = num("scaleFactor");
      if (factor === undefined || factor <= 0) throw new Error('sims calibration "scale" needs a positive "scaleFactor"');
      const offset = cal.offset === undefined ? 0 : num("offset");
      if (offset === undefined) throw new Error('sims calibration "scale" needs a finite "offset"');
      if (typeof cal.inputUnit !== "string") throw new Error('sims calibration "scale" needs its string "inputUnit"');
      Object.assign(p.calibration, { scaleFactor: factor, offset, inputUnit: cal.inputUnit });
    } else if (method === "rate") {
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
    if (method !== "scale" && typeof cal.timeUnit === "string" && cal.timeUnit.trim()) p.calibration.timeUnit = cal.timeUnit.trim();
    const acc = cal.acceptedTimeUnit;
    if (method !== "scale" && acc !== undefined) {
      if (!Array.isArray(acc) || acc.length !== 2 || typeof acc[0] !== "string" || typeof acc[1] !== "string" || !acc[1]) {
        throw new Error('sims "acceptedTimeUnit" must be two unit names');
      }
      p.calibration.acceptedTimeUnit = [acc[0], acc[1]];
    }
  }
  const bg = obj("background");
  if (bg) {
    if (!finite(bg.lo) || !finite(bg.hi)) throw new Error('sims "background" needs numbers "lo" and "hi"');
    p.background = { lo: bg.lo, hi: bg.hi };
    if (bg.keep !== undefined) {
      if (!Array.isArray(bg.keep) || !bg.keep.every((k) => typeof k === "string" && k)) {
        throw new Error('sims "keep" must list column names');
      }
      p.background.keep = bg.keep as string[];
    }
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
