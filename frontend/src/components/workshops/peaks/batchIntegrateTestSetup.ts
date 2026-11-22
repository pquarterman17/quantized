// Store fields a batch-table commit test resets between cases (lane RL2): the
// shared commit writes a Library result and an undo entry, and stale marking
// reads the recalc mode.
export const analysisResultsReset = {
  analysisResults: [], history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual" as const, status: "",
};
