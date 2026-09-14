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
  /** Injected so tests are deterministic; defaults to `new Date()`. */
  now?: Date;
}

/** Build a durable table from a fit result.
 *
 *  `keepExclusionsFrom` carries the user's `excluded` flags across a RE-FIT of
 *  the same dataset: peaks are matched by POSITION in the previous table (the
 *  seeds are the same detected peaks in the same order, so row i is the same
 *  physical peak), because ids are minted fresh — a re-fit is a new measurement
 *  of the same peak, and silently reusing an id would claim the two rows are
 *  the same record. Any length change abandons the mapping rather than guessing.
 */
export function peakTableFromFit(
  result: MultiFitResult,
  source: PeakTableSource,
  keepExclusionsFrom?: PeakTable | null,
): PeakTable {
  const prior =
    keepExclusionsFrom && keepExclusionsFrom.peaks.length === result.peaks.length
      ? keepExclusionsFrom.peaks
      : null;
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
      excluded: prior ? prior[i].excluded : false,
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

