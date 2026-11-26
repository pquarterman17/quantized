import { channelModelingType, isCategorical } from "./modeling";
import { canRenderMap, MAP_GATE_CHECKING, mapGateResolved } from "./mapdata";
import { EXTRA_REQUIREMENTS } from "./analysisExtraRequirements";
import { techniqueOf } from "./techniqueDefaults";
import type { Dataset, Technique } from "./types";
import type { Action } from "../store/commands";

export const ANALYSIS_CATEGORIES = [
  "Fit",
  "Peaks & baseline",
  "Signal processing",
  "Statistics",
  "XRD & reflectivity",
  "Magnetometry",
  "SIMS",
  "Data preparation",
] as const;

export type AnalysisCategory = (typeof ANALYSIS_CATEGORIES)[number];
export type Requirement = "none" | "dataset" | "continuous" | "two-continuous" | "three-continuous" | "variability" | "map";

export interface AnalysisToolMetadata {
  category: AnalysisCategory;
  requiredInputs: string;
  requirement: Requirement;
  techniques?: readonly Technique[];
  recommendedFor?: readonly Technique[];
}

const GENERAL_RECOMMENDED: readonly Technique[] = ["generic", "transport", "spectroscopy"];

/** Discovery metadata only. The canonical Action remains the sole launch
 * authority, so the Analysis Center cannot drift into a second tool registry. */
