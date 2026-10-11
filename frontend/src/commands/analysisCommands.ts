// Analyze-menu command registry entries (curve fit, hysteresis, magnetometry
// tools, peak finding, reflectivity, calculators, reductions, distributions,
// stats chooser, graph builder, peak wizard) — split out of appCommands.ts
// (that module's own store-size ratchet, zero headroom). appCommands.ts
// stays the thin aggregator. It owns analysis commands plus the Graph Builder
// workflow, which is intentionally filed under Plot.

import type { StoreGet } from "../lib/exportActive";
import type { Action } from "../store/commands";
import { useFitYByXStore } from "../store/fitYByX";
import { useOutlierScreeningStore } from "../store/outlierScreening";
import { openSimsDialog } from "../store/simsDialog";
import { useMultivarStore } from "../store/multivar";
import { useStatsTestsStore } from "../store/statsTests";
import { useVariabilityStore } from "../store/variability";
import { useAuxFigureStore } from "../components/workshops/ternary/auxFigureStore";

/** Build the Analyze-group curated palette actions against the live store
 *  handle (`useApp.getState`) — store setters are stable, so callers build
 *  once. */
export function buildAnalysisCommands(s: StoreGet): Action[] {
  return [
    {
      id: "analysis-center",
      group: "Analyze",
      section: "Workflow",
      label: "Analysis Center…",
      description: "Browse analysis tools, requirements, and saved results.",
      keywords: "discover workflow favorites recent",
      run: () => s().setStageTab("analysis"),
    },
    { id: "curvefit", group: "Analyze", section: "Fit", label: "Curve fit…", description: "Fit a model and inspect parameters, uncertainty, residuals, and fit quality.", keywords: "regression least squares nonlinear model gaussian lorentzian", run: () => s().setCurveFitOpen(true) },
    {
      id: "hysteresis",
      group: "Analyze",
      section: "Magnetometry",
      label: "Hysteresis analysis…",
      description: "Measure coercivity, remanence, saturation, and loop shape.",
      keywords: "coercivity remanence saturation magnetization mh loop vsm squid",
      run: () => s().setHysteresisOpen(true),
    },
    {
      id: "magtools",
      group: "Analyze",
      section: "Magnetometry",
      label: "Magnetometry (background · units)…",
      description: "Subtract magnetic background or convert magnetic units.",
      keywords: "background units tesla oersted emu moment mass volume",
      run: () => s().setMagToolsOpen(true),
    },
    {
      id: "peaks",
      group: "Analyze",
      section: "Peaks & baseline",
      label: "Find peaks…",
      description: "Detect and fit peaks and their backgrounds.",
      keywords: "peak picking detection fwhm prominence",
      run: () => s().setPeaksOpen(true),
    },
    {
      id: "reflectivity",
      group: "Analyze",
      section: "XRD & reflectivity",
      label: "Reflectivity model…",
      description: "Simulate or fit a reflectivity layer stack with uncertainty.",
      keywords: "xrr pnr specular parratt sld fit dream posterior reflectometry",
      run: () => s().setReflectivityOpen(true),
    },
    {
      id: "reflview",
      group: "Analyze",
      section: "XRD & reflectivity",
      label: "Reflectometry view (data + model + SLD)…",
      description: "Compare measured/model reflectivity and SLD.",
      keywords: "refl1d sld profile two frame model data",
      run: () => s().setReflViewOpen(true),
    },
    {
      id: "baseline",
      group: "Analyze",
      section: "Peaks & baseline",
      label: "Baseline / background…",
      description: "Estimate or subtract a signal background.",
      keywords: "background subtraction als snip shirley rolling ball modpoly detrend",
      run: () => s().setBaselineOpen(true),
    },
    {
      id: "calculators",
      group: "Analyze",
      section: "Workflow",
      label: "DiraCulator — materials calculators…",
      description: "Open materials-science calculators.",
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
      id: "roi-cuts",
      group: "Analyze",
      section: "XRD & reflectivity",
      label: "ROI cuts (box / sector)…",
      description: "Integrate a box or sector of a 2-D map into a 1-D cut.",
      keywords: "reciprocal space map box sector annulus azimuth chi profile roi integrate",
      run: () => s().setRoiCutsOpen(true),
    },
    {
      id: "digitizer",
      group: "Analyze",
      section: "Workflow",
      label: "Graph digitizer (trace a curve from an image)…",
      description: "Trace a calibrated plot image into a dataset.",
      keywords: "digitize trace image extract points plot picture",
      run: () => s().setDigitizerOpen(true),
    },
    // Reductions (MAIN_PLAN #11): one ToolWindow, pre-set to the picked method.
    { id: "reductions-wh", group: "Analyze", section: "XRD & reflectivity", label: "Williamson-Hall…", description: "Estimate crystallite size and microstrain from diffraction peak widths across 2θ.", keywords: "crystallite size microstrain broadening williamson hall xrd", run: () => s().openReductions("williamson-hall") },
    { id: "reductions-pawley", group: "Analyze", section: "XRD & reflectivity", label: "Pawley refinement…", description: "Refine a powder XRD unit cell from the whole pattern.", keywords: "pawley unit cell powder xrd", run: () => s().openReductions("pawley") },
    {
      id: "signal-processing",
      group: "Analyze",
      section: "Transform & signal",
      label: "Signal Processing…",
      description: "Create linked signal-processing outputs.",
      keywords: "smooth normalize reference detrend derivative integral savitzky golay fft psd phase filter correlation",
      run: () => s().setSignalProcessingOpen(true),
    },
    {
      id: "sims",
      group: "Analyze",
      section: "Transform & signal",
      label: "SIMS depth profile…",
      description: "Process a SIMS depth profile into a linked dataset.",
      keywords: "secondary ion sputter rate crater scale divide offset rsf matrix",
      run: () => openSimsDialog(s().activeId ?? ""),
    },
    { id: "reductions-fft", group: "Analyze", section: "Transform & signal", label: "Film thickness (FFT)…", description: "Estimate film thickness from Kiessig-fringe frequency using a Fourier transform.", keywords: "fft kiessig fringe thickness frequency reflectivity", run: () => s().openReductions("fft-thickness") },
    { id: "reductions-reflfft", group: "Analyze", section: "Transform & signal", label: "Reflectivity FFT…", description: "Extract Kiessig thicknesses and superlattice harmonics from X-ray or neutron reflectivity.", keywords: "fft superlattice harmonic thickness xrr nr", run: () => s().openReductions("reflectivity-fft") },
    {
      id: "distribution",
      group: "Analyze",
      section: "Statistics",
      label: "Distribution (histogram + normality of a column)…",
      description: "Profile a distribution, normality, and optional By groups.",
      keywords: "jmp histogram normality shapiro wilk quantile descriptive stats by column by group",
      run: () => s().setDistributionOpen(true),
    },
    {
      id: "multivar",
      group: "Analyze",
      section: "Statistics",
      label: "Multivariate (correlation · SPLOM · PCA)…",
      description: "Explore correlations and PCA across numeric columns.",
      keywords: "jmp correlation matrix heatmap scatterplot matrix splom pca principal components scree loadings biplot scores eigenvalue",
      run: () => useMultivarStore.getState().setOpen(true),
    },
    {
      id: "variability-chart",
      group: "Analyze",
      section: "Statistics",
      label: "Variability chart (nested ANOVA · variance components)…",
      description: "Compare nested-factor variability and variance components.",
      keywords: "jmp variability gauge chart nested anova variance components lot wafer site emp gauge r&r",
      run: () => useVariabilityStore.getState().setOpen(true),
    },
    {
      id: "stats-chooser",
      group: "Analyze",
      section: "Statistics",
      label: "Test chooser (which stats test? + run it)…",
      description: "Choose a test with its assumptions explained.",
      keywords: "jmp t-test anova mann whitney which test assumptions hypothesis",
      run: () => s().setStatsChooserOpen(true),
    },
    {
      id: "stats-tests",
      group: "Analyze",
      section: "Statistics",
      label: "Statistical tests (normality · paired · Dunnett · regression · power)…",
      description: "Run and interpret a statistical test.",
      keywords: "anderson darling kolmogorov smirnov ks normality sign test friedman repeated measures two-way anova dunnett control multiple regression stepwise partial correlation power sample size",
      run: () => useStatsTestsStore.getState().setOpen(true),
    },
    {
      id: "outlier-screening",
      group: "Analyze",
      section: "Statistics",
      label: "Outlier screening…",
      description: "Flag suspect points for review without deleting or excluding them.",
      keywords: "outlier grubbs rosner dixon q mad screening flag suspect point jmp",
      run: () => useOutlierScreeningStore.getState().setOpen(true),
    },
    {
      id: "fit-y-by-x",
      group: "Analyze",
      section: "Statistics",
      label: "Fit Y by X (oneway · bivariate · contingency)…",
      description: "Analyze Y by X and optional By groups.",
      keywords: "fit y by x oneway anova bivariate regression contingency chi-square chi square fisher exact tukey levene jmp by column by group",
      run: () => useFitYByXStore.getState().setOpen(true),
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
    { id: "ternary-figure", group: "Plot", section: "Build & export", label: "Ternary diagram…", description: "Plot three composition columns on a ternary diagram, optionally coloured by a fourth, previewed as the PDF/SVG/PNG export renders.", keywords: "ternary composition phase triangle barycentric alloy", run: () => useAuxFigureStore.getState().setTernaryOpen(true) },
    { id: "field-figure", group: "Plot", section: "Build & export", label: "Vector field…", description: "Draw X, Y, U, V columns on a regular grid as quiver arrows or streamlines, previewed as the PDF/SVG/PNG export renders.", keywords: "vector field quiver streamline flow magnetization", run: () => useAuxFigureStore.getState().setFieldOpen(true) },
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
