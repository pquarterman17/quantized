// Which tool windows are layout windows (WORKSPACE_LAYOUT_PLAN P4, D1/D7):
// the analysis tools, by their `ToolWindow` `id`, each with the Analyze
// commands (lib/analysisCenter.ts ANALYSIS_TOOL_METADATA ids) that open it.
// Every other ToolWindow (Trash, Search, Pack project, a result panel, ...)
// keeps its classic floating frame in windows mode: D1 makes ANALYSIS tools
// windows, and a panel that is not one stays as it was (fail closed).
//
// PINNABLE: the tools whose whole input path reads the shared analysis
// selection (components/workshops/analysisselection/useToolAnalysisSelection)
// through the resolver precedence (lib/analysisInputs.ts): a reviewed
// selection item wins over the active worksheet, and a deleted one refuses.
// Pinning one of them freezes that item on a dataset. Any other tool reads the
// focused plot directly, so a pin could not hold: it follows, and says so.

/** Tool-window id -> the Analyze command ids that open it. */
export const LAYOUT_TOOLS: Readonly<Record<string, readonly string[]>> = {
  curvefit: ["curvefit"],
  "surface-fit": ["surface-fit"],
  "optical-gap": ["optical-gap"],
  "ellipse-fit": ["ellipse-fit"],
  hysteresis: ["hysteresis"],
  magtools: ["magtools"],
  peaks: ["peaks"],
  baseline: ["baseline"],
  peakwizard: ["peak-wizard"],
  reflectivity: ["reflectivity"],
  reflview: ["reflview"],
  rsm: ["rsm"],
  "roi-cuts": ["roi-cuts"],
  reductions: ["reductions-wh", "reductions-pawley", "reductions-reference", "reductions-fft", "reductions-reflfft"],
  "signal-processing": ["signal-processing"],
  datasetmath: ["average-curves"],
  sims: ["sims"],
  distribution: ["distribution"],
  multivar: ["multivar"],
  variability: ["variability-chart"],
  statschooser: ["stats-chooser"],
  "stats-tests": ["stats-tests"],
  "outlier-screening": ["outlier-screening"],
  "fit-y-by-x": ["fit-y-by-x"],
  calculators: ["calculators"],
};

/** Every layout tool id (the saved-layout sanitizer's `toolIds`). */
export const LAYOUT_TOOL_IDS: ReadonlySet<string> = new Set(Object.keys(LAYOUT_TOOLS));

/** Tools whose input can be pinned to a dataset (header). */
export const PINNABLE_TOOLS: ReadonlySet<string> = new Set(["curvefit", "peaks", "hysteresis"]);

export const isLayoutTool = (id: string): boolean => LAYOUT_TOOL_IDS.has(id);

/** The tool window an Analyze command opens, or null when it opens none. */
export function toolWindowOf(actionId: string): string | null {
  for (const [id, actions] of Object.entries(LAYOUT_TOOLS)) if (actions.includes(actionId)) return id;
  return null;
}

/** Why a tool cannot be pinned (one sentence), or null when it can. */
export function pinRefusal(id: string, title: string): string | null {
  return PINNABLE_TOOLS.has(id) ? null : `${title} reads the focused plot directly, so it follows the plot and cannot be pinned yet.`;
}
