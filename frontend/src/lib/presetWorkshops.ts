// The preset tools this build knows (plans/PRESET_BAR_CONTRACT.md sections 6 and
// 9): id, label, settings schema and run button, as plain data. The Recipe
// Library listing and the preset file read it SYNCHRONOUSLY (a list row needs
// the tool's name and whether its schema is newer than this build's); the
// adapters themselves load lazily through
// components/workshops/presets/presetRegistry.ts, and a test pins every row
// here against its real adapter so the two cannot drift. A new preset adapter
// adds its row here AND its loader there (the registry test fails otherwise).

export interface PresetWorkshopInfo {
  label: string;
  /** The adapter's settings schema. */
  schema: number;
  runLabel: string;
  /** False for tools whose presets live in a legacy store (fit templates, peak recipes): already listed under their own recipe kind. */
  generic: boolean;
}

export const PRESET_WORKSHOPS: Readonly<Record<string, PresetWorkshopInfo>> = {
  baseline: { label: "Baseline", schema: 1, runLabel: "Estimate", generic: true },
  curvefit: { label: "Curve Fit", schema: 1, runLabel: "Fit", generic: false },
  distribution: { label: "Distribution", schema: 1, runLabel: "Save result", generic: true },
  doe: { label: "Design of experiments", schema: 1, runLabel: "Generate worksheet", generic: true },
  "fft-thickness": { label: "Film thickness (FFT)", schema: 1, runLabel: "Compute", generic: true },
  hysteresis: { label: "Hysteresis", schema: 1, runLabel: "Run Hysteresis comparison batch", generic: true },
  "map-ops": { label: "Map operations", schema: 1, runLabel: "Apply → new dataset", generic: true },
  multivar: { label: "Multivariate", schema: 1, runLabel: "Save result", generic: true },
  "outlier-screening": { label: "Outlier screening", schema: 1, runLabel: "Save result", generic: true },
  peaks: { label: "Peaks", schema: 1, runLabel: "Find again, then Fit", generic: false },
  resample: { label: "Resample", schema: 1, runLabel: "Create", generic: true },
  "signal-processing": { label: "Signal processing", schema: 1, runLabel: "Create new worksheet", generic: true },
  sims: { label: "SIMS depth profile", schema: 1, runLabel: "Create processed dataset", generic: true },
  "stats-tests": { label: "Statistical tests", schema: 1, runLabel: "Run test", generic: true },
  tabulate: { label: "Tabulate", schema: 1, runLabel: "Export", generic: true },
  "time-series": { label: "Time series", schema: 1, runLabel: "Run", generic: true },
  variability: { label: "Variability chart", schema: 1, runLabel: "Save result", generic: true },
};
