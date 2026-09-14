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
import type { DataStruct } from "./types";

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
// it is not a recalc-graph node. WHAT it digests: the dataset's own numbers —
// row count, column count, the x (time) channel's first/last/min/max, and an
// FNV-1a hash over the raw float bytes of every value column.
//
// EVERY value column, not just the one the fit ran on: that needs no channel
// INDEX in the record (which would falsify architecture.test.ts's
// `DATASET_CHANNEL_REMAP_EXCLUDED` reason for `peakTable`), it survives a
// column reorder without a remap rule of its own, and it is strictly more
// conservative — the worst it can do is ask the user to re-fit after an edit
// to a column the fit never read. It deliberately does NOT digest row state
// (`excludedRows`/`filter`): those select a SUBSET of unchanged measurements
// and the Peaks workshop already re-runs detection on them.
//
// FNV-1a over the IEEE-754 bytes, the same construction lib/jitter.ts uses for
// its (non-exported, UTF-8) hash: 32-bit, allocation-free per value, and exact
// — NaN and -0 hash to stable values distinct from 0 rather than collapsing
// the way `String(v)` would.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** A digest of `data`'s numeric content — see the block comment above. Pure
 *  and deterministic: the same DataStruct always yields the same string, and
 *  any edit to any measured value changes it. */
export function peakDataFingerprint(data: DataStruct): string {
  const view = new DataView(new ArrayBuffer(8));
  let h = FNV_OFFSET_BASIS >>> 0;
  for (const row of data.values) {
    for (const v of row) {
      view.setFloat64(0, v);
      for (let i = 0; i < 8; i++) {
        h = Math.imul(h ^ view.getUint8(i), FNV_PRIME) >>> 0;
      }
    }
  }
  const x = data.time;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of x) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const cols = data.values[0]?.length ?? 0;
  return `1:${x.length}:${data.values.length}:${cols}:${x[0]}:${x[x.length - 1]}:${lo}:${hi}:${h}`;
}

/** Does `table` still describe `data`? A record with NO fingerprint (written
 *  before the field existed, or by a caller that could not supply one) is
 *  "unknown", and unknown reads as YES — the same additive-optional, fail-soft
 *  contract `sanitizePeakTable` applies to every other field, so reopening a
 *  pre-round-2 `.dwk` still shows its saved fit. */
export function peakTableMatchesData(table: PeakTable, data: DataStruct): boolean {
  const fp = table.provenance.fingerprint;
  return fp === null || fp === peakDataFingerprint(data);
}

/** Is the axis this table was fit on 2-theta in DEGREES — i.e. may a consumer
 *  that reads `center` as 2-theta (Williamson-Hall) use it?
 *
 *  The rule is the UNIT TEXT, because that is the only x-convention signal the
 *  app records: "deg" or "°" (case-insensitive) passes, and an EMPTY unit
 *  passes too — a great many XRD files carry no unit string at all, and
 *  refusing every one of them would break the feature for the common case
 *  while proving nothing. Anything else present and non-degree ("1/A",
 *  "Å⁻¹", "nm") is a q/d-spacing axis and is refused: the reviewer's
 *  measured hole was a q-axis pattern loading into the 2-theta column and
 *  producing a plausible-looking grain size. */
export function peakTableXIsDegrees(table: PeakTable): boolean {
  const u = table.provenance.xUnit.trim().toLowerCase();
  return u === "" || u.includes("deg") || u.includes("°");
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
 *  are the same record. */
function carriedExclusions(result: MultiFitResult, prior: PeakTable | null | undefined): boolean[] {
  const flags = result.peaks.map(() => false);
  const taken = new Set<number>();
  for (const old of prior?.peaks ?? []) {
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
      if (gap <= Math.min(Math.abs(p.fwhm), Math.abs(old.fwhm)) / 2 && gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    }
    if (best >= 0) {
      taken.add(best);
      flags[best] = true;
    }
  }
  return flags;
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

