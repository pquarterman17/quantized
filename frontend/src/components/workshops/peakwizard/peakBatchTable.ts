// Peak Analyzer batch — the uncertainty / diagnostic result table (audit
// P2.4 slice 4). Pure: no React, no store, no fetch.
//
// ONE ROW PER (dataset, peak): centre / FWHM / height / area each with its
// standard error, the peak's shape, and the dataset's diagnostics repeated on
// every one of its rows (so any column sorts and a CSV row stands alone):
// status, R², the minimised objective under its HONEST label (SSR for an
// unweighted fit, χ² only when `metrics.objective` says so — the rule
// modelFitReasons.ts keeps for the single fit), AIC / BIC, points, the
// warning texts, and which of this peak's parameters (plus the background's)
// ended on a bound or were left undetermined. A dataset that could not be
// prepared or fitted is ONE row carrying the reason; nothing is dropped.
//
// A missing standard error is null with its REASON (./modelFitReasons —
// not converged / on a bound / fixed / tied / undetermined), shown as "—" +
// tooltip in the view and written to the CSV's `missing_errors` column.

import type { PeakBatchFit, PeakBatchResult } from "../../../lib/api/peakBatch";
import type { DataStruct } from "../../../lib/types";
import { derivedErrorReason, type DerivedKey } from "./modelFitReasons";
import { paramLabel } from "./peakModelParams";

/** A dataset's outcome: prepared + fitted, or where it failed and why. */
export interface BatchDatasetResult {
  datasetId: string;
  name: string;
  status: "ok" | "error" | "not_run";
  /** Where an error happened: preparing the fit (client) or fitting it. */
  stage: "prepare" | "fit" | null;
  error: string | null;
  fit: PeakBatchFit | null;
  /** Client-side notes (gap rows excluded), listed with the fit's warnings. */
  notes: string[];
}

/** A dataset's preparation outcome, in the order the user picked them. */
export type PrepOutcome =
  | { datasetId: string; name: string; ok: true; itemId: string; notes: string[] }
  | { datasetId: string; name: string; ok: false; error: string };

/** Join the preparations with the job's rows (matched by item id). */
export function mergeBatch(preps: readonly PrepOutcome[], job: PeakBatchResult | null): BatchDatasetResult[] {
  const byId = new Map((job?.rows ?? []).map((r) => [r.id, r]));
  return preps.map((p): BatchDatasetResult => {
    if (!p.ok) {
      return { datasetId: p.datasetId, name: p.name, status: "error", stage: "prepare", error: p.error, fit: null, notes: [] };
    }
    const row = byId.get(p.itemId);
    if (!row) {
      return { datasetId: p.datasetId, name: p.name, status: "not_run", stage: "fit", error: "no result was returned for this dataset", fit: null, notes: p.notes };
    }
    return {
      datasetId: p.datasetId, name: p.name, status: row.status,
      stage: row.status === "ok" ? null : "fit", error: row.error, fit: row.fit, notes: p.notes,
    };
  });
}

export interface ValueErr {
  value: number | null;
  err: number | null;
  /** Why `err` is null (null when it is not). */
  reason: string | null;
}

export interface BatchTableRow {
  dataset: string;
  datasetId: string;
  /** 1-based; null on a dataset's error row. */
  peak: number | null;
  shape: string | null;
  /** "converged" | "not converged" | "error" | "not run". */
  status: string;
  error: string | null;
  center: ValueErr | null;
  fwhm: ValueErr | null;
  height: ValueErr | null;
  area: ValueErr | null;
  rSquared: number | null;
  /** "SSR" or "χ²" — from `metrics.objective`, never assumed. */
  objectiveLabel: string | null;
  objective: number | null;
  reducedObjective: number | null;
  /** SSR always (the plain unweighted sum); χ² only for a weighted fit. */
  ssr: number | null;
  reducedSsr: number | null;
  chi2: number | null;
  reducedChi2: number | null;
  aic: number | null;
  bic: number | null;
  nPoints: number | null;
  warnings: string[];
  atBound: string[];
  undetermined: string[];
}

export const DERIVED: DerivedKey[] = ["center", "fwhm", "height", "area"];
const SHAPE_LABEL: Record<string, string> = {
  gaussian: "Gaussian", lorentzian: "Lorentzian", pseudo_voigt: "Pseudo-Voigt", voigt: "Voigt",
};

/** Peak `k`'s parameters (and the background's) that ended on a bound / were
 *  left undetermined. Undetermined = free, converged, not on a bound, and
 *  still no error (calc/peak_model_fit.py's degenerate-direction flag). */
