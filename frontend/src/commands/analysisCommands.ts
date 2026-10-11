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

/** Keep the command copy fully descriptive without serializing six repeated
 * object keys and the Analyze group name for every eager registry entry. */
function analyze(
  id: string,
  section: string,
  label: string,
  description: string,
  keywords: string,
  run: () => void,
): Action {
  return { id, group: "Analyze", section, label, description, keywords, run };
}

/** Build the Analyze-group curated palette actions against the live store
 *  handle (`useApp.getState`) — store setters are stable, so callers build
 *  once. */
export function buildAnalysisCommands(s: StoreGet): Action[] {
  return [
    analyze("analysis-center", "Workflow", "Analysis Center…", "Browse analysis tools, requirements, and saved results.", "discover workflow favorites recent", () => s().setStageTab("analysis")),
    analyze("curvefit", "Fit", "Curve fit…", "Fit a model to active data and inspect parameters, uncertainty, residuals, and goodness-of-fit.", "regression least squares nonlinear model gaussian lorentzian", () => s().setCurveFitOpen(true)),
    analyze("hysteresis", "Magnetometry", "Hysteresis analysis…", "Extract coercivity, remanence, saturation, squareness, loop area, and switching-field distribution.", "coercivity remanence saturation magnetization mh loop vsm squid", () => s().setHysteresisOpen(true)),
    analyze("magtools", "Magnetometry", "Magnetometry (background · units)…", "Subtract a linear magnetometry background or convert field and moment units with sample context.", "background units tesla oersted emu moment mass volume", () => s().setMagToolsOpen(true)),
    analyze("peaks", "Peaks & baseline", "Find peaks…", "Detect peaks and optionally fit their centers, heights, widths, and shared or independent backgrounds.", "peak picking detection fwhm prominence", () => s().setPeaksOpen(true)),
    analyze("reflectivity", "XRD & reflectivity", "Reflectivity model…", "Build a layer stack; simulate or fit X-ray/neutron reflectivity, with DREAM uncertainty.", "xrr pnr specular parratt sld fit dream posterior reflectometry", () => s().setReflectivityOpen(true)),
    analyze("reflview", "XRD & reflectivity", "Reflectometry view (data + model + SLD)…", "Compare measured and modeled reflectivity beside the corresponding SLD depth profile.", "refl1d sld profile two frame model data", () => s().setReflViewOpen(true)),
    analyze("baseline", "Peaks & baseline", "Baseline / background…", "Estimate and subtract a background using anchors, analytic functions, or established baseline algorithms.", "background subtraction als snip shirley rolling ball modpoly detrend", () => s().setBaselineOpen(true)),
    analyze("calculators", "Workflow", "DiraCulator — materials calculators…", "Open materials-science calculators for crystal, SLD, transport, optics, superconductivity, and more.", "diraculator calculator units constants semiconductor superconductor magnetic crystal sld optics transport thermal vacuum electrical electrochemistry diffusion substrates thinfilm periodic table elements xray", () => s().setCalculatorsOpen(true)),
    analyze("rsm", "XRD & reflectivity", "RSM analysis (strain · relaxation)…", "Locate substrate and film peaks in a reciprocal-space map and calculate strain and relaxation.", "reciprocal space map strain relaxation epitaxy q", () => s().setRsmOpen(true)),
    analyze("roi-cuts", "XRD & reflectivity", "ROI cuts (box / sector)…", "Integrate a box or annulus/azimuth region of a 2-D map into a 1-D cut, numerically — no drawing required.", "reciprocal space map box sector annulus azimuth chi profile roi integrate", () => s().setRoiCutsOpen(true)),
    analyze("digitizer", "Workflow", "Graph digitizer (trace a curve from an image)…", "Calibrate a plot image, trace a curve, and create a numeric dataset from the selected points.", "digitize trace image extract points plot picture", () => s().setDigitizerOpen(true)),
    // Reductions (MAIN_PLAN #11): one ToolWindow, pre-set to the picked method.
    analyze("reductions-wh", "XRD & reflectivity", "Williamson-Hall…", "Estimate crystallite size and microstrain from diffraction peak widths across 2θ.", "crystallite size microstrain broadening williamson hall xrd", () => s().openReductions("williamson-hall")),
    analyze("reductions-pawley", "XRD & reflectivity", "Pawley refinement…", "Refine a powder XRD unit cell from the whole pattern.", "pawley unit cell powder xrd", () => s().openReductions("pawley")),
    analyze("signal-processing", "Transform & signal", "Signal Processing…", "Preview, save, and create linked time-domain, spectral, filtering, or correlation outputs.", "smooth normalize reference detrend derivative integral savitzky golay fft psd phase filter correlation", () => s().setSignalProcessingOpen(true)),
    analyze("sims", "Transform & signal", "SIMS depth profile…", "Calibrate or rescale depth, subtract background, normalize by an RSF/matrix signal, and smooth into a new dataset.", "secondary ion sputter rate crater scale divide offset rsf matrix", () => openSimsDialog(s().activeId ?? "")),
    analyze("reductions-fft", "Transform & signal", "Film thickness (FFT)…", "Estimate film thickness from Kiessig-fringe frequency using a Fourier transform.", "fft kiessig fringe thickness frequency reflectivity", () => s().openReductions("fft-thickness")),
    analyze("reductions-reflfft", "Transform & signal", "Reflectivity FFT…", "Extract Kiessig thicknesses and superlattice harmonics from X-ray or neutron reflectivity.", "fft superlattice harmonic thickness xrr nr", () => s().openReductions("reflectivity-fft")),
    analyze("distribution", "Statistics", "Distribution (histogram + normality of a column)…", "Inspect one column with a histogram, quantiles, descriptive statistics, fit, and normality verdict; an optional By column runs the same profile once per level.", "jmp histogram normality shapiro wilk quantile descriptive stats by column by group", () => s().setDistributionOpen(true)),
    analyze("multivar", "Statistics", "Multivariate (correlation · SPLOM · PCA)…", "Explore relationships among several continuous columns: a correlation heatmap, a scatterplot matrix, and principal component analysis with scree, scores, and loadings.", "jmp correlation matrix heatmap scatterplot matrix splom pca principal components scree loadings biplot scores eigenvalue", () => useMultivarStore.getState().setOpen(true)),
    analyze("variability-chart", "Statistics", "Variability chart (nested ANOVA · variance components)…", "Chart a response nested under two grouping factors (e.g. lot/wafer) with connected cell means and group means, plus the nested ANOVA and ANOVA/EMS variance-component breakdown.", "jmp variability gauge chart nested anova variance components lot wafer site emp gauge r&r", () => useVariabilityStore.getState().setOpen(true)),
    analyze("stats-chooser", "Statistics", "Test chooser (which stats test? + run it)…", "Choose and run a statistical test with its assumptions and recommendation explained.", "jmp t-test anova mann whitney which test assumptions hypothesis", () => s().setStatsChooserOpen(true)),
    analyze("stats-tests", "Statistics", "Statistical tests (normality · paired · Dunnett · regression · power)…", "Run a chosen test on picked columns and read a one-sentence interpretation next to the results table, ready to copy, export, or report.", "anderson darling kolmogorov smirnov ks normality sign test friedman repeated measures two-way anova dunnett control multiple regression stepwise partial correlation power sample size", () => useStatsTestsStore.getState().setOpen(true)),
    analyze("outlier-screening", "Statistics", "Outlier screening…", "Flag suspect points in a column with a chosen screening method, then select the flagged rows for review — never deletes anything automatically.", "outlier grubbs rosner dixon q mad screening flag suspect point jmp", () => useOutlierScreeningStore.getState().setOpen(true)),
    analyze("fit-y-by-x", "Statistics", "Fit Y by X (oneway · bivariate · contingency)…", "Pick an X and a Y column and get the matching analysis automatically: group comparison for a categorical factor, a line fit for two measurements, or a cross-tab test for two categories; an optional By column runs the same fit once per level.", "fit y by x oneway anova bivariate regression contingency chi-square chi square fisher exact tukey levene jmp by column by group", () => useFitYByXStore.getState().setOpen(true)),
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
    analyze("peak-wizard", "Peaks & baseline", "Peak Analyzer (baseline → find → fit → report wizard)…", "Use a guided baseline, peak detection, fitting, and report workflow.", "wizard stepper guided origin peak analyzer", () => s().setPeakWizardOpen(true)),
  ];
}
