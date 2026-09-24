// The FIT side of the durable peak table (PRIMARY_SOFTWARE_AUDIT_PLAN P2.1):
// building one from a fit result, rehydrating a fit result from one, and the
// two accessors every consumer goes through. The contract itself — the types
// and the `.dwk` sanitize/serialize pair — lives in ./peakTable.
//
// WHY THE SPLIT IS A BUNDLE BOUNDARY, NOT A STYLE CHOICE. `./peakTable` is
// imported by the EAGER `.dwk` path (lib/workspaceDatasetParse.ts and
// lib/workspaceSerialize.ts), so anything in it lands in the eager chunk even
// when only lazy code calls it — a module shared across a lazy boundary is
// emitted in the chunk both sides can reach, and rollup cannot shake an export
// the lazy side really does use. MEASURED 2026-09-14 (exact eager bytes, clean
// `npm ci` + `rm -rf node_modules/.vite` builds either side of 9ec8f49c): with
// these helpers in ./peakTable the eager total rose 2,743 B (916,515 ->
// 919,257); with them here it rises 1,657 B (916,515 -> 918,172).
// Every consumer of this file (store/peakTables.ts, the Peaks workshop, the
// Reductions workshop) is lazy — keep it that way, and put anything the `.dwk`
// path needs in ./peakTable instead.

import { PEAK_TABLE_VERSION, type MultiFitResult, type PeakTable, type PeakTableEntry } from "./peakTable";
import { analysisData } from "./rowstate";
import type { DataStruct, Dataset } from "./types";

let _peakSeq = 0;

/** Stable per-peak id, same `Date.now().toString(36)` + module counter shape as
 *  every other id generator in the app (store/useApp.ts's `nextFigureId`,
 *  store/rois.ts's `nextRoiId`). */
function nextPeakId(): string {
  return `peak-${Date.now().toString(36)}-${++_peakSeq}`;
}

export interface PeakTableSource {
  datasetId: string;
  datasetName: string;
  method: "simultaneous" | "independent";
  bgDegree: number;
  linkMode: string;
  constrain: boolean;
  wavelengthA: number | null;
  /** The x channel the fit ran on — label/unit text only (see
   *  `PeakTableProvenance.xLabel`). Omitted = "unknown", recorded as `""`. */
  xLabel?: string;
  xUnit?: string;
  /** `peakDataFingerprint` of the data the fit ran on. Omitted = "unknown",
   *  recorded as null, which every reader treats as "still valid" — so a
   *  caller that CAN supply it (store/peakTables.ts's `publishFitResult`)
   *  always should. */
  fingerprint?: string | null;
  /** Injected so tests are deterministic; defaults to `new Date()`. */
  now?: Date;
}

