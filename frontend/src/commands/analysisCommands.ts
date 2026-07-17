// Analyze-menu command registry entries (curve fit, hysteresis, magnetometry
// tools, peak finding, reflectivity, calculators, reductions, distributions,
// stats chooser, graph builder, peak wizard) — split out of appCommands.ts
// (that module's own store-size ratchet, zero headroom). appCommands.ts
// stays the thin aggregator; this module owns every command whose `group`
// is "Analyze". Behavior is unchanged — this is a verbatim move.

import type { StoreGet } from "../lib/exportActive";
import type { Action } from "../store/commands";

/** Build the Analyze-group curated palette actions against the live store
 *  handle (`useApp.getState`) — store setters are stable, so callers build
 *  once. */
export function buildAnalysisCommands(s: StoreGet): Action[] {
  return [
    { id: "curvefit", group: "Analyze", label: "Curve fit…", run: () => s().setCurveFitOpen(true) },
    {
      id: "hysteresis",
      group: "Analyze",
      label: "Hysteresis analysis…",
      run: () => s().setHysteresisOpen(true),
    },
    {
      id: "magtools",
      group: "Analyze",
      label: "Magnetometry (background · units)…",
      run: () => s().setMagToolsOpen(true),
    },
    {
      id: "peaks",
      group: "Analyze",
      label: "Find peaks…",
      run: () => s().setPeaksOpen(true),
    },
    {
      id: "reflectivity",
      group: "Analyze",
      label: "Reflectivity model…",
      run: () => s().setReflectivityOpen(true),
    },
    {
      id: "reflview",
      group: "Analyze",
      label: "Reflectometry view (data + model + SLD)…",
      run: () => s().setReflViewOpen(true),
    },
    {
      id: "baseline",
      group: "Analyze",
      label: "Baseline / background…",
      run: () => s().setBaselineOpen(true),
    },
    {
      id: "calculators",
      group: "Analyze",
      label: "DiraCulator — materials calculators…",
      keywords:
        "diraculator calculator units constants semiconductor superconductor magnetic crystal sld optics thermal vacuum electrical electrochemistry diffusion substrates thinfilm periodic table elements xray",
      run: () => s().setCalculatorsOpen(true),
    },
    {
      id: "rsm",
      group: "Analyze",
      label: "RSM analysis (strain · relaxation)…",
      run: () => s().setRsmOpen(true),
    },
    {
      id: "digitizer",
      group: "Analyze",
      label: "Graph digitizer (trace a curve from an image)…",
      run: () => s().setDigitizerOpen(true),
    },
    // Reductions (MAIN_PLAN #11): one ToolWindow, pre-set to the picked method.
    { id: "reductions-wh", group: "Analyze", label: "Williamson-Hall…", run: () => s().openReductions("williamson-hall") },
    { id: "reductions-fft", group: "Analyze", label: "Film thickness (FFT)…", run: () => s().openReductions("fft-thickness") },
    { id: "reductions-reflfft", group: "Analyze", label: "Reflectivity FFT…", run: () => s().openReductions("reflectivity-fft") },
    {
      id: "distribution",
      group: "Analyze",
      label: "Distribution (histogram + normality of a column)…",
      run: () => s().setDistributionOpen(true),
    },
    {
      id: "stats-chooser",
      group: "Analyze",
      label: "Test chooser (which stats test? + run it)…",
      run: () => s().setStatsChooserOpen(true),
    },
    {
      id: "graph-builder",
      group: "Analyze",
      label: "Graph Builder (drag columns into X/Y/Group wells)…",
      keywords: "plot spec scatter line box violin bar mark morph drop zone well facet",
      run: () => s().setGraphBuilderOpen(true),
    },
    {
      id: "peak-wizard",
      group: "Analyze",
      label: "Peak Analyzer (baseline → find → fit → report wizard)…",
      run: () => s().setPeakWizardOpen(true),
    },
  ];
}
