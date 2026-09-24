// Reflectivity fit — the DURABLE fit record (P2.2 slice 3). Pure: no React, no
// store. A finished fit becomes a `ReflFitRecord` stored on every channel
// dataset (`Dataset.reflFits`, newest first, at most HISTORY_LIMIT), so it
// survives closing the workshop and a `.dwk` save/reopen.
//
// DESIGN NOTE — which precedent each part mirrors:
//   * Record on the dataset, one undo step per write, plain `useApp.setState`
//     writer instead of a slice: the durable XRD peak table (lib/peakTable.ts +
//     store/peakTables.ts, PR #404). Like `PeakTable.provenance.datasetId`, a
//     record is only shown for a dataset its channels actually name
//     (`recordsFor`), so a workbook copy that carried the field verbatim does
//     not present another dataset's fit as its own.
//   * Staleness is a DIGEST compared on read, never a recalc-graph edge or a
//     clear-on-write: the peak table's `fingerprint` (`peakDataFingerprint`).
//     History is kept even when the data changes — it is a log of what was
//     fit, and the view says "the data changed since this fit" instead.
//   * Non-finite numbers: the BUG-017/BUG-023 sentinel strings
//     (lib/nonFiniteCells.ts). The record is ENCODED here, before it reaches
//     the store, so the eager `.dwk` serializer and parser pass it through
//     verbatim and pay only for the passthrough (the eager bundle has no room
//     for a sanitizer); every field is validated here on READ (`decodeRecord`),
//     where a malformed record is skipped instead of failing the load — the
//     fail-soft contract `sanitizePeakTable` applies.
//   * Fit-curve datasets' provenance lives in `data.metadata.reflFit` and they
//     are placed in the source's workbook/folder: Freeze Copy's
//     `metadata.frozenFrom` + `createDerivedWorksheet`'s placement
//     (store/derivedWorksheets.ts). NOT `Dataset.derivedFrom`: that edge puts
//     a dataset in the recalc graph, whose executor would overwrite a fit
//     curve with its source's corrected data on the next recalc.
//   * Ids come from store/idSeq.ts's shared sequence (BUG-020), never a
//     page-lifetime counter; the record's `seq` (the "#n" in names) is derived
//     from the records already stored, so it is stable across reopen.
//   * Report: the same `reportEmit` → calc/report_emit path peak tables use.
//
// Column indices in a record are HINTS: every reader re-checks each against
// the column label stored beside it (reflFitRestore.ts's `resolveBinding`), so
// a removed or reordered column can never silently rebind a restored fit.

import type { ReflFitParamResult, ReflFitResult } from "../../../lib/api/reflectivity";
import type { Dataset } from "../../../lib/types";
import { objectiveSummary, type RequestParam } from "./reflFitModel";
import type { ChannelBinding, FitDataSettings, Spin, Weighting, XKind } from "./reflFitData";
import type { ModelLayer, Radiation } from "./useReflectivity";

export const REFL_FIT_RECORD_VERSION = 1;
/** Fits kept per dataset; older ones drop off the end. */
export const HISTORY_LIMIT = 10;

/** One parameter as it was SENT (the fit's starting point and constraints). */
export type SavedParam = RequestParam;

/** One channel as it was bound, with what is needed to re-validate it. */
export interface SavedChannel extends ChannelBinding {
  datasetName: string;
  rLabel: string;
  drLabel: string | null;
  dqLabel: string | null;
  /** λ (Å) this channel's 2θ → Q conversion used; null for Q data. */
  lambda: number | null;
  /** Digest of the points actually sent (`channelDigest`). */
  digest: string;
}

/** The fit response minus its curves (stored apart, in `SavedCurves`), plus
 *  the objective with its honest label. */
export type SavedFitResult = Omit<ReflFitResult, "curves" | "sld_profiles"> & {
  objective: { label: string; value: number | null };
};

/** One channel's fitted points as stored: q, the measured R and the model
 *  (null where the fit reported none). `total` is the point count before
 *  decimation (reflFitCurves.ts `MAX_CURVE_POINTS`); `total > q.length`
 *  means the stored curve is thinned. */
export interface SavedChannelCurve {
  label: string;
  spin: "+" | "-" | null;
  q: number[];
  r: number[];
  model: (number | null)[];
  total: number;
}

/** One SLD profile as stored, `total` as above. */
export interface SavedSldProfile {
  spin: "+" | "-" | null;
  z: number[];
  sld: (number | null)[];
  total: number;
}

/** The fit's curves, so a saved fit can overlay and add them without
 *  re-running. Absent on records written before curves were stored. */
export interface SavedCurves {
  channels: SavedChannelCurve[];
  sld: SavedSldProfile[];
}