// ── Data fingerprint (review round 2, 2026-09-14) ─────────────────────
// See lib/peakTable.ts's module header for WHY a durable fit needs one and why
// it is not a recalc-graph node. WHAT it digests, in ONE FNV-1a pass over
// `analysisData(ds) ?? ds.data` — the dataset's ANALYSIS VIEW, i.e. the rows a
// fit actually runs on (both `lib/fitselection`'s `selectedFitData` and the
// Peaks workshop's `peakInputs` fallback read that view, never the raw data):
//   • every x (time) value, byte for byte;
//   • every value column's numbers, byte for byte;
//   • every column LABEL and UNIT;
//   • four numbers folded into the prefix (not hashed): the kept row count
//     (`data.time.length`), the kept row count AGAIN (`data.values.length` —
//     `DataStruct.values` is row-major, so this always equals the first
//     field; the redundancy costs nothing and cannot cause a false match),
//     the column count (`cols`), and the RAW row count
//     (`ds.data.time.length`, before exclusion/filter) — so a change to the
//     exclusion list or the local filter moves the digest even in the
//     degenerate case where the kept rows would hash the same.
//
// EVERY value column, not just the one the fit ran on: that needs no channel
// INDEX in the record (which would falsify architecture.test.ts's
// `DATASET_CHANNEL_REMAP_EXCLUDED` reason for `peakTable`), it survives a
// column reorder without a remap rule of its own, and it is strictly more
// conservative — the worst it can do is ask the user to re-fit after an edit
// to a column the fit never read.
//
// ROUND 3 (2026-09-15) widened it three ways, each closing a MEASURED hole:
//   • the x channel was reduced to four order statistics (length/first/last/
//     min/max), so an interior 2θ edit — a bulk paste into the x column via
//     `store/cellEdit.setCellBlock` — was invisible to it. Hashing the whole
//     column costs one pass (it replaces the min/max loop) and makes the
//     store-side clears belt-and-braces rather than load-bearing.
//   • labels/units were not digested, so correcting a mis-imported unit from
//     "" to "1/A" in the Inspector left the table offered to Williamson-Hall
//     under the unit it had been fit with.
//   • the digest was taken from `ds.data` while the fit ran on the analysis
//     view, so toggling a row exclusion moved the fit's real input with the
//     digest still saying "valid". Digesting the view closes that, and needs
//     no separate row-state stamp beyond the raw row count above.
//
// FNV-1a over the IEEE-754 bytes (and UTF-16 code units for text), the same
// construction lib/jitter.ts uses for its (non-exported, UTF-8) hash: 32-bit,
// allocation-free per value, and exact — NaN and -0 each hash to a value
// distinct from 0 rather than collapsing the way `String(v)` would. That
// stability is PER BIT PATTERN, not per NaN in the abstract: JS NaN has more
// than one IEEE-754 encoding, and three are reachable here — `0/0` (and
// `NaN`/`parseFloat("x")`/`Number("abc")`) is `7ff8000000000000`,
// `0*Infinity` (and `Infinity-Infinity`/`Math.sqrt(-1)`) is
// `fff8000000000000`, and `Math.log(-1)` (and `Math.asin(2)`) is
// `7ff4000000000000` — so two cells that are both "NaN" can digest
// differently if a value is re-minted by a different code path. Harmless in
// the fail-safe direction only (a false MISMATCH costs a redundant re-fit
// prompt, never a false match), never checked for a false match: a cell is
// always minted by one code path and re-minted the same way.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnvFloat(h: number, view: DataView, v: number): number {
  view.setFloat64(0, v); // big-endian by default, read byte by byte — platform-independent
  let acc = h;
  for (let i = 0; i < 8; i++) acc = Math.imul(acc ^ view.getUint8(i), FNV_PRIME) >>> 0;
  return acc;
}

/** Fold one string in, then a terminator so `["ab"]` and `["a","b"]` differ. */
function fnvText(h: number, s: string): number {
  let acc = h;
  for (let i = 0; i < s.length; i++) acc = Math.imul(acc ^ s.charCodeAt(i), FNV_PRIME) >>> 0;
  return Math.imul(acc ^ 0xff, FNV_PRIME) >>> 0;
}

/** A digest of `ds`'s ANALYSIS VIEW — see the block comment above. Pure and
 *  deterministic: the same dataset always yields the same string, and any edit
 *  to any measured value, column label, column unit or row-state changes it.
 *
 *  The `2:` prefix is the digest's OWN version. A fingerprint written by the
 *  round-2 composition reads as a mismatch under this one, which asks for a
 *  re-fit — the safe direction — rather than trusting a digest whose fields
 *  meant something else. */
export function peakDataFingerprint(ds: Dataset): string {
  const data = analysisData(ds) ?? ds.data;
  const view = new DataView(new ArrayBuffer(8));
  let h = FNV_OFFSET_BASIS >>> 0;
  for (const v of data.time) h = fnvFloat(h, view, v);
  for (const row of data.values) {
    for (const v of row) h = fnvFloat(h, view, v);
  }
  for (const s of data.labels) h = fnvText(h, s);
  for (const s of data.units) h = fnvText(h, s);
  const cols = data.values[0]?.length ?? 0;
  return `2:${data.time.length}:${data.values.length}:${cols}:${ds.data.time.length}:${h}`;
}