export const ANALYSIS_TOOL_METADATA: Readonly<Record<string, AnalysisToolMetadata>> = {
  curvefit: { category: "Fit", requiredInputs: "one numeric response and an x axis", requirement: "continuous", recommendedFor: GENERAL_RECOMMENDED },
  "surface-fit": { category: "Fit", requiredInputs: "X, Y and Z columns: a map or a long-form XYZ table", requirement: "three-continuous" },
  "optical-gap": { category: "Fit", requiredInputs: "an energy or wavelength column and an absorption or transmittance column", requirement: "continuous", recommendedFor: ["spectroscopy"] },
  "curve-measure": { category: "Peaks & baseline", requiredInputs: "an X column and one or two Y columns", requirement: "continuous" },
  "ellipse-fit": { category: "Fit", requiredInputs: "two columns of points tracing an ellipse", requirement: "two-continuous" },
  hysteresis: { category: "Magnetometry", requiredInputs: "a magnetometry field sweep and response", requirement: "continuous", techniques: ["magnetometry.mvsh", "magnetometry.mvst"], recommendedFor: ["magnetometry.mvsh", "magnetometry.mvst"] },
  magtools: { category: "Magnetometry", requiredInputs: "magnetometry data and sample or unit context", requirement: "continuous", techniques: ["magnetometry.mvsh", "magnetometry.mvst"], recommendedFor: ["magnetometry.mvsh", "magnetometry.mvst"] },
  peaks: { category: "Peaks & baseline", requiredInputs: "one numeric signal with at least three rows", requirement: "continuous", recommendedFor: ["xrd.powder", "spectroscopy"] },
  baseline: { category: "Peaks & baseline", requiredInputs: "one numeric signal with at least three rows", requirement: "continuous", recommendedFor: ["xrd.powder", "spectroscopy"] },
  "peak-wizard": { category: "Peaks & baseline", requiredInputs: "one numeric signal with at least three rows", requirement: "continuous", recommendedFor: ["xrd.powder", "spectroscopy"] },
  // Lab XRR line scans arrive through XRDML/Bruker RAW as xrd.powder; keep
  // these explicit tools available without recommending them for powder XRD.
  reflectivity: { category: "XRD & reflectivity", requiredInputs: "a reflectometry curve", requirement: "continuous", techniques: ["reflectometry", "xrd.powder"], recommendedFor: ["reflectometry"] },
  reflview: { category: "XRD & reflectivity", requiredInputs: "reflectometry data plus a model or SLD profile", requirement: "continuous", techniques: ["reflectometry", "xrd.powder"], recommendedFor: ["reflectometry"] },
  rsm: { category: "XRD & reflectivity", requiredInputs: "a 2-D reciprocal-space map", requirement: "map", techniques: ["xrd.rsm"], recommendedFor: ["xrd.rsm"] },
  "map-ops": { category: "Data preparation", requiredInputs: "a 2-D map (RSM, contour or image map); a second map for map arithmetic", requirement: "map" },
  "roi-cuts": { category: "XRD & reflectivity", requiredInputs: "a 2-D map with x, y, and intensity columns", requirement: "map", techniques: ["xrd.rsm"], recommendedFor: ["xrd.rsm"] },
  "reductions-wh": { category: "XRD & reflectivity", requiredInputs: "powder XRD peak positions and widths", requirement: "continuous", techniques: ["xrd.powder"], recommendedFor: ["xrd.powder"] },
  "reductions-pawley": { category: "XRD & reflectivity", requiredInputs: "a powder XRD pattern and starting unit cell", requirement: "continuous", techniques: ["xrd.powder"], recommendedFor: ["xrd.powder"] },
  "reductions-reference": { category: "XRD & reflectivity", requiredInputs: "a powder XRD pattern and a trusted 2θ/intensity reference file", requirement: "continuous", techniques: ["xrd.powder"], recommendedFor: ["xrd.powder"] },
  "signal-processing": { category: "Signal processing", requiredInputs: "one numeric signal with at least three rows", requirement: "continuous", recommendedFor: GENERAL_RECOMMENDED },
  "average-curves": { category: "Signal processing", requiredInputs: "two or more datasets sharing an x axis and a y column", requirement: "continuous" },
  "reductions-fft": { category: "Signal processing", requiredInputs: "a numeric fringe signal", requirement: "continuous", recommendedFor: ["reflectometry"] },
  "reductions-reflfft": { category: "Signal processing", requiredInputs: "an X-ray or neutron reflectivity curve", requirement: "continuous", techniques: ["reflectometry", "xrd.powder"], recommendedFor: ["reflectometry"] },
  sims: { category: "SIMS", requiredInputs: "a SIMS depth profile", requirement: "continuous", techniques: ["sims"], recommendedFor: ["sims"] },
  distribution: { category: "Statistics", requiredInputs: "one numeric column; an optional grouping column", requirement: "continuous", recommendedFor: GENERAL_RECOMMENDED },
  multivar: { category: "Statistics", requiredInputs: "at least two numeric columns", requirement: "two-continuous", recommendedFor: GENERAL_RECOMMENDED },
  "variability-chart": { category: "Statistics", requiredInputs: "one numeric response and two categorical factors", requirement: "variability" },
  "stats-chooser": { category: "Statistics", requiredInputs: "the columns that describe your statistical question", requirement: "dataset", recommendedFor: GENERAL_RECOMMENDED },
  "stats-tests": { category: "Statistics", requiredInputs: "one or more analysis columns", requirement: "dataset" },
  // Direct launchers for the SPC and life tests (UX menus audit M3): Statistical tests, pre-selected.
  "quality-control-chart": { category: "Statistics", requiredInputs: "a data or count column, optionally a subgroup column", requirement: "dataset" },
  "quality-capability": { category: "Statistics", requiredInputs: "a numeric column and its specification limits", requirement: "dataset" },
  "quality-life-distribution": { category: "Statistics", requiredInputs: "a failure-time column and a 0/1 censor column", requirement: "dataset" },
  "outlier-screening": { category: "Statistics", requiredInputs: "one numeric column", requirement: "continuous" },
  "spectro-extras": { category: "Peaks & baseline", requiredInputs: "spectra as columns against an X column (self-deconvolution needs an even X; 2-D correlation needs 3 or more spectra)", requirement: "continuous", recommendedFor: ["spectroscopy"] },
  "time-series": { category: "Statistics", requiredInputs: "one numeric column sampled at an evenly spaced X, with no blanks", requirement: "continuous" },
  "fit-y-by-x": { category: "Statistics", requiredInputs: "an X column and a Y column", requirement: "dataset", recommendedFor: GENERAL_RECOMMENDED },
  doe: { category: "Statistics", requiredInputs: "no worksheet required to generate; a design worksheet to analyze", requirement: "none" },
  "fit-model": { category: "Statistics", requiredInputs: "a numeric response and one or more factor columns", requirement: "dataset" },
  profiler: { category: "Statistics", requiredInputs: "a fitted Fit Model result (open from Fit Model or saved)", requirement: "none" },
  calculators: { category: "Data preparation", requiredInputs: "no worksheet required", requirement: "none" },
  digitizer: { category: "Data preparation", requiredInputs: "a plot image to calibrate and trace", requirement: "none" },
};

export interface AnalysisTool {
  action: Action;
  category: AnalysisCategory;
  requiredInputs: string;
  datasetRequired: boolean;
  available: boolean;
  unavailableReason?: string;
  recommended: boolean;
  searchText: string;
}