function flags(fit: PeakBatchFit, k: number): { atBound: string[]; undetermined: string[] } {
  const mine = fit.parameters.filter((p) => p.name.startsWith(`p${k}.`) || p.name.startsWith("bg."));
  return {
    atBound: mine.filter((p) => p.at_bound).map((p) => paramLabel(p.name)),
    undetermined: fit.success
      ? mine.filter((p) => p.vary && !p.tie && !p.at_bound && p.stderr === null).map((p) => paramLabel(p.name))
      : [],
  };
}

type ObjectiveCells = "objectiveLabel" | "objective" | "reducedObjective" | "ssr" | "reducedSsr" | "chi2" | "reducedChi2";

function objectiveOf(fit: PeakBatchFit): Pick<BatchTableRow, ObjectiveCells> {
  const m = fit.metrics;
  const all = { ssr: m.ssr, reducedSsr: m.reduced_ssr, chi2: m.chi2, reducedChi2: m.reduced_chi2 };
  return m.objective === "chi2"
    ? { ...all, objectiveLabel: "χ²", objective: m.chi2, reducedObjective: m.reduced_chi2 }
    : { ...all, objectiveLabel: "SSR", objective: m.ssr, reducedObjective: m.reduced_ssr };
}

const EMPTY = {
  shape: null, center: null, fwhm: null, height: null, area: null, rSquared: null,
  objectiveLabel: null, objective: null, reducedObjective: null, ssr: null, reducedSsr: null,
  chi2: null, reducedChi2: null, aic: null, bic: null,
  nPoints: null, atBound: [], undetermined: [],
} as const;

export function batchTableRows(results: readonly BatchDatasetResult[]): BatchTableRow[] {
  return results.flatMap((r): BatchTableRow[] => {
    const base = { dataset: r.name, datasetId: r.datasetId };
    const fit = r.fit;
    if (r.status !== "ok" || !fit) {
      return [{
        ...base, ...EMPTY, atBound: [], undetermined: [], peak: null,
        status: r.status === "not_run" ? "not run" : "error", error: r.error, warnings: r.notes,
      }];
    }
    const diag = {
      status: fit.success ? "converged" : "not converged", error: null,
      rSquared: fit.metrics.r_squared, ...objectiveOf(fit), aic: fit.metrics.aic, bic: fit.metrics.bic,
      nPoints: fit.metrics.n_points, warnings: [...r.notes, ...fit.warnings],
    };
    return fit.peaks.map((p, k): BatchTableRow => {
      const cell = (key: DerivedKey): ValueErr => ({
        value: p[key], err: p[`${key}_stderr`], reason: derivedErrorReason(fit, k, key),
      });
      return {
        ...base, ...diag, ...flags(fit, k), peak: k + 1, shape: SHAPE_LABEL[p.shape] ?? p.shape,
        center: cell("center"), fwhm: cell("fwhm"), height: cell("height"), area: cell("area"),
      };
    });
  });
}

// ── sorting ──────────────────────────────────────────────────────────────────

export type SortKey =
  | "dataset" | "peak" | "shape" | "status" | DerivedKey
  | "rSquared" | "objective" | "reducedObjective" | "aic" | "bic" | "nPoints" | "warnings";

function sortValue(r: BatchTableRow, key: SortKey): number | string | null {
  switch (key) {
    case "dataset": case "shape": case "status":
      return r[key];
    case "center": case "fwhm": case "height": case "area":
      return r[key]?.value ?? null;
    case "warnings":
      return r.warnings.length;
    default:
      return r[key];
  }
}

/** Stable sort; missing values (null / non-finite) always last. */
export function sortRows(rows: readonly BatchTableRow[], key: SortKey, dir: "asc" | "desc"): BatchTableRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const missing = (v: number | string | null) => v === null || (typeof v === "number" && !Number.isFinite(v));
  return rows
    .map((row, i) => ({ row, i, v: sortValue(row, key) }))
    .sort((a, b) => {
      if (missing(a.v) || missing(b.v)) return missing(a.v) === missing(b.v) ? a.i - b.i : missing(a.v) ? 1 : -1;
      const c = typeof a.v === "number" && typeof b.v === "number"
        ? a.v - b.v
        : String(a.v).localeCompare(String(b.v), undefined, { numeric: true });
      return c !== 0 ? sign * c : a.i - b.i;
    })
    .map((x) => x.row);
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const CSV_HEADER = [
  "dataset", "peak", "shape", "status", "error",
  "center", "center_stderr", "fwhm", "fwhm_stderr", "height", "height_stderr", "area", "area_stderr",
  "r_squared", "objective", "ssr", "reduced_ssr", "chi2", "reduced_chi2", "aic", "bic", "n_points",
  "n_warnings", "at_bound", "undetermined", "missing_errors", "warnings",
];