/** Does `table` still describe `ds`? A record with NO fingerprint (written
 *  before the field existed, or by a caller that could not supply one) is
 *  "unknown", and unknown reads as YES — the same additive-optional, fail-soft
 *  contract `sanitizePeakTable` applies to every other field, so reopening a
 *  pre-round-2 `.dwk` still shows its saved fit. */
export function peakTableMatchesData(table: PeakTable, ds: Dataset): boolean {
  const fp = table.provenance.fingerprint;
  return fp === null || fp === peakDataFingerprint(ds);
}

// ── The "x is 2θ in degrees" rule (review round 3) ────────────────────────
// Williamson-Hall reads `PeakTableEntry.center` AS 2-theta in degrees, so a
// table fit on a q or d-spacing axis must be refused. The EXACT rule, two
// clauses, no others:
//   1. a PRESENT unit passes only on an EXACT match (trimmed, lower-cased)
//      against DEGREE_UNITS below. Exact, not substring: round 2 shipped
//      `u.includes("deg") || u.includes("°")`, which passed `degC` and `°C`
//      — a magnetometry M(T) curve in Celsius between 0 and 180 also clears
//      the reduction's `0 < 2θ < 180` check, so that was a real wrong answer.
//   2. an EMPTY unit passes only on LABEL evidence: `xLabel` matching
//      TWO_THETA_LABEL ("2Theta", "2-theta", "2 θ", "two_theta", …). A great
//      many XRD files record no unit at all, so refusing every unit-less axis
//      would break the common case; but a unit-less q column ("q", "Q") then
//      carries no 2θ evidence at all and is refused — the hole round 2
//      measured end to end (a q pattern producing a plausible grain size).
//      Clause 2 is POSITIVE EVIDENCE ONLY — it does not check the label for a
//      conflicting unit, so e.g. `xUnit: ""`, `xLabel: "2 Theta (rad)"` also
//      passes. Not reachable through any shipped parser: `io/spc.py` is the
//      only writer that emits an empty unit, and it never writes a 2θ label;
//      `io/delimited.py`'s `_extract_units` lifts a parenthesized unit like
//      `(rad)` out of the header text into `xUnit` itself, so that case hits
//      clause 1 (and is refused there) before clause 2 ever sees it.
// Real XRD files clear clause 1 without needing clause 2: `io/_xrdml_scan.py`
// writes `x_column_name: "2-Theta"` AND `x_column_unit: "deg"`, and
// `xChannelIdentity` below records both.
const DEGREE_UNITS = new Set(["deg", "°", "degree", "degrees"]);
const TWO_THETA_LABEL = /2\s*-?\s*(theta|θ)|two[_ -]?theta/i;

/** The rule itself, factored out so every consumer that needs to know "is
 *  THIS axis 2-theta in degrees" shares one predicate instead of re-deriving
 *  it — `peakTableXIsDegrees` below delegates to it (no behaviour change),
 *  and `usePawley` (the Reductions workshop) calls it directly over
 *  `xChannelIdentity(ds.data, null)` rather than a `PeakTable`'s recorded
 *  provenance, since Pawley refines straight off the dataset's own x axis
 *  with no fitted-peak table involved. */
export function xAxisIsTwoThetaDegrees(x: { xLabel: string; xUnit: string }): boolean {
  const u = x.xUnit.trim().toLowerCase();
  return u === "" ? TWO_THETA_LABEL.test(x.xLabel) : DEGREE_UNITS.has(u);
}

/** Is the axis this table was fit on 2-theta in DEGREES — i.e. may a consumer
 *  that reads `center` as 2-theta (Williamson-Hall) use it? The exact rule is
 *  in the block comment above. */
export function peakTableXIsDegrees(table: PeakTable): boolean {
  return xAxisIsTwoThetaDegrees({ xLabel: table.provenance.xLabel, xUnit: table.provenance.xUnit });
}

