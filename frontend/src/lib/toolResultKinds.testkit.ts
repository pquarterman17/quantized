// Saved Time series, DOE and Profiler results for the result-kind tests
// (owner decision 2026-11-25). Built through the real producers.

import type { ProfileResponse } from "./api/modelEvaluate";
import type { DoeEffectsResponse } from "./api/doe";
import { ANALYSIS_RESULT_VERSION, type AnalysisResult } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { doeMeta } from "./doe";
import { designColumnsOf, doeDesignAnalysisResult, doeEffectsAnalysisResult } from "./doeAnalysisResult";
import { designData } from "./doeTestData";
import { profilerAnalysisResult } from "./profilerAnalysisResult";
import { recordedInputs } from "./resultInputsRecord";
import { timeSeriesAnalysisResult, type TimeSeriesSnapshot } from "./timeSeriesAnalysisResult";
import { fitModelDigest, type ProfilerRecipe, type TimeSeriesRecipe } from "./toolResultKinds";
import type { Dataset } from "./types";

const N = 24;
export const tsSource: Dataset = {
  id: "log", name: "log.dat",
  data: { time: Array.from({ length: N }, (_, i) => i), values: Array.from({ length: N }, (_, i) => [Math.sin(i / 3), i]),
    labels: ["pressure", "index"], units: ["mbar", ""], metadata: { x_column_name: "t" } },
};

export const tsRecipe: TimeSeriesRecipe = { tool: "correlogram", col: 0, allowIrregular: false, options: { nlags: 0, alpha: 0.05 } };

export const tsSnapshot = (source: Dataset = tsSource): TimeSeriesSnapshot => ({
  run: { tab: "correlogram", data: {
    dt: 1, irregular: false, n: N, alpha: 0.05, lags: [0, 1, 2], acf: [1, 0.6, 0.2], pacf: [1, 0.6, -0.1],
    white_noise_band: 0.4, acf_bartlett_band: [null, 0.4, 0.5], pacf_band: 0.4,
    ljung_box: [{ lag: 2, q: 9.5, df: 2, p: 0.009 }],
  } },
  x: source.data.time, y: source.data.values.map((r) => r[0]!), yLabel: "pressure", xName: "t",
});

export const tsResult = (source: Dataset = tsSource): AnalysisResult =>
  timeSeriesAnalysisResult("ts-1", source, tsRecipe, tsSnapshot(source), "2026-11-25T00:00:00Z");

export const designSource = (y?: (number | null)[]): Dataset => ({ id: "design", name: "DOE 2^2", data: designData(y) });
export const designMeta = () => doeMeta(designData())!;
export const SETUP = { design: "full_factorial", k: 2, responseName: "Y", randomize: false, seed: "", replicates: "1",
  factors: [{ name: "A", low: "5", high: "15", unit: "C", levels: "" }, { name: "B", low: "0", high: "2", unit: "", levels: "" }] };

export const designResult = (source: Dataset = designSource()): AnalysisResult => doeDesignAnalysisResult(
  "design-1", source, { setup: SETUP, designColumns: designColumnsOf(source.data, designMeta()) }, designMeta(), "2026-11-25T00:00:00Z");

export const EFFECTS: DoeEffectsResponse = {
  n_runs: 4, pse: 0.75, me: 2.1, sme: 3.4,
  effects: [
    { term: "A (coded)", effect: 6, abs_effect: 6, half_normal_q: 1.15, t_ratio: 8, significant: true },
    { term: "B (coded)", effect: 1, abs_effect: 1, half_normal_q: 0.67, t_ratio: 1.33, significant: false },
    { term: "A (coded)*B (coded)", effect: 0, abs_effect: 0, half_normal_q: 0.32, t_ratio: 0, significant: false },
  ],
};

export const effectsResult = (source: Dataset = designSource([5, 11, 6, 12])): AnalysisResult => doeEffectsAnalysisResult(
  "effects-1", source, { responseLabel: "Y", terms: designMeta().terms_coded }, designMeta(), EFFECTS, "2026-11-25T00:00:00Z");

export const fitSource: Dataset = {
  id: "film", name: "film.csv",
  data: { time: [0, 1, 2, 3, 4, 5], values: [[300, 1], [450, 2], [600, 3], [750, 2], [900, 1], [600, 2]],
    labels: ["T", "y"], units: ["K", ""], metadata: {} },
};

/** A saved Fit Model result as the profiler reads it (`parameters.model`, recipe, fingerprint). */
export const fitResult = (source: Dataset = fitSource): AnalysisResult => ({
  version: ANALYSIS_RESULT_VERSION, id: "fit-1", name: "y fit model · film.csv",
  producer: { id: "fit-model", label: "Fit Model", version: 1 },
  sources: [{ datasetId: source.id, role: "input" }], outputs: [],
  sourceFingerprint: analysisDataFingerprint(source),
  parameters: {
    recipe: { responseCol: 1, terms: [[0]], kinds: { 0: "continuous" }, center: true },
    inputs: recordedInputs([source], { xKey: undefined }),
    model: { response: "y", factors: [{ name: "T", kind: "continuous", mean: 600 }], terms: [["T"]], coefficients: [2, 0.001], ranges: { T: [300, 900] } },
  },
  tables: [{ title: "Summary of fit", columns: ["statistic", "value"], rows: [["RSquare", 0.5]] }],
  warnings: [], createdAt: "2026-11-25T00:00:00Z",
});

export const PROFILE: ProfileResponse = {
  response: "y", alpha: 0.05, t_crit: 2.78, df_error: 4, rmse: 0.5,
  current: { settings: { T: 600 }, predicted: 2.6, se: 0.2, lower: 2.04, upper: 3.16 },
  factors: [{ name: "T", kind: "continuous", x: [300, 600, 900], range: [300, 900], predicted: [2.3, 2.6, 2.9],
    se: [0.3, 0.2, 0.3], lower: [1.5, 2.04, 2.1], upper: [3.1, 3.16, 3.7] }],
};

export const profilerRecipeOf = (fit: AnalysisResult): ProfilerRecipe => ({
  fitResultId: fit.id, fitDigest: fitModelDigest(fit), settings: { T: 600 }, alpha: 0.05, goal: null,
});

export const profileResult = (fit: AnalysisResult = fitResult()): AnalysisResult =>
  profilerAnalysisResult("profile-1", fit, profilerRecipeOf(fit), PROFILE, "2026-11-25T00:00:00Z");
