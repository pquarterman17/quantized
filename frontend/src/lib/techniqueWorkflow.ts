import type { Dataset, Technique } from "./types";

export type TechniqueActionId =
  | "quick-plot"
  | "configure-figure"
  | "sims-process"
  | "sims-compare"
  | "sims-region"
  | "curvefit"
  | "hysteresis"
  | "magtools"
  | "reflectivity"
  | "reflview"
  | "baseline"
  | "rsm"
  | "roi-cuts"
  | "reductions-wh"
  | "reductions-pawley"
  | "reductions-fft"
  | "reductions-reflfft"
  | "stats-chooser"
  | "data-filter"
  | "graph-builder"
  | "pipeline"
  | "plot-recipe-manager"
  | "peak-wizard";

export interface TechniqueWorkflowStage {
  title: string;
  description: string;
  actions: readonly TechniqueActionId[];
}

export interface TechniqueWorkflow {
  label: string;
  summary: string;
  stages: readonly TechniqueWorkflowStage[];
}

const finish = (): TechniqueWorkflowStage => ({
  title: "Build and reuse",
  description: "Polish the result, then preserve a repeatable workflow.",
  actions: ["graph-builder", "pipeline", "plot-recipe-manager"],
});

const inspect = (): TechniqueWorkflowStage => ({
  title: "Inspect",
  description: "Verify the imported columns and create a safe first figure.",
  actions: ["quick-plot", "configure-figure"],
});

export const TECHNIQUE_WORKFLOWS: Record<Technique, TechniqueWorkflow> = {
  sims: {
    label: "SIMS depth profile",
    summary: "Calibrate depth, process species signals, compare profiles, and measure regions.",
    stages: [
      inspect(),
      { title: "Process", description: "Calibrate depth and apply traceable signal corrections.", actions: ["sims-process"] },
      { title: "Compare and measure", description: "Compare species or quantify a selected depth region.", actions: ["sims-compare", "sims-region"] },
      finish(),
    ],
  },
  "xrd.powder": {
    label: "Powder XRD",
    summary: "Prepare a diffraction pattern, fit peaks, and derive structure or broadening results.",
    stages: [
      inspect(),
      { title: "Prepare and fit peaks", description: "Remove background and use the guided peak workflow.", actions: ["baseline", "peak-wizard"] },
      { title: "Reduce", description: "Estimate crystallite size or refine the unit cell.", actions: ["reductions-wh", "reductions-pawley"] },
      finish(),
    ],
  },
  "xrd.rsm": {
    label: "XRD reciprocal-space map",
    summary: "Extract defensible cuts and quantify strain or relaxation from a 2-D map.",
    stages: [
      inspect(),
      { title: "Extract", description: "Turn a chosen map region into a quantitative 1-D cut.", actions: ["roi-cuts"] },
      { title: "Analyze", description: "Locate film and substrate peaks and calculate strain and relaxation.", actions: ["rsm"] },
      finish(),
    ],
  },
  reflectometry: {
    label: "Reflectometry",
    summary: "Inspect reflectivity, model the layer stack, and extract thickness information.",
    stages: [
      inspect(),
      { title: "Model", description: "Fit a layer model and inspect measured, modeled, and SLD views.", actions: ["reflectivity", "reflview"] },
      { title: "Estimate thickness", description: "Use reflectivity-aware or general fringe-frequency analysis.", actions: ["reductions-reflfft", "reductions-fft"] },
      finish(),
    ],
  },
  "magnetometry.mvsh": {
    label: "Magnetization vs field",
    summary: "Correct units and background, then extract hysteresis-loop properties.",
    stages: [
      inspect(),
      { title: "Prepare", description: "Convert magnetic units or subtract a linear background.", actions: ["magtools"] },
      { title: "Analyze", description: "Extract coercivity, remanence, saturation, and loop metrics.", actions: ["hysteresis", "curvefit"] },
      finish(),
    ],
  },
  "magnetometry.mvst": {
    label: "Magnetization vs temperature",
    summary: "Standardize magnetic units, inspect temperature dependence, and fit a model.",
    stages: [
      inspect(),
      { title: "Prepare", description: "Convert field or moment units using the sample context.", actions: ["magtools"] },
      { title: "Analyze", description: "Fit the temperature-dependent response with a chosen model.", actions: ["curvefit"] },
      finish(),
    ],
  },
  transport: {
    label: "Transport",
    summary: "Select the relevant rows, fit transport behavior, and preserve a reusable result.",
    stages: [
      inspect(),
      { title: "Prepare", description: "Narrow the analysis view without deleting source rows.", actions: ["data-filter"] },
      { title: "Analyze", description: "Fit the selected response or use the guided test chooser.", actions: ["curvefit", "stats-chooser"] },
      finish(),
    ],
  },
  spectroscopy: {
    label: "Spectroscopy",
    summary: "Correct the baseline, resolve peaks, and fit spectral features.",
    stages: [
      inspect(),
      { title: "Prepare and find peaks", description: "Estimate background and use the guided peak workflow.", actions: ["baseline", "peak-wizard"] },
      { title: "Fit", description: "Fit a selected spectral model and inspect residuals.", actions: ["curvefit"] },
      finish(),
    ],
  },
  generic: {
    label: "General data",
    summary: "Quantized could not identify a technique, so it will not guess a scientific workflow.",
    stages: [
      { title: "Choose the plot", description: "Assign columns explicitly, or use Quick Plot only when the structure is recognized.", actions: ["configure-figure", "quick-plot", "graph-builder"] },
      { title: "Prepare and analyze", description: "Filter rows or choose a general fit or statistical test.", actions: ["data-filter", "curvefit", "stats-chooser"] },
      { title: "Reuse", description: "Inspect recorded steps and save a reusable plot recipe.", actions: ["pipeline", "plot-recipe-manager"] },
    ],
  },
};

export function workflowArtifacts(ds: Dataset, hasFigure: boolean, hasReport: boolean): string[] {
  const out: string[] = [];
  if (hasFigure) out.push("Editable figure");
  if (ds.peakTable) out.push("Peak table");
  if (ds.fitSpec) out.push("Fit result");
  if (ds.reflFits?.length) out.push(`${ds.reflFits.length} reflectivity fit${ds.reflFits.length === 1 ? "" : "s"}`);
  if (hasReport) out.push("Linked report");
  return out;
}