/** The x channel's label/unit as the user sees it, for
 *  `PeakTableProvenance.xLabel`/`xUnit`. Mirrors lib/plotdata.ts's `packSeries`
 *  field for field (the Origin long name over the raw column letter for the
 *  time axis) so the provenance line names the same axis the plot does —
 *  duplicated here rather than imported because `packSeries` returns a whole
 *  uPlot payload and this module must stay lazy-only (see the header). */
export function xChannelIdentity(
  data: DataStruct,
  xKey: number | null,
): { xLabel: string; xUnit: string } {
  if (xKey == null) {
    return {
      xLabel: String(data.metadata?.["x_column_long"] || data.metadata?.["x_column_name"] || "x"),
      xUnit: String(data.metadata?.["x_column_unit"] ?? ""),
    };
  }
  return { xLabel: data.labels[xKey] ?? "x", xUnit: data.units[xKey] ?? "" };
}

/** Carry the user's `excluded` flags across a RE-FIT, matched by peak
 *  IDENTITY — nearest CENTRE within half the smaller of the two FWHMs — not by
 *  array position.
 *
 *  Position was the original rule, justified as "the seeds are the same
 *  detected peaks in the same order", with any length change abandoning the
 *  mapping. Review round 2 measured the hole: `usePeaks`'s `fitEach` publishes
 *  only the SUCCESSES, and detection re-runs on every data change, so an
 *  N-of-M run whose success count merely HAPPENS to equal the previous table's
 *  length carried the user's exclusions onto different physical peaks,
 *  silently. Centres are what a peak IS; row order is an accident of the fit.
 *
 *  Each prior exclusion claims at most one new row (nearest first come, first
 *  served, `taken`), and an exclusion with no row inside tolerance is DROPPED —
 *  a peak that is gone cannot stay excluded, and guessing a neighbour for it is
 *  the exact failure this replaces. Ids are still minted fresh: a re-fit is a
 *  new measurement of the same peak, and reusing an id would claim the two rows
 *  are the same record.
 *
 *  ROUND 3: the match must be MUTUALLY nearest (`isMutuallyNearest`). Nearest-
 *  from-the-exclusion's-side alone let a VANISHED excluded peak inherit onto
 *  the neighbour the user deliberately KEPT — measured at Kα1/Kα2 spacing
 *  (old `[20.00 excluded, 20.20 kept]`, re-fit finds only `[20.20]`: 20.20 is
 *  0.20° from the exclusion, inside a 0.25° tolerance, so it was excluded and
 *  silently dropped out of Williamson-Hall). Under the OLD positional rule the
 *  length change abandoned the mapping, so for that shape nearest-only was a
 *  regression. Mutual nearest is exactly what separates "the same peak" from
 *  "its neighbour", and a TIE (two prior peaks equidistant — the merged-peak
 *  case) resolves to NOT carrying: an ambiguous inheritance that silently
 *  drops a peak from a reduction is worse than a checkbox the user re-ticks. */
function carriedExclusions(result: MultiFitResult, prior: PeakTable | null | undefined): boolean[] {
  const flags = result.peaks.map(() => false);
  const priorPeaks = prior?.peaks ?? [];
  const taken = new Set<number>();
  for (const old of priorPeaks) {
    if (!old.excluded) continue;
    let best = -1;
    let bestGap = Infinity;
    for (let i = 0; i < result.peaks.length; i++) {
      if (taken.has(i)) continue;
      const p = result.peaks[i];
      const gap = Math.abs(p.center - old.center);
      // Half the SMALLER FWHM: two peaks closer than that are not resolvable
      // as separate peaks anyway, and the wider one must not swallow a
      // neighbour just because it is broad.
      if (gap > Math.min(Math.abs(p.fwhm), Math.abs(old.fwhm)) / 2 || gap >= bestGap) continue;
      if (!isMutuallyNearest(priorPeaks, old, p.center)) continue;
      best = i;
      bestGap = gap;
    }
    if (best >= 0) {
      taken.add(best);
      flags[best] = true;
    }
  }
  return flags;
}

