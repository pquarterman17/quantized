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
// UNCERTAINTIES — ONE PRODUCER MEASURES THEM, ONE DOES NOT (2026-09-25).
// `centerErr`/`fwhmErr`/`heightErr`/`areaErr` are 1σ standard errors or
// null, NEVER 0 and never NaN (`sanitizePeakTable` enforces "finite and > 0"
// on the way in). Two producers write this table:
//   • the Peaks workshop's classic fit (`provenance.producer` absent) writes
//     null for all of them: neither `calc/peak_multifit.fit_multi_peak` nor
//     `calc/peak_fit.fit_peak` returns a covariance, and inventing one would
//     be new numerics with no MATLAB golden (CLAUDE.md's golden-parity rule);
//   • the Peak Analyzer's mixed-shape model fit (`producer: "model_fit"`,
//     peakwizard/modelFitPublish.ts) copies the backend's delta-method errors
//     (`calc/peak_model_fit.py`, pinv covariance) verbatim. An error the
//     backend could not determine — fixed, tied to one, on a bound, or after a
//     non-converged stop — stays null, and WHY is kept in `errReasons`.
// `areaErr`, the Voigt widths, `errReasons` and the model-fit provenance
// fields are all OPTIONAL: a record written before them simply lacks them,
// so no `PEAK_TABLE_VERSION` bump was needed.
//
// INVALIDATION (review rounds 2 and 3, 2026-09-15). A durable record of a fit
// is a LIE the moment the data it was fit from changes, so
// `PeakTableProvenance` carries a `fingerprint` — a cheap, deterministic digest
// of the dataset's ANALYSIS VIEW: its x and value numbers, its column labels
// and units, and its row state (lib/peakTableFit's `peakDataFingerprint`, whose
// own header states the exact composition). Every reader compares it
// against the LIVE data before using the table: the Peaks workshop refuses to
// rehydrate a table that no longer matches, and Williamson-Hall's "Use fitted
// peaks" is disabled with the reason instead of quietly loading 2-theta values
// measured from data the user has since replaced. The store also clears the
// table outright wherever it already clears `fitSpec` for the same reason
// (store/reimport.ts, store/corrections.ts, store/cellEdit.ts); the fingerprint
// is the DURABLE half — it survives a `.dwk` reopen, which an in-memory stale
// list cannot, and it catches any future data-writing path that forgets to
// clear. This is deliberately NOT a node in lib/recalc.ts's dependency graph:
// that graph exists to mark artifacts an EXECUTOR can re-derive automatically
// (`store/recalcDatasets.ts`, `store/recalcFits.ts`), and re-deriving a peak
// table means re-issuing a peak search plus a user-chosen model/background/
// link mode — a deliberate action, not a recompute. Its only writer,
// `touchDataset`, also returns early when `recalcMode` is "off", so a
// graph-based invalidation would silently not happen for anyone who turned
// recalc off.
//
// A DUPLICATE DOES NOT CARRY THE TABLE, deliberately (review round 2).
// `store/useApp.ts`'s `duplicateDataset` makes an INDEPENDENT dataset "for
// trying different corrections/formulas" (its own doc) and carries no derived
// analysis at all — not `fitSpec`, not `excludedRows`, not `filter`. Carrying
// the table would also carry a provenance record naming the SOURCE dataset's
// id and name, which the `.dwk` sanitizer would accept verbatim: a traceability
// claim about a dataset the rows did not come from. Re-fitting the copy is one
// click, and it is the honest one.
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
  /** 1σ on `center`, or null when the producer reports none (see the module
   *  header: the classic fit never does, the model fit does when it can).
   *  Same for the three below — never 0, never NaN. */
  centerErr: number | null;
  fwhm: number;
  fwhmErr: number | null;
  height: number;
  heightErr: number | null;
  area: number;
  /** Optional (added with the model-fit producer); absent reads as null. */
  areaErr?: number | null;
  /** Why a null `*Err` is null, keyed by field — the producer's own reason
   *  (e.g. "on a bound"), or "edited by hand" after a manual edit. Optional. */
  errReasons?: Partial<Record<PeakErrKey, string>>;
  bg: number;
  eta: number | null;
  /** Voigt rows only: the Gaussian and Lorentzian component FWHMs (x units)
   *  whose combination is `fwhm`. Optional; absent for every other shape. */
  fwhmG?: number | null;
  fwhmL?: number | null;
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
  /** The x channel the fit RAN on, as the user sees it — its label and unit
   *  text ONLY, never a column index (architecture.test.ts's
   *  `DATASET_CHANNEL_REMAP_EXCLUDED` entry for `peakTable` says this record
   *  stores no channel index at all, and that has to stay true). Recorded
   *  because `center`/`fwhm` are in whatever units that channel carries, so a
   *  consumer that needs 2-theta in degrees — Williamson-Hall — can refuse a
   *  table fit on a q or d-spacing axis instead of silently reading Å⁻¹ as
   *  degrees. `xUnit === ""` means the file recorded no unit — very common in
   *  XRD — and is then decided on `xLabel` evidence alone; see
   *  `peakTableXIsDegrees` for the exact two-clause rule. */
  xLabel: string;
  xUnit: string;
  /** Digest of the DATA this fit was measured from (lib/peakTableFit's
   *  `peakDataFingerprint`), or null for a record written before this field
   *  existed — "unknown", which reads as "still valid", the same fail-soft
   *  contract `sanitizePeakTable` applies everywhere else. See the module
   *  header for what compares it and why it is not a recalc-graph node. */
  fingerprint: string | null;
  /** ISO-8601 instant the fit completed. */
  fittedAt: string;
  /** Which producer wrote the table: absent = the Peaks workshop's classic
   *  fit; "model_fit" = the Peak Analyzer's mixed-shape model fit, whose
   *  `bgDegree` is the polynomial's degree (-1 = no background term) and
   *  whose `bgCoeffs` are that polynomial in powers of x — empty when the fit
   *  ran after a baseline subtraction, since it then describes the subtracted
   *  trace, not the raw one each row's `bg` is on. */
  producer?: "model_fit";
  /** Human-readable engine and recipe summaries (model_fit only). */
  engine?: string;
  recipe?: string;
  /** The minimised objective under its honest name — SSR for an unweighted
   *  fit, χ² only for a weighted one — and its reduced value. Cleared, like
   *  `R2`/`rmse`, by a manual edit or removal. */
  objective?: PeakTableObjective;
}

