// Reflectivity fit — pure data binding (P2.2 slice 2). A dataset + column
// choice in, one request channel (`ReflFitChannel`) out, plus the row map that
// puts the fitted curve back onto the dataset's own rows for the plot overlay.
//
// The client sends ONLY the points the fit will use (finite, q > 0, inside the
// Q window, positive R for log weighting, positive dR for dR weighting, not
// excluded/filtered), so the backend's own mask is a no-op and every returned
// point maps back to a known dataset row. `alignToRows` still walks by value,
// not by position, so a future backend-side drop cannot shift the overlay.

import type { ReflFitChannel, ReflFitCurve } from "../../../lib/api/reflectivity";
import { inferErrorBindings } from "../../../lib/errorRoles";
import type { DataStruct, Dataset, ErrorBinding } from "../../../lib/types";

// ── the X-ray wavelength recorded in a dataset's metadata ───────────────────
//
// This is lib/xrdWavelength.ts `wavelengthFromMetadata`, RESTATED rather than
// imported, deliberately. Importing it from this chunk splits the lazy chunk it
// currently shares with lib/peakTableFit (a third importer gives the two
// modules different importer sets), and the split costs the EAGER entry 46 B of
// preload map (a new chunk path plus one reference per importing panel;
// measured 2026-09-24 with vite build; a dynamic import() splits it too and
// cost 42 B) against an eager budget that had 25 B of headroom. The parity test in
// reflFitData.test.ts runs the real `wavelengthFromMetadata` as the oracle over
// every edge case, so any change to its keys or plausibility window fails
// there instead of drifting silently. See that module's header for why these
// two keys, in this order, inside 0.2–10 Å.
const WAVELENGTH_KEYS = ["wavelength_a", "alpha_average"] as const;

export function metadataWavelength(metadata: Record<string, unknown> | undefined): number | null {
  if (!metadata) return null;
  for (const key of WAVELENGTH_KEYS) {
    const raw = metadata[key];
    const v = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(v) && v >= 0.2 && v <= 10) return v;
  }
  return null;
}

export type XKind = "q" | "twotheta";
export type Spin = "none" | "+" | "-";
export type Weighting = "dr" | "log";

/** Backend limit (routes/reflectivity.py FIT_MAX_CHANNELS). */
export const MAX_CHANNELS = 4;

/** One measured curve: which dataset and which of its columns. */
export interface ChannelBinding {
  datasetId: string;
  rCol: number;
  drCol: number | null;
  dqCol: number | null;
  dqIsFwhm: boolean;
  spin: Spin;
}

/** Settings shared by every channel. */
export interface FitDataSettings {
  xKind: XKind;
  lambda: number | null; // Å override; null = from the dataset's metadata
  qMin: number | null;
  qMax: number | null;
  weighting: Weighting; // the user's choice; see effectiveWeighting
  resolution: number; // constant dQ/Q (1σ) for channels without a dQ column; 0 = off
}

export const DEFAULT_SETTINGS: FitDataSettings = {
  xKind: "q",
  lambda: null,
  qMin: null,
  qMax: null,
  weighting: "dr",
  resolution: 0,
};

/** Q = 4π/λ · sin θ, with θ = 2θ/2 (2θ in degrees, λ and Q in Å / Å⁻¹). */
export function twoThetaToQ(twoThetaDeg: number, lambda: number): number {
  return ((4 * Math.PI) / lambda) * Math.sin((twoThetaDeg * Math.PI) / 360);
}

/** A 2θ-space width (deg) as a Q-space width: dQ = 4π/λ · cos θ · dθ. */
export function twoThetaWidthToDq(twoThetaDeg: number, dTwoThetaDeg: number, lambda: number): number {
  return ((4 * Math.PI) / lambda) * Math.cos((twoThetaDeg * Math.PI) / 360) * ((dTwoThetaDeg * Math.PI) / 360);
}