/** Is `old` the prior table's own nearest peak to `center`? Checked against
 *  the WHOLE prior table, excluded rows included — a new peak that sits closer
 *  to some other row of the table the user was looking at is that row's
 *  re-measurement, not this exclusion's. Equidistant counts as "no" (see
 *  `carriedExclusions`'s tie rule). */
function isMutuallyNearest(
  priorPeaks: readonly PeakTableEntry[],
  old: PeakTableEntry,
  center: number,
): boolean {
  const gap = Math.abs(old.center - center);
  return !priorPeaks.some((q) => q !== old && Math.abs(q.center - center) <= gap);
}

/** Build a durable table from a fit result. `keepExclusionsFrom` carries the
 *  user's `excluded` flags across a re-fit — see `carriedExclusions` for how
 *  a row is recognized as the same physical peak. */
export function peakTableFromFit(
  result: MultiFitResult,
  source: PeakTableSource,
  keepExclusionsFrom?: PeakTable | null,
): PeakTable {
  const prior = carriedExclusions(result, keepExclusionsFrom);
  return {
    version: PEAK_TABLE_VERSION,
    peaks: result.peaks.map((p, i) => ({
      id: nextPeakId(),
      center: p.center,
      centerErr: null,
      fwhm: p.fwhm,
      fwhmErr: null,
      height: p.height,
      heightErr: null,
      area: p.area,
      bg: p.bg,
      eta: p.eta,
      model: p.model,
      status: p.status,
      excluded: prior[i],
    })),
    provenance: {
      datasetId: source.datasetId,
      datasetName: source.datasetName,
      method: source.method,
      model: result.model,
      bgDegree: source.bgDegree,
      linkMode: source.linkMode,
      constrain: source.constrain,
      bgCoeffs: [...result.bgCoeffs],
      R2: result.R2,
      rmse: result.rmse,
      wavelengthA: source.wavelengthA,
      xLabel: source.xLabel ?? "",
      xUnit: source.xUnit ?? "",
      fingerprint: source.fingerprint ?? null,
      fittedAt: (source.now ?? new Date()).toISOString(),
    },
  };
}

/** Re-hydrate the panel's display shape from the durable table, so a reopened
 *  project shows the same fitted-peak table it was saved with. Lossless for
 *  everything `MultiFitResult` carries — `bgCoeffs`/`R2`/`rmse`/`model` all
 *  live in the provenance. Excluded peaks are KEPT (they stay visible and
 *  index-aligned with the table; only consumers drop them). */
export function peakTableToFitResult(table: PeakTable): MultiFitResult {
  return {
    peaks: table.peaks.map((p) => ({
      center: p.center,
      fwhm: p.fwhm,
      height: p.height,
      bg: p.bg,
      eta: p.eta,
      area: p.area,
      status: p.status,
      model: p.model,
    })),
    bgCoeffs: [...table.provenance.bgCoeffs],
    R2: table.provenance.R2,
    rmse: table.provenance.rmse,
    nPeaks: table.peaks.length,
    model: table.provenance.model,
  };
}

/** The rows every downstream consumer (Williamson-Hall, a future Pawley entry
 *  point, an export) must use — the single place the `excluded` flag is
 *  honoured, so no consumer can forget it. */
export function includedPeaks(table: PeakTable): PeakTableEntry[] {
  return table.peaks.filter((p) => !p.excluded);
}

/** Flip one peak's `excluded` flag, addressed BY ID (see `PeakTableEntry.id`).
 *  Returns the same reference when `id` matches nothing, so a caller's
 *  identity check can skip a pointless store write. */
export function withPeakExcluded(table: PeakTable, id: string, excluded: boolean): PeakTable {
  if (!table.peaks.some((p) => p.id === id)) return table;
  return {
    ...table,
    peaks: table.peaks.map((p) => (p.id === id ? { ...p, excluded } : p)),
  };
}



export type PeakManualPatch = Partial<Pick<PeakTableEntry, "center" | "fwhm" | "height" | "area">>;

