// Analyze-menu command registry entries (curve fit, hysteresis, magnetometry
// tools, peak finding, reflectivity, calculators, reductions, distributions,
// stats chooser, graph builder, peak wizard) — split out of appCommands.ts
// (that module's own store-size ratchet, zero headroom). appCommands.ts
// stays the thin aggregator. It owns analysis commands plus the Graph Builder
// workflow, which is intentionally filed under Plot.

import type { StoreGet } from "../lib/exportActive";
import type { Action } from "../store/commands";

/** Build the Analyze-group curated palette actions against the live store
 *  handle (`useApp.getState`) — store setters are stable, so callers build
 *  once. */
export function buildAnalysisCommands(s: StoreGet): Action[] {
  return [
    { id: "curvefit", group: "Analyze", section: "Fit", label: "Curve fit…", run: () => s().setCurveFitOpen(true) },
    {
      id: "hysteresis",
      group: "Analyze",
      section: "Magnetometry",
      label: "Hysteresis analysis…",
      run: () => s().setHysteresisOpen(true),
    },
    {
      id: "magtools",
      group: "Analyze",
      section: "Magnetometry",
      label: "Magnetometry (background · units)…",
      run: () => s().setMagToolsOpen(true),
    },
    {
      id: "peaks",
      group: "Analyze",
      section: "Peaks & baseline",
      label: "Find peaks…",
      run: () => s().setPeaksOpen(true),
    },
    {
      id: "reflectivity",
      group: "Analyze",
      section: "XRD & reflectivity",
      label: "Reflectivity model…",
      run: () => s().setReflectivityOpen(true),
    },
    {
      id: "reflview",
      group: "Analyze",
      section: "XRD & reflectivity",
      label: "Reflectometry view (data + model + SLD)…",
      run: () => s().setReflViewOpen(true),
    },
    {
      id: "baseline",
      group: "Analyze",
      section: "Peaks & baseline",
      label: "Baseline / background…",
      run: () => s().setBaselineOpen(true),
    },
    {
      id: "calculators",
      group: "Analyze",
      section: "Workflow",
      label: "DiraCulator — materials calculators…",
      keywords:
        "diraculator calculator units constants semiconductor superconductor magnetic crystal sld optics thermal vacuum electrical electrochemistry diffusion substrates thinfilm periodic table elements xray",
      run: () => s().setCalculatorsOpen(true),
    },
    {
      id: "rsm",
      group: "Analyze",
      section: "XRD & reflectivity",
      label: "RSM analysis (strain · relaxation)…",
      run: () => s().setRsmOpen(true),
    },
    {
      id: "digitizer",
      group: "Analyze",
      section: "Workflow",
      label: "Graph digitizer (trace a curve from an image)…",
      run: () => s().setDigitizerOpen(true),
    },
    // Reductions (MAIN_PLAN #11): one ToolWindow, pre-set to the picked method.
    { id: "reductions-wh", group: "Analyze", section: "XRD & reflectivity", label: "Williamson-Hall…", run: () => s().openReductions("williamson-hall") },
    { id: "reductions-fft", group: "Analyze", section: "Transform & signal", label: "Film thickness (FFT)…", run: () => s().openReductions("fft-thickness") },
    { id: "reductions-reflfft", group: "Analyze", section: "Transform & signal", label: "Reflectivity FFT…", run: () => s().openReductions("reflectivity-fft") },
    {
      id: "distribution",
      group: "Analyze",
      section: "Statistics",
      label: "Distribution (histogram + normality of a column)…",
      run: () => s().setDistributionOpen(true),
    },
    {
      id: "stats-chooser",
      group: "Analyze",
      section: "Statistics",
      label: "Test chooser (which stats test? + run it)…",
      run: () => s().setStatsChooserOpen(true),
    },
    {
      id: "graph-builder",
      group: "Plot",
      section: "Build & export",
      label: "Graph Builder (drag columns into X/Y/Group wells)…",
      keywords: "plot spec scatter line box violin bar mark morph drop zone well facet",
      run: () => s().setGraphBuilderOpen(true),
    },
    {
      id: "peak-wizard",
      group: "Analyze",
      section: "Peaks & baseline",
      label: "Peak Analyzer (baseline → find → fit → report wizard)…",
      run: () => s().setPeakWizardOpen(true),
    },
  ];
}