export type PeakErrKey = "center" | "fwhm" | "height" | "area";
export const PEAK_ERR_KEYS: readonly PeakErrKey[] = ["center", "fwhm", "height", "area"];

export interface PeakTableObjective {
  kind: "ssr" | "chi2";
  value: number | null;
  reduced: number | null;
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

/** "a string, or the absent-field default" — the coercion every text field in
 *  this sanitizer needs. One helper rather than six inline `typeof` ternaries:
 *  this module is paid for in the EAGER bundle (see the module header), and
 *  the six call sites below cost measurably less through it. */
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** A standard error: finite and strictly positive, else null. A 0 or negative
 *  "error" in a hand-edited record would read as "exactly known" downstream,
 *  which is the one claim a missing error must never make. */
function err(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
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
  const entry: PeakTableEntry = {
    id: str(o.id) || `peak-restored-${index}`,
    center,
    centerErr: err(o.centerErr),
    fwhm,
    fwhmErr: err(o.fwhmErr),
    height,
    heightErr: err(o.heightErr),
    area: num(o.area) ?? 0,
    bg: num(o.bg) ?? 0,
    eta: num(o.eta),
    model: str(o.model),
    status: str(o.status),
    excluded: o.excluded === true,
  };
  // The optional fields are written only when PRESENT, so a record from before
  // they existed round-trips to exactly the object it was.
  if ("areaErr" in o) entry.areaErr = err(o.areaErr);
  if ("fwhmG" in o) entry.fwhmG = num(o.fwhmG);
  if ("fwhmL" in o) entry.fwhmL = num(o.fwhmL);
  const reasons = o.errReasons;
  if (typeof reasons === "object" && reasons !== null) {
    const r = reasons as Record<string, unknown>;
    const kept: Partial<Record<PeakErrKey, string>> = {};
    for (const k of PEAK_ERR_KEYS) if (typeof r[k] === "string" && r[k]) kept[k] = r[k];
    if (Object.keys(kept).length > 0) entry.errReasons = kept;
  }
  return entry;
}

function parseObjective(v: unknown): PeakTableObjective | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (o.kind !== "ssr" && o.kind !== "chi2") return undefined;
  return { kind: o.kind, value: num(o.value), reduced: num(o.reduced) };
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
  const provenance: PeakTableProvenance = {
    datasetId: p.datasetId,
    datasetName: str(p.datasetName),
    method,
    model: str(p.model),
    bgDegree: num(p.bgDegree) ?? 0,
    linkMode: str(p.linkMode),
    constrain: p.constrain === true,
    bgCoeffs: Array.isArray(p.bgCoeffs)
      ? p.bgCoeffs.filter((c): c is number => typeof c === "number" && Number.isFinite(c))
      : [],
    R2: num(p.R2),
    rmse: num(p.rmse),
    wavelengthA: num(p.wavelengthA),
    xLabel: str(p.xLabel),
    xUnit: str(p.xUnit),
    fingerprint: str(p.fingerprint) || null,
    fittedAt: str(p.fittedAt),
  };
  if (p.producer === "model_fit") provenance.producer = "model_fit";
  if (str(p.engine)) provenance.engine = str(p.engine);
  if (str(p.recipe)) provenance.recipe = str(p.recipe);
  const objective = parseObjective(p.objective);
  if (objective) provenance.objective = objective;
  return { version: PEAK_TABLE_VERSION, peaks, provenance };
}

/** Serialize for the `.dwk` doc. A defensive deep-ish copy, the same shape
 *  `store/rois.ts`'s `serializeRois` uses: the record is plain JSON already, so
 *  this exists to stop a live store object being aliased into the saved doc.
 *  The nested optionals (`errReasons`, `objective`) are copied too. */
export function serializePeakTable(table: PeakTable): PeakTable {
  const { objective } = table.provenance;
  return {
    version: table.version,
    peaks: table.peaks.map((p) => (p.errReasons ? { ...p, errReasons: { ...p.errReasons } } : { ...p })),
    provenance: {
      ...table.provenance,
      bgCoeffs: [...table.provenance.bgCoeffs],
      ...(objective ? { objective: { ...objective } } : {}),
    },
  };
}
