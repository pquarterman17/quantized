// PLS / LDA / spectra PCA tab of the Multivariate workshop (GAP_AUDIT_9 G12):
// the option model, the input checks that fail closed before a request is
// sent, and the dispatch to the three backend routes (routes/stats_multivar_ext.py).
// Pure apart from the API call.

import {
  statsLda, statsPcaSpectra, statsPls,
  type LdaResult, type PlsPreprocess, type PlsResult, type SpectraPcaResult,
} from "../../../../lib/api/multivarExt";
import { listwiseCompleteWithIndices, multivarColumnValues, transposeRows } from "../../../../lib/multivar";
import type { DataStruct } from "../../../../lib/types";

export type ExtTool = "pls" | "lda" | "spectra";
export const EXT_TOOLS: readonly { id: ExtTool; label: string }[] = [
  { id: "pls", label: "PLS" },
  { id: "lda", label: "LDA" },
  { id: "spectra", label: "Spectra PCA" },
];

export interface ExtOptions {
  pls: {
    /** "cols": each selected column is a predictor. "spectra": each selected column is one sample's spectrum. */
    orientation: "cols" | "spectra";
    y: number[];
    /** Spectra orientation: one response value per selected column, in column order. */
    yText: string;
    preprocess: PlsPreprocess;
    maxComp: number;
    /** 0 = choose by cross-validation (smallest PRESS). */
    fixed: number;
    folds: number;
    seed: number;
  };
  lda: { classCol: number; priors: "empirical" | "equal"; cvFolds: number; seed: number };
  spectra: { center: boolean; scale: boolean };
}

export const DEFAULT_EXT_OPTIONS: ExtOptions = {
  pls: { orientation: "cols", y: [], yText: "", preprocess: "center", maxComp: 10, fixed: 0, folds: 7, seed: 0 },
  lda: { classCol: -2, priors: "empirical", cvFolds: 5, seed: 0 },
  spectra: { center: true, scale: false },
};

export type ExtResult =
  | { tool: "pls"; data: PlsResult }
  | { tool: "lda"; data: LdaResult }
  | { tool: "spectra"; data: SpectraPcaResult };

/** What a run read: the rows kept, their worksheet positions and the names of the variables / observations. */
export interface ExtMeta {
  /** 1-based worksheet rows of the complete rows (the X grid rows for spectra). */
  sourceRows: number[];
  dropped: number;
  /** Predictors (PLS columns / LDA variables), or the grid x of a spectrum. */
  varLabels: string[];
  varX: number[];
  /** PLS responses; LDA class column; spectra column names. */
  yLabels: string[];
  obsLabels: string[];
  classLabel: string;
}

type Request =
  | { tool: "pls"; body: Parameters<typeof statsPls>[0] }
  | { tool: "lda"; body: Parameters<typeof statsLda>[0] }
  | { tool: "spectra"; body: Parameters<typeof statsPcaSpectra>[0] };

export type Prepared = { problem: string } | { problem: null; request: Request; meta: ExtMeta };

const isInt = (v: number, lo: number, hi: number): boolean => Number.isInteger(v) && v >= lo && v <= hi;

export function parseNumberList(text: string): number[] {
  return text.split(/[\s,;]+/).filter((s) => s !== "").map(Number);
}

function complete(data: DataStruct, cols: readonly number[]) {
  const got = listwiseCompleteWithIndices(cols.map((c) => multivarColumnValues(data, c)));
  return { rows: got.rows, rowIndices: got.rowIndices, dropped: data.time.length - got.rows.length };
}

