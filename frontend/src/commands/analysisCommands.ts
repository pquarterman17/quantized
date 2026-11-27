// Analyze-menu command registry entries (curve fit, hysteresis, magnetometry
// tools, peak finding, reflectivity, calculators, reductions, distributions,
// stats chooser, graph builder, peak wizard) — split out of appCommands.ts
// (that module's own store-size ratchet, zero headroom). appCommands.ts
// stays the thin aggregator. It owns analysis commands plus the Graph Builder
// workflow, which is intentionally filed under Plot.

import { onLoadFailure, runLazy } from "../lib/runLazy";
import type { StoreGet } from "../lib/exportActive";
import type { Action } from "../store/commands";
import { useAnalysisCenter } from "../store/analysisCenter";
import { useAnalysisExtras } from "../store/analysisExtras";
import { useDoeStore } from "../store/doe";
import { useFitModelStore } from "../store/fitModel";
import { useFitYByXStore } from "../store/fitYByX";
import { useProfilerStore } from "../store/profiler";
import { useOutlierScreeningStore } from "../store/outlierScreening";
import { openSimsDialog } from "../store/simsDialog";
import { useMultivarStore } from "../store/multivar";
import { useStatsTestsStore } from "../store/statsTests";
import type { StatsTestId } from "../lib/api/statsTests";
import { DEFAULT_PARAMS, DEFAULT_SELECTION } from "../lib/statsTests";
import { NEEDS_DATASET } from "../lib/menuReasons";
import { plotTypeUnavailable } from "../lib/plotTypes";
import { useVariabilityStore } from "../store/variability";
import { useAuxFigureStore } from "../components/workshops/ternary/auxFigureStore";

/** Single-key shortcuts (useGlobalShortcuts.ts), shown on their menu items. */
const ANALYZE_KEYS: Readonly<Record<string, string>> = { curvefit: "F", hysteresis: "Y", peaks: "P" };

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
  // Every launch (menu, palette, Analysis Center) feeds the Analyze menu's
  // "Recent analyses"; the center itself is a navigator, not an analysis.
  const launch = id === "analysis-center" ? run : () => { useAnalysisCenter.getState().recordUse(id); run(); };
  return { id, group: "Analyze", section, label, description, keywords, shortcut: ANALYZE_KEYS[id], run: launch };
}

/** Build the Analyze-group curated palette actions against the live store
 *  handle (`useApp.getState`) — store setters are stable, so callers build
 *  once. */
// G15 plot types: each opens its Plot stage through the gallery's switch (applyPlotType), so the
// palette, the Plot type… gallery and the Stage agree. The description doubles as the Help entry.
const PLOTS2_COMMANDS = [
  ["parallel", "Parallel coordinates…", "Draw each row as a line across one axis per column, optionally coloured by a column; exports as PDF/SVG/PNG exactly as previewed.", "parallel coordinates multivariate growth runs parameters axes lines"],
  ["hexbin", "Hexbin density…", "Count X-Y points per hexagon for dense scatter data (optional log colour scale); exports as PDF/SVG/PNG exactly as previewed.", "hexbin hexagonal binning density scatter overplotting counts"],
  ["kde2d", "2-D density (KDE)…", "Smoothed density contours of X-Y points from a Gaussian kernel density estimate (Scott's rule bandwidth by default, provisional); exports as previewed.", "kde kernel density 2d contour smoothed scatter bandwidth scott silverman"],
  ["pareto", "Pareto chart…", "Sort categories by size with a cumulative-percent line (the 80 % mark is drawn); exports as PDF/SVG/PNG exactly as previewed.", "pareto chart 80 20 defects cumulative percent categories sorted bars"],
  ["blandAltman", "Bland-Altman…", "Compare two methods: A minus B against their mean with the bias and 1.96 SD limits of agreement and their 95 % confidence intervals (Bland and Altman 1986, 1999); exports as previewed.", "bland altman agreement plot limits of agreement bias method comparison calibration instruments"],
] as const;

/** Direct launchers for the SPC and life tests (UX menus audit M3), each opening Statistical tests on its
 *  test: they were reachable only through that window's 33-item select. Provisional, owner to confirm:
 *  the Analyze > "Quality & reliability" flyout. */
