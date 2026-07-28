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
    { id: "curvefit", group: "Analyze", section: "Fit", label: "Curve fit…", description: "Fit a model to active data and inspect parameters, uncertainty, residuals, and goodness-of-fit.", keywords: "regression least squares nonlinear model gaussian lorentzian", run: () => s().setCurveFitOpen(true) },
    {
      id: "hysteresis",
      group: "Analyze",
      section: "Magnetometry",
      label: "Hysteresis analysis…",
      description: "Extract coercivity, remanence, saturation, squareness, loop area, and switching-field distribution.",
      keywords: "coercivity remanence saturation magnetization mh loop vsm squid",
      run: () => s().setHysteresisOpen(true),
    },
    {
      id: "magtools",
      group: "Analyze",
      section: "Magnetometry",
      label: "Magnetometry (background · units)…",
      description: "Subtract a linear magnetometry background or convert field and moment units with sample context.",
      keywords: "background units tesla oersted emu moment mass volume",
      run: () => s().setMagToolsOpen(true),
    },
    {
      id: "peaks",
      group: "Analyze",
      section: "Peaks & baseline",
      label: "Find peaks…",
      description: "Detect peaks and optionally fit their centers, heights, widths, and shared or independent backgrounds.",
      keywords: "peak picking detection fwhm prominence",
      run: () => s().setPeaksOpen(true),
    },
    {
      id: "reflectivity",
      group: "Analyze",
      section: "XRD & reflectivity",
      label: "Reflectivity model…",
      description: "Build a layer stack and simulate an X-ray or neutron reflectivity curve on a chosen Q grid.",
      keywords: "xrr specular parratt sld layer stack simulate reflectometry",
      run: () => s().setReflectivityOpen(true),
    },
    {
      id: "reflview",
      group: "Analyze",
      section: "XRD & reflectivity",
      label: "Reflectometry view (data + model + SLD)…",
      description: "Compare measured and modeled reflectivity beside the corresponding SLD depth profile.",
      keywords: "refl1d sld profile two frame model data",
      run: () => s().setReflViewOpen(true),
    },
    {
      id: "baseline",
      group: "Analyze",
      section: "Peaks & baseline",
      label: "Baseline / background…",
      description: "Estimate and subtract a background using anchors, analytic functions, or established baseline algorithms.",
      keywords: "background subtraction als snip shirley rolling ball modpoly detrend",
      run: () => s().setBaselineOpen(true),
    },
    {
      id: "calculators",
      group: "Analyze",
      section: "Workflow",
      label: "DiraCulator — materials calculators…",
      description: "Open materials-science calculators for crystal, SLD, transport, optics, superconductivity, and more.",
      keywords:
        "diraculator calculator units constants semiconductor superconductor magnetic crystal sld optics transport thermal vacuum electrical electrochemistry diffusion substrates thinfilm periodic table elements xray",
      run: () => s().setCalculatorsOpen(true),
    },
    {
      id: "rsm",
      group: "Analyze",
      section: "XRD & reflectivity",
      label: "RSM analysis (strain · relaxation)…",
      description: "Locate substrate and film peaks in a reciprocal-space map and calculate strain and relaxation.",
      keywords: "reciprocal space map strain relaxation epitaxy q",
      run: () => s().setRsmOpen(true),
    },
    {
      id: "digitizer",
      group: "Analyze",
      section: "Workflow",
      label: "Graph digitizer (trace a curve from an image)…",
      description: "Calibrate a plot image, trace a curve, and create a numeric dataset from the selected points.",
      keywords: "digitize trace image extract points plot picture",
      run: () => s().setDigitizerOpen(true),
    },
    // Reductions (MAIN_PLAN #11): one ToolWindow, pre-set to the picked method.
    { id: "reductions-wh", group: "Analyze", section: "XRD & reflectivity", label: "Williamson-Hall…", description: "Estimate crystallite size and microstrain from diffraction peak widths across 2θ.", keywords: "crystallite size microstrain broadening williamson hall xrd", run: () => s().openReductions("williamson-hall") },
    { id: "reductions-fft", group: "Analyze", section: "Transform & signal", label: "Film thickness (FFT)…", description: "Estimate film thickness from Kiessig-fringe frequency using a Fourier transform.", keywords: "fft kiessig fringe thickness frequency reflectivity", run: () => s().openReductions("fft-thickness") },
    { id: "reductions-reflfft", group: "Analyze", section: "Transform & signal", label: "Reflectivity FFT…", description: "Extract Kiessig thicknesses and superlattice harmonics from X-ray or neutron reflectivity.", keywords: "fft superlattice harmonic thickness xrr nr", run: () => s().openReductions("reflectivity-fft") },
    {
      id: "distribution",
      group: "Analyze",
      section: "Statistics",
      label: "Distribution (histogram + normality of a column)…",
      description: "Inspect one column with a histogram, quantiles, descriptive statistics, fit, and normality verdict.",
      keywords: "jmp histogram normality shapiro wilk quantile descriptive stats",
      run: () => s().setDistributionOpen(true),
    },
    {
      id: "stats-chooser",
      group: "Analyze",
      section: "Statistics",
      label: "Test chooser (which stats test? + run it)…",
      description: "Choose and run a statistical test with its assumptions and recommendation explained.",
      keywords: "jmp t-test anova mann whitney which test assumptions hypothesis",
      run: () => s().setStatsChooserOpen(true),
    },
    {
      id: "graph-builder",
      group: "Plot",
      section: "Build & export",
      label: "Graph Builder (drag columns into X/Y/Group wells)…",
      description: "Build a plot by dragging data channels into X, Y, Group, and Facet roles.",
      keywords: "jmp plot spec scatter line box violin bar mark morph drop zone well facet drag wells x y group builder origin",
      run: () => s().setGraphBuilderOpen(true),
    },
    {
      id: "peak-wizard",
      group: "Analyze",
      section: "Peaks & baseline",
      label: "Peak Analyzer (baseline → find → fit → report wizard)…",
      description: "Use a guided baseline, peak detection, fitting, and report workflow.",
      keywords: "wizard stepper guided origin peak analyzer",
      run: () => s().setPeakWizardOpen(true),
    },
  ];
}
