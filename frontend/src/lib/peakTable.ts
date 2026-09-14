// The XRD peak contract: the /api/peaks wire types (moved here verbatim from
// lib/types.ts — see that file's re-export) PLUS the DURABLE peak table that
// survives a `.dwk` save/reopen (PRIMARY_SOFTWARE_AUDIT_PLAN P2.1).
//
// WHY THIS FILE EXISTS. Before P2.1 a fit's results lived only in
// `usePeaks.ts`'s `useState` — switching datasets, closing the panel, or
// reopening the project threw them away, and the Williamson-Hall section's own
// header said so ("Peak entry is manual for v1 … there is nothing durable to
// prefill from"). `PeakTable` is that durable artifact: one record per source
// dataset, carrying a stable id per peak, the model that produced it, an
// `excluded` flag the user controls, uncertainty slots, and a provenance
// record naming the dataset and the fit parameters. It hangs off
// `Dataset.peakTable` (lib/types.ts), so it serializes with the dataset it
// belongs to — the same additive-optional shape as `Dataset.fitSpec`, absent
// meaning "no peak table", never an ad-hoc dict (CLAUDE.md's data contract).
//
// UNCERTAINTIES ARE MODELLED, NOT YET MEASURED. `centerErr`/`fwhmErr`/
// `heightErr` are `number | null` and every producer here writes `null`:
// neither `calc/peak_multifit.fit_multi_peak` nor `calc/peak_fit.fit_peak`
// returns a covariance or a standard error today, and inventing one would be
// new numerics with no MATLAB golden to check them against (CLAUDE.md's
// golden-parity rule). The COLUMNS are durable now so that adding the numbers
// later is an additive backend change rather than another `.dwk` migration;
// P2.1's plan entry records the numerics as the next box.
//
// WHAT LIVES WHERE. This file is the CONTRACT (the types) plus the `.dwk`
// sanitize/serialize pair, and nothing else — it is imported by the EAGER
// workspace path (lib/workspaceDatasetParse.ts, lib/workspaceSerialize.ts), so
// everything in it is paid for in the eager bundle. The fit-side helpers
// (building a table from a fit, rehydrating one, `includedPeaks`,
// `withPeakExcluded`) live in ./peakTableFit, which only lazy workshop code
// imports; see that file's header for the measured reason.
//
// Pure lib — no store, no React, no fetch.

/** One detected peak (from /api/peaks/find). `height` is measured ABOVE
 *  `bg` (`calc/peaks.py`'s `find_peaks_robust` returns both) — the apex's
 *  actual y is `height + bg`, never `height` alone (L1/L2 review finding,
 *  usePeaks.ts's "label peaks"/marker-overlay bug: every backgrounded
 *  dataset placed labels/markers a whole background below the real peak).
 *  Declared explicitly (not left to the index signature) so that formula is
 *  type-checked at every call site, not incidental. */
export interface Peak {
  center: number;
  height: number;
  fwhm: number;
  prominence: number;
  localSNR: number;
  area: number | null;
  bg: number;
  [key: string]: unknown;
}

/** One fitted peak (from /api/peaks/fit-multi, or mapped from /api/peaks/fit).
 *  `eta` is null for non-pseudo-Voigt models (NaN serialized at the wire). */
export interface FittedPeak {
  center: number;
  fwhm: number;
  height: number;
  bg: number;
  eta: number | null;
  area: number;
  status: string;
  model: string;
  [key: string]: unknown;
}

/** Result of a simultaneous multi-peak fit (/api/peaks/fit-multi). `R2`/`rmse`
 *  are NaN-serialized to null when synthesized from independent per-peak fits. */
export interface MultiFitResult {
  peaks: FittedPeak[];
  bgCoeffs: number[];
  R2: number | null;
  rmse: number | null;
  nPeaks: number;
  model: string;
}

/** Result of a single-peak window fit (/api/peaks/fit). */
export interface SinglePeakFit {
  success: boolean;
  reason: string;
  center: number;
  fwhm: number;
  height: number;
  bg: number;
  eta: number | null;
  area: number;
  params: number[];
  model: string;
  window: number[];
}

/** One durable row of a `PeakTable`.
 *
 *  `id` is the peak's IDENTITY and the only stable handle downstream code may
 *  hold: row order is an accident of the fit, and re-fitting renumbers rows,
 *  so an exclusion toggle addresses a peak by id, never by index.
 *  `center`/`fwhm` are in the dataset's own x units (2θ degrees for XRD);
 *  `height` is measured above `bg`, exactly like `FittedPeak`. */
export interface PeakTableEntry {
  id: string;
  center: number;
  /** 1σ on `center`, or null when the fit engine reports none (always, today —
   *  see the module header). Same for the two below. */
  centerErr: number | null;
  fwhm: number;
  fwhmErr: number | null;
  height: number;
  heightErr: number | null;
  area: number;
  bg: number;
  eta: number | null;
  /** The peak-shape model this row was fit with (per row: a future mixed-model
   *  fit can vary it, and P2.4 plans exactly that). */
  model: string;
  status: string;
  /** User-controlled: an excluded peak stays in the table (and visible, so the
   *  exclusion is reviewable) but is omitted from every downstream consumer —
   *  see `includedPeaks`. */
  excluded: boolean;
}

