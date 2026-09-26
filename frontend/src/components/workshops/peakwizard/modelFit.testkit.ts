// Test fixture (not shipped: imported by tests only): a `/api/peaks/model-fit`
// response for two peaks — p0 a pseudo-Voigt whose eta ended on a bound,
// p1 a gaussian with a fixed centre and its FWHM tied to p0's — plus a fixed
// constant background. `over` patches the top level; `metrics` merges.

import type { PeakModelFitResponse } from "../../../lib/api/peaks";
import type { PeakTable } from "../../../lib/peakTable";
import { modelFitDraft, type ModelFitDraftOptions, type PublishableFit } from "./modelFitPublish";
import { assembleModelFitTable, type TableStamp } from "./modelFitPublishRun";

type Over = Partial<Omit<PeakModelFitResponse, "metrics">> & {
  metrics?: Partial<PeakModelFitResponse["metrics"]>;
};

const p = (name: string, value: number, stderr: number | null, extra: Record<string, unknown> = {}) => ({
  name, value, stderr, vary: true, tie: null as string | null, at_bound: false, ...extra,
});

export function modelFitResponse(over: Over = {}): PeakModelFitResponse {
  const { metrics, ...rest } = over;
  const x = [0, 1, 2, 3, 4, 5];
  return {
    parameters: [
      p("p0.center", 2.01, 0.004),
      p("p0.height", 5.2, 0.05),
      p("p0.fwhm", 0.81, 0.01),
      p("p0.eta", 1, null, { at_bound: true }),
      p("p1.center", 4, null, { vary: false }),
      p("p1.height", 2.1, 0.04),
      p("p1.fwhm", 0.81, 0.01, { vary: false, tie: "p0.fwhm" }),
      p("bg.c0", 0.5, null, { vary: false }),
    ],
    free: ["p0.center", "p0.height", "p0.fwhm", "p0.eta", "p1.height"],
    correlation: [],
    peaks: [
      { id: "p0", shape: "pseudo_voigt", center: 2.01, center_stderr: 0.004, height: 5.2, height_stderr: 0.05,
        fwhm: 0.81, fwhm_stderr: 0.01, area: 5.9, area_stderr: null },
      { id: "p1", shape: "gaussian", center: 4, center_stderr: null, height: 2.1, height_stderr: 0.04,
        fwhm: 0.81, fwhm_stderr: 0.01, area: 1.81, area_stderr: 0.03 },
    ],
    background: { kind: "constant", x_ref: 2.5 },
    weighted: false,
    metrics: {
      objective: "ssr", n_points: 6, n_free: 5, dof: 1, ssr: 0.012, reduced_ssr: 0.012,
      chi2: null, reduced_chi2: null, r_squared: 0.998, adj_r_squared: 0.99, aic: -30.1, bic: -31.2,
      ...metrics,
    },
    success: true,
    message: "`ftol` termination condition is satisfied.",
    n_evaluations: 40,
    x_range: [0, 5],
    n_dropped: 0,
    n_excluded: 0,
    curves: {
      x, y: [0.5, 1, 5.7, 1.2, 2.6, 0.6], y_err: null,
      model: [0.52, 1.1, 5.69, 1.15, 2.6, 0.61],
      background: x.map(() => 0.5),
      components: [[0.02, 0.6, 5.19, 0.6, 0.05, 0.01], [0, 0, 0.01, 0.05, 2.1, 0.1]],
      residual: [-0.02, -0.1, 0.01, 0.05, 0, -0.01],
      normalized_residual: null,
    },
    warnings: ["parameters ended on a bound (errors not reported): p0.eta"],
    ...rest,
  };
}

/** The durable table a publish of `res` would write, without the store:
 *  draft (./modelFitPublish) + assembly (./modelFitPublishRun). */
export function modelFitTable(
  res: PublishableFit,
  source: TableStamp & ModelFitDraftOptions,
  prior?: PeakTable | null,
): PeakTable {
  return assembleModelFitTable(modelFitDraft(res, source), source, prior);
}