const QUALITY_COMMANDS: readonly (readonly [string, StatsTestId, string, string, string])[] = [
  ["quality-control-chart", "control-chart", "Control chart…", "Chart a process over time with control limits and run rules: X-bar/R, X-bar/S, I-MR, P, NP, C and U charts, plus EWMA and CUSUM for small shifts (statistical process control).", "spc ewma cusum exponentially weighted moving average cumulative sum nelson rules statistical process control xbar imr individuals moving range p chart np c u western electric nelson run rules shewhart quality"],
  ["quality-capability", "capability", "Process capability…", "Compare a process with its specification limits: Cp, Cpk, Pp and Ppk with the in-spec fraction.", "cp cpk pp ppk lsl usl spec limits capability six sigma quality"],
  ["quality-life-distribution", "life-distribution", "Life distribution…", "Fit a censored life distribution (Weibull, lognormal, exponential, loglogistic) with a probability plot and B10 life. Fit life by X (Arrhenius, power law) is in Statistical tests.", "reliability weibull lognormal censored censoring b10 life data failure time kaplan meier tddb breakdown"],
];

/** Exact-method launchers (palette only: the menus list their parent workshop). Each opens its workshop on the
 *  test or tab it names, where the generic command would open the workshop's first test. [id, workshop, target, label, description, keywords] */
const METHOD_COMMANDS: readonly (readonly [string, "stats" | "multivar", string, string, string, string])[] = [
  ["method-fit-life-by-x", "stats", "life-by-x", "Fit life by X…", "Fit censored life data against a stress (Arrhenius or power law) and read the life at use conditions.", "accelerated life arrhenius power law acceleration factor activation energy"],
  ["method-response-screening", "stats", "response-screening", "Response screening…", "Test many response columns against factor columns with a false discovery rate.", "fdr false discovery rate logworth benjamini hochberg"],
  ["method-pls", "multivar", "pls", "PLS (partial least squares)…", "Partial least squares calibration on the Multivariate PLS / LDA tab.", "regression calibration latent variables spectra"],
  ["method-lda", "multivar", "lda", "LDA (linear discriminant analysis)…", "Classify rows into groups on the Multivariate PLS / LDA tab.", "classification discriminant classes"],
  ["method-cluster", "multivar", "cluster", "Clustering (k-means, hierarchical)…", "Group rows with k-means or hierarchical clustering, with a dendrogram view.", "cluster kmeans dendrogram linkage"],
];

/** Statistics launchers for the lazy power and probability panels: [id (also the panel key), label, description, keywords]. */
const PLANNING_COMMANDS = [
  ["stats-power", "Power analysis…", "Solve power, sample size or detectable effect for t, ANOVA, proportion and variance tests.", "power sample size effect cohen"],
  ["prob-calc", "Probability calculator…", "pdf, cdf, survival and quantile of a distribution, for a value or a column.", "probability distribution quantile critical p"],
] as const;

const activeDataset = (s: StoreGet) => s().datasets.find((d) => d.id === s().activeId) ?? null;

