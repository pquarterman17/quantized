# Origin 2026b Student (local install) vs quantized: feature gap findings

**Status:** Audit findings only; no code changed. Ranking is pending a joint
owner session (rows marked **?** below). This is an **interim** survey and not
a plan. After ranking, the chosen items are booked into `MAIN_PLAN.md` (or a
sub-plan), and this file is folded in and deleted (plan-consolidation rule).
**Sibling:** `GAP_AUDIT_9.md` (2026-11-24, built from OriginLab's web pages).
This file is built from the **installed program itself** and cites
GAP_AUDIT_9 IDs (G1–G27, J13–J16) instead of re-reporting them.
**Created:** 2026-11-25
**Baseline:** quantized `origin/main` at `cf38baf0d` (Release v0.45.0).
Origin: `C:\Program Files\OriginLab\Origin2026b`, version 10.35 Student
(`@V` = 10.350222).

---

## How to read this file

Every table row is one user-level Origin feature. Columns:

- **Origin**: the X-Function, graph template or install file that provides
  it. You can open the X-Function's `.OXF` under `X-Functions/` for its
  description and variables.
- **Student**: what the COM probe measured on this install. `ran` means
  the call succeeded and produced output. `graph` means a new graph page
  appeared. `crashed` means the hidden instance died. `—` means it was not
  probed; the feature ships in the install and nothing suggests it is gated.
  `App` means it is an OriginLab App wrapper that is **not installed** here.
- **quantized**: evidence at `cf38baf0d`, as file paths relative to
  `src/quantized/` or `frontend/src/`. "none" means the evidence search
  (method step 2) found nothing after a line-level re-check.
- **Status**: one of four values.
  - **Have**: equivalent capability, reachable in the app.
  - **Partial**: some of it, or only inside another tool.
  - **Missing**: no equivalent.
  - **Out**: out of scope by a standing owner decision.
- **Rank**: `—` means clear and needs no discussion. **?** means to go
  through together, because the status or the value is unclear. The
  question to settle is in the [discussion list](#discussion-list-the--rows).

The file is exhaustive by design. Ranking happens afterwards, and only the
**?** rows need talking through.

---

## Method

1. **Install inventory (no Origin running).**

   | Source in the install | What it gave |
   |---|---|
   | `X-Functions/**/*.OXF` (XML) | **799** X-Functions in 40 categories; each file's `xFdescription` gives the menu label and purpose; `<name>/<io>/<type>` gives the signature |
   | `FitFunc/*.FDF` + `LTF/Default/Functions.xml` | **305** built-in fit models in 32 fitting categories |
   | `LTF/Default/Functions.xml` | **≈400** Set Column Values functions in 26 categories |
   | `*.otp` / `*.otpu` (program root) | **515** graph templates, which define the plot types; includes report and preview templates |
   | `Filters/*.oif` + `imp*` X-Functions | 39 import filters, 41 import X-Functions |
   | `%LOCALAPPDATA%\OriginLab\Apps` | 26 preinstalled Apps (list below) |
   | `Themes/`, `Palettes/`, `Samples/` | 186 theme files, 67 palettes, sample projects by topic |

2. **Fold and grep.** The inventory was folded into 383 user-level
   features (the table rows below). Each feature got an evidence regex, which was searched over the
   3,413 non-test source files of `src/quantized/` and `frontend/src/`. Every
   zero, low or suspicious hit was then re-checked line by line, and false
   positives were removed. Examples of false positives: "WAV" matched
   *wavelength*, and "Smith" matched a CSV comment parser. This catches code
   that exists. It does not prove a feature is pleasant to use.

3. **COM probe.** Three runs, about 90 calls, in one owned hidden
   `Origin.Application` (`tools/plot_corpus/origin_session.py`: refuses to
   start beside another Origin, never `ApplicationSI`, and kills only its own
   PID). Each call ran on seeded synthetic data under a 60 s deadline. Origin
   was confirmed gone after every run.

4. **Online sweeps (2026-11-25).** One timed agent made a first pass over
   the 2026/2026b pages and the interface guide. Three cheaper agents then
   (a) re-verified those rows in code, (b) swept the product pages and the
   Pro comparison, and (c) swept the 2018–2025b what's-new pages. Each
   lists only features absent from earlier sections; see sections E–G.

5. **GUI pass: not done.** The screen-control request timed out unanswered.
   See [What the GUI pass would still verify](#what-the-gui-pass-would-still-verify).

---

## Origin Student as an oracle: what was measured

- **Edition flags.** `system.product = 13`. Bit 0 is LabTalk's OriginPro
  flag, so this Student build runs with Pro features unlocked.
- **No feature gate was hit.** Every analysis X-Function called with the
  right syntax ran:
  - Signal: CWT, DWT, wavelet denoise, decimation, envelope, coherence,
    Hilbert, unwrap, STFT, white noise, level crossing.
  - Math: trace interpolation, polygon and XYZ surface area, 3D
    interpolation, curve averaging, curve intersection.
  - Gridding: Renka-Cline, Shepard, thin-plate spline.
  - Worksheet: pivot, conditional-format heatmap, remove duplicates.
  - Stats: row-wise t-test, k-means, hierarchical clustering, PCA, PLS,
    discriminant analysis, Kaplan-Meier, graphical summary, distribution
    fit, Shapiro-Wilk, Dixon Q, Grubbs, Spearman/Kendall, partial
    correlation, Friedman, Kruskal-Wallis, Mann-Whitney, 2D binning.
- **Exports are clean.** `expGraph` PNGs carry no "Student" watermark
  (checked by eye, 2026-11-25).
- **Graph templates work.** Built from a fresh small book: Beeswarm, Line,
  Ridgeline (`worksheet -p 121 ridgeline`), Smith chart, stacked histogram
  (`-pk 219 HistStacked`), wind rose (`plot_windrose`) and marginal plots
  (`plot_marginal`).
- **Template caveats.**
  - Menu recipes of the form `run.section(,general,…)` returned OK over COM
    but drew no graph: Radar, half violin, sunburst, error band. They need
    the menu's context, so the GUI pass should check them.
  - `plottreemapm` **crashed** the hidden instance (RPC failure). The
    owned-PID harness contained it. Keep treemap oracles in a separate
    session.
  - The first probe built many templates into one book and selected the
    wrong sheet. The corpus recipe works: one `Execute()` per step, with
    `page.active = 1` set before `worksheet -s`.
- **Calls not confirmed (argument shape, not gating).** These failed with
  the argument shapes tried, and no feature-gate message was seen:
  `bspline` (`iy` + `ox:=<new>`), Cox PH (`phm_Cox` with a combined
  time/censor/covariate range), `PSS_tTest2` (power and sample size),
  `funcRank` (needs a dialog tree of function categories), and the 3D
  colormap surface (never reached: the treemap crash ended that run first).
  Treat these as "ships, not exercised".
- **Apps.** These 26 came preinstalled: CSV, Excel, Google Sheets, HDF,
  HTML, Import Filter, JSON, MATLAB, Minitab, NetCDF, Origin, Prism,
  Shapefile, TDMS and XML Connectors; Fitting Function Library; Graph
  Annotator; Graph Maker; Graph Publisher; Predictive Modeling Advisor;
  Send Graphs to PowerPoint; Send Graphs to Word; Simple Fit; Speedy Fit;
  Stats Advisor; Theme Preview.
  The `appNNN` statistics wrappers are **not** installed: MANOVA, linear
  mixed model, factor analysis, decision tree, logistic, Poisson, general
  linear regression, best subset, probit, reliability, probability
  calculator, standard curve, enzyme kinetics, fit-comparison apps, ANOVA
  from summary, chi-square. In Student they would need an Apps Center
  download; that was not tried.
- **Known from earlier sessions.**
  - Student saves `.opj` as `.opju` (`ORIGIN_PLOT_TYPE_PARITY_PLAN.md`).
  - The documented "~52 page" load limit did not reproduce for `.opju`.

---

## Summary

| Area | Have | Partial | Missing | Out / N/A | Rows marked **?** | Rows marked *Out?* |
|---|---:|---:|---:|---:|---:|---:|
| A. Analysis & fitting | 91 | 31 | 32 | 5 | 28 | 5 |
| B. Graphs & figure styling | 47 | 13 | 31 | 0 | 13 | 11 |
| C. Data & worksheet | 47 | 18 | 38 | 1 | 14 | 7 |
| D. Automation & workflow | 11 | 7 | 8 | 3 | 6 | 2 |
| **Total (383 rows)** | **196** | **69** | **109** | **9** | **61** | **25** |

Online-documentation sections (counted separately; the statuses in F and G are less
thoroughly verified than in A–D):

| Section | Rows | Have | Partial | Missing | Out | ? |
|---|---:|---:|---:|---:|---:|---:|
| E. What's new 2026/2026b + GUI tools (code-verified) | 60 | 12 | 26 | 19 | 3 | 0 |
| F. Product pages / Pro comparison | 57 | 8 | 14 | 31 | 4 | 0 |
| G. What's new 2018–2025b | 83 | 10 | 15 | 54 | 2 | 2 |

Counts are table rows, not weights. A row such as "fit library breadth"
stands for dozens of Origin functions. *Out?* rows are Missing or Partial
items that look out of scope; the owner confirms them in item 4 and item 11
of the discussion list.

**The biggest clusters of missing features, in the install's terms:**

1. Signal processing: wavelets, coherence, FIR decimation and phase unwrap
   (G10 residue).
2. Clustering and multivariate statistics: k-means and hierarchical
   clustering (J13), factor analysis, MANOVA, mixed models, decision trees.
   Also power and sample size, the probability calculator, and row-wise
   t-tests.
3. Specialised plot types. Wind rose, radar, Smith chart, ridgeline,
   marginal plots, half/split violin, Sankey, chord and treemap families.
   Also polar bar, CDF plot and rug.
4. Fit-library breadth: about 33 of Origin's built-in named models are
   shipped; about 270 are not. Any of them can still be typed as a user
   equation.
5. Worksheet formula breadth: about 100 functions in quantized against
   about 400 in Origin. The missing families are distributions, NAG special
   functions, moving-window statistics, conditional aggregates, complex
   numbers and lookup functions.
6. Import breadth beyond lab instruments: TDMS, SPE, ISF, ABF, EDF, WAV,
   JSON, ODBC, Igor `.pxp`, SAS/Prism/Minitab (G17 residue).
7. Figure export: no **EPS** or **EMF**.
8. Automation surfaces: no in-app script or console (G18), no event
   scripts, no custom menus or toolbars, no app store.

---

## A. Analysis & fitting

### A1. Curve fitting

| Feature | Origin | Student | quantized | Status | Rank |
|---|---|---|---|---|---|
| Linear fit | FitLinear | — | `calc/stats_linear_model.py`, Curve Fit | Have | — |
| Linear fit with X **and** Y errors (York / Deming) | FitLRXErr | — | none | Missing | ? |
| Polynomial fit | FitPolynomial | — | Curve Fit poly models, `calc/baseline.py` | Have | — |
| Multiple linear regression | MR, fitMR | — | `calc/stats_linear_model.py`, Fit Model (G1) | Have | — |
| Nonlinear curve fit (NLFit) | FitNL, nlbegin… | ran | `calc/fitting.py`, `workshops/curvefit` | Have | — |
| Implicit fit (ODR) | FitODR | — | `calc/fit_odr.py`, `calc/fit_implicit.py` | Have | — |
| Fit with several dependent / independent variables in one model | nlbeginr | — | global fit shares parameters across datasets; no multi-output model | Partial | ? |
| Nonlinear fit of a 3D function to **matrix** data | Fitmatrix, nlbeginm | — | `calc/surface_fit.py` fits XYZ point clouds; maps are point clouds, so likely reachable | Partial | ? |
| Nonlinear surface fit (XYZ) | Fitsurface | — | `calc/surface_fit.py`, `workshops/surfacefit` | Have | — |
| Global fit with shared parameters | NLFit (multi-data) | — | `calc/global_fit.py`, `GlobalFitSection.tsx` | Have | — |
| User-defined fit functions (builder, organizer) | fitfuncwiz | — | `calc/fit_equation*.py`, `lib/fitmodels.ts`, fit templates | Have | — |
| Compare two datasets with one model | fitcmpdata | — | `calc/dataset_compare.py` | Have | — |
| Compare two models (F-test, AIC, BIC) | fitcmpmodel | — | `calc/fit_model_compare.py`, `calc/fit_metrics.py` | Have | — |
| Rank **every** model in a category automatically | funcRank | not exercised | Compare fits a user-chosen list only | Partial | ? |
| Fit-parameter equality test | app501 (App) | App | `calc/dataset_compare.py` (one shared value test) | Have | — |
| Compare fits across datasets (linear / nonlinear) | app230 / app302 (App) | App | global fit compare | Have | — |
| Simulate curve from a model | simcurve | — | `workshops/functionplot`, `calc/model_evaluate` | Have | — |
| Simulate surface from a model | simsurface | — | function plot is 1-D; surface models in `calc/surface_models.py` | Partial | — |
| Per-pixel linear fit through a matrix stack | mstacklr | — | none | Missing | ? |
| Confidence and prediction bands | NLFit output | — | `calc/stats_band.py`, `useFitBands.ts` | Have | — |
| Studentized / deleted residuals on curve fits | NLFit residual analysis | — | in linear-model stats only (`calc/stats_lm_compare.py`) | Partial | — |
| Residual diagnostic plots (vs order, lag, histogram, normal probability) | ReportResidual* | — | `ResidualPlotGrid.tsx` | Have | — |
| Weighting (instrumental, statistical, direct) | NLFit | — | Curve Fit weighting | Have | — |
| Parameter bounds and linear constraints | NLFit | — | `calc/fit_constraints.py` | Have | — |
| ODE-defined models | (App in Origin) | — | `calc/fit_models_ode.py` | Have | — |
| Bootstrap parameter errors | (App) | — | `routes/fitting_bootstrap.py` | Have | — |
| Robust and quantile fits | (App) | — | `calc/fit_robust.py`, `calc/fit_quantile.py` | Have | — |
| Bayesian / MCMC fitting | none in Origin | — | `calc/fit_bumps.py`, `calc/mcmc.py` | Have (leads) | — |
| Find Y from X / X from Y on a fit | NLFit tab | — | `calc/fit_findxy.py`, `FindXYSection.tsx` | Have | — |
| Fit report and flat report sheet | FitFlatReport, getnlr | — | `calc/fit_report.py`, result book | Have | — |
| Piecewise fit | PWL2 / PWL3 | — | `calc/fit_piecewise.py` | Have | — |
| Convolution fit (model ⊗ instrument response) | (App) | — | `calc/fit_convolve.py` | Have | — |
| Quick fit / sigmoidal fit gadget on a graph ROI | addtool_quickfit, addtool_sigmoidal_fit | — | `lib/quickfit.ts`, `store/gadget.ts` (fit gadget; no sigmoid preset) | Have | — |
| Standard / calibration curve (fit standards, read unknowns) | app573 (App) | App | Find X from Y covers reading unknowns; no guided tool | Partial | ? |
| Enzyme kinetics set (inhibition models, Lineweaver-Burk) | app335 (App) + Enzyme Kinetics FDFs | App | Michaelis-Menten only | Partial | ? |

### A2. Fit-function library breadth

quantized ships three groups of models. **33 Origin-named models**
(`calc/fit_models_origin_*.py`, `calc/fit_scan.py`): Gauss, GaussAmp,
Lorentz, Voigt, PsdVoigt1/2, LogNormal, Asym2Sig, ExpDec1–3, ExpDecay1–3,
ExpGro1/2, ExpGrow1/2, Boltzmann, DoseResp, Hill, Hill1, MichaelisMenten,
Logistic5, SLogistic1, SGompertz, SWeibull1, Poly, Poly5, Allometric1,
Proportional, Sine, SineDamp. About **35 domain models**: magnetic,
thermal, hysteresis, VFT, Langmuir (`docs/fit_models.md`). Peak shapes:
Doniach-Šunjić, Pearson VII, Fano, split pseudo-Voigt, TCH. Any formula
can also be typed as a user equation. The fit-equation language
(`calc/fit_equation.py`) has Bessel functions.

| Origin fitting category (`Functions.xml`) | Count | quantized | Status | Rank |
|---|---:|---|---|---|
| Origin Basic Functions | 21 | most present (missing Beta, dhyperbl, Pulse, Rational0, Poisson) | Partial | — |
| Exponential | 49 | ExpDec/ExpGro/ExpGrow family only; missing Asymptotic1, BoxLucas, Chapman, ExpAssoc, Exp1P*–Exp3P*, ExpLinear, PIPlatt/PIWebb, Stirling, MnMolecular… | Partial | ? |
| Growth / Sigmoidal | 19 | missing BiDoseResp, BiHill, BoltzIV, DoubleBoltzmann, SRichards1/2, SLogistic2/3, SWeibull2 | Partial | — |
| Hyperbola | 5 | none (Hyperbl, Dhyperbl, HyperbolaGen/Mod, RectHyperbola) | Missing | — |
| Logarithm | 5 | Logarithmic (MATLAB) only | Partial | — |
| Peak Functions | 23 | missing Beta, Bigaussian, CCE, ECS, Extreme, GaussMod (EMG), GCAS, Giddings, InvsPoly, Laplace, Logistpk, PearsonIV, Weibull3 | Partial | ? |
| PFW (peak-fitting) shapes | 28 | have Doniach-Šunjić, Pearson VII, Fano (≈ BWF), Voigt family; missing Fraser-Suzuki, HVL, Schulz-Flory, Gaussian-Lorentz cross, ConsGaussian | Partial | ? |
| Piecewise | 2 | `calc/fit_piecewise.py` | Have | — |
| Polynomial | 8 | Have | Have | — |
| Power | 18 | Power, Allometric only; missing Belehradek, BlNeld, FarazdaghiHarris, Freundlich, Gunary, LangmuirEXT, Pareto, Pow2P* | Partial | — |
| Rational | 15 | missing BET, Holliday, Nelder, Rational0–5, Reciprocal* | Missing | ? |
| Waveform | 7 | Sine, SineDamp; missing Sawtooth, SquareWave, SineSqr, Step | Partial | — |
| Surface Fitting | 22 | `calc/surface_models.py` (subset) | Partial | — |
| Implicit | 5 | circle and ellipse (`workshops/implicitfit`); missing ModDiode, PlaneMod, SolarCellIV | Partial | ? |
| Baseline | 15 | baseline models in `calc/baseline.py`, `calc/backgrounds.py` | Have | — |
| Statistics (CDFs, Gumbel, Rayleigh…) | 20 | distribution fit covers several | Partial | — |
| Rheology (Bingham, Cross, Carreau, Herschel, VFT, MYEGA) | 6 | VFT only | Partial | ? |
| Chromatography | 6 | none | Missing | Out? |
| Electrophysiology (BoltzIV, Goldman) | 9 | none beyond Boltzmann | Missing | Out? |
| Pharmacology / Binding / Dose Response | 23 | DoseResp, Hill; missing Biphasic, One/Two-site binding and competition | Partial | Out? |
| Enzyme Kinetics (1 + 2) | 34 | MichaelisMenten | Partial | Out? |
| Multiple Variables | 5 | none | Missing | — |

### A3. Peaks and spectroscopy

| Feature | Origin | Student | quantized | Status | Rank |
|---|---|---|---|---|---|
| Peak Analyzer wizard (baseline, find, fit, integrate) | pa, pa_* | — | `workshops/peakwizard` | Have | — |
| Baseline from user anchors / interpolation | pa_anchors | — | `workshops/baseline`, `lib/uplotAnchors.ts` | Have | — |
| Asymmetric least squares baseline | pa_alsbase | — | `calc/baseline.py` (ALS) | Have | — |
| XPS Shirley / Tougaard baseline | pa_xpsbase | — | `calc/backgrounds.py` | Have | — |
| Auto baseline anchors | blauto | — | SNIP (`calc/_snip.py`), auto baseline | Have | — |
| End-point / fixed baseline modes | pa_basemode, pa_epbase | — | baseline workshop | Have | — |
| Multiple peak fit | fitpeaks, nlfitpeaks | — | `calc/peak_multifit*.py` | Have | — |
| Batch peak analysis with a saved theme | paMultiY | — | `calc/peak_batch.py`, `usePeakBatch.ts` | Have | — |
| Peak finding: 1st / 2nd derivative, window search, residual after 1st derivative | pkFind | — | local maxima on the residual, prominence, matched-filter noise (`calc/peaks.py`, `calc/peak_noise.py`); no derivative modes | Partial | ? |
| Peak integration table (area, centroid, FWHM) | pa_int | — | `calc/peak_integrate.py` | Have | — |
| Single-peak fit | Fitpeak | — | Curve Fit with a peak model | Have | — |
| Fourier self-deconvolution, 2D-COS, peak onset (G21) | — | — | `calc/spectro_fsd.py`, `calc/spectro_corr2d.py`, `calc/spectro_onset.py` | Have | — |

### A4. Signal processing

| Feature | Origin | Student | quantized | Status | Rank |
|---|---|---|---|---|---|
| Smoothing: Savitzky-Golay, adjacent average, LOWESS, median, Gaussian | smooth | ran (SG) | `calc/signal_filters.py`, `calc/processing.py` | Have | — |
| Smoothing: percentile filter, binomial | smooth | — | none | Missing | — |
| FFT filters (low / high / band pass and block, threshold) | fft_filters | — | `calc/spectral.py` | Have | — |
| 2D FFT and 2D FFT filter on matrices | fft2, fft_filter2 | — | `calc/map_fft.py` (G22) | Have | — |
| FFT / IFFT with windows | fft1, ifft1 | — | `calc/spectral.py`, `calc/signal_ifft.py` | Have | — |
| Short-time FFT / spectrogram | stft | ran | `calc/spectrogram.py`, `SpectrogramBody.tsx` | Have | — |
| Continuous wavelet transform | cwt | ran | none | Missing | ? |
| Discrete / multi-level wavelet decompose and reconstruct | dwt, mdwt, idwt, dwt2, idwt2 | ran (dwt) | none | Missing | ? |
| Wavelet denoise / smooth | wtdenoise, wtsmooth | ran | none | Missing | ? |
| IIR filter design and apply | dfilter | — | `calc/iir_filter.py`, `calc/iir_workbench.py` | Have | — |
| Convolution / Wiener deconvolution | conv, deconv | — | `calc/signal_filters.py`, `calc/signal_ops.py` | Have | — |
| Cross-correlation of two signals | corr1 | — | `calc/spectral.py` `cross_correlation` | Have | — |
| 2D correlation of two matrices | corr2 | — | none (`spectro_corr2d` is Noda 2D-COS, a different method) | Missing | — |
| Coherence | cohere | ran | none | Missing | — |
| Hilbert transform / analytic signal | hilbert | ran | `calc/signal_filters.py` `hilbert_envelope` | Have | — |
| Envelope from local extrema | envelope | ran | Hilbert envelope only | Partial | — |
| Decimation with an anti-alias filter | decimate | ran | display decimation only (`calc/decimate.py`) | Missing | — |
| Phase unwrap | unwrap | ran | none | Missing | — |
| Rise / fall time | addtool_rise_time | — | none | Missing | ? |
| Level crossing (X where data crosses Y) | levelcrossing | ran (12 crossings) | Find X from Y on a **fit** only | Partial | ? |
| Add white noise | white_noise | ran | formula `normal(seed)` | Partial | — |

### A5. Mathematics

| Feature | Origin | Student | quantized | Status | Rank |
|---|---|---|---|---|---|
| Integrate XY (area, cumulative) | integ1 | — | `calc/signal_ops.py`, integrate gadget | Have | — |
| 2D volume integration of a matrix / ROI | integ2, addtool_integ2 | — | box-ROI integration on RSM maps (`routes/rsm.py`, `calc/linecut.py`) | Partial | ? |
| Differentiate (incl. smoothed) | differentiate | — | `lib/differentiate.ts`, `calc/processing.py` | Have | — |
| Interpolate / extrapolate (linear, spline, PCHIP, Akima) | interp1xy | — | `calc/resample.py` (linear, pchip, spline, makima) | Have | — |
| B-spline interpolation | bspline | not exercised | B-spline baseline only | Partial | — |
| Trace / periodic interpolation | interp1trace | ran | none | Missing | — |
| 3D interpolation (XYZ → W) | interp3 | ran | none | Missing | — |
| Interpolate Z from XY | interp2, minterp2 | — | `calc/interp2d.py` | Have | — |
| Intersection points of two curves | intersect | ran | none (only tangent intersections inside `calc/spectro_onset.py`) | Missing | ? |
| Average / merge multiple curves | avecurves | ran | `calc/curve_average.py` | Have | — |
| Normalize (range, max, area, z-score, reference point) | normalize, cnormalize | — | `calc/processing.py` | Have | — |
| Subtract reference / straight line | subtract_ref, subtract_line | — | baseline workshop, dataset math | Have | — |
| Simple curve / column math | mathtool, vmathtool | — | dataset math workshop, formulas | Have | — |
| Polygon area | polyarea | ran (19.73) | none | Missing | — |
| Surface area of matrix / XYZ | marea, xyzarea | ran | none | Missing | — |
| Matrix inverse | minverse | — | none (no matrix-algebra UI) | N/A | — |
| Complex vectors / matrices (amplitude-phase, real-imag) | vc2ap, mc2ri… | — | none in UI | Missing | — |
| Spherical ↔ Cartesian | sph2cart | — | internal to `calc/polar_map.py` | Partial | — |

### A6. Statistics

| Feature | Origin | Student | quantized | Status | Rank |
|---|---|---|---|---|---|
| Descriptive statistics (columns, rows, whole sheet) | DescStats, rowstats, wstats | — | `lib/api/statsDescriptive.ts`, row functions | Have | — |
| Normality tests (Shapiro-Wilk, KS, Lilliefors, Anderson-Darling, D'Agostino) | NormalityTest | ran (SW) | `calc/stats_tests.py` | Have | — |
| Pearson / Spearman / Kendall correlation | corrcoef | ran | `calc/stats_multivar.py` | Have | — |
| Partial correlation | pcorrcoef | ran | `calc/stats_multivar.py` | Have | — |
| Cross tabulation and chi-square | crosstab, app339 | — | `calc/stats_contingency.py` | Have | — |
| Frequency counts / 2D binning | freqcounts, twoDBinning | ran | `lib/frequencyCount.ts` | Have | — |
| Distribution fit | distfit | ran | `calc/statplots.py`, `calc/stats_dist.py` | Have | — |
| Grubbs / Dixon Q outlier tests | grubbs, qtest | ran | `calc/stats_outliers.py` | Have | — |
| t-tests: one-sample, two-sample, paired | ttest* | — | stats tests workshop | Have | — |
| **Row-wise** t-tests (one test per row) | rowttest2, rowttestpair | ran | none | Missing | ? |
| Variance tests (χ², F, Levene, Bartlett) | vartest1/2 | — | `calc/stats_group_tests.py` | Have | — |
| Proportion tests (one, two, homogeneity) | *ProportionTest | — | `calc/stats_proportion.py` | Have | — |
| Poisson rate tests | *PoissonRateTest | — | `routes/stats_tests_ext.py` | Have | — |
| ANOVA one / two / three way | ANOVA* | — | `calc/stats_anova2.py`, `calc/stats_anova_ext.py`; n-way through Fit Model (`calc/stats_linear_model.py`, G1) | Have | — |
| Repeated-measures ANOVA | ANOVAOneWayRM, TwoWayRM | — | `routes/stats_design.py` | Have | — |
| Means comparison (Tukey, Bonferroni, Scheffé, Dunnett…) | ANOVA option | — | `calc/stats_anova2.py`, `calc/stats_lm_compare.py` | Have | — |
| MANOVA | app602 (App) | App | none | Missing | ? |
| Linear mixed-effects model | app567 (App) | App | variance components only (`calc/stats_varcomp.py`) | Partial | ? |
| ANOVA from summary data | app617 (App) | App | variability workshop path | Partial | — |
| Nonparametric: Mann-Whitney, Kruskal-Wallis, Friedman, Wilcoxon, sign, Mood median, KS 2-sample | NPH*, kwanova… | ran (MW, KW, Friedman) | `calc/stats_tests.py`, `calc/stats_nonparam_ext.py` | Have | — |
| Power and sample size (t, ANOVA, proportions, variance, Poisson) | PSS_* | not exercised | none | Missing | ? |
| Sample size for estimation (margin of error) | sample_size_estimation | — | none | Missing | — |
| ROC curve | ROCCurve | — | `calc/stats_roc.py` | Have | — |
| PCA | pca | ran | `workshops/multivar` | Have | — |
| PLS regression | pls | ran | `calc/stats_pls.py` (G12) | Have | — |
| Discriminant analysis | discrim | ran | `calc/stats_lda.py` | Have | — |
| K-means clustering | kmeans | ran | none (J13) | Missing | ? |
| Hierarchical clustering + dendrogram | hcluster | ran | none (J13) | Missing | ? |
| Factor analysis | app422 (App) | App | none (G12 residue) | Missing | — |
| Decision tree | app1042 (App) | App | none (G14) | Missing | Out? |
| Logistic regression | app329 (App) | App | `calc/stats_glm.py` | Have | — |
| Poisson regression / GLM | app995, app336 (App) | App | `calc/stats_glm.py` | Have | — |
| Best subset selection | app1054 (App) | App | `routes/stats.py` best subset | Have | — |
| Survival: Kaplan-Meier, Cox PH, Weibull | kaplanmeier, phm_Cox, weibullfit | ran (KM) | `calc/stats_survival.py`, `calc/stats_life*.py` | Have | — |
| Probit analysis | app606 (App) | App | none (probit axis scale only) | Missing | — |
| Reliability / life data | app1062 (App) | App | `calc/stats_life*.py`, `calc/life_*.py` (G8) | Have | — |
| Probability distribution calculator (pdf, cdf, inverse) | app304 (App) | App | none | Missing | ? |
| Graphical summary (statistics, histogram, box and CI on one page) | gsummary | ran (4 windows) | Distribution workshop (`workshops/distribution`: histogram, box strip, descriptive stats, Shapiro-Wilk, distribution fit); no CI panel | Partial | — |
| Equivalence tests (TOST) | none in Origin | — | `calc/stats_equivalence.py` | Have (leads) | — |
| SPC charts / capability (J14) | (Apps) | — | `calc/spc_*.py` | Have | — |
| Design of experiments (J16) | (Apps) | — | `calc/doe*.py` | Have | — |
| Time series: ACF, ARIMA, decomposition, change point (G13) | (Apps) | — | `calc/ts_*.py` | Have | — |
| Statistics / modelling advisor | Stats Advisor, Predictive Modeling Advisor (Apps, installed) | — | `workshops/statschooser` | Have | — |

### A7. Image and vision (`Image/*`, `Vision/*`: 111 X-Functions)

EM and image analysis are **out of scope** (`CLAUDE.md`: they live in
`fermiviewer`). They are listed so the catalogue is complete. Only map
operations on lab maps matter here.

| Feature | Origin | quantized | Status | Rank |
|---|---|---|---|---|
| Image adjustments (brightness, contrast, gamma, levels, hue) | Image/Adjustments | none | Out | — |
| Spatial filters on maps (Gaussian, median, sharpen, edge, user kernel) | Image/Spatial Filters, cv* | `calc/map_imgfilt.py` | Have | — |
| Threshold / binarize, morphology, watershed, distance map | imgBinary, imgMorph, cvWatershed… | none | Out | — |
| Geometric transforms on maps (crop, flip, rotate, transpose) | Image/Geometric Transform, mCrop… | `calc/map_ops.py` (G3) | Have | — |
| Map arithmetic / background subtraction | imgSimpleMath, imgSubtractBg | `calc/map_arith.py` | Have | — |
| RGB split / merge, palette conversion | imgRGBsplit… | none | Out | — |
| Line / ROI intensity profiles | image lines profile, mroiprofile | `calc/linecut.py`, `workshops/roicuts` | Have | — |
| Video import / image-stack movies | OVideoReader, expm2video | animation export only | Out | — |

---

## B. Graphs & figure styling

The 2D plot types Origin's plotting toolbar makes are tracked type by type
in `ORIGIN_PLOT_TYPE_PARITY_PLAN.md` (items 10–26 plus the Lane B residue).
The rows below cover the **rest** of the 515 templates.

### B1. Plot types beyond the parity plan

| Feature | Origin template / X-Function | Student | quantized | Status | Rank |
|---|---|---|---|---|---|
| 3D surface / colormap surface | gl3D, glCMAP, glXYZ2MatCMAP | — | `components/Stage/Map3D/*`, `calc/figure_map3d.py` | Partial | Out? |
| 3D waterfall | glWater3D, WATER3D | — | `workshops/waterfall/Waterfall3dSection.tsx` | Have | — |
| 3D scatter / trajectory / bars / vector / walls / ribbons | gl3DScatter, glTraject, glBar3D, gl3DVector… | — | none | Missing | Out? |
| 3D ternary / tetrahedral | gl3DTERNARYSCATTER, gl3DTetrahedral | — | none | Missing | Out? |
| Bubble / colour-mapped scatter | bubble, bubblecmap, colormapped | — | `lib/colorscatter.ts`, `calc/figure_bubble_pad.py` | Have | — |
| Vector XYAM / XYXY, quiver, streamline | VECTOR, VECTXYXY, Streamline | — | `workshops/fieldplot` | Have | — |
| Contour + quiver / streamline overlay | ContQuiver, ContStream, plot_mquiver | — | `workshops/fieldplot` | Have | — |
| Contour from scattered XYZ (triangulation) | TRICONTOUR, TRIcontline | — | `calc/figure_map.py` (tricontour) | Have | — |
| Polar heatmap / polar contour (G2) | PolarheatmapMat, PolarContour | — | `workshops/polarmap` | Have | — |
| Polar bar / radial bar / radial stacked bar / spiral bar | PolarRThetaBar, RadialBar, SpiralBar | — | none | Missing | — |
| Wind rose | WindRose, WindRoseRaw, plot_windrose | graph | none | Missing | — |
| Radar / spider (G15) | Radar | not drawn over COM | none | Missing | ? |
| Smith chart | SmithCht | graph | none | Missing | ? |
| Compass / kite | Compass, kite | — | none | Missing | — |
| Ternary contour / heatmap (G15) | TernaryContour, glCMAPTernary | — | none: `calc/figure_ternary.py` draws scatter only; `contour-scattered` grids on Cartesian axes | Missing | ? |
| Ternary vector / line | TernaryVector, TERNARYLine | — | ternary scatter only | Partial | — |
| Piper / Durov / Stiff (hydrochemistry) | Piper, Durov, Stiff, plotpiper | — | none | Missing | Out? |
| Sankey / alluvial / parallel sets | Sankey, Alluvial, parallelset | — | none | Missing | Out? |
| Chord / network / edge bundling | chord, Network, EdgeBundling | — | none | Missing | Out? |
| Treemap / sunburst / tree / phylogenetic tree | Treemap, sunburst, tree, PolarPhyTree | crashed (treemap) | none | Missing | Out? |
| Mosaic plot | MosaicPlot, plot_mosaic | — | `workshops/fityx/MosaicPlot.tsx` | Have | — |
| Marginal plots (scatter + histogram / box / violin / contour margins) | Marginal_*, plot_marginal | graph | corner plot for MCMC only (`calc/figure_corner.py`) | Missing | ? |
| Scatter matrix | ScatterMatrix, plot_matrix | — | `workshops/multivar/SplomView.tsx` | Have | — |
| Q-Q plot | QQ, plot_prob | — | `calc/statplots.py` (Q-Q) | Have | — |
| P-P / probability plots for 11 distributions | PP*, gPP* | — | Weibull / life probability plots (`calc/stats_life*`) | Partial | — |
| CDF / ECDF plot | CDF, plot_cdf | — | none | Missing | ? |
| Ridgeline | Ridgeline | graph | none | Missing | ? |
| Beeswarm / strip / jitter | Beeswarm, ColumnScatter | graph | `lib/jitter.ts`, `GroupedStrip.tsx` | Have | — |
| Half violin / split violin / raincloud / box + data | HalfViolin, ViolinSplit, BOX+DATA* | not drawn over COM | decoded on import (`opju_stat_plots.py`), no creation | Missing | ? |
| Lollipop / dot plot / Cleveland | Lollipop, gdot, statdot | — | none | Missing | — |
| Bridge (waterfall) chart | BridgeChart, StackedBridgeChart | — | none | Missing | Out? |
| Bullet chart | Bullet* | — | none | Missing | Out? |
| OHLC / candlestick / high-low-close | Candlestick, OHLCBarchart, HLCLOSE | — | decoded on import only | Missing | Out? |
| Before-after / paired-lines plot | BeforeAfter | — | none found | Missing | — |
| Interval / means / interaction / main-effects plots | BoxInterval, MeansPlot, Interaction, MainEffect | — | DOE effects plots (`calc/doe_effects.py`) | Partial | — |
| Multi-vari / variability chart | multivari, Variability | — | `workshops/variability` | Have | — |
| Run chart (runs test about the median) | Runchart, plot_runchart | — | I-MR control chart (`calc/spc_charts.py`) | Partial | — |
| Error band / filled band | ERRORBAND | not drawn over COM | `useFitBands.ts`, fill modes | Have | — |
| Fill area between two curves | FillLine, FILLAREA | — | `fill: "between"` | Have | — |
| Drop lines | DROPLINE | — | `lib/uplotDropLines.ts` | Have | — |
| Pie of pie / bar of pie / doughnut variants | PIEofPie, BarofPie, DonutDiffRadius | — | pie / doughnut (`calc/figure_pie.py`) | Partial | — |
| Heatmap with labels / split heatmap / multi-variable heatmap | Heat_Map_With_Labels, SplitHeatMap | — | heatmap; labels? | Partial | ? |
| Tile / territorial / pie / bar maps | TileGridFillOnly, TerritorialMap, PieMap, BarMap | — | none | Missing | Out? |
| Stacked histogram / histogram + rug / histogram matrix | HistStacked, HistogramRug, HistMatrix | graph (stacked) | multi-column overlay histogram only | Partial | — |
| Density-coloured scatter (density dots) | DensityDots, ColorDots | — | hexbin and 2D KDE instead | Partial | — |
| Population pyramid | PopulationPyramid | — | none | Missing | — |
| Multiple Y axes (3–4 axes) | 3Ys_*, 4Ys_*, plotmyaxes | — | `calc/figure_multi_y.py` | Have | — |
| Zoom / enlarged inset | ZOOM1, ENLARGED | — | `components/Stage/InsetPlot.tsx`, `calc/figure_inset.py` | Have | — |
| Image / contour line profiles | PROFILE_* | — | `workshops/profiler`, linecuts | Have | — |
| 2D / 3D function plot, parametric function | Function, glFunc, glParaFunc | — | `workshops/functionplot` (y = f(x)) | Partial | — |
| Trellis / group plots, plot by label | plot_group, plotbylabel | — | facets (`calc/figure_facets*.py`) | Have | — |
| Stack browser (page through panels) | plotstackbrowser | — | none | Missing | — |
| Line coloured by a column | LineCmap | — | `color_by` on lines (`lib/exportDefaultTrace.ts`) | Have | — |
| Spectrogram plot | stftSpectrogram | — | `SpectrogramBody.tsx` | Have | — |
| 2D kernel density, hexbin, Bland-Altman, Pareto, parallel coordinates (G15) | kdCONTOUR, BA_*, Pareto*, parallel | — | plot-type gallery | Have | — |

### B2. Graph construction and styling

| Feature | Origin | Student | quantized | Status | Rank |
|---|---|---|---|---|---|
| Layer management (add, m × n, align, link, swap) | layadd, laymanage, laylink, layarrange | — | `figure_layers`, `GraphLayerBox.tsx`, layer commands | Have | — |
| Merge graph windows / layout page with graphs, sheets, text | merge_graph, g2layout, LAYOUT | — | figure page (`lib/figurepageActions.ts`), window layout | Have | — |
| Insert a worksheet range as a **linked image** in a graph or layout | insert_wks_to_layer, add_table_to_graph | — | fit-results table only (`lib/fitTableLayer.ts`) | Partial | ? |
| Legend: auto-update, categorical, enhanced box legend | legendupdate, legendcat, legendbox | — | `PlotLegend.tsx`, `LegendDialog.tsx` | Have | — |
| Axis scales: log10/ln/log2, reciprocal, probability, logit | Axis dialog | — | `calc/axis_scales.py` | Have | — |
| Axis breaks | Axis dialog | — | `calc/axis_breaks.py` | Have | — |
| Tick labels from formula / dates / categories | Axis dialog | — | `calc/axis_expr.py`, `axis_dates.py`, `axis_categories.py` | Have | — |
| Axis scroller / scrollbar for zoom and pan | axis_scroller, axis_scrollbar | — | none | Missing | — |
| Straight reference lines | addline | — | `canonicalRefLines.ts` | Have | — |
| Annotations: text, arrows, shapes, rich text, LaTeX | Graph objects, TeXExtensions | — | annotations, `lib/equationLatex.ts` | Have | — |
| Data labels on points | label plots | — | `calc/figure_point_labels.py` | Have | — |
| Palettes / colormaps, colour-blind checks | Palettes (67), palEdit, colorManager | — | `lib/palettes.ts`, `lib/colormap.ts`, `lib/cvd.ts` | Have | — |
| Palette **editor** (make and save a palette) | palEdit | — | none | Missing | — |
| Graph / worksheet themes, Theme Organizer (apply to many) | Themes/, themeApply2g | — | `lib/graphFormatBulk.ts` | Have | — |
| Increment lists (colour / symbol / line cycles) | IncrementList | — | `lib/seriesStyleCycle.ts`, `lib/seriesRamp.ts` | Have | — |
| Graph templates (save, apply, library) | template_saveas, Template Library | — | plot recipes (`store/plotRecipes.ts`, Recipe Manager) | Have | — |
| Copy / paste format | Copy Format | — | `copy-format` / `paste-format` commands | Have | — |
| Speed mode for large data | speedmode | — | screen downsampling (`lib/downsample.ts`) | Have | — |
| Export formats PDF, SVG, PNG, TIFF, JPEG | expGraph | ran (PNG) | figure export routes (also WebP) | Have | — |
| Export **EPS** / PS | expGraph | — | none | Missing | ? |
| Export **EMF** (Office vector) | expGraph, Copy Page | — | none (no matplotlib EMF backend, per `desktop_bridge_clipboard.py`) | Missing | ? |
| Export BMP / GIF / PSD / DXF / CGM | expGraph | — | none | Missing | — |
| Export graph as video / animation (G20) | expG2video, mkvid | — | `workshops/animation`, `routes/export_figure_animation.py` | Have | — |
| Copy graph to clipboard as picture | copypic, copyimg | — | `desktop_bridge_clipboard.py` (SVG / PNG) | Have | — |
| Send graphs to PowerPoint / Word | Send Graphs to PowerPoint / Word (Apps) | — | report export docx / pptx (`io/report_export.py`) | Have | — |
| Slide show of graphs | pef_slideshow | — | none | Missing | — |
| Data reader / vertical cursor across plots | verticalcursor | — | `PlotReadouts.tsx`, cursor gadget | Have | — |
| Mask / exclude points from a graph | Data Masking | — | row states (`lib/rowstate.ts`) | Have | — |
| Pick points from a graph into a sheet | pickpoints | — | digitizer only (`workshops/digitizer`) | Partial | ? |
| ROI gadgets: stats, integrate, FFT, derivative, quick fit, cursors | addtool_* | — | `store/gadget.ts` | Have | — |
| ROI gadgets: interpolate, intersect, cluster, rise time, quick peaks, sigmoidal, data extraction, 2D integrate | addtool_* | — | none of these kinds | Partial | ? |
| Digitizer | digitizer | — | `workshops/digitizer` | Have | — |
| Graph slider (step one graph through sheets / columns) | gslider | — | none | Missing | — |
| Dark mode | Themes/DarkMode | — | appearance prefs | Have | — |
| Graph Maker (drag-and-drop builder, App) | Graph Maker | — | Graph Builder (`workshops/graphbuilder`) | Have | — |
| Graph Publisher / Annotator (Apps) | Graph Publisher, Graph Annotator | — | Publication Preview, annotations | Have | — |

---

## C. Data & worksheet

### C1. Import

| Feature | Origin | quantized | Status | Rank |
|---|---|---|---|---|
| ASCII / CSV with wizard and saved filters | impWiz, iwFilter | `io/import_filters.py`, `routes/import_wizard.py` | Have | — |
| Excel XLS / XLSX | impExcel | `io/excel*.py` | Have | — |
| Data connectors / re-import on change | Data Connector, reimport | `store/reimport*.ts`, `io/live_text.py` | Have | — |
| Connect several files at once / clone import | files2dc, cloneimport | `store/importAppend.ts`, `routes/import_template.py` | Have | — |
| HDF5 / NeXus | impHDF5, HDF Connector | `io/hdf5*.py` | Have | — |
| NetCDF | impNetCDF | `io/netcdf.py` | Have | — |
| MATLAB `.mat` | impMatlab | `io/matlab_mat.py` | Have | — |
| Igor `.ibw` | impIgorPro | `io/igor_ibw.py` | Have | — |
| Igor packed experiment `.pxp` | impIgorPro | none | Missing | — |
| JCAMP-DX | impJCAMP | `io/jcamp.py` | Have | — |
| Thermo / Galactic SPC | impSPC | `io/spc.py` | Have | — |
| Bruker OPUS | impBRUKER | `io/opus.py` | Have | — |
| Princeton Instruments SPE | impSPE | none (G17) | Missing | ? |
| Tektronix ISF (oscilloscope) | impISF | none | Missing | ? |
| NI TDM / TDMS / DIAdem | impNITDM, TDMS Connector | none (G17) | Missing | ? |
| pCLAMP ABF / HEKA (electrophysiology) | imppClamp, impHEKA | none | Missing | Out? |
| EDF / BDF (biosignals) | impEDF | none | Missing | Out? |
| Famos / ETAS MDF / Somat SIE (test rigs) | impFamos, impMDF, impSIE | none | Missing | Out? |
| mzXML / mzML (mass spectrometry) | impMZXML | none | Missing | Out? |
| NASA CDF | impCDF | none | Missing | — |
| SAS / Minitab / Prism / SigmaPlot / KaleidaGraph | impSAS, impMNTB, impPrism, impJNB, impKG | none (G17) | Missing | ? |
| Binary 2D array / user binary | impBin2d | none | Missing | — |
| Image to matrix | impImage | `io/image_import.py` | Have | — |
| WAV audio | impWav | none | Missing | — |
| HTML tables / web page | impHTML, HTML Connector | none | Missing | — |
| JSON | JSON Connector | none (JSON is used only for recipes) | Missing | ? |
| XML (generic) | XML Connector | instrument XML only (BRML, XRDML) | Partial | — |
| Google Sheets | GoogleSheets Connector | none | Missing | — |
| Databases: SQLite | dbImport | `io/sqlite_query.py` | Have | — |
| Databases: ODBC / ADO / SQL editor | dbEdit, dbImport | none (G17) | Missing | ? |
| Origin project (OPJ / OPJU) | impOPJ | `io/origin_project/` | Have | — |
| Shapefile / GIS | Shapefile Connector | none | Missing | Out? |
| Instrument formats Origin lacks (QD, Rigaku, XRDML, NCNR, ORSO, SIMS, Lake Shore…) | none | `io/*` | Have (leads) | — |

### C2. Export

| Feature | Origin | quantized | Status | Rank |
|---|---|---|---|---|
| ASCII / CSV | expASC | `io/table_export.py` | Have | — |
| Excel | expXLS | `io/table_export.py` (.xlsx) | Have | — |
| XML | expXML | none | Missing | — |
| SQLite | expSQLite | none | Missing | — |
| NetCDF matrix / TDMS / WAV | expMatNC, expNITDM, expWAV | none | Missing | — |
| Worksheet as multipage PDF / image | expPDFw, expWks | none found | Missing | ? |
| Shapefile | expSHP | none | Missing | Out? |
| Origin project / `.ogs` (round trip) | n/a | `io/origin_project/writer*`, `.ogs` export | Have | — |

### C3. Worksheet and column formulas

| Feature | Origin | quantized | Status | Rank |
|---|---|---|---|---|
| Column formulas (Set Column Values), cross-sheet references, fit references | csetvalue | `lib/formula*.ts` | Have | — |
| Formula: math, trig and hyperbolic, erf / gamma | Math, Trig, Special Math | `lib/formulaFuncs.ts`, `lib/formulaMath.ts` | Have | — |
| Formula: text functions | String Functions (42) | `lib/formulaText.ts` (≈25 incl. regex) | Have | — |
| Formula: date / time | Date and Time (24) | `lib/formulaDate.ts`, `lib/formulaCalendar.ts`; no DateDif, WeekNum, Quarter, MonthName | Partial | — |
| Formula: distributions (≈45 pdf / cdf / inverse) | Distribution Functions | none in formulas | Missing | ? |
| Formula: NAG special functions (Bessel, Airy, elliptic, Kelvin, Lambert W, Fresnel; ≈50) | NAG Special Functions | in fit equations only (`calc/fit_equation.py`) | Partial | ? |
| Formula: moving-window statistics (Movavg, Emovavg, Wmovavg, Movrms, Movslope) | Statistical Functions | none in formulas (smoothing exists as a tool) | Missing | ? |
| Formula: column statistics (Correl, cov, Slope, Intercept, rmse, Kurt, Skew, Percentile, Mode…) | Statistical Functions | `col_*` aggregates, mean / median / sd | Partial | — |
| Formula: conditional aggregates (sumif, countif, averageif, maxifs, minifs) | Basic Statistical | grouped aggregates (`lib/formulaGroupAgg.ts`, G4); no *if forms | Partial | — |
| Formula: lookup / reference (table, lookup, xindex, unique, list) | Lookup & Reference | `interp()`, `col()`, `sheet()` | Partial | — |
| Formula: data manipulation (sort, reverse, dropNA, peaks, treplace) | Data Manipulation Functions | none in formulas | Missing | — |
| Formula: complex numbers (Im*, 28) | Complex | none | Missing | — |
| Formula: engineering / bit operations / base conversion | Engineering, Misc | none | Missing | — |
| Formula: financial | Financial | none | N/A | — |
| Formula: signal (fftamp, fftfreq, windata) | Signal Processing Functions | none in formulas | Missing | — |
| Formula: data generation (normal, uniform, Poisson, randbetween) | Data Generation | `rnd(seed)`, `normal(seed)` | Partial | — |
| Conditional formatting: value rules and colour scale | wcolor, wheatmap | `lib/worksheetRulesModel.ts` | Have | — |
| Conditional formatting: duplicates, outliers, top / bottom, Pareto, text rules | wcolordup, wcoloroutlier, wcolortb, wcolorPareto | none | Missing | — |
| Insert graph / image / notes / sparkline **into a cell** | insertGraph, insertImg, insertSparklines | sparklines in the Library only | Missing | ? |
| Mask cells by condition | colmask | row exclusion by filter (row level, not cell level) | Partial | — |
| Extract / filter rows by condition | wextract, wxt | `workshops/datafilter` | Have | — |
| Sort (nested) | wsort | `store/sortRows.ts` | Have | — |
| Find and replace | findreplace, wreplace | `FindReplaceBar.tsx` | Have | — |
| Remove / combine duplicate rows | wdeldup, wkeepdup | `remove-duplicate-rows` command | Have | — |
| Text to columns (split by delimiter) | text2cols | split dataset (`lib/datasetsplit.ts`); no in-sheet delimiter split | Partial | ? |
| Fill column with number / date / text patterns | patternN, patternD, patternT | formulas | Partial | — |
| Column designations (X, Y, Z, error, label, disregard) | coldesig | `store/columnDesignationActions.ts` | Have | — |
| Label rows (long name, units, comments, user parameters) | wlabel | `lib/labelRows.ts`, `lib/userParams.ts` | Have | — |
| Promote data rows to label rows | wrow2label | header detection at import only | Partial | — |
| Mirror / reference columns from similar sheets | colmirror, col2mirror | none | Missing | — |
| Protect sheet / lock cells | lockoptn | none | Missing | — |
| Hide / unhide rows and columns | colhide, wrowhide | hidden columns | Have | — |
| Pivot table | wpivot | unstack / pivot command | Have | — |
| Time-series pivot / unstack by time interval (hour, day, week… buckets) | wtspivot, wtsunstack | none | Missing | — |
| Stack / unstack columns | wstackcol, wunstackcol | `lib/worksheetTransforms.ts` | Have | — |
| Join by column / by label | wjoinbycol, wjoinbylabel | `lib/worksheetJoin.ts` | Have | — |
| Append / stack worksheets | wAppend, wstacksheets | append workshop | Have | — |
| Split worksheet / workbook | wsplit, wsplit_book | `store/split.ts` | Have | — |
| Transpose | wtranspose | worksheet transforms | Have | — |
| Reduce rows (every n, by group, evenly spaced X, duplicate X) | reducerows, reducexy, reduce_ex, reducedup | `calc/reduce_xy.py`, `workshops/reductions` | Have | — |
| Statistics by bin of X | statsxy | `bin_average` (`calc/reduce_xy.py`) | Have | — |
| Merge XY data from two sheets by X | wmergexy | resample / align (`calc/resample_align.py`), join | Have | — |
| Categorical columns and level order | Category functions | `workshops/levelorder`, `cat_levels.py` | Have | — |
| Rank | rank | `col_rank*` | Have | — |
| New data table from a table type (assays, replicates) | newtable, dt* | none | Missing | Out? |

### C4. Matrices and gridding

| Feature | Origin | Student | quantized | Status | Rank |
|---|---|---|---|---|---|
| Matrix books (several objects, XY mapping, set dimensions) | mdim, mlabels | — | maps as point clouds (`io/_map_schema.py`), map ops | Partial | — |
| Set matrix values from a formula | msetvalue | — | none found | Missing | ? |
| Crop / flip / rotate / shrink / expand / transpose | mCrop, mflip, mrotate90, mshrink, mexpand | — | `calc/map_ops.py` (G3) | Have | — |
| Gridding: nearest, linear, cubic, IDW, thin-plate, natural neighbour | XYZ2Mat | — | `calc/interp2d.py`, `calc/_natural_neighbor.py` | Have | — |
| Gridding: Renka-Cline, modified Shepard, Kriging | xyz_renka, xyz_shep, (Kriging in dialog) | ran (Renka, Shepard, TPS) | none | Missing | — |
| Log-scale and sparse gridding | XYZ2MatLog, xyz_sparse | — | regular-grid detection (`calc/_grid_detect.py`); no log grid | Partial | — |
| Matrix ROI: extract, profile, statistics | mroi2mat, mroiprofile | — | `workshops/roicuts`, `store/rois.ts` | Have | — |
| Pixel extraction across all matrices | mcellextract | — | none | Missing | — |
| Complex matrices | mc2ap, mri2c | — | none | Missing | — |
| Image ↔ matrix | img2m, m2img | — | image import only | Partial | — |
| Virtual matrix from a worksheet range | w2vm | — | wide-sheet maps? | Partial | ? |

### C5. Project and exploration

| Feature | Origin | quantized | Status | Rank |
|---|---|---|---|---|
| Project Explorer folders | pe_* | `lib/foldertree.ts`, Library | Have | — |
| Find in project / in project **files** on disk (G23) | Find in Project Files | one open project (`routes/project_search.py`) | Partial | — |
| Notes windows | Notes | Inspector notes card | Partial | — |
| Favorites / shortcuts to windows | pep_addshortcuts | pinned items? | Partial | — |
| Recent files browser | Recent Files Browser | `store/recentProjects.ts` | Have | — |
| Pack project with its data files | (none) | `workshops/packproject` | Have (leads) | — |
| Linked brushing / data highlighter | Data Highlighter | row states, brush | Have | — |

---

## D. Automation & workflow

| Feature | Origin | quantized | Status | Rank |
|---|---|---|---|---|
| Batch processing with an analysis template | batchProcess | pipelines, batch figure builder | Have | — |
| Analysis templates (save a book / project as a template, re-run on new data) | OGW / OGWU, clrAllData | transformation recipes (`store/plotRecipes.ts`, recipe manager) | Have | — |
| Auto / manual recalculation | Recalculate | `store/recalcEngine.ts` | Have | — |
| Duplicate a project or book without data | saveProjectNoData | quick-plot templates | Partial | — |
| Command language with a script window (LabTalk) | LabTalk, Command Window | macro recorder (`lib/macro.ts`) and command palette; no command language | Partial | ? |
| Embedded Python console on the open project (G18) | originpro, Py/ | exported Python scripts (`api.py`) and a plugin loader; no in-app console | Partial | ? |
| Compiled extensions / user tools with auto dialogs | Origin C, X-Function Builder | Python plugins (`plugins/loader.py`) | Partial | — |
| App store / installable packages | Apps Center, OPX | none | Missing | ? |
| Custom menus / toolbars / buttons | customMenu, OUbtn | none | Missing | — |
| Keyboard shortcut customization | KeyChords.ini | fixed shortcuts (`lib/shortcuts.ts`) | Missing | — |
| Project / system event scripts (on open, on save) | ProjectEvents.ogs, SysEvents.ogs | none | Missing | — |
| HTML / JS custom dialogs | newHTML | n/a | N/A | — |
| Automation server for other programs | COM `Origin.Application` | REST API + `client.py` | Have | — |
| Headless CLI | none | `cli.py`, `cli_run.py` | Have (leads) | — |
| MATLAB / LabVIEW / Excel clients | Samples/COM Server and Client | REST API covers it | N/A | — |
| R integration (Rserve) | OR.dll, ORserve.dll | none | Missing | Out? |
| Report sheets with tables and charts | Report templates | report workshop (`lib/report.ts`) | Have | — |
| Word report from a template with bookmarks | word2ogw, Send Graphs to Word | docx export without template bookmarks | Partial | ? |
| Flat, copy-friendly result sheets | FitFlatReport, getresults | result book (`lib/resultBook.ts`) | Have | — |
| Group folders (shared templates / files for a team) | group_server, groupmgr | none | Missing | ? |
| FTP / web file transfer | oftp, web2file | none | N/A | — |
| Bundled samples / tutorials / Learning Center | Samples/, Learning Center | `docs/tutorials` (not in app) | Partial | ? |
| Tips / new-feature hints | TipOfDay.csv, Hints, NewFeatures.ini | none | Missing | — |
| Undo history | Undo | `lib/undoHistory.ts` | Have | — |
| Localized UI (Chinese, German, Japanese) | Localization/ | none | Missing | Out? |
| Window arrangement | winarrange | window layout | Have | — |
| Project browser / workbook organizer | pb | Library | Have | — |
| Message / results log | Results Log, Message Log | analysis history, run log | Partial | — |
| Speedy Fit / Simple Fit (Apps) | Apps | quick-fit gadget, Curve Fit | Have | — |

---

## E. Online-documentation additions: what's new 2026/2026b and GUI-only tools

Sources: [Origin 2026](https://www.originlab.com/2026),
[Origin 2026b](https://www.originlab.com/2026b) and the
[interface guide](https://docs.originlab.com/user-guide/origin-interface/).
First pass 2026-11-25 by a timed agent. Every status was then re-verified
by reading the cited code (`path:line`). `Changed?` shows where the first
guess was wrong.

| Feature | Origin doc URL | quantized evidence (path:line) | Status | Changed? | Note |
|---|---|---|---|---|---|
| Mirror Columns (live reference to a column elsewhere in the project, no copy; cross-workbook; managed in Project Browser) | https://www.originlab.com/2026b | none (searched: mirror, linkedColumn, live reference, columnLink). Nearest: frontend/src/store/derivedWorksheets.ts:1 | Missing | | Derived worksheets are recomputed pipeline copies of a whole sheet, not per-column references |
| Life Science GUI mode: five structured table types (XY, Column, Grouped, Contingency, Survival) with table-aware plot menus | https://www.originlab.com/2026b | none | Out | yes (was Missing) | Life-science-only |
| GraphPad Prism `.pzfx` / `.prism` import (drag and drop, paste a Prism table) | https://www.originlab.com/2026b | none (searched: pzfx, prism) | Missing | | Low priority for target users |
| Add / insert columns across many sheets (scope: book, folder, project), with formula copy | https://www.originlab.com/2026b | frontend/src/commands/dataCommands.ts:63 (insertColumn on the active dataset only) | Partial | yes (was ?) | Single-sheet add/insert exists; no book/folder/project scope (searched: allSheets, scope.*book) |
| Slope Annotation tool on a graph | https://www.originlab.com/2026b | none (searched: slope.?annot) | Missing | | Small; useful for log-log power-law plots |
| Reference lines on all layers, and from column label row values | https://www.originlab.com/2026b | src/quantized/calc/figure_decor.py:255; frontend/src/components/Inspector/RefLinesCard.tsx:60 | Partial | | Ref lines are axis x/y + value (RefLine has no layer concept); no "from label row" source found |
| Mini toolbar axis-break button | https://www.originlab.com/2026b | src/quantized/calc/axis_breaks.py:3 (breaks set via Axis dialog Break from / Break to); frontend/src/components/Stage/SelectionMiniToolbar.tsx:38 (no break action) | Partial | yes (was Have?) | Axis breaks Have; no one-click mini-toolbar button found |
| Active layer indicator and toggle on multi-layer graphs | https://www.originlab.com/2026b | frontend/src/store/layerContentsApply.ts:46 (activeLayerCurves) | Partial | yes (was ?) | An active/focused layer concept exists; no indicator or toggle UI found (searched: activeLayer, focusedLayer, layerFocus) |
| Hide analysis locks in graphs; rescale for floating graphs and graph sheets | https://www.originlab.com/2026b | none (searched: analysisLock, lock.*operation, rescale.*float) | Missing | yes (was ?) | Origin-specific operation-lock concept; not applicable as such |
| Export Notes window to MHTML | https://www.originlab.com/2026b | none (searched: mhtml) | Missing | | Low value |
| Import SVG into a worksheet cell | https://www.originlab.com/2026b | none for cell images (SVG is used for figure export only) | Missing | | Low value |
| Trim extra spaces on Excel paste / import | https://www.originlab.com/2026b | src/quantized/io/excel.py:119 (cell strip), :124 (header strip); frontend/src/lib/clipboardGrid.ts:173 (parseCell trims) | Have | yes (was ?) | Leading/trailing whitespace trimmed on import and paste; interior runs of spaces not collapsed |
| Flash Fill comma-decimal support | https://www.originlab.com/2026b | none (searched: flash.?fill, smart.?formula) | Missing | | No Flash Fill at all (G16 in GAP_AUDIT_9) |
| Search text in data cells across project files | https://www.originlab.com/2026b | frontend/src/lib/projectSearch.ts; frontend/src/lib/projectSearchCells.test.ts (cells covered) | Partial | | Extends G23 in GAP_AUDIT_9 |
| Power analysis for ANOVA and proportion tests; hypothesis-test Summary and Diagnostic reports | https://www.originlab.com/2026b | src/quantized/calc/stats_dist.py:128 (t_test_power, required_n); frontend/src/lib/statsTests.ts:253 (power test id); src/quantized/calc/stats_proportion.py:9 (tests only) | Partial | | Power and sample size exist for the t-test only; no ANOVA or proportion power; no Summary/Diagnostic report pair found. Overlaps G6 |
| New Apps: Random Forest, Acceptance Sampling, Stability Study, Predictive Modeling Advisor | https://www.originlab.com/2026b | none (searched: random.?forest, decision.?tree) | Missing | | Apps, not core; likely out of scope |
| DOE additions: binary response, variability analysis, optimal design, overlaid contour plot | https://www.originlab.com/2026b | src/quantized/calc/doe_optimal.py:1 (D-optimal designs); src/quantized/calc/doe_effects.py:2 (half-normal / Pareto) | Partial | yes (was ?) | Optimal design Have; binary response, variability analysis and overlaid contour not found (searched: binary, logistic, variab, overlaid) |
| Graph Maker (drag columns onto X / Y / group / panel shelves to build a chart; multi-panel and multi-page splitting; run and Pareto charts) | https://www.originlab.com/2026 | `frontend/src/components/workshops/graphbuilder/` (EncodingWells.tsx, facetGuard.ts), `workshops/quickfigurebuilder/`; src/quantized/calc/spc_charts.py | Partial | | Well-based builder with facets exists; multi-page splitting and reopen-from-graph not confirmed |
| Smart Formula (formula suggested from an example) | https://www.originlab.com/2026 | none (searched: smart.?formula, suggest.*formula, infer.*formula) | Missing | | Sibling of G16 (Flash Fill) |
| Excel-style formula handling: keep Excel formulas on paste, Ctrl+` formula/value toggle, highlight formula cells, convert formulas to values, find and replace in formulas | https://www.originlab.com/2026 | frontend/src/components/Stage/worksheet/WorksheetToolbar.tsx:128 (formula bar), frontend/src/commands/editDataExtras.ts:31 (Set column values) | Partial | yes (was ?) | Own formula engine and computed columns exist; none of the Excel-specific items found (searched: showFormula, formulaToValue, highlight.*formula) |
| Repeat last action (Ctrl+Backspace) | https://www.originlab.com/2026 | frontend/src/components/overlays/CommandPalette.tsx:148-163 (empty-query "Recent" group, non-destructive only); frontend/src/useGlobalShortcuts.ts:63 (Backspace deletes a dataset) | Partial | yes (was Have?) | Recent-commands list in the palette, no repeat-last shortcut; Backspace is bound to delete |
| Reopen last dialog (Ctrl+Shift+Backspace) | https://www.originlab.com/2026 | none (searched: reopen, lastDialog) | Missing | | Small |
| Duplicate Operation (re-run an analysis on other data) | https://www.originlab.com/2026 | frontend/src/store/corrections.ts:62 (batch Apply to All); frontend/src/commands/hookCommandDocs.ts:35 (Save as Plot Recipe); frontend/src/components/Inspector/MacroCard.tsx | Partial | yes (was ?) | Corrections apply to all, plot recipes and the macro recorder cover reuse; no per-analysis duplicate-onto-other-data |
| Periodic data refresh from a connector (5 s to 3 days) | https://www.originlab.com/2026 | frontend/src/lib/sourceWatch.ts:59 (POLL_MS = 2000); src/quantized/routes/source_watch.py:1 | Have | yes (was Have?) | Auto re-import on source file change by polling; interval is fixed 2 s (pollMs option at sourceWatch.ts:161), not user-selectable 5 s to 3 days |
| Sort multiple columns individually | https://www.originlab.com/2026 | frontend/src/commands/commandDocs.ts:181 (Sort worksheet: up to three keys, rows move together) | Partial | yes (was ?) | Multi-key row sort exists; independent per-column sort not found (searched: individually, sortColumns) |
| Bulk edit column comments and units in the project browser | https://www.originlab.com/2026 | frontend/src/components/Stage/worksheet/HeaderEditor.tsx:1; frontend/src/components/Stage/worksheet/GridHeader.tsx:96 | Partial | yes (was ?) | Long Name / Units / Comments editable per column via header editor; no bulk or project-browser editing |
| Trendline with mini-toolbar controls; trendlines for plot groups | https://www.originlab.com/2026 | frontend/src/components/Stage/useGadgetChip.ts:131 (QUICK_FIT_MODELS); frontend/src/components/Stage/PlotResultChips.tsx:13 | Partial | yes (was Partial?) | Quick Fit gadget draws a fit overlay with a chip; named trendline and per-group trendlines not found (searched: trend.?line) |
| Heatmap significance marks | https://www.originlab.com/2026 | none for heatmaps; frontend/src/components/Stage/statDrawComparisons.ts:1 is categorical brackets / letters only | Missing | yes (was ?) | Related to Discussion item 23 (heatmap cell labels) |
| Syntax colouring in legends and labels | https://www.originlab.com/2026 | none (searched: syntax.?colou?r) | Missing | yes (was ?) | Low value |
| Graphical Summary (descriptive statistics on one page: histogram, box, CI, normality) | https://www.originlab.com/2026 | frontend/src/commands/analysisCommands.ts:99 (Distribution...: histogram, quantiles, descriptive stats, fit, normality verdict, per-level By column) | Partial | yes (was Missing?) | Already exists under another name (Distribution); no single-page box plot / mean CI combination found |
| Anderson-Darling normality test | https://www.originlab.com/2026 | src/quantized/api.py:172,462 (anderson_darling); frontend/src/commands/analysisCommands.ts:103 (stats-tests keywords anderson darling, normality) | Have | yes (was Have?) | Exposed in Statistical tests |
| t-test conclusion charts | https://www.originlab.com/2026 | none (searched: conclusion chart, interval plot, intervalPlot); text interpretation sentence only (analysisCommands.ts:103) | Missing | yes (was ?) | One-sentence interpretation exists, no chart |
| Cause-and-effect (fishbone) diagram | https://www.originlab.com/2026 | none | Out | yes (was Missing) | Quality management |
| Stem and leaf plot | https://www.originlab.com/2026 | none (searched: stem.?and.?leaf) | Missing | | Low value |
| Frequency charts: column, bar, pie, doughnut | https://www.originlab.com/2026 | frontend/src/commands/dataCommands.ts:139 (Frequency count); src/quantized/calc/figure_pie.py:1 (pie and multi-ring doughnut) | Have | yes (was Partial) | Doughnut and count-from-raw both found; column/bar from the counts uses the ordinary plot types |
| Double X axis (Arrhenius templates) | https://www.originlab.com/2026 | `src/quantized/calc/axis_top.py`, `calc/axis_expr.py` | Have | | Top axis from an expression |
| Grouped histogram / grouped Pareto / grouped scatter | https://www.originlab.com/2026 | `src/quantized/calc/doe_effects.py` (Pareto of effects), `calc/figure_categorical.py`; frontend/src/commands/menuAvailability.ts:51 (plot-pareto) | Partial | | Grouped variants not checked one by one |
| Run chart and control charts | https://www.originlab.com/2026 | `src/quantized/calc/spc_charts.py` | Have | | |
| Decision tree (graph type and App) | https://www.originlab.com/2026 | none | Missing | | Out of scope |
| New connectors: DMD, RPC3, Ivium (electrochemistry), Minitab | https://www.originlab.com/2026 | none (searched: ivium, biologic, gamry, rpc3, minitab, in src/quantized/io) | Missing | yes (was Missing?) | Ivium may matter for electrochemistry users only |
| Lock toolbar positions; start from a user-defined project file | https://www.originlab.com/2026 | none (searched: lock.?toolbar, startup project, defaultWorkspace, userTemplate) | Missing | yes (was ?) | Toolbar locking not applicable to this UI |
| Object Manager (dockable tree of the active graph: select, show / hide, reorder plots, layers and objects; selecting a plot also selects its source data) | https://docs.originlab.com/user-guide/origin-interface/ | frontend/src/components/Inspector/PlotObjectsCard.tsx:1 (tree of axes, legend, curves, annotations, shapes; curve visibility, duplicate/delete); frontend/src/components/overlays/figuredialogs/LayerContentsDialog.tsx:1 (reorder) | Have | yes (was Partial?) | Exists as Plot Objects inspector; reorder lives in Layer Contents; graph-to-worksheet selection sync not checked |
| Layer Contents dialog (two-list add / remove plots in a layer, group / ungroup, reorder draw order) | https://docs.originlab.com/origin-help/layern-dialog/ | frontend/src/components/overlays/figuredialogs/LayerContentsDialog.tsx:1 | Have | yes (was Partial?) | Already exists under the same name, which the first pass missed: remove, reorder, rebind, add curves, one undo step. Group / ungroup of plots not found |
| Plot Setup dialog (pick any sheet and columns, plot type and designations for a layer in one place) | https://docs.originlab.com/origin-help/dataplot-manage/ | frontend/src/components/overlays/figuredialogs/LayerContentsDialog.tsx:2 (re-bind a curve to another dataset / X / Y); frontend/src/lib/originTips.ts | Partial | yes (was Partial?) | Dataset / X / Y rebinding covered by Layer Contents; per-curve plot type and designations in the same dialog not confirmed |
| Data Navigator (side panel listing the not-yet-imported sheets / variables of a connected Excel, MATLAB or Origin file, for selective import) | https://www.originlab.com/doc/en/Origin-Help/Data_Navigator | frontend/src/components/workshops/importwizard/ImportWizardPanel.tsx (import-time preview); workshops/originmigration/ | Partial | yes (was Partial?) | No persistent "other sheets in this file" panel found (searched: sheetNames, listSheets) |
| Data Highlighter (brush points on one graph, same rows light up in other graphs and the worksheet) | no doc page found in two searches | frontend/src/store/linkedFigureSelection.ts:6 (shared worksheet brush); frontend/src/components/workshops/distribution/useDistribution.ts:150 (histogram bar brushing); `frontend/src/lib/rowstate.ts` | Have | yes (was Have?) | Row-state model links brushing across views (#50) |
| Messages Log (errors and output not sent to a script window) | https://docs.originlab.com/user-guide/origin-interface/ | none (searched: messageLog, statusLog, statusHistory); `frontend/src/components/overlays/Toaster.tsx` only | Missing | yes (was Partial?) | Toasts and status line only; no persistent scrollable message log |
| Results Log (time-stamped record of every analysis and fit result) | https://docs.originlab.com/user-guide/origin-interface/ | frontend/src/components/workshops/analysisresults/AnalysisResultPanel.tsx:305 (Created), :342 (Last updated); `frontend/src/components/overlays/ResultsWindow.tsx`, `workshops/resultbook/`, `components/history/` | Have | yes (was Have?) | Results carry created / updated timestamps and a result book |
| Command Window / Script Window (type a command, get a value; command history) | https://docs.originlab.com/user-guide/origin-interface/ | `frontend/src/components/overlays/CommandPalette.tsx` (commands only); src/quantized/client.py:1 | Partial | | No scripting console in the app; the Python client is the scripting route |
| Code Builder (IDE for Origin C and Python) | https://docs.originlab.com/user-guide/origin-interface/ | none | Missing | | Deliberately out of scope is a reasonable call; external editor plus `client.py` |
| Learning Center (startup dialog: sample graphs, analysis samples, tutorials) | https://docs.originlab.com/user-guide/origin-interface/ | frontend/src/commands/fileCommands.ts:141 (Load sample dataset); `frontend/src/components/overlays/HelpDialog.tsx` | Partial | yes (was Partial?) | One bundled sample dataset plus help; no browsable gallery of sample graphs |
| Apps Gallery and App Center (install, update and launch add-on Apps) | https://docs.originlab.com/user-guide/origin-interface/ | src/quantized/cli.py:16 (qz plugin list / enable / disable); `src/quantized/plugins/` | Partial | yes (was Partial?) | Plugin layer managed from the CLI; no in-app browse / install surface |
| Start menu search (one box searching menus, apps, help, samples, templates) | https://docs.originlab.com/user-guide/origin-interface/ | `frontend/src/components/overlays/CommandPalette.tsx`, `workshops/search/` | Have | | |
| Mini Toolbars (context toolbar next to the selected object, layer or page margin) | https://docs.originlab.com/user-guide/origin-interface/ | frontend/src/components/Stage/SelectionMiniToolbar.tsx:38; frontend/src/components/Stage/objectMenus.tsx:177 | Have | yes (was Partial?) | Selection mini-toolbar exists under the same name |
| Status bar selection statistics (sum, mean, count of the selected cells) | https://docs.originlab.com/user-guide/origin-interface/ | frontend/src/components/Shell/StatusBar.tsx:59,204,217 (dataset count, autosave only); frontend/src/components/Stage/PlotReadouts.tsx:78 (stats of a plot region) | Partial | yes (was ?) | Plot-region readouts exist; no worksheet cell-selection sum / mean / count |
| Smart Hint Log (review or suppress hints shown this session) | https://docs.originlab.com/user-guide/origin-interface/ | frontend/src/components/overlays/InteractionHints.tsx; frontend/src/AppOverlayPanels.tsx:43 (Help can re-show hints) | Partial | yes (was Partial?) | Hints can be re-shown; no log of past hints |
| Formula bar with function search and range picking | https://docs.originlab.com/user-guide/origin-interface/ | frontend/src/components/Stage/worksheet/WorksheetToolbar.tsx:128-160 (formula bar with FORMULA_HELP tooltip) | Partial | yes (was ?) | Formula bar and column name exist; no function search or range picking |
| Notes window in plain text, rich text, HTML or Markdown | https://docs.originlab.com/user-guide/origin-interface/ | frontend/src/components/Inspector/NotesCard.tsx:1 (editable plain-text notes per dataset); `src/quantized/io/origin_project/notes.py` (import) | Partial | yes (was Partial?) | Editable plain text only; no rich text, HTML or Markdown |
| Layout window (arrange several graphs, tables and text on one page) | https://docs.originlab.com/user-guide/origin-interface/ | frontend/src/components/workshops/figurepage/SlotGrid.tsx:1 (grid of panel slots); `workshops/windowlayout/` | Partial | yes (was Have?) | Figure Page composes graph panels; free-placed tables and text not confirmed |
| Image window (view / edit raster images and video) | https://docs.originlab.com/user-guide/origin-interface/ | none | Out | yes (was Missing) | EM and imaging live in fermiviewer |

---

## F. OriginPro product pages and the Origin vs OriginPro comparison

Sources: the [product comparison](https://www.originlab.com/productcomparison)
and the originlab.com product feature pages. Only features absent from
sections A–E and GAP_AUDIT_9 are listed. Evidence is one file per row, and
only the two rows marked *spot-checked* were read line by line.

| Feature | Pro-only? | Origin URL | quantized evidence | Status | Area | Note |
|---|---|---|---|---|---|---|
| Sequential Fit (fit datasets in turn, seed from previous) | Yes (App) | https://www.originlab.com/productcomparison | `calc/batch_fit.py` (same model over many datasets, per-dataset auto-guess, parameter trends; no seed-from-previous chain) | Partial | A | Spot-checked 2026-11-25. The gap is carrying parameters across a T/H series |
| Pulse Fit | Yes (App) | https://www.originlab.com/productcomparison | none | Missing | A | Pulse/step response fit; minor for our lab |
| Redlich-Kister Polynomial Fit | Yes (App) | https://www.originlab.com/productcomparison | none | Missing | A | Thermodynamic mixing; low value |
| Compare Datasets / Compare linear-fit parameters | No (App) | https://www.originlab.com/productcomparison | src/quantized/calc/dataset_compare.py:55 | Have | A | extra-sum-of-squares F-test, warm start |
| Propagation of Error (App) | Yes | https://www.originlab.com/productcomparison | src/quantized/calc/errors.py:27 | Have | A | first-order + Monte Carlo (errors.py:4) |
| Monte Carlo Simulation (stats) | Yes | https://www.originlab.com/productcomparison | src/quantized/calc/errors.py:4 | Partial | A | MC only for error propagation, no general simulation tool |
| Tafel Extrapolation (from polarisation curve) | No (App) | https://www.originlab.com/productcomparison | src/quantized/calc/electrochemistry.py:112 | Partial | A | Tafel slope formula only; no fit/extrapolation of j0 from data |
| Tangential Baseline (peak integration) | Yes (App) | https://www.originlab.com/productcomparison | none | Missing | A | Straight-line baseline between chosen endpoints per peak; XRD/XPS use |
| 2D Peak Analysis | Yes (App) | https://www.originlab.com/productcomparison | `calc/rsm_analyze.py` (finds the brightest RSM peaks and fits each with a 2D peak model) | Partial | A | Spot-checked 2026-11-25. The general 2D Peak Analyzer for any matrix is missing |
| X-Ray Diffraction Analysis (App) | Yes | https://www.originlab.com/productcomparison | src/quantized/io/xrdml.py:1 | Have | A | XRD peak/Scherrer workshop exists |
| Zoom FFT | Yes (App) | https://www.originlab.com/productcomparison | none | Missing | A | Narrow-band high-res FFT |
| Empirical Mode Decomposition | Yes (App) | https://www.originlab.com/productcomparison | none | Missing | A | Low priority |
| Rainflow Counting | Yes (App) | https://www.originlab.com/productcomparison | none | Missing | A | Fatigue; not our domain |
| Dynamic Time Warping | Yes (App) | https://www.originlab.com/productcomparison | none | Missing | A | Low priority |
| Signal to Noise Ratio | Yes (App) | https://www.originlab.com/productcomparison | src/quantized/calc/peak_noise.py:13 | Partial | A | Peak-level SNR only, no general signal SNR |
| Optimization Solver / Equation Solver | Yes (Apps) | https://www.originlab.com/productcomparison | none | Missing | A | No minimize/root UI for arbitrary user equations |
| Tangent / Curvature Radius / Distance Between Points (Apps) | No | https://www.originlab.com/productcomparison | src/quantized/calc/spectro_onset.py:148 | Partial | A | tangent line only for onset; no general tangent/curvature tool |
| Concave Hull / Connect scatter to convex hull or centroid | Yes | https://www.originlab.com/index.aspx?go=Products/Origin/Graphing | src/quantized/calc/_hull_query.py (internal inside_hull only) | Missing | B | Hull used for interpolation masking, not plottable |
| Time-Temperature Superposition | Yes (App) | https://www.originlab.com/productcomparison | none | Missing | A | Master curves (WLF); relaxation shifts |
| Mann-Kendall Test | Yes (App) | https://www.originlab.com/productcomparison | none | Missing | A | Trend test; low priority |
| Hurst Exponent | No (App) | https://www.originlab.com/productcomparison | none | Missing | A | Low priority |
| Gaussian Mixture Models | Yes (App) | https://www.originlab.com/productcomparison | none | Missing | A | Clustering |
| Steel-Dwass / post-hoc for nonparametric tests | Yes (Apps) | https://www.originlab.com/productcomparison | src/quantized/calc/stats_anova2.py:164 (Tukey/Dunnett only) | Partial | A | Parametric post-hoc only; no Dunn/Steel-Dwass |
| Effect Size for ANOVA | Yes (App) | https://www.originlab.com/productcomparison | src/quantized/calc/stats_anova_ext.py:127 | Partial | A | partial eta-squared only in RM ANOVA |
| Canonical Correlation / Nonmetric MDS / Detrended Correspondence / Redundancy Analysis | Yes (Apps) | https://www.originlab.com/productcomparison | none | Missing | A | Multivariate stats; ecology-flavoured, low value |
| Generalized Additive Model / GLMM / SEM | Yes (Apps) | https://www.originlab.com/productcomparison | none | Missing | A | Advanced stats; low for our lab |
| White Noise / Random Sample generator | Both | https://www.originlab.com/productcomparison | none | Missing | A | Synthetic test data; trivial |
| Gel MW / Western Blot / qPCR / Drug Dissolution / Flow Cytometry | Yes/Both | https://www.originlab.com/productcomparison | n/a | Out | A | Life science |
| Image Object Counter / Bubble Image Area / NIfTI / Brain Atlas / Image Stack Profile | Yes | https://www.originlab.com/productcomparison | n/a | Out | A | EM/imaging/life science |
| Radiometric Geochronology / Piper / Durov / Stiff / Soil triangle | Yes/Both | https://www.originlab.com/index.aspx?go=Products/Origin/Graphing | n/a | Out | B | Geoscience |
| Poincare Plot | Yes (App) | https://www.originlab.com/productcomparison | none | Missing | B | Return map; trivial scatter |
| Gardner-Altman / Paired Comparison / Before-After plot | Yes/Both | https://www.originlab.com/index.aspx?go=Products/Origin/Graphing | none | Missing | B | Estimation plots; low |
| Taylor Diagram | Both (App) | https://www.originlab.com/productcomparison | none | Missing | B | Model skill; low |
| Venn Diagram / UpSet plot | Both | https://www.originlab.com/index.aspx?go=Products/Origin/Graphing | none | Missing | B | Set overlaps; low |
| Youden / Means plot / Rug plot / Symmetry plot | Yes/Both | https://www.originlab.com/index.aspx?go=Products/Origin/Graphing | none | Missing | B | Small stat plots |
| Nyquist plot (impedance Re vs -Im) | Both (App) | https://www.originlab.com/productcomparison | none (plain XY with equal aspect would do) | Partial | B | No template/equal-aspect preset; transport/EIS use |
| Chromaticity Diagram | Both (App) | https://www.originlab.com/productcomparison | none | Missing | B | Colour science; low |
| Bridge chart / Binned scatter / Anomaly plot / Spiral bar | Both | https://www.originlab.com/index.aspx?go=Products/Origin/Graphing | none | Missing | B | Business-style charts; low |
| Network diagram / Circular packing | Both | https://www.originlab.com/index.aspx?go=Products/Origin/Graphing | none | Missing | B | Not lab-relevant |
| Tile grid map | Both | https://www.originlab.com/index.aspx?go=Products/Origin/Graphing | n/a | Out | B | GIS |
| Font Changer App | Both | https://www.originlab.com/productcomparison | src/quantized/calc/figure_fonts.py:1 | Have | B | |
| Color Editor App / Layer Stack Manager | Both | https://www.originlab.com/productcomparison | src/quantized/calc/figure_categorical.py:44 (palette param only) | Partial | B | No dedicated colour-list editor |
| Data Slicer App / graph-based data slicer filter | Both | https://www.originlab.com/Origin | none | Missing | D | Interactive row filter linked to graph |
| Data reduction: evenly spaced X, duplicate X, by rows, by group | No | https://www.originlab.com/Origin | src/quantized/calc/reduce_xy.py:1 (average_duplicates, bin_average, keep_every_nth) | Have | C | reduce-by-group unverified |
| Cell comments / Sticky Notes | No | https://www.originlab.com/Origin | src/quantized/calc/signal_ops.py:43 (column_comments only) | Partial | C | Column comments only, no per-cell notes |
| Password protection for projects/workbooks | No | https://www.originlab.com/Origin | none | Missing | D | No project encryption |
| Mathematica Link | No | https://www.originlab.com/Origin | none | Missing | D | Low priority |
| Import: Tektronix WFM / LeCroy / Yokogawa WDF / MDF4 | Both | https://www.originlab.com/productcomparison | none | Missing | C | Oscilloscope/logger binaries; transport rigs may use |
| Import: BioLogic / Neware / Ivium / Metrohm connectors | Both | https://www.originlab.com/productcomparison | none | Missing | C | Potentiostat/battery cyclers; BioLogic .mpr most useful |
| Import PDF Tables | Both | https://www.originlab.com/productcomparison | none | Missing | C | Extract tables from papers |
| Import Minitab / SAS XPT | Both | https://www.originlab.com/productcomparison | none | Missing | C | Low priority |
| Import Chem Data / ChemStation / Agilent MS / PerkinElmer / Nicolet WFT / N42 | Yes/Both | https://www.originlab.com/productcomparison | src/quantized/io/opus.py:1 (Bruker OPUS only) | Partial | C | Spectroscopy instruments |
| Database import (Oracle, MySQL, SQL Server) | No | https://www.originlab.com/Origin | src/quantized/io/sqlite_query.py:1 | Partial | C | SQLite only |
| Video Builder / Movie Creator | Both | https://www.originlab.com/Origin | src/quantized/calc/figure_animation.py:46 | Have | B | |
| Master Page / layout page | No | https://www.originlab.com/Origin | src/quantized/calc/figure_page.py:1 | Have | B | |
| Graph Publisher / Send to PowerPoint/Word | Both | https://www.originlab.com/Origin | src/quantized/io/report_office.py:1 | Have | D | Also in earlier audit |
| Stats Advisor / Find a Fitting Function / Speedy Fit | Both | https://www.originlab.com/fileExchange/ | src/quantized/calc/fit_autoguess.py:1 | Partial | A | Fit auto-guess exists; no test-chooser advisor |

---

## G. What's new 2018–2025b

Sources: originlab.com/2018 … /2025b (16 pages). Only features absent from
sections A–F and GAP_AUDIT_9 are listed. Have/Partial verdicts rest on
grep hits with few files opened; Missing verdicts were spot-checked for the
materials-lab items (electrochemistry/cycler import, impedance analysis,
tangential baseline, peak alignment, Zoom FFT, Redlich-Kister: no code).
The two `?` rows are Apparent Integration and symmetric-log axes
(`symlog` appears only in `calc/axis_cross.py`).

| Feature | Version | Origin URL | quantized evidence | Status | Area | Note |
|---|---|---|---|---|---|---|
| Align Peaks app (shift spectra to common peak position) | 2019 | https://www.originlab.com/2019 | none | Missing | A | XRD/Raman zero-shift correction; peak finding exists |
| Gaussian Mixture Models (Pro) | 2019 | https://www.originlab.com/2019 | none | Missing | A |  |
| Independent Component Analysis (Pro) | 2019 | https://www.originlab.com/2019 | none | Missing | A | PCA exists in workshops/multivar |
| Peak Deconvolution app | 2019 | https://www.originlab.com/2019 | calc/peak_multifit*.py (per audit) | Have | A | multi-peak fit covers it |
| Dynamic Time Warping (Pro) | 2018b | https://www.originlab.com/2018b | none | Missing | A |  |
| Zoom FFT / FFT Examiner (Pro) | 2018, 2022b | https://www.originlab.com/2018 | calc/spectral.py (plain FFT only) | Partial | A | no zoomed-band FFT or interactive examiner |
| Equations Solver (Pro) | 2018 | https://www.originlab.com/2018 | none | Missing | A | root find / system solve UI |
| Composite Spectrum Regression (Pro) | 2018 | https://www.originlab.com/2018 | none | Missing | A | fit spectrum as weighted sum of reference spectra |
| 2D / 3D Smoother apps (matrix smoothing) | 2018b | https://www.originlab.com/2018b | src/quantized/calc/map_imgfilt.py:3 (scipy.ndimage gaussian) | Partial | A | maps only, not generic matrix |
| Voronoi diagram app | 2018b | https://www.originlab.com/2018b | calc/_natural_neighbor.py (interp only) | Missing | B |  |
| Concave Hull app (Pro) | 2019b | https://www.originlab.com/2019b | none | Missing | A | qhull used only for Delaunay in figure_map.py |
| Isosurface plot | 2019b | https://www.originlab.com/2019b | none | Missing | B | no 3D volume/isosurface |
| Neural Network Fitting / Regression (Pro) | 2020, 2021 | https://www.originlab.com/2020 | none | Missing | A |  |
| Canonical Correlation Analysis (Pro) | 2020b | https://www.originlab.com/2020b | none | Missing | A |  |
| Fit Adsorption Isotherm (Pro) | 2020b | https://www.originlab.com/2020b | calc/fit_models.py:142 (Langmuir only) | Partial | A | no BET/Freundlich/Sips set |
| Nonmetric Multidimensional Scaling (Pro) | 2020b | https://www.originlab.com/2020b | none | Missing | A |  |
| Optimization Solver (Pro) | 2021 | https://www.originlab.com/2021 | none | Missing | A | constrained minimiser UI |
| Apparent Integration app (Pro) | 2021 | https://www.originlab.com/2021 | none | ? | A | semantics unclear from page; no match |
| Optimal Cluster Number (Pro) | 2021b | https://www.originlab.com/2021b | none | Missing | A | lib/datasetsplit.ts gap clustering is 1D splitting only |
| Empirical Mode Decomposition (Pro) | 2021b | https://www.originlab.com/2021b | none | Missing | A |  |
| 1D Statistical Parametric Mapping (Pro) | 2021b | https://www.originlab.com/2021b | none | Missing | A |  |
| Partial Least Squares Discriminant Analysis (Pro) | 2025 | https://www.originlab.com/2025 | none | Missing | A |  |
| Mann-Kendall trend test (Pro) | 2022b | https://www.originlab.com/2022b | none | Missing | A | calc/ts_* has ACF/ARIMA only |
| Tangential Baseline app (Pro) | 2022b | https://www.originlab.com/2022b | calc/baseline.py (no tangent mode) | Missing | A | common for XPS/UV-vis edges |
| Pulse Fit app (Pro) | 2023b | https://www.originlab.com/2023b | none | Missing | A | pulse-train/rise-decay fitting |
| Propagation of Error app (Pro) | 2023b | https://www.originlab.com/2023b | calc/errors.py:1, calc/linear_uncertainty.py:1 | Partial | A | first-order Taylor + MC exist; no user-expression UI confirmed |
| Steel-Dwass nonparametric test (Pro) | 2023b | https://www.originlab.com/2023b | none | Missing | A |  |
| Effect Size for ANOVA (Pro) | 2023b | https://www.originlab.com/2023b | calc/stats_anova_ext.py:127 (partial eta-squared) | Partial | A | omega/Cohen f not seen |
| Overlap of Empirical Distributions (Pro) | 2022 | https://www.originlab.com/2022 | none | Missing | A |  |
| Redlich-Kister polynomial fit (Pro) | 2022 | https://www.originlab.com/2022 | none | Missing | A | thermodynamic excess properties |
| Time-Temperature Superposition (Pro) | 2024b | https://www.originlab.com/2024b | none | Missing | A | rheology/polymer shift-factor master curves |
| Rainflow Counting (Pro) | 2023b | https://www.originlab.com/2023b | none | Missing | A | fatigue cycle counting |
| IIR Comb Filter (Pro) | 2025 | https://www.originlab.com/2025 | calc/iir_filter.py (no comb) | Missing | A |  |
| Random Sample app (Pro) / random row sampling | 2025, 2019b | https://www.originlab.com/2025 | none | Missing | A |  |
| Power Spectral Density (Pro) | 2024 | https://www.originlab.com/2024 | components/workshops/signalprocessing/spectralSettings.ts (Welch) | Partial | A | Welch settings present; no dedicated PSD report |
| Generalized Additive Model (Pro) | 2024 | https://www.originlab.com/2024 | none | Missing | A |  |
| Best Subset Selection (Pro) | 2025b | https://www.originlab.com/2025b | none | Missing | A |  |
| Trend Lines (linear/poly/power/log/exp/moving avg, fixed params) | 2025b | https://www.originlab.com/2025b | components/Inspector/FitOverlaysCard.tsx | Partial | A | fit overlays yes; no one-click moving-average trend line |
| Piecewise Peak Fitting app (Pro) | 2025b | https://www.originlab.com/2025b | calc/fit_piecewise.py (per audit) | Partial | A |  |
| Cyclic Voltammetry app (Pro) | 2025b | https://www.originlab.com/2025b | none | Missing | A | electrochemistry, not core lab |
| Nyquist plot / impedance spectroscopy app | 2025b | https://www.originlab.com/2025b | none | Missing | A | no EIS tooling |
| Extract Ridge from Spectrogram | 2025 | https://www.originlab.com/2025 | calc/spectrogram.py (no ridge) | Missing | A |  |
| Signal-to-Noise Ratio app (Taguchi, Pro) | 2025 | https://www.originlab.com/2025 | calc/peaks.py:79 (peak snr threshold only) | Missing | A |  |
| Stats functions geomean/harmean/geosd/mad/lcl/ucl | 2021b | https://www.originlab.com/2021b | calc/fit_robust.py:55 (median abs resid only) | Missing | C | none in lib/formulaMath.ts |
| LET(), idx(), ReportCell() formula functions | 2021, 2021b | https://www.originlab.com/2021 | none | Missing | C |  |
| Bridge chart | 2018 | https://www.originlab.com/2018 | none | Missing | B |  |
| Before-After plot | 2020 | https://www.originlab.com/2020 | none | Missing | B |  |
| Skewed plot (adjustable axis angle) | 2021 | https://www.originlab.com/2021 | none | Missing | B |  |
| Symmetric log scale | 2021 | https://www.originlab.com/2021 | calc/axis_cross.py:64 (symlog string only) | ? | B | no symlog scale seen in axis_scales.py or axisScaleExtras.ts |
| Taylor Diagram app | 2021 | https://www.originlab.com/2021 | none | Missing | B |  |
| Confidence ellipse / Ellipse plot / XY error as rectangles | 2021b | https://www.originlab.com/2021b | none | Missing | B | ellipse exists only as implicit fit |
| Contour + Gradient arrows | 2025 | https://www.originlab.com/2025 | calc/figure_field.py (quiver/streamline) | Partial | B |  |
| Polar Vector / Polar Quiver plot | 2021, 2025b | https://www.originlab.com/2021 | calc/figure_field.py:1 (cartesian only) | Partial | B |  |
| Normal CDF, Symmetry, Main Effects plots; Gardner-Altman; Youden plot | 2023b-2025b | https://www.originlab.com/2023b | calc/figure_statplots.py:118 (interaction), calc/stats_roc.py:4 (Youden index) | Partial | B | interaction plot exists; the rest not |
| Network plots / Hierarchical edge bundling | 2021b, 2025 | https://www.originlab.com/2021b | none | Missing | B |  |
| Browser Graph (toggle through many columns or sheets) | 2020b | https://www.originlab.com/2020b | none | Missing | B |  |
| Data Slicer (filter plotted data from the graph) | 2021b, 2025 | https://www.originlab.com/2021b | lib/uplotLasso.ts (lasso mask only) | Partial | B |  |
| Smart symbol skipping for large data | 2023 | https://www.originlab.com/2023 | lib/plotDecimateRows.ts:24, calc/decimate.py | Have | B | min/max bucket decimation |
| Angle / distance annotation tools | 2022b, 2023 | https://www.originlab.com/2022b | none | Missing | B |  |
| Graph Styles (one-click restyle) | 2025 | https://www.originlab.com/2025 | lib/exportStyles.ts | Partial | B |  |
| Dark mode graphs and windows | 2024 | https://www.originlab.com/2024 | lib/uplotOpts.ts:94 ([data-theme]) | Have | D |  |
| PNG/TIFF export with transparency | 2024b | https://www.originlab.com/2024b | calc/figure.py:269 | Have | B |  |
| Multi-page PDF export of several graphs | 2018b | https://www.originlab.com/2018b | calc/figure_pdf_pages.py:1 | Have | B |  |
| Video export from browser graph / matrix | 2023 | https://www.originlab.com/2023 | none | Missing | B | low priority |
| Graph protection from edit/delete | 2025b | https://www.originlab.com/2025b | none | Missing | D | low |
| Freehand Curve Tool | 2021 | https://www.originlab.com/2021 | none | Missing | B | low |
| Geoscience diagrams (Piper, Durov, Stiff, Schoeller, soil texture, Hansen) | 2019b-2022b | https://www.originlab.com/2019b | none | Out | B |  |
| Named ranges (cells, columns, label rows, fit params) | 2022 | https://www.originlab.com/2022 | none | Missing | C |  |
| Cell notes / rich-text cell notes | 2022, 2022b | https://www.originlab.com/2022 | none | Missing | C |  |
| Import PDF Tables app | 2021 | https://www.originlab.com/2021 | none | Missing | C |  |
| Cloud files (OneDrive, Google Drive, SharePoint) open/save | 2022, 2024b | https://www.originlab.com/2022 | none | Missing | C | local-first app |
| Auto-import when files appear in a watched folder | 2024b | https://www.originlab.com/2024b | none | Missing | C | relevant to live instrument folders; live_text.py is different |
| Battery cycler connectors (BioLogic, Neware, Metrohm) | 2020b, 2025b | https://www.originlab.com/2020b | none | Missing | C | no io parser for them |
| MDF4 / ChemStation / N42 / LeCroy / Yokogawa / Nicolet WFT connectors | 2020-2023b | https://www.originlab.com/2020 | none | Missing | C | mostly automotive/chromatography/scope |
| XRDML connector | 2025 | https://www.originlab.com/2025 | io/xrdml.py | Have | C |  |
| NMR import app | 2020 | https://www.originlab.com/2020 | io/jcamp.py:5 | Partial | C | JCAMP only; no Bruker/Varian dirs |
| Export worksheets to .mat | 2025 | https://www.originlab.com/2025 | io/convert_containers.py:254 (savemat) | Have | C |  |
| Frozen panes in worksheets | 2023 | https://www.originlab.com/2023 | store/worksheetColumnView.ts:2 | Have | C |  |
| Python API driving the app (originpro package) | 2021 | https://www.originlab.com/2021 | api.py (qz package) | Have | D |  |
| Python expressions in Set Column Values / Fit builder | 2021, 2021b | https://www.originlab.com/2021 | none | Out | D | formula language only by design (no-eval rule) |
| Command Palette / Start Menu search | 2019, 2025b | https://www.originlab.com/2019 | App.tsx:16 (CommandPalette) | Have | D |  |
| User-defined key chords and Window Switcher (Ctrl+Tab) | 2025b | https://www.originlab.com/2025b | none | Missing | D |  |
| Recent Origin Files browser | 2025 | https://www.originlab.com/2025 | commands/recentProjectsCommands.ts | Partial | D |  |

---

## Discussion list (the **?** rows)

For each, the question to settle before ranking. Grouped so related items
can be decided together.

### Is it worth building? (status clear, value unclear)

1. **York / Deming regression** (A1). Both axes carry error. Used in
   calibration lines and Arrhenius fits.
2. **Per-pixel fit through a matrix stack** (A1). Only useful if
   temperature- or field-series maps are a real workflow.
3. **Fit-library breadth** (A2): Exponential, Peak, PFW, Rational, Implicit
   and Rheology families. Bulk-port all Origin built-ins so `.opju` fits
   re-open with their own function, or port on demand?
4. **Domain fit families** (A2, marked *Out?*): chromatography,
   electrophysiology, pharmacology, enzyme kinetics. Out of scope?
5. **Wavelets** (A4). CWT, DWT and denoise are G10 residue. Student runs
   them, so an oracle exists.
6. **Rise time and level crossing on raw data** (A4). Transport and pulse
   measurements.
7. **Curve intersection and 2D ROI volume integration** (A5).
8. **Row-wise t-tests, MANOVA, mixed models, power and sample size,
   probability calculator** (A6). Which of these does
   the lab actually reach for?
9. **K-means and hierarchical clustering** (A6, J13). Still census-gated in
   `JMP_GAP_PLAN.md`. Does an Origin-side oracle change that?
10. **Radar, Smith chart, ridgeline, marginal plots, CDF plot, half/split
    violin** (B1). Which are wanted for creation, not just import?
11. **The *Out?* plot families**: 3D beyond surface and waterfall,
    hydrochemistry, Sankey and chord, treemap, finance, tile maps.
    Confirm out of scope.
12. **EPS and EMF export** (B2). EPS is still requested by some journals.
    EMF needs a non-matplotlib path.
13. **Missing ROI gadget kinds** (B2) and **pick points into a sheet** (B2).
14. **Imports** (C1): SPE, ISF, TDMS, Prism/SAS/Minitab, JSON, ODBC. Which
    files actually turn up in the lab?
15. **Formula breadth** (C3): distributions, special functions and
    moving-window statistics in column formulas.
16. **Graphs / images inside worksheet cells** (C3), **matrix formulas** and
    **virtual matrices** (C4).
17. **Automation surfaces** (D): a command language, a Python console
    (G18), an app store, group folders, Word templates with bookmarks, an
    in-app Learning Center.

### Is the status right? (evidence unclear)

18. **Multi-output fit (nlbeginr) and matrix fit (nlbeginm)** (A1). Does
    Global Fit / Surface Fit cover the real use, or not?
19. **Rank-all-models (funcRank)** (A1). Is Compare with a user-picked list
    enough?
20. **Standard curve and enzyme kinetics** (A1). Is Find X from Y plus the
    MM model sufficient?
21. **Peak finding by derivative** (A3). Does the residual and prominence
    finder meet the same need?
22. ~~**Ternary contour** (B1)~~. Settled 2026-11-25: it is Missing. The
    `contour-scattered` command grids on Cartesian axes, not the triangle.
23. **Heatmap with cell labels** (B1), and the **linked worksheet image /
    table on a graph** (B2).
24. **Text to columns** (C3). Does split dataset cover splitting one text
    column by a delimiter?
25. **Worksheet to PDF / image** (C2). Not found; confirm it is absent.
26. **Tutorials** (D). `docs/tutorials` exists. Should anything be reachable
    in the app?

---

### Added by the online sweeps (2026-11-25)

27. **Electrochemistry: cycler/potentiostat import (BioLogic, Neware, Ivium,
    Metrohm) and impedance (EIS / Nyquist) analysis** (F, G). Today
    `calc/electrochemistry.py` holds only scalar calculators. Is
    electrochemistry a target user group?
28. **Tangential baseline and peak alignment (zero-shift)** (F, G). These
    are small additions to the peak tools.
29. **Time-temperature superposition and Redlich-Kister** (F, G). They
    belong with the rheology question in item 4.
30. **Oscilloscope and logger import (Tektronix, LeCroy, MDF4)** (F). Merge
    with item 14?
31. **Pro-only Apps quantized lacks**: chaining parameters in sequential
    fits, pulse fit, optimization / equation solver, Mann-Kendall trend
    test, Gaussian mixture models, Poincaré plot, concave hull, Zoom FFT
    (F, G).
32. **Interface tools that exist under other names** (E): Layer Contents
    (`LayerContentsDialog.tsx`), Object Manager (the Plot Objects
    inspector), Mini Toolbars (`SelectionMiniToolbar.tsx`), Data
    Highlighter (row states). Check whether their scope matches Origin's
    before treating them as Have.

---

## What the GUI pass would still verify

The COM probe cannot see menus or dialogs. When screen access is granted,
check:

- **Plot menu:** that Radar, half violin, sunburst and error band (the
  `run.section` recipes) draw from the menu, and list any menu plot type
  missing from the 515-template inventory.
- **Tools, Format, View, Window menus:** GUI-only tools without an
  X-Function, for example Object Manager, Data Navigator, Layer Contents,
  Code Builder, Function Organizer, Message Log and Results Log, Learning
  Center, Apps Gallery.
- **Graph right-click menus:** plot-level options with no LabTalk entry.
- **Apps Center as Student:** whether the statistics Apps can be
  downloaded at all.

---

## Reproduce

The scratch scripts were not committed; this section says how to regenerate
them.

- **X-Function catalogue:** for every `.OXF`, read `xFdescription` (label and
  purpose) and `<name>/<io>/<type>` (signature). `<example>` blocks are often
  empty, so build calls from the signature.
- **Fit and formula catalogues:** `LTF/Default/Functions.xml`
  (`<Category Label=…>` children).
- **Evidence search:** one regex per feature over non-test `*.py`, `*.ts`
  and `*.tsx` under `src/quantized` and `frontend/src`, then re-check
  zero-hit and suspicious rows line by line.
- **COM probe:** `OriginSession` from `tools/plot_corpus/origin_session.py`.
  Seed a fresh book, one `Execute()` per step, `page.active = 1` before
  `worksheet -s`, a 60 s `deadline()` per call. Count pages with
  `doc -e P {…}`. `Execute()` returning `False` is the reliable failure
  signal; `xf_get_last_error_code()` stayed 0 even on failure.
- **Treemap:** `plottreemapm` kills the instance, so run it last or alone.