/** Where a `PeakTable` came from and what produced it. Enough to answer "which
 *  data, which model, which settings, when" without re-running anything. */
export interface PeakTableProvenance {
  datasetId: string;
  datasetName: string;
  /** "simultaneous" = one global /api/peaks/fit-multi over all seeds;
   *  "independent" = one windowed /api/peaks/fit per seed. */
  method: "simultaneous" | "independent";
  model: string;
  bgDegree: number;
  linkMode: string;
  constrain: boolean;
  bgCoeffs: number[];
  R2: number | null;
  rmse: number | null;
  /** X-ray wavelength (Å) resolved from the dataset's instrument metadata at
   *  fit time (lib/xrdWavelength.ts), or null when the file carried none.
   *  Frozen here so a downstream reduction uses the wavelength THIS pattern was
   *  measured at, not whatever is typed in a panel later. */
  wavelengthA: number | null;
  /** ISO-8601 instant the fit completed. */
  fittedAt: string;
}

/** A dataset's durable fitted-peak table. `version` is the record's own schema
 *  version, independent of WORKSPACE_VERSION: a `.dwk` without the field simply
 *  has no table (absent means default), so adding this needed no bump. */
export interface PeakTable {
  version: 1;
  peaks: PeakTableEntry[];
  provenance: PeakTableProvenance;
}

export const PEAK_TABLE_VERSION = 1;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseEntry(v: unknown, index: number): PeakTableEntry | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const center = num(o.center);
  const fwhm = num(o.fwhm);
  const height = num(o.height);
  // center/fwhm/height are the columns every consumer reads; a row missing any
  // of them is unusable, so it is DROPPED rather than defaulted to a number
  // that would quietly enter a Williamson-Hall fit.
  if (center === null || fwhm === null || height === null) return null;
  return {
    id: typeof o.id === "string" && o.id ? o.id : `peak-restored-${index}`,
    center,
    centerErr: num(o.centerErr),
    fwhm,
    fwhmErr: num(o.fwhmErr),
    height,
    heightErr: num(o.heightErr),
    area: num(o.area) ?? 0,
    bg: num(o.bg) ?? 0,
    eta: num(o.eta),
    model: typeof o.model === "string" ? o.model : "",
    status: typeof o.status === "string" ? o.status : "",
    excluded: o.excluded === true,
  };
}

/** Validate a persisted `Dataset.peakTable` from a `.dwk`. A hand-edited,
 *  truncated or future-schema record degrades to `undefined` ("this dataset has
 *  no peak table") rather than throwing — the same fail-soft contract
 *  `workspaceDatasetParse.ts` applies to `fitSpec` and `pending`. */
export function sanitizePeakTable(v: unknown): PeakTable | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (o.version !== PEAK_TABLE_VERSION) return undefined;
  if (!Array.isArray(o.peaks)) return undefined;
  const prov = o.provenance;
  if (typeof prov !== "object" || prov === null) return undefined;
  const p = prov as Record<string, unknown>;
  if (typeof p.datasetId !== "string" || !p.datasetId) return undefined;
  const peaks: PeakTableEntry[] = [];
  for (let i = 0; i < o.peaks.length; i++) {
    const entry = parseEntry(o.peaks[i], i);
    if (entry) peaks.push(entry);
  }
  if (peaks.length === 0) return undefined;
  const method = p.method === "independent" ? "independent" : "simultaneous";
  return {
    version: PEAK_TABLE_VERSION,
    peaks,
    provenance: {
      datasetId: p.datasetId,
      datasetName: typeof p.datasetName === "string" ? p.datasetName : "",
      method,
      model: typeof p.model === "string" ? p.model : "",
      bgDegree: num(p.bgDegree) ?? 0,
      linkMode: typeof p.linkMode === "string" ? p.linkMode : "",
      constrain: p.constrain === true,
      bgCoeffs: Array.isArray(p.bgCoeffs)
        ? p.bgCoeffs.filter((c): c is number => typeof c === "number" && Number.isFinite(c))
        : [],
      R2: num(p.R2),
      rmse: num(p.rmse),
      wavelengthA: num(p.wavelengthA),
      fittedAt: typeof p.fittedAt === "string" ? p.fittedAt : "",
    },
  };
}

/** Serialize for the `.dwk` doc. A defensive deep-ish copy, the same shape
 *  `store/rois.ts`'s `serializeRois` uses: the record is plain JSON already, so
 *  this exists to stop a live store object being aliased into the saved doc. */
export function serializePeakTable(table: PeakTable): PeakTable {
  return {
    version: table.version,
    peaks: table.peaks.map((p) => ({ ...p })),
    provenance: { ...table.provenance, bgCoeffs: [...table.provenance.bgCoeffs] },
  };
}