export function buildAnalysisCommands(s: StoreGet): Action[] {
  return [
    analyze("analysis-center", "Tools", "Analysis Center…", "Browse analysis tools, requirements, and saved results.", "discover workflow favorites recent", () => s().setStageTab("analysis")),
    analyze("curvefit", "Fit", "Curve fit…", "Fit a model to active data and inspect parameters, uncertainty, residuals, and goodness-of-fit.", "regression least squares nonlinear model gaussian lorentzian batch fit parameter vs plot parameter tau vs t summary across datasets piecewise segmented breakpoint convolution instrument resolution ode kinetics decay logistic robust quantile", () => s().setCurveFitOpen(true)),
    analyze("surface-fit", "Fit", "Surface fit z = f(x, y)…", "Fit a 2-D model (plane, paraboloid, Gaussian, Lorentzian, pseudo-Voigt…) to X, Y, Z columns or a map, with errors, confidence limits and a residual map.", "xyz map wafer 2d surface plane paraboloid gaussian regression", () => useAnalysisExtras.getState().show("surface-fit")),
    analyze("map-ops", "Transform & signal", "Map operations…", "Crop, flip, rotate, transpose, level a tilted plane, add, subtract, multiply and divide 2-D maps, take a 2-D FFT, apply a 2-D FFT filter, or smooth and edge-filter an image map; each result is a new map dataset.", "matrix crop rotate flip transpose plane level tilt background subtract normalize divide rsm afm image dark frame arithmetic fft2 2d fft fourier moire periodicity lowpass highpass bandpass gaussian median sobel laplacian denoise smooth blur edge", () => useAnalysisExtras.getState().show("map-ops")),
    analyze("map-grid", "Transform & signal", "Map gridding…", "Grid X, Y, Z columns to a map with modified Shepard, kriging (with a variance map), Renka-Cline and the other methods, on linear or log10-spaced axes; set a map's values from a formula of x, y and z; read the value at one (x, y) from every map into a worksheet. Each result is a new dataset.", "xyz gridding kriging variogram shepard renka cline natural neighbor interpolate scattered log spaced grid map formula set values pixel extract across maps series drift matrix", () => useAnalysisExtras.getState().show("map-grid")),
    analyze("math-extras", "Transform & signal", "Math extras…", "Polygon and surface area, arc-length and 3-D interpolation, B-spline resampling, 2-D map correlation, equation solver.", "area polygon surface interpolate trace bspline correlation solve root minimize optimise", () => useAnalysisExtras.getState().show("math-extras")),
    analyze("map-analysis", "Peaks & baseline", "Map analysis (peaks, ROI volume)…", "Find and fit the 2-D peaks of any map (Gaussian or Lorentzian, optionally rotated; centre, widths, angle, volume with errors) or integrate a rectangle of a map with an optional constant or plane background; each result is a new table dataset.", "map peaks 2d peak fit gaussian lorentzian rsm volume integrate integral roi region integ2 background", () => useAnalysisExtras.getState().show("map-analysis")),
    analyze("optical-gap", "Fit", "Optical gap (Tauc plot)…", "Find a semiconductor band gap from an absorption or transmittance spectrum: direct or indirect Tauc plot, linear-edge fit and uncertainty.", "tauc band gap bandgap absorption transmittance uvvis semiconductor eg direct indirect", () => useAnalysisExtras.getState().show("optical-gap")),
    analyze("curve-measure", "Peaks & baseline", "Curve measurements…", "Measure raw curves: every intersection of two curves, every crossing of a Y level (with an optional dead band against noise), and the rise or fall time between two fractions of a step; the positions can be added as a new dataset.", "intersect intersection cross crossing crossings level crossing threshold hysteresis dead band rise time fall time 10 90 percent transition step edge two curves meet", () => useAnalysisExtras.getState().show("curve-measure")),
    analyze("ellipse-fit", "Fit", "Ellipse fit (implicit curve)…", "Fit an ellipse to X, Y points: center, semi-axes and tilt with standard errors, by a direct then geometric least-squares fit.", "ellipse conic implicit circle orbit loop fitzgibbon geometric orthogonal distance", () => useAnalysisExtras.getState().show("ellipse-fit")),
    analyze("hysteresis", "Magnetometry", "Hysteresis analysis…", "Extract coercivity, remanence, saturation, squareness, loop area, and switching-field distribution.", "coercivity remanence saturation magnetization mh loop vsm squid", () => s().setHysteresisOpen(true)),
    analyze("magtools", "Magnetometry", "Magnetometry tools…", "Prepare magnetic data, correct internal field, or fit loaded χ(T)/M(T) data in the Curie–Weiss regime with explicit sample context.", "background units tesla oersted emu moment mass volume susceptibility curie weiss effective magnetic moment isotherm isotherms arrott noakes entropy maxwell magnetocaloric cooling power derived", () => s().setMagToolsOpen(true)),
    analyze("spectro-extras", "Peaks & baseline", "Spectroscopy extras…", "Fourier self-deconvolution to resolve overlapped bands, 2-D correlation (Noda) of spectra under a perturbation, and peak or edge onset.", "fsd fourier self deconvolution resolution enhancement noda 2d correlation synchronous asynchronous onset tangent raman ftir", () => useAnalysisExtras.getState().show("spectro-extras")),
    analyze("peaks", "Peaks & baseline", "Find peaks…", "Detect peaks and optionally fit their centers, heights, widths, and shared or independent backgrounds.", "peak picking detection fwhm prominence peak table fitted peak list centers heights widths", () => s().setPeaksOpen(true)),
    analyze("reflectivity", "XRD & reflectivity", "Reflectivity model…", "Build a layer stack; simulate or fit X-ray/neutron reflectivity, with DREAM uncertainty.", "xrr pnr specular parratt sld fit dream posterior reflectometry", () => s().setReflectivityOpen(true)),
    analyze("reflview", "XRD & reflectivity", "Reflectometry view…", "Compare measured and modeled reflectivity beside the corresponding SLD depth profile.", "refl1d sld profile two frame model data", () => s().setReflViewOpen(true)),
    analyze("baseline", "Peaks & baseline", "Baseline / background…", "Estimate and subtract a background using anchors, analytic functions, or established baseline algorithms.", "background subtraction als snip shirley rolling ball modpoly detrend", () => s().setBaselineOpen(true)),
    analyze("calculators", "Tools", "Calculators…", "Open materials-science calculators for crystal, SLD, transport, optics, superconductivity, and more.", "diraculator calculator units constants semiconductor superconductor magnetic crystal sld optics transport thermal vacuum electrical electrochemistry diffusion substrates thinfilm periodic table elements xray d-spacing d spacing interplanar bragg plane spacing scherrer crystallite size", () => s().setCalculatorsOpen(true)),
    analyze("rsm", "XRD & reflectivity", "RSM analysis (strain · relaxation)…", "Locate substrate and film peaks in a reciprocal-space map and calculate strain and relaxation.", "reciprocal space map strain relaxation epitaxy q", () => s().setRsmOpen(true)),
    analyze("roi-cuts", "XRD & reflectivity", "ROI cuts (box / sector)…", "Integrate a box or annulus/azimuth region of a 2-D map into a 1-D cut, numerically — no drawing required.", "reciprocal space map box sector annulus azimuth chi profile roi integrate", () => s().setRoiCutsOpen(true)),
    analyze("digitizer", "Tools", "Graph digitizer…", "Calibrate a plot image, trace a curve, and create a numeric dataset from the selected points.", "digitize trace image extract points plot picture", () => s().setDigitizerOpen(true)),
    // Reductions (MAIN_PLAN #11): one ToolWindow, pre-set to the picked method.
    analyze("reductions-wh", "XRD & reflectivity", "Williamson-Hall…", "Estimate crystallite size and microstrain from diffraction peak widths across 2θ.", "crystallite size microstrain broadening williamson hall xrd scherrer peak table fwhm", () => s().openReductions("williamson-hall")),
    analyze("reductions-pawley", "XRD & reflectivity", "Pawley refinement…", "Refine a powder XRD unit cell from the whole pattern.", "pawley unit cell powder xrd index peaks indexing lattice parameters", () => s().openReductions("pawley")),
    analyze("reductions-reference", "XRD & reflectivity", "XRD reference pattern…", "Import a trusted diffraction stick pattern, preview it, and overlay it on the active powder scan.", "reference phase sticks hkl powder diffraction overlay csv xy index peaks indexing miller indices d-spacing d spacing match phases phase matching identify identification search database", () => s().openReductions("xrd-reference")),
    analyze("signal-processing", "Transform & signal", "Signal processing…", "Preview, save, and create linked time-domain, spectral, filtering, or correlation outputs. Quick entries for derivative, integrate, smooth, detrend, FFT, filter, cross-correlation, despike and median filter are in the command palette (Ctrl+K), each opening this tool on that operation.", "smooth normalize reference detrend derivative integral savitzky golay fft psd phase filter correlation median despike cosmic ray spike lowess convolve convolution deconvolve deconvolution wiener hilbert envelope inverse fft ifft coherence phase unwrap decimate anti-alias envelope local extrema percentile rank binomial zoom fft wavelet cwt dwt scalogram wavelet denoise iir butterworth chebyshev elliptic bessel lowpass highpass bandpass bandstop zero phase", () => s().setSignalProcessingOpen(true)),
    analyze("average-curves", "Transform & signal", "Average multiple curves…", "Average N datasets on a common x grid: mean, SD, SEM (bound as the error) and N.", "mean scans repeat sem standard error interpolate", () => s().setDatasetMathOpen(true, "average")),
    analyze("sims", "Transform & signal", "SIMS depth profile…", "Calibrate or rescale depth, subtract background, normalize by an RSF/matrix signal, and smooth into a new dataset.", "secondary ion sputter rate crater scale divide offset rsf matrix", () => openSimsDialog(s().activeId ?? "")),
    analyze("reductions-fft", "Transform & signal", "Film thickness (FFT)…", "Estimate film thickness from Kiessig-fringe frequency using a Fourier transform.", "fft kiessig fringe thickness frequency reflectivity", () => s().openReductions("fft-thickness")),
    analyze("reductions-reflfft", "Transform & signal", "Reflectivity FFT…", "Extract Kiessig thicknesses and superlattice harmonics from X-ray or neutron reflectivity.", "fft superlattice harmonic thickness xrr nr", () => s().openReductions("reflectivity-fft")),
    analyze("distribution", "Statistics", "Distribution…", "Inspect one column with a histogram, quantiles, descriptive statistics, fit, and normality verdict; an optional By column runs the same profile once per level.", "jmp histogram normality shapiro wilk quantile descriptive stats by column by group", () => s().setDistributionOpen(true)),
    analyze("multivar", "Statistics", "Multivariate…", "Explore relationships among several continuous columns: a correlation heatmap, a scatterplot matrix, and principal component analysis with scree, scores, and loadings.", "jmp correlation matrix heatmap scatterplot matrix splom pca principal components scree loadings biplot scores eigenvalue", () => useMultivarStore.getState().setOpen(true)),
    analyze("variability-chart", "Statistics", "Variability chart…", "Chart a response nested under two grouping factors (e.g. lot/wafer) with connected cell means and group means, plus the nested ANOVA and ANOVA/EMS variance-component breakdown (not a full gauge R&R study).", "jmp variability gauge chart nested anova variance components lot wafer site emp gauge r&r", () => useVariabilityStore.getState().setOpen(true)),
    analyze("stats-chooser", "Statistics", "Test chooser…", "Choose and run a statistical test with its assumptions and recommendation explained.", "jmp t-test anova mann whitney which test assumptions hypothesis", () => s().setStatsChooserOpen(true)),
    analyze("stats-tests", "Statistics", "Statistical tests…", "Run a chosen test on picked columns and read a one-sentence interpretation next to the results table, ready to copy, export, or report. Also SPC: control charts (X-bar/R, X-bar/S, I-MR, P, NP, C, U, EWMA, CUSUM) with run rules, and process capability (Cp, Cpk, Pp, Ppk). Also reliability: censored life distributions (Weibull, lognormal, exponential) with a probability plot and B10 life, and Fit Life by X (Arrhenius, power law).", "anderson darling kolmogorov smirnov ks normality sign test friedman repeated measures two-way anova dunnett control multiple regression stepwise partial correlation power sample size welch anova games howell tukey scheffe fisher lsd post hoc bartlett levene brown forsythe f test variance equivalence tost tolerance interval proportion binomial fisher exact 2x2 dunn sidak mood median test poisson rate nonparametric tolerance interval wilks distribution free ewma cusum spc statistical process control control chart xbar r imr individuals moving range p chart np c u chart western electric nelson run rules process capability cp cpk pp ppk lsl usl spec limits quality reliability life data weibull lognormal censored censoring b10 life probability plot kaplan meier tddb breakdown fit life by x arrhenius activation energy acceleration factor jmp life distribution response screening fdr false discovery rate logworth benjamini hochberg", () => useStatsTestsStore.getState().setOpen(true)),
    ...PLANNING_COMMANDS.map(([id, label, description, keywords]) => analyze(id, "Statistics", label, description, keywords, () => useAnalysisExtras.getState().show(id))),
    analyze("outlier-screening", "Statistics", "Outlier screening…", "Flag suspect points in a column with a chosen screening method, then select the flagged rows for review — never deletes anything automatically.", "outlier grubbs rosner dixon q mad screening flag suspect point jmp", () => useOutlierScreeningStore.getState().setOpen(true)),
    analyze("time-series", "Statistics", "Time series…", "Check one long log for drift and structure: autocorrelation, stationarity tests, seasonal decomposition, change points and an ARIMA forecast.", "time series acf pacf autocorrelation adf kpss stationarity unit root seasonal decomposition trend change point pelt drift arima forecast chamber pressure temperature stability", () => useAnalysisExtras.getState().show("time-series")),
    analyze("fit-y-by-x", "Statistics", "Fit Y by X…", "Pick an X and a Y column and get the matching analysis automatically: group comparison for a categorical factor, a line fit for two measurements, or a cross-tab test for two categories; an optional By column runs the same fit once per level.", "fit y by x oneway anova bivariate regression contingency chi-square chi square fisher exact tukey levene jmp by column by group", () => useFitYByXStore.getState().setOpen(true)),
    analyze("fit-model", "Statistics", "Fit model (least squares)…", "Model a response on several continuous and categorical factors with interactions and polynomial terms: parameter estimates, the whole-model ANOVA, Type III effect tests, least-squares means and residual plots.", "jmp fit model standard least squares general linear model glm ancova covariate multiple factor interaction polynomial quadratic type iii effect tests ls means lsmeans least squares means anova three-way", () => useFitModelStore.getState().setOpen(true)),
    analyze("profiler", "Statistics", "Profiler…", "Explore a fitted Fit Model: one trace per factor with confidence bands and draggable settings, a contour of the response over two factors with an optional limit, and a desirability search for the settings that hit a goal.", "jmp prediction profiler contour profiler desirability optimize maximize what if trace factor settings fit model predicted response surface", () => useProfilerStore.getState().setOpen(true)),
    analyze("doe", "Statistics", "Design of experiments…", "Generate a two-level factorial or fractional factorial (with its alias structure and resolution), a Plackett-Burman screening design, or a central composite or Box-Behnken response-surface design as a worksheet with coded and actual factor columns, a run order and an empty response column; then analyze it in Fit Model.", "doe design of experiments factorial fractional factorial 2^k resolution alias confounding generator plackett burman screening central composite ccd box behnken response surface rsm run order randomize center points half normal pareto effects jmp minitab blocking blocks block d-optimal doptimal optimal custom design exchange", () => useDoeStore.getState().setOpen(true)),
    {
      id: "graph-builder",
      group: "Plot",
      section: "Charts",
      label: "Graph builder…",
      description: "Build a plot by dragging data channels into X, Y, Group, and Facet roles.",
      keywords: "jmp plot spec scatter line box violin bar mark morph drop zone well facet drag wells x y group builder origin",
      run: () => s().setGraphBuilderOpen(true),
    },
    { id: "ternary-figure", group: "Plot", section: "Charts", label: "Ternary diagram…", description: "Plot three composition columns on a ternary diagram, optionally coloured by a fourth, previewed as the PDF/SVG/PNG export renders.", keywords: "ternary composition phase triangle barycentric alloy", run: () => useAuxFigureStore.getState().setTernaryOpen(true) },
    ...PLOTS2_COMMANDS.map(([kind, label, description, keywords]) => ({
      id: `plot-${kind}`, group: "Plot", section: "Charts", label, description, keywords,
      run: () => { void runLazy("Loading plot types…", () => import("../lib/figureDialogActions")).then((m) => m.applyPlotType(kind), onLoadFailure); }, // lazy: the plot-type gallery's own switch
    })),
    { id: "field-figure", group: "Plot", section: "Charts", label: "Vector field…", description: "Draw X, Y, U, V columns on a regular grid as quiver arrows or streamlines, previewed as the PDF/SVG/PNG export renders.", keywords: "vector field quiver streamline flow magnetization", run: () => useAuxFigureStore.getState().setFieldOpen(true) },
    ...QUALITY_COMMANDS.map(([id, test, label, description, keywords]) =>
      analyze(id, "Quality & reliability", label, description, keywords, () => useStatsTestsStore.getState().openWith({ testId: test, selection: { ...DEFAULT_SELECTION }, params: { ...DEFAULT_PARAMS } })),
    ),
    {
      id: "plot-polar-map",
      group: "Plot",
      section: "Charts",
      label: "Polar map / pole figure…",
      description: "Heatmap or contour of intensity over tilt (radius) and azimuth (angle), equal-area or stereographic: a pole figure for texture and orientation data; exports as PDF/SVG/PNG exactly as previewed.",
      keywords: "pole figure polar map stereographic schmidt equal-area texture orientation pole density tilt azimuth chi phi projection",
      disabled: () => !s().activeId || plotTypeUnavailable("polarMap", activeDataset(s)) !== null,
      disabledReason: () => (s().activeId ? (plotTypeUnavailable("polarMap", activeDataset(s)) ?? undefined) : NEEDS_DATASET),
      run: () => { void runLazy("Loading plot types…", () => import("../lib/figureDialogActions")).then((m) => m.applyPlotType("polarMap"), onLoadFailure); },
    },
    ...METHOD_COMMANDS.map(([id, shop, target, label, description, keywords]) => ({
      ...analyze(id, "Statistics", label, description, keywords, () => (shop === "stats"
        ? useStatsTestsStore.getState().openWith({ testId: target as StatsTestId, selection: { ...DEFAULT_SELECTION }, params: { ...DEFAULT_PARAMS } })
        : useMultivarStore.getState().openTab(target === "cluster" ? { tab: "cluster" } : { tab: "ext", tool: target as "pls" | "lda" }))),
      paletteOnly: true,
    })),
    analyze("peak-wizard", "Peaks & baseline", "Peak analyzer…", "A guided wizard that takes you from baseline to peak finding, fitting, and a report.", "wizard stepper guided origin peak analyzer", () => s().setPeakWizardOpen(true)),
  ];
}