/** `dr` weighting needs a dR column on every channel; otherwise log. */
export function effectiveWeighting(choice: Weighting, channels: ChannelBinding[]): Weighting {
  return choice === "dr" && channels.length > 0 && channels.every((c) => c.drCol != null) ? "dr" : "log";
}

/** The wavelength a 2θ dataset converts with: the override, else metadata. */
export function channelLambda(settings: FitDataSettings, data: DataStruct | undefined): number | null {
  if (settings.lambda != null && settings.lambda > 0) return settings.lambda;
  return metadataWavelength(data?.metadata);
}

export interface BuiltChannel {
  channel: ReflFitChannel;
  /** Dataset row of each sent point, in send order. */
  rows: number[];
}

/** Build one request channel from a dataset. Throws with a user-facing
 *  message when the channel has too few usable points. `lambda` is required
 *  (non-null) for 2θ data — the caller refuses before calling otherwise. */
export function buildChannel(
  data: DataStruct,
  dropped: ReadonlySet<number>,
  b: ChannelBinding,
  s: FitDataSettings,
  weighting: Weighting,
  lambda: number | null,
  label: string,
): BuiltChannel {
  const twoTheta = s.xKind === "twotheta";
  if (twoTheta && (lambda == null || !(lambda > 0))) {
    throw new Error(`${label}: the X-ray wavelength is unknown — enter λ to convert 2θ to Q`);
  }
  const col = (row: number, c: number): number => data.values[row]?.[c] ?? Number.NaN;
  const sendDr = weighting === "dr" && b.drCol != null;
  const rows: number[] = [];
  const q: number[] = [];
  const r: number[] = [];
  const dr: number[] = [];
  const dq: number[] = [];
  for (let row = 0; row < data.time.length; row++) {
    if (dropped.has(row)) continue;
    const x = data.time[row];
    const qv = twoTheta ? twoThetaToQ(x, lambda as number) : x;
    const rv = col(row, b.rCol);
    if (!Number.isFinite(qv) || qv <= 0 || !Number.isFinite(rv)) continue;
    if (s.qMin != null && qv < s.qMin) continue;
    if (s.qMax != null && qv > s.qMax) continue;
    if (weighting === "log" && rv <= 0) continue;
    let drv = 0;
    if (sendDr) {
      drv = col(row, b.drCol as number);
      if (!Number.isFinite(drv) || drv <= 0) continue;
    }
    let dqv = 0;
    if (b.dqCol != null) {
      const raw = col(row, b.dqCol);
      dqv = twoTheta ? twoThetaWidthToDq(x, raw, lambda as number) : raw;
      if (!Number.isFinite(dqv) || dqv < 0) continue;
    }
    rows.push(row);
    q.push(qv);
    r.push(rv);
    if (sendDr) dr.push(drv);
    if (b.dqCol != null) dq.push(dqv);
  }
  if (rows.length < 2) throw new Error(`${label}: fewer than 2 usable points in the Q window`);
  const hasDq = b.dqCol != null;
  return {
    rows,
    channel: {
      q,
      r,
      dr: sendDr ? dr : null,
      dq: hasDq ? dq : null,
      dq_is_fwhm: hasDq && b.dqIsFwhm,
      // A dQ column and a dQ/Q resolution are mutually exclusive (the backend
      // refuses both): the per-point column always wins.
      resolution: !hasDq && s.resolution > 0 ? s.resolution : null,
      spin: b.spin === "none" ? null : b.spin,
      q_min: s.qMin,
      q_max: s.qMax,
      label: label.slice(0, 120),
    },
  };
}

/** Map a fitted curve back onto `n` dataset rows (null where unused). */
export function alignToRows(
  curve: Pick<ReflFitCurve, "q" | "model">,
  sent: { q: number[]; rows: number[] },
  n: number,
): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(n).fill(null);
  let j = 0;
  for (let k = 0; k < curve.q.length; k++) {
    while (j < sent.q.length && sent.q[j] !== curve.q[k]) j++;
    if (j >= sent.q.length) break;
    const row = sent.rows[j];
    if (row < n) out[row] = curve.model[k] ?? null;
    j++;
  }
  return out;
}