const q = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const num = (v: number | null | undefined): string => (v === null || v === undefined || !Number.isFinite(v) ? "" : String(v));

/** RFC 4180 CSV of the table (every row, in the given order). Missing numbers
 *  are empty cells; `objective` names what the fit minimised ("ssr" or
 *  "chi2", the backend's own word); `chi2`/`reduced_chi2` are empty for an
 *  unweighted fit (there is no χ² to report); `missing_errors` says why each
 *  empty `*_stderr` is empty. */
export function batchCsv(rows: readonly BatchTableRow[]): string {
  const lines = rows.map((r) => {
    const missing = DERIVED.flatMap((k) => (r[k]?.reason ? [`${k}: ${r[k]!.reason}`] : []));
    return [
      q(r.dataset), num(r.peak), q(r.shape ?? ""), r.status, q(r.error ?? ""),
      ...DERIVED.flatMap((k) => [num(r[k]?.value), num(r[k]?.err)]),
      num(r.rSquared), r.objectiveLabel === null ? "" : r.objectiveLabel === "SSR" ? "ssr" : "chi2",
      num(r.ssr), num(r.reducedSsr), num(r.chi2), num(r.reducedChi2), num(r.aic), num(r.bic), num(r.nPoints),
      String(r.warnings.length), q(r.atBound.join("; ")), q(r.undetermined.join("; ")),
      q(missing.join("; ")), q(r.warnings.join(" | ")),
    ].join(",");
  });
  return [CSV_HEADER.join(","), ...lines].join("\n");
}

// ── the derived table (a library dataset) ────────────────────────────────────

export interface BatchProvenance {
  recipeName: string;
  /** The recipe exactly as run (plain JSON), so the table says how it was made. */
  recipe: unknown;
  sources: { id: string; name: string }[];
  ranAt: string;
}

const NUMERIC: [string, (r: BatchTableRow) => number | null][] = [
  ["Peak", (r) => r.peak],
  ...DERIVED.flatMap((k): [string, (r: BatchTableRow) => number | null][] => {
    const name = k === "fwhm" ? "FWHM" : k[0].toUpperCase() + k.slice(1);
    return [[name, (r) => r[k]?.value ?? null], [`${name} SE`, (r) => r[k]?.err ?? null]];
  }),
  ["R²", (r) => r.rSquared],
  ["SSR", (r) => r.ssr],
  ["Reduced SSR", (r) => r.reducedSsr],
  ["χ²", (r) => r.chi2],
  ["Reduced χ²", (r) => r.reducedChi2],
  ["AIC", (r) => r.aic],
  ["BIC", (r) => r.bic],
  ["N points", (r) => r.nPoints],
  ["Warnings", (r) => r.warnings.length],
];

/** The table as a DataStruct for the library (the standard derived-dataset
 *  path: `addDataset` saves it with the workspace). Numbers are channels
 *  (missing = NaN, which a .dwk keeps via lib/nonFiniteCells — so χ² columns
 *  of an unweighted batch are NaN, never an SSR under the wrong name;
 *  `Objective` says which one each fit minimised); the text is
 *  `metadata.text_columns` (lib/columnmeta's read-only worksheet columns);
 *  provenance — the recipe and every source dataset — is `metadata.peakBatch`. */
export function batchDataStruct(rows: readonly BatchTableRow[], prov: BatchProvenance): DataStruct {
  const nan = (v: number | null) => (v === null ? Number.NaN : v);
  return {
    time: rows.map((_, i) => i + 1),
    values: rows.map((r) => NUMERIC.map(([, get]) => nan(get(r)))),
    labels: NUMERIC.map(([label]) => label),
    units: NUMERIC.map(() => ""),
    metadata: {
      source: "peak-batch-fit",
      x_column_name: "Row",
      peakBatch: prov,
      text_columns: {
        Dataset: rows.map((r) => r.dataset),
        Shape: rows.map((r) => r.shape ?? ""),
        Status: rows.map((r) => (r.error ? `${r.status}: ${r.error}` : r.status)),
        Objective: rows.map((r) => r.objectiveLabel ?? ""),
        Flags: rows.map((r) => [
          r.atBound.length ? `at bound: ${r.atBound.join(", ")}` : "",
          r.undetermined.length ? `undetermined: ${r.undetermined.join(", ")}` : "",
        ].filter(Boolean).join("; ")),
        WarningText: rows.map((r) => r.warnings.join(" | ")),
      },
    },
  };
}