export function dimensions(dataset: Dataset): { rows: number; columns: number; numericColumns: number; numericResponses: number } {
  const rows = dataset.pending?.rows ?? Math.max(dataset.data.time.length, dataset.data.values.length);
  // Every analysis selector exposes the x/time column as index -1. Count it
  // when populated so X + one response correctly enables multivariate work.
  let numericResponses = 0;
  dataset.data.labels.forEach((_label, index) => {
    if (!isCategorical(channelModelingType(dataset, index))) numericResponses += 1;
  });
  const hasX = dataset.data.time.length > 0;
  return {
    rows,
    columns: dataset.data.labels.length + (hasX ? 1 : 0),
    numericColumns: numericResponses + (hasX ? 1 : 0),
    numericResponses,
  };
}

function compatibility(id: string, meta: AnalysisToolMetadata, dataset: Dataset | undefined, datasets: readonly Dataset[]): { available: boolean; reason?: string } {
  if (meta.requirement === "none") return { available: true };
  if (!dataset) return { available: false, reason: "Select a worksheet first." };
  const technique = techniqueOf(dataset);
  if (technique !== "generic" && meta.techniques && !meta.techniques.includes(technique)) {
    const declared = technique.replaceAll(".", " ");
    return { available: false, reason: `This tool needs ${meta.requiredInputs}; the active worksheet is ${declared}.` };
  }

  const size = dimensions(dataset);
  if (size.rows < 2) return { available: false, reason: "At least two data rows are required." };
  if (meta.requirement !== "dataset" && size.rows < 3) return { available: false, reason: "At least three data rows are required." };
  if (meta.requirement === "continuous" && size.numericResponses < 1) return { available: false, reason: "No numeric response column is available." };
  if (meta.requirement === "three-continuous" && size.numericColumns < 3) return { available: false, reason: "At least three numeric columns (X, Y and Z) are required." };
  if (meta.requirement === "two-continuous" && size.numericColumns < 2) return { available: false, reason: "At least two numeric columns are required." };
  if (meta.requirement === "variability" && (size.numericColumns < 1 || size.columns < 3)) {
    return { available: false, reason: "Choose data with one numeric response and two factor columns." };
  }
  if (meta.requirement === "map") {
    if (!canRenderMap(dataset.data) && !mapGateResolved(dataset.data)) return { available: false, reason: MAP_GATE_CHECKING };
    if (!canRenderMap(dataset.data)) return { available: false, reason: "A 2-D map with x, y, and intensity columns is required." };
  }
  // Worksheet-count and 2θ checks live in the shared predicate table the
  // Analyze menu and palette read (lib/analysisExtraRequirements.ts).
  for (const predicate of EXTRA_REQUIREMENTS[id] ?? []) {
    const reason = predicate({ dataset, datasets });
    if (reason) return { available: false, reason: `${reason}.` };
  }
  return { available: true };
}

/** `datasets` is every worksheet in the project (the "2 or more worksheets"
 *  check); omitted, it defaults to just the active one. */
export function analysisTools(actions: readonly Action[], dataset: Dataset | undefined, datasets: readonly Dataset[] = dataset ? [dataset] : []): AnalysisTool[] {
  const technique = techniqueOf(dataset);
  return actions.flatMap((action) => {
    const meta = ANALYSIS_TOOL_METADATA[action.id];
    if (!meta) return [];
    const state = compatibility(action.id, meta, dataset, datasets);
    const commandDisabled = state.available && (typeof action.disabled === "function" ? action.disabled() : action.disabled === true);
    const commandReason = typeof action.disabledReason === "function" ? action.disabledReason() : action.disabledReason;
    const available = state.available && !commandDisabled;
    const unavailableReason = state.reason ?? (commandDisabled ? commandReason ?? "This command is currently unavailable." : undefined);
    return [{
      action,
      category: meta.category,
      requiredInputs: meta.requiredInputs,
      datasetRequired: meta.requirement !== "none",
      available,
      ...(unavailableReason ? { unavailableReason } : {}),
      recommended: available && Boolean(meta.recommendedFor?.includes(technique)),
      searchText: [action.label, action.description, action.keywords, meta.category, meta.requiredInputs].filter(Boolean).join(" ").toLocaleLowerCase(),
    }];
  });
}

export function matchesAnalysisSearch(tool: AnalysisTool, query: string): boolean {
  return query.trim().split(/\s+/).every((term) => tool.searchText.includes(term.toLocaleLowerCase()));
}