// ── prefill from what the dataset already says about itself ────────────────

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const DQ_LABELS = new Set(["dq", "resolution", "sigmaq", "dqz"]);

/** Spin state from a reflectometry column label: `R++`/`Rpp` → "+",
 *  `R--`/`Rmm` → "-". Spin-flip (`pm`/`mp`) and plain labels → "none". */
export function spinFromLabel(label: string): Spin {
  const l = label.trim().toLowerCase();
  if (/(\+\+|pp)$/.test(l)) return "+";
  if (/(--|mm)$/.test(l)) return "-";
  return "none";
}

/** The symmetric error column bound to `target` on `axis`, if any. The same
 *  rule as lib/errorRoles `symmetricBinding`, restated here because importing
 *  it would add an export to an EAGER chunk (+7 B, measured) against a budget
 *  with no headroom. */
function symmetric(bindings: readonly ErrorBinding[], target: number, axis: "x" | "y"): number | null {
  return bindings.find((b) => b.target === target && b.axis === axis && b.side === "both")?.channel ?? null;
}

/** The dR column for value column `r`: a recorded/inferred error role, else a
 *  column literally named `d<label>`. */
function drFor(data: DataStruct, bindings: readonly ErrorBinding[], r: number): number | null {
  const bound = symmetric(bindings, r, "y");
  if (bound != null) return bound;
  const want = "d" + norm(data.labels[r] ?? "");
  const i = data.labels.findIndex((l) => norm(l) === want);
  return i >= 0 ? i : null;
}

/** Channel bindings suggested by a dataset: its measured columns (the targets
 *  of its error roles), their dR columns, and its Q-resolution column. A PNR
 *  file with `R++`/`R--` columns gets one channel per spin state. */
export function defaultChannels(ds: Dataset): ChannelBinding[] {
  const { data } = ds;
  const labels = data.labels ?? [];
  if (labels.length === 0) return [];
  const bindings = ds.errorRoles ?? inferErrorBindings(data);
  const errorCols = new Set(bindings.map((b) => b.channel));
  labels.forEach((l, i) => {
    if (DQ_LABELS.has(norm(l)) || (norm(l).startsWith("d") && labels.some((o) => "d" + norm(o) === norm(l)))) {
      errorCols.add(i);
    }
  });
  const targets = [...new Set(bindings.filter((b) => b.axis === "y" && b.target >= 0).map((b) => b.target))];
  const values = labels.map((_, i) => i).filter((i) => !errorCols.has(i));
  const measured = (targets.length ? targets.sort((a, b) => a - b) : values).filter((i) => !errorCols.has(i));
  if (measured.length === 0) return [];
  const xBound = symmetric(bindings, -1, "x");
  const dqByLabel = labels.findIndex((l) => DQ_LABELS.has(norm(l)));
  const dqCol = xBound ?? (dqByLabel >= 0 ? dqByLabel : null);
  const make = (rCol: number, spin: Spin): ChannelBinding => ({
    datasetId: ds.id,
    rCol,
    drCol: drFor(data, bindings, rCol),
    dqCol,
    dqIsFwhm: false,
    spin,
  });
  const spun = measured.filter((i) => spinFromLabel(labels[i]) !== "none");
  if (spun.length) return spun.slice(0, MAX_CHANNELS).map((i) => make(i, spinFromLabel(labels[i])));
  return [make(measured[0], "none")];
}

/** Q or 2θ from the dataset's own description of its x axis. */
export function defaultXKind(data: DataStruct): XKind {
  const meta = data.metadata ?? {};
  const unit = String(meta.x_column_unit ?? "").toLowerCase();
  if (/ang|å|a-1|1\/a/.test(unit)) return "q";
  const name = String(meta.x_column_name ?? "").toLowerCase();
  if (/2.?theta|2θ|tth/.test(name) || metadataWavelength(meta) != null) return "twotheta";
  return "q";
}