/** Why a manual edit of `current` is not physical, or null. Shared by the
 *  edit dialog and the store writer. Only fields the edit actually CHANGES
 *  are judged — the dialog always sends all four, and a row the fit produced
 *  must stay editable whatever it holds. FWHM must stay positive. Height and
 *  area may not become zero or flip sign: the fitter leaves height
 *  unconstrained, so a dip is a legitimate negative peak, but zeroing a peak
 *  is what Remove is for. */
export function peakManualEditProblem(
  patch: PeakManualPatch,
  current: Pick<PeakTableEntry, "center" | "fwhm" | "height" | "area">,
): string | null {
  const changed = (k: keyof PeakManualPatch): number | undefined =>
    patch[k] !== undefined && patch[k] !== current[k] ? patch[k] : undefined;
  const c = { center: changed("center"), fwhm: changed("fwhm"), height: changed("height"), area: changed("area") };
  if (!Object.values(c).every((v) => v === undefined || Number.isFinite(v))) {
    return "Peak values must be finite numbers.";
  }
  if (c.fwhm !== undefined && !(c.fwhm > 0)) return "FWHM must be greater than zero.";
  const keepsSign = (v: number | undefined, was: number): boolean =>
    v === undefined || (v !== 0 && (was === 0 || Math.sign(v) === Math.sign(was)));
  if (!keepsSign(c.height, current.height)) return "Height cannot be zero or change sign; remove the peak instead.";
  if (!keepsSign(c.area, current.area)) return "Area cannot be zero or change sign; remove the peak instead.";
  return null;
}

/** Manually revise one durable fitted-peak row. Manual numbers supersede the
 * fit-derived value, so the uncertainty of each field that actually CHANGED is
 * cleared and global fit metrics are invalidated. Raw data and the data
 * fingerprint are unchanged.
 *
 * Area is not independent of height and FWHM: for a fixed profile shape it is
 * height × FWHM × a shape constant (exact for Gaussian, Lorentzian and
 * pseudo-Voigt at fixed η; approximate for an independently fitted Split
 * Pearson VII, whose area is a windowed integral). When height or FWHM changes
 * and the area field is unchanged, the area is rescaled by the same ratio so
 * the row stays self-consistent; a changed area is kept as given. A row with a
 * zero height or FWHM cannot be rescaled and keeps its area. */
export function withPeakManualEdit(table: PeakTable, id: string, patch: PeakManualPatch): PeakTable {
  const index = table.peaks.findIndex((p) => p.id === id);
  if (index < 0) return table;
  const current = table.peaks[index];
  const differs = (key: keyof PeakManualPatch): boolean =>
    patch[key] !== undefined && patch[key] !== current[key];
  if (!(["center", "fwhm", "height", "area"] as const).some(differs)) return table;
  const next = { ...current, ...patch, status: "manual-edit" };
  if (!differs("area") && (differs("height") || differs("fwhm")) && current.height !== 0 && current.fwhm !== 0) {
    next.area = current.area * (next.height / current.height) * (next.fwhm / current.fwhm);
  }
  if (differs("center")) next.centerErr = null;
  if (differs("fwhm")) next.fwhmErr = null;
  if (differs("height")) next.heightErr = null;
  const peaks = [...table.peaks];
  peaks[index] = next;
  return {
    ...table,
    peaks,
    provenance: { ...table.provenance, R2: null, rmse: null },
  };
}

/** How many rows of a table carry hand-edited values. */
export function manualEditCount(peaks: readonly { status?: string }[]): number {
  return peaks.filter((p) => p.status === "manual-edit").length;
}

/** Remove fitted peaks by durable id. Refuses to create an empty PeakTable:
 * zero fitted rows means the dataset has no peak-analysis artifact at all. */
export function withoutPeaks(table: PeakTable, ids: ReadonlySet<string>): PeakTable | null {
  const peaks = table.peaks.filter((p) => !ids.has(p.id));
  if (peaks.length === table.peaks.length) return table;
  if (peaks.length === 0) return null;
  return {
    ...table,
    peaks,
    provenance: { ...table.provenance, R2: null, rmse: null },
  };
}