export interface ReflFitRecord {
  version: typeof REFL_FIT_RECORD_VERSION;
  id: string;
  /** Ordinal among the fits of its datasets — the "#n" in names. */
  seq: number;
  fittedAt: string;
  request: {
    parameters: SavedParam[];
    channels: SavedChannel[];
    settings: FitDataSettings;
    /** The weighting the fit actually used (dR falls back to log). */
    weighting: Weighting;
  };
  /** The layer model the parameter NAMES refer to (the Apply guard's basis). */
  model: { layers: ModelLayer[]; radiation: Radiation };
  result: SavedFitResult;
  /** Absent on a record written before P2.2 slice 3's follow-up. */
  curves?: SavedCurves;
}

/** The result as stored: everything but the curves, plus the objective. */
export function savedResult(res: ReflFitResult): SavedFitResult {
  const { curves: _c, sld_profiles: _s, ...rest } = res;
  return { ...rest, objective: objectiveSummary(res) };
}

/** A new record id from the shared id sequence (BUG-020). `nextDatasetId`'s
 *  counter with the prefix swapped: a dedicated minter in store/idSeq.ts would
 *  be eager code the bundle budget has no room for. */
export function recordId(nextId: () => string): string {
  return nextId().replace(/^ds-/, "rfit-");
}

/** 32-bit FNV-1a over the channel exactly as sent (its label excepted, which
 *  follows a dataset rename, not its data), plus the point count. */