/** Everything a run needs from the worksheet, or the reason it cannot start. */
export function prepareExt(
  tool: ExtTool, data: DataStruct, selected: readonly number[], rowIds: readonly number[] | null,
  labelOf: (col: number) => string, o: ExtOptions,
): Prepared {
  const src = (idx: number[]) => idx.map((r) => (rowIds?.[r] ?? r) + 1);
  const meta = (m: Partial<ExtMeta> & Pick<ExtMeta, "sourceRows" | "dropped">): ExtMeta =>
    ({ varLabels: [], varX: [], yLabels: [], obsLabels: [], classLabel: "", ...m });

  if (tool === "pls") {
    const p = o.pls;
    if (!isInt(p.maxComp, 1, 50)) return { problem: "Maximum components must be a whole number from 1 to 50." };
    if (!isInt(p.fixed, 0, 50)) return { problem: "Fixed components must be 0 (choose by cross-validation) or a whole number up to 50." };
    if (!isInt(p.folds, 2, 100)) return { problem: "Folds must be a whole number from 2 to 100." };
    if (!Number.isInteger(p.seed)) return { problem: "Seed must be a whole number." };
    if (p.orientation === "cols") {
      const yCols = p.y;
      const xCols = selected.filter((c) => !yCols.includes(c));
      if (!yCols.length) return { problem: "Pick at least one response (Y) column." };
      if (!xCols.length) return { problem: "Select at least one predictor column in the list above (other than the responses)." };
      const c = complete(data, [...xCols, ...yCols]);
      if (c.rows.length < 4) return { problem: `Only ${c.rows.length} complete rows; PLS needs at least 4.` };
      if (p.folds > c.rows.length) return { problem: `Folds (${p.folds}) exceed the ${c.rows.length} complete rows.` };
      const xs = c.rows.map((r) => r.slice(0, xCols.length));
      const ys = c.rows.map((r) => r.slice(xCols.length));
      return { problem: null, request: { tool, body: {
        x: xs, y: ys, max_components: p.maxComp, folds: p.folds, seed: p.seed, preprocess: p.preprocess,
        ...(p.fixed > 0 ? { n_components: p.fixed } : {}),
      } }, meta: meta({ sourceRows: src(c.rowIndices), dropped: c.dropped, varLabels: xCols.map(labelOf),
        varX: xCols.map((_, i) => i + 1), yLabels: yCols.map(labelOf) }) };
    }
    if (selected.length < 4) return { problem: "Spectra orientation: select at least 4 spectra (columns), one per calibration sample." };
    const y = parseNumberList(p.yText);
    if (y.length !== selected.length || y.some((v) => !Number.isFinite(v))) {
      return { problem: `Enter ${selected.length} finite response values (one per selected column, in column order); got ${y.length}.` };
    }
    if (p.folds > selected.length) return { problem: `Folds (${p.folds}) exceed the ${selected.length} spectra.` };
    const c = complete(data, selected);
    if (c.rows.length < 2) return { problem: "Fewer than 2 rows are finite in every selected spectrum." };
    return { problem: null, request: { tool, body: {
      x: transposeRows(c.rows), y: y.map((v) => [v]), max_components: p.maxComp, folds: p.folds, seed: p.seed,
      preprocess: p.preprocess, ...(p.fixed > 0 ? { n_components: p.fixed } : {}),
    } }, meta: meta({ sourceRows: src(c.rowIndices), dropped: c.dropped,
      varLabels: c.rowIndices.map((r) => String(data.time[r])), varX: c.rowIndices.map((r) => data.time[r]),
      yLabels: ["Y"], obsLabels: selected.map(labelOf) }) };
  }

  if (tool === "lda") {
    const l = o.lda;
    if (l.classCol < -1) return { problem: "Pick the class column." };
    const xCols = selected.filter((c) => c !== l.classCol);
    if (!xCols.length) return { problem: "Select at least one variable column (other than the class column)." };
    if (l.cvFolds !== 0 && !isInt(l.cvFolds, 2, 100)) return { problem: "CV folds must be 0 (none) or a whole number from 2 to 100." };
    const c = complete(data, [...xCols, l.classCol]);
    if (c.rows.length < 4) return { problem: `Only ${c.rows.length} complete rows.` };
    const labels = c.rows.map((r) => r[xCols.length]);
    const distinct = new Set(labels).size;
    if (distinct < 2) return { problem: "The class column has a single value; LDA needs at least two classes." };
    if (distinct > Math.min(20, Math.floor(c.rows.length / 2))) {
      return { problem: `The class column has ${distinct} distinct values; pick a categorical column (at most 20 classes, at least 2 rows each).` };
    }
    return { problem: null, request: { tool, body: {
      x: c.rows.map((r) => r.slice(0, xCols.length)), labels, priors: l.priors, cv_folds: l.cvFolds, seed: l.seed,
    } }, meta: meta({ sourceRows: src(c.rowIndices), dropped: c.dropped, varLabels: xCols.map(labelOf),
      varX: xCols.map((_, i) => i + 1), classLabel: labelOf(l.classCol) }) };
  }

  if (selected.length < 2) return { problem: "Select at least 2 columns: each selected column is one spectrum on the worksheet's X grid." };
  const c = complete(data, selected);
  if (c.rows.length < 3) return { problem: "Fewer than 3 rows are finite in every selected spectrum." };
  const grid = c.rowIndices.map((r) => data.time[r]);
  return { problem: null, request: { tool, body: {
    spectra_x: selected.map(() => grid), spectra_y: transposeRows(c.rows), center: o.spectra.center, scale: o.spectra.scale,
  } }, meta: meta({ sourceRows: src(c.rowIndices), dropped: c.dropped, varLabels: grid.map(String), varX: grid,
    obsLabels: selected.map(labelOf) }) };
}

export async function runExt(req: Request): Promise<ExtResult> {
  if (req.tool === "pls") return { tool: "pls", data: await statsPls(req.body) };
  if (req.tool === "lda") return { tool: "lda", data: await statsLda(req.body) };
  return { tool: "spectra", data: await statsPcaSpectra(req.body) };
}