export function channelDigest(channel: object): string {
  const text = JSON.stringify(channel, (k, v: unknown) => (k === "label" ? undefined : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

// ── the stored (JSON-safe) form ─────────────────────────────────────────────
//
// `encodeCell`/`decodeCell` are lib/nonFiniteCells.ts's, RESTATED rather than
// imported, deliberately: that module is eager, and importing two of its
// functions from this lazy chunk makes the eager chunk export them — measured
// +22 B against an eager budget with no headroom (2026-09-24, vite build). The
// parity test in reflFitRecord.test.ts runs the real pair as the oracle over
// every sentinel, so a change to the codec fails there instead of drifting.

/** lib/nonFiniteCells.ts `encodeCell`: the sentinel for NaN/±Infinity/-0. */
export function encodeNum(v: number): number | string {
  if (Object.is(v, -0)) return "-0";
  return Number.isFinite(v) ? v : String(v);
}

/** lib/nonFiniteCells.ts `decodeCell`: a number or sentinel back to a number,
 *  undefined for anything else. */
export function decodeNum(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (v === "NaN") return Number.NaN;
  if (v === "Infinity") return Infinity;
  if (v === "-Infinity") return -Infinity;
  return v === "-0" ? -0 : undefined;
}

/** The record as it is stored on a dataset: a deep, JSON-safe copy whose
 *  non-finite numbers (and -0) are the BUG-017 sentinel strings. */
export function encodeRecord(record: ReflFitRecord): unknown {
  return JSON.parse(JSON.stringify(record, (_k, v: unknown) => (typeof v === "number" ? encodeNum(v) : v)));
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
/** A number, decoding the sentinels; undefined when it is neither. */
const num = (v: unknown): number | undefined => decodeNum(v);
const numOrNull = (v: unknown): number | null | undefined => (v === null ? null : num(v));
const index = (v: unknown): number | null | undefined =>
  v === null ? null : Number.isInteger(v) && (v as number) >= 0 ? (v as number) : undefined;

class Bad extends Error {}
function need<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Bad(what);
  return v;
}
function needNullable<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Bad(what);
  return v;
}
function list<T>(v: unknown, item: (x: unknown) => T): T[] {
  if (!Array.isArray(v)) throw new Bad("list");
  return v.map(item);
}
const oneOf = <T extends string>(v: unknown, options: readonly T[]): T => {
  if (!options.includes(v as T)) throw new Bad("enum");
  return v as T;
};

function decodeParam(v: unknown): SavedParam {
  if (!isObj(v)) throw new Bad("param");
  return {
    name: need(str(v.name), "name"),
    value: need(num(v.value), "value"),
    vary: v.vary === true,
    min: need(num(v.min), "min"),
    max: need(num(v.max), "max"),
    tie: str(v.tie),
  };
}

function decodeChannel(v: unknown): SavedChannel {
  if (!isObj(v)) throw new Bad("channel");
  return {
    datasetId: need(str(v.datasetId), "datasetId"),
    rCol: need(index(v.rCol), "rCol"),
    drCol: needNullable(index(v.drCol), "drCol"),
    dqCol: needNullable(index(v.dqCol), "dqCol"),
    dqIsFwhm: v.dqIsFwhm === true,
    spin: oneOf<Spin>(v.spin, ["none", "+", "-"]),
    datasetName: str(v.datasetName) ?? "",
    rLabel: str(v.rLabel) ?? "",
    drLabel: str(v.drLabel),
    dqLabel: str(v.dqLabel),
    lambda: numOrNull(v.lambda) ?? null,
    digest: str(v.digest) ?? "",
  };
}

function decodeSettings(v: unknown): FitDataSettings {
  if (!isObj(v)) throw new Bad("settings");
  return {
    xKind: oneOf<XKind>(v.xKind, ["q", "twotheta"]),
    lambda: numOrNull(v.lambda) ?? null,
    qMin: numOrNull(v.qMin) ?? null,
    qMax: numOrNull(v.qMax) ?? null,
    weighting: oneOf<Weighting>(v.weighting, ["dr", "log"]),
    resolution: num(v.resolution) ?? 0,
  };
}

function decodeLayer(v: unknown): ModelLayer {
  if (!isObj(v)) throw new Bad("layer");
  const layer: ModelLayer = {
    preset: str(v.preset) ?? "",
    thickness: need(num(v.thickness), "thickness"),
    roughness: need(num(v.roughness), "roughness"),
    sld: need(num(v.sld), "sld"),
  };
  const isld = num(v.isld);
  const msld = num(v.msld);
  if (isld !== undefined) layer.isld = isld;
  if (msld !== undefined) layer.msld = msld;
  return layer;
}

function decodeParamResult(v: unknown): ReflFitParamResult {
  if (!isObj(v)) throw new Bad("result param");
  return {
    name: need(str(v.name), "name"),
    value: need(num(v.value), "value"),
    // null stays null: "not reported" is not a number, and never becomes 0/NaN.
    stderr: numOrNull(v.stderr) ?? null,
    vary: v.vary === true,
    tie: str(v.tie),
    at_bound: v.at_bound === true,
  };
}

function decodeResult(v: unknown): SavedFitResult {
  if (!isObj(v)) throw new Bad("result");
  const weighting = oneOf<Weighting>(v.weighting, ["dr", "log"]);
  const stat = (x: unknown): number | null => numOrNull(x) ?? null;
  const res = {
    parameters: list(v.parameters, decodeParamResult),
    free: list(v.free, (x) => need(str(x), "free")),
    correlation: Array.isArray(v.correlation) ? list(v.correlation, (row) => list(row, stat)) : [],
    chi2: stat(v.chi2),
    reduced_chi2: stat(v.reduced_chi2),
    sum_sq_log: stat(v.sum_sq_log),
    reduced_sum_sq_log: stat(v.reduced_sum_sq_log),
    n_points: need(num(v.n_points), "n_points"),
    n_free: need(num(v.n_free), "n_free"),
    success: v.success === true,
    message: str(v.message) ?? "",
    n_evaluations: num(v.n_evaluations) ?? 0,
    weighting,
    warnings: Array.isArray(v.warnings) ? v.warnings.filter((w): w is string => typeof w === "string") : [],
  };
  // The label is re-derived, never trusted from the file: only dR weighting
  // is a chi-square, and a hand-edited label must not say otherwise.
  return { ...res, objective: objectiveSummary(res) };
}

const spinOf = (v: unknown): "+" | "-" | null => (v === "+" || v === "-" ? v : null);
const nums = (v: unknown): number[] => list(v, (x) => need(num(x), "number"));
const gappy = (v: unknown): (number | null)[] => list(v, (x) => numOrNull(x) ?? null);

function sized<T extends { total: number }>(curve: T, lengths: number[]): T {
  if (lengths.some((n) => n !== lengths[0])) throw new Bad("curve lengths");
  if (!Number.isInteger(curve.total) || curve.total < lengths[0]) curve.total = lengths[0];
  return curve;
}

/** Stored curves, or undefined when absent or unusable: a bad curve costs the
 *  record its curves, never the record itself. */
function decodeCurves(v: unknown): SavedCurves | undefined {
  if (!isObj(v)) return undefined;
  try {
    return {
      channels: list(v.channels, (c) => {
        if (!isObj(c)) throw new Bad("curve");
        const out = { label: str(c.label) ?? "", spin: spinOf(c.spin), q: nums(c.q), r: nums(c.r), model: gappy(c.model), total: num(c.total) ?? 0 };
        return sized(out, [out.q.length, out.r.length, out.model.length]);
      }),
      sld: list(v.sld, (p) => {
        if (!isObj(p)) throw new Bad("sld");
        const out = { spin: spinOf(p.spin), z: nums(p.z), sld: gappy(p.sld), total: num(p.total) ?? 0 };
        return sized(out, [out.z.length, out.sld.length]);
      }),
    };
  } catch (e) {
    if (e instanceof Bad) return undefined;
    throw e;
  }
}

/** Validate one stored record, or null when it is unusable (unknown version,
 *  missing fields, wrong types). Never throws. */
export function decodeRecord(v: unknown): ReflFitRecord | null {
  try {
    if (!isObj(v) || v.version !== REFL_FIT_RECORD_VERSION) return null;
    const req = v.request;
    const model = v.model;
    if (!isObj(req) || !isObj(model)) return null;
    const channels = list(req.channels, decodeChannel);
    const layers = list(model.layers, decodeLayer);
    if (channels.length === 0 || layers.length < 2) return null;
    const seq = num(v.seq);
    const curves = decodeCurves(v.curves);
    return {
      ...(curves ? { curves } : {}),
      version: REFL_FIT_RECORD_VERSION,
      id: need(str(v.id), "id"),
      seq: seq !== undefined && Number.isInteger(seq) && seq > 0 ? seq : 1,
      fittedAt: str(v.fittedAt) ?? "",
      request: {
        parameters: list(req.parameters, decodeParam),
        channels,
        settings: decodeSettings(req.settings),
        weighting: oneOf<Weighting>(req.weighting, ["dr", "log"]),
      },
      model: { layers, radiation: oneOf<Radiation>(model.radiation, ["xray", "neutron"]) },
      result: decodeResult(v.result),
    };
  } catch (e) {
    if (e instanceof Bad) return null;
    throw e;
  }
}

// Decoding is pure in the stored array, so cache by its identity: a render
// that did not change the dataset's history re-reads nothing.
const decoded = new WeakMap<readonly unknown[], ReflFitRecord[]>();

function decodeAll(stored: readonly unknown[] | undefined): ReflFitRecord[] {
  if (!Array.isArray(stored)) return [];
  let out = decoded.get(stored);
  if (!out) {
    out = stored.map(decodeRecord).filter((r): r is ReflFitRecord => r !== null);
    decoded.set(stored, out);
  }
  return out;
}

/** The dataset's usable fit records, newest first — only those whose channels
 *  name THIS dataset (a copy carrying another dataset's history shows none). */
export function recordsFor(ds: Dataset | undefined): ReflFitRecord[] {
  if (!ds) return [];
  return decodeAll(storedFits(ds)).filter((r) => r.request.channels.some((c) => c.datasetId === ds.id));
}

/** The distinct dataset ids a record is attached to, in channel order. */
export function recordDatasetIds(record: Pick<ReflFitRecord, "request">): string[] {
  return [...new Set(record.request.channels.map((c) => c.datasetId))];
}

/** The stored history array, or none: a hand-edited `.dwk` can carry any
 *  JSON value here (`{"0":1}`, a string), and the eager parser passes it
 *  through verbatim, so every reader goes through this. */
export function storedFits(ds: Pick<Dataset, "reflFits">): readonly unknown[] {
  return Array.isArray(ds.reflFits) ? ds.reflFits : [];
}

/** The next "#n" for a fit on these datasets: one past the highest number
 *  any library dataset still carries for them — a stored record, or a fit
 *  curve's `metadata.reflFit` — so a number that is still visible anywhere
 *  is never handed out twice. */
export function nextSeq(datasets: readonly Dataset[], ids: readonly string[]): number {
  let max = 0;
  for (const d of datasets) {
    if (ids.includes(d.id)) for (const r of recordsFor(d)) max = Math.max(max, r.seq);
    const prov = d.data.metadata?.reflFit as { seq?: unknown; sourceIds?: unknown } | undefined;
    if (prov && typeof prov.seq === "number" && Array.isArray(prov.sourceIds) && prov.sourceIds.some((s) => ids.includes(s as string))) {
      max = Math.max(max, prov.seq);
    }
  }
  return max + 1;
}

/** Is `record` known to be GONE from the library — at least one of its
 *  datasets is present and none of those holds it (an undo removed it)? A
 *  record whose datasets were all deleted is "unknown", not gone. */
export function recordGone(record: ReflFitRecord, datasets: readonly Dataset[]): boolean {
  const ids = recordDatasetIds(record);
  const present = datasets.filter((d) => ids.includes(d.id));
  return present.length > 0 && !present.some((d) => recordsFor(d).some((r) => r.id === record.id));
}

/** `datasets` with `record` put at the head of each of its datasets' history
 *  (trimmed to HISTORY_LIMIT). The SAME array when none of them exists. */
export function withFitRecord(datasets: Dataset[], record: ReflFitRecord): Dataset[] {
  const ids = recordDatasetIds(record);
  if (!datasets.some((d) => ids.includes(d.id))) return datasets;
  const stored = encodeRecord(record);
  return datasets.map((d) =>
    ids.includes(d.id) ? { ...d, reflFits: [stored, ...storedFits(d)].slice(0, HISTORY_LIMIT) } : d,
  );
}
