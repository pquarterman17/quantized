# GAP AUDIT 9 — OriginPro 2026b and JMP 19 / JMP Pro 19 against quantized v0.43.1 (main)

**Date:** 2026-11-24. **Status:** audit only; no code changed (this file is the only
change, on branch `claude/gap-audit-9`). **Baseline:** `origin/main` at
`d10c70c1` (Release v0.43.1). A first draft was checked against a stale
`v0.42.0` checkout; every "has today" claim below was re-grepped against
`d10c70c1` (see "Re-verification" at the end).
**Owner rules applied:** general before specialised; fail closed (new behaviour
is a UI option); MATLAB is not a gate.

## Method

1. **Feature inventory from official sources** (fetched 2026-11-24):
   - Origin: [What's new in 2026](https://www.originlab.com/2026),
     [What's new in 2026b](https://www.originlab.com/2026b), and the product
     feature pages for
     [Graphing](https://www.originlab.com/index.aspx?go=Products/Origin/Graphing),
     [Curve fitting](https://www.originlab.com/index.aspx?go=Products/Origin/DataAnalysis/CurveFitting),
     [Peak analysis](https://www.originlab.com/index.aspx?go=Products/Origin/DataAnalysis/PeakAnalysis),
     [Signal processing](https://www.originlab.com/index.aspx?go=Products/Origin/DataAnalysis/SignalProcessing),
     [Mathematics](https://www.originlab.com/index.aspx?go=Products/Origin/DataAnalysis/Mathematics),
     [Statistics](https://www.originlab.com/index.aspx?go=Products/Origin/Statistics),
     [Third-party import formats](https://docs.originlab.com/origin-help/import-thirdpartyformats/),
     [Data Connector](https://docs.originlab.com/origin-help/data-connector/) and
     [the originpro Python package](https://docs.originlab.com/python/documentation-for-originpro-package/).
   - JMP: [New in JMP 19 / JMP Pro 19](https://www.jmp.com/en/software/new-release/new-in-jmp),
     [JMP Pro capabilities](https://www.jmp.com/en/software/predictive-analytics-software),
     the [JMP documentation library](https://www.jmp.com/support/help/en/16.0/jmp/jmp-documentation-library.shtml)
     (platform list per book; the current 19.x library is at
     [jmp.com/documentation](https://www.jmp.com/documentation)),
     [Profiler](https://www.jmp.com/support/help/en/18.0/jmp/profiler-2.shtml),
     [Standard Least Squares](https://www.jmp.com/support/help/en/18.2/jmp/standard-least-squares-models.shtml),
     [Prediction Formula (19.0)](https://www.jmp.com/support/help/en/19.0/jmp/prediction-formula.shtml)
     and the [Statistics Knowledge Portal](https://www.jmp.com/en/statistics-knowledge-portal).
2. **quantized check** by grep over `src/quantized/{calc,routes,io}`,
   `frontend/src/{commands,components,lib,store}` (menus:
   `components/Shell/appMenuPlacement.ts` + `appMenuModel.ts`; Analyze commands:
   `commands/analysisCommands.ts`, `commands/discoveryCommands.ts`), `docs/`,
   `CHANGELOG.md` through 0.43.1
   (test files, `schema.d.ts` and `__pycache__` excluded). Every "absent"
   below is a grep that found nothing; the searched terms are given in the
   evidence. Items whose absence could not be proved from code are marked
   **verify**. The app was not started for this audit (the optional
   Playwright check was skipped); the **verify** items are the ones a
   browser check should settle first.
3. **De-duplication** against `plans/GAP_AUDIT_8.md` (lanes SCAT, SIG, LBL,
   FITANN, CLEAN, FITPRE, SEL2, RL2, STATUI, CFMT, STFT: all shipped, see
   CHANGELOG 0.40–0.42), `plans/JMP_GAP_PLAN.md` (J1–J17),
   `plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md`,
   `plans/ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md`,
   `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` (skimmed: P0–P4, P2.8, P4.4),
   `plans/OPEN_ITEMS.md` and `plans/PORT_CHECKLIST.md`. Earlier items that are
   still open are listed under "Still open", not as new gaps.

Provisional owner decisions: `plans/OPEN_ITEMS.md` "2026-11-24 overnight:
provisional owner decisions" (10 boxes, none confirmed) and the four
"Provisional decisions (owner to confirm)" sections in
`plans/RESULT_ACCEPTANCE_AUDIT.md`. None is contradicted by a gap below. Item 2
there (a PANalytical binary `.raw` parser, today refused with a request for
`.xrdml`) is folded into G5 / decision D5.

## Summary

| Area | P0 | P1 | P2 | Total |
|---|--:|--:|--:|--:|
| Graphing and interaction | 1 | 0 | 3 | 4 |
| Data handling and import | 0 | 2 | 4 | 6 |
| Mathematics on maps / matrices | 0 | 1 | 1 | 2 |
| Curve fitting | 0 | 0 | 1 | 1 |
| Signal processing and peaks | 0 | 0 | 2 | 2 |
| Statistics and modelling | 1 | 2 | 2 | 5 |
| Quality, reliability and DOE | 0 | 1 | 1 | 2 |
| Multivariate and predictive | 0 | 0 | 2 | 2 |
| Automation and scripting | 0 | 0 | 1 | 1 |
| Collaboration and reporting | 0 | 0 | 2 | 2 |
| **Total** | **2** | **6** | **19** | **27** |

Plus 4 large still-open earlier gaps (J13 clustering, J14 SPC/capability, J15
MSA, J16 DOE; census-gated) that would each be P0/P1 if the owner lifts the
gate (decision D1).

Headline: for **plotting, fitting, peaks, signal processing and the lab's
techniques** quantized is at parity or ahead. The remaining distance to "replace
JMP" is concentrated in **modelling** (no multi-factor linear model, no
profiler, no DOE/SPC) and to "replace Origin" in a handful of **plot/map
operations** (polar heatmap / pole figure, matrix operations) and **import
breadth**.

## Prioritised gaps

Legend: **Size** S under a day, M one focused PR, L multi-PR or design-heavy.
"Has today" cites the nearest existing code.

### P0 — a common lab workflow cannot be done at all

#### G1. Fit Model: multi-factor linear model (continuous + categorical effects, interactions)

- **Capability:** JMP Fit Model / Standard Least Squares: any number of
  continuous and nominal effects, crossed interactions, polynomial terms,
  ANCOVA, effect tests (Type III), LS means with comparisons, leverage and
  residual plots, Save prediction formula. Origin: General Linear Regression,
  Three-Way ANOVA, MANOVA.
- **Source:** [JMP Standard Least Squares](https://www.jmp.com/support/help/en/18.2/jmp/standard-least-squares-models.shtml);
  [JMP Prediction Formula](https://www.jmp.com/support/help/en/19.0/jmp/prediction-formula.shtml);
  [Origin Statistics](https://www.originlab.com/index.aspx?go=Products/Origin/Statistics) (General Linear Regression, Three-Way ANOVA, MANOVA).
- **Has today:** continuous-only `multiple_regression` / `stepwise_regression`
  (`src/quantized/calc/stats_multivar.py`); one-way ANOVA (`calc/stats.py`
  `anova1`); balanced and unbalanced **two**-way ANOVA
  (`calc/stats_anova2.py` `anova2`, `calc/stats_anova_ext.py`
  `anova2_unbalanced`); RM-ANOVA; nested ANOVA (`calc/stats_varcomp.py`).
  Grep for `ancova|covariate|manova|lsmeans|ls means|least squares means`
  finds nothing; no model can mix a categorical factor with a continuous
  covariate or take three factors.
- **Why it matters here:** growth-parameter studies (substrate temperature ×
  pressure × substrate type → lattice parameter, Hc, resistivity, roughness)
  are 3+ factor problems with a categorical factor. Today the user exports to
  JMP. It is also the analysis half of any DOE (J16) and the base of G7.
- **Size:** L (design of the effect/model spec is new data-model work).
- **Dependencies:** none to start; J1 categorical columns (shipped). Unblocks
  G7, J16, G26.

#### G2. Polar heatmap / polar contour, and a pole-figure (stereographic / equal-area) view

- **Capability:** Origin polar contour and polar heatmap plot types; a pole
  figure is the same plot of intensity over (ψ/χ radial, φ azimuthal).
- **Source:** [Origin Graphing](https://www.originlab.com/index.aspx?go=Products/Origin/Graphing) ("polar contour, polar heatmap").
- **Has today:** pole-figure XRDML imports as a rectangular map
  (`src/quantized/io/xrdml.py` `_classify_pole`, `mesh_kind="pole"`,
  `io/_map_schema.py`); ROI tools know the periodic φ axis
  (`frontend/src/lib/roi.ts` pole-figure branch); the polar plot type is
  line/scatter only (`frontend/src/components/Stage/PolarStageCore.tsx`,
  `calc/figure_polar.py`). `io/_xrdml_scan.py:173` and archived
  `plans/archive/GAP_TIER3_PLAN.md` #6 record "stereographic/polar projection
  is a later view" but no active plan books it. Grep for `polar contour|polar
  heatmap|stereograph` finds no renderer.
- **Why it matters here:** texture and in-plane epitaxy checks of films are
  presented as pole figures; the lab can load the data but cannot draw the
  figure. Polar heatmap is also a general plot type (angle-resolved
  anything), so it satisfies "general first".
- **Size:** M (general polar heatmap: screen + export) + S (pole-figure
  projection options on top).
- **Dependencies:** owner decision D4 (projection default). Map colour-scale
  machinery exists (`calc/figure_map.py`, `components/Stage/mapColorbar.ts`).

### P1 — important, a workaround exists

#### G3. Map (matrix) operations

- **Capability:** Origin matrix operations: crop/shrink/expand, flip,
  rotate, transpose, Set Matrix Values (arithmetic, also between two
  matrices), matrix filters, volume integration, profile lines.
- **Source:** [Origin Mathematics](https://www.originlab.com/index.aspx?go=Products/Origin/DataAnalysis/Mathematics) (Matrix operations, Volume Integration).
- **Has today:** map build / regrid / interpolate (`calc/map.py`,
  `calc/interp2d.py`), line/box/sector cuts (`calc/linecut.py`,
  `calc/boxcut.py`, `calc/sectorcut.py`), ROI integrate (`roicuts`
  workshop), surface fit with residual map. Grep for `flip|rotate|crop|map
  math|subtract plane|plane level` in map code finds nothing; Dataset math
  (`components/workshops/datasetmath/`) is 1-D only. **Verify** whether a map
  held as X/Y/Z columns can be edited with Set Column Values (likely yes for
  single-map arithmetic, which is the workaround).
- **Why it matters here:** subtracting a background/dark map from an RSM or
  area-detector frame, normalising one map by another, cropping to the region
  of interest, and levelling a tilted wafer/AFM map.
- **Status 2026-11-25 (lane `map-extras`):** crop from a drawn region shipped (the map's Box tool `mapRoi` fills the crop op's bounds via "Use box drawn on the map", snapped to the nearest cell centre per edge; same op and recipe, no backend change; provisional, owner to confirm). Still open: matrix filters, volume integration, profile lines.
- **Size:** M. **Dependencies:** none; keep out of `MapStage.tsx` (399/400
  lines): new `calc/map_ops.py` + workshop, toolbar entry only.

#### G4. Grouped aggregates in formulas (per-group normalise)

- **Capability:** JMP `Col Mean(x, by)`, `Col Max`, `Col Rank`, `Col Score`
  (JMP 19 adds Col Score / Col Interpolate); Origin column formulas with
  grouping.
- **Source:** [New in JMP 19](https://www.jmp.com/en/software/new-release/new-in-jmp) (Scripting: "Col Score, Col Interpolate"; ranking tie modes).
- **Has today:** whole-column and row-range aggregates only
  (`frontend/src/lib/formulaAggregates.ts`: mean/sd/min/max/median/sum/count;
  `lib/formulaRefs.ts` `A[i:j]`, `rowmean`, `sheet()`); `standardize`
  transform is per column, not per group (Reshape ▸ "Z-score / min-max /
  rank columns…"); Analyze ▸ Normalize (range / peak / area / z-score /
  reference, `commands/discoveryCommands.ts` → Signal processing) normalises
  whole signals, not per level of a group column.
- **Why it matters here:** long-form data with one row per point and a
  Sample column (M vs H for 12 samples, SIMS profiles): "divide each sample's
  M by its own Ms" is one formula in JMP. Workaround: Split by column, then
  Normalize across the split sheets (Signal processing on several sheets),
  re-merge.
- **Size:** S. **Dependencies:** none. `formulaRefs.ts` is 448/500: add a new
  lazy extension module.
- **Status (lane FXBY, 2026-11-24):** built as `col_mean/sd/min/max/median/sum/count/
  rank(_avg/_min/_dense)/score(x, By…)` in `lib/formulaGroupAgg.ts`, validated
  against pandas `groupby().transform()`. Provisional, owner to confirm: a
  missing by-key gives missing (not its own group); `col_rank` ties in row
  order; `col_score` = sample-sd z-score (JMP 19 Col Score definition unread).
- **G16 status (lane gap9-fxtext, 2026-11-24):** text functions (`len`, `num`,
  `contains`/`startswith`/`endswith`/`find`, `regex_match`, `parse_date`, plus
  `upper/lower/trim/left/right/mid/substr/concat/replace/regex_extract/str/
  format_date` as arguments of those) in `lib/formulaText.ts`; date/time
  (`year..second`, `weekday`, `dayofyear`, `make_date`, `datediff`) in
  `lib/formulaDate.ts` + `lib/formulaCalendar.ts`; pandas/dateutil goldens
  (`tools/freeze_text_date_fixture.py`). A formula column still holds
  numbers: a text-VALUED column and Flash Fill are NOT built; see
  `plans/FORMULA_TEXT_DESIGN.md` (provisional, owner to confirm).

#### G5. Instrument import breadth: Rigaku `.ras`/`.rasx`, Bruker `.uxd`, VAMAS `.vms`, PANalytical binary `.raw`

- **Capability:** Origin imports instrument formats through import filters
  and Data Connectors; JMP through connectors.
- **Source:** [Origin third-party formats](https://docs.originlab.com/origin-help/import-thirdpartyformats/);
  [Origin Data Connector](https://docs.originlab.com/origin-help/data-connector/).
- **Has today:** Rigaku `.raw` binary only (`io/rigaku.py`), Bruker `.raw`
  and `.brml`, PANalytical `.xrdml`, plus ~50 extensions
  (`io/registry.py`). Grep for `rasx|\.ras\b|vamas|\.vms` finds nothing; `.uxd`
  is mentioned only in a `io/bruker_raw.py` docstring and is not registered.
  The new quick converter (`io/convert_*.py`, `qz convert`, File ▸ Export ▸
  Quick Convert) widens **output** formats only; it reads what the registry
  reads. A PANalytical binary `.raw` parser is OPEN_ITEMS overnight decision 2.
  Workaround: export ASCII from the vendor software and use the import wizard.
- **Why it matters here:** SmartLab Studio II writes `.ras`/`.rasx` by default;
  VAMAS is the XPS interchange format (thin-film chemistry). The `.raw`
  variable-step / Oxford items are already gated (see Still open).
- **Size:** M (S per format with a specimen). **Dependencies:** specimens
  (decision D5); `io/registry.py` is 499/500 lines: split the registry first.

#### G6. Hypothesis-test completion

- **Capability:** Welch ANOVA, Games-Howell (new in JMP 19 Oneway), Scheffé /
  Fisher LSD / Dunn-Sidak post hoc, Bartlett and two-sample F variance tests,
  equivalence (TOST), tolerance intervals (normal and nonparametric),
  one/two-proportion and binomial tests, Poisson rate test, Mood's median.
- **Source:** [Origin Statistics](https://www.originlab.com/index.aspx?go=Products/Origin/Statistics);
  [New in JMP 19](https://www.jmp.com/en/software/new-release/new-in-jmp) (Games-Howell, Fieller, nonnormal tolerance intervals).
- **Has today:** large set (`lib/statsTests.ts`, `calc/stats_tests.py`,
  `calc/stats_anova2.py` Tukey/Dunnett/adjust-p, Levene/Brown-Forsythe,
  chi-square GoF, Fisher exact). Grep for `welch.?anova|games.?howell|bartlett|
  tolerance interval|proportion test|binomial test|tost` finds no engine
  (Welch exists only for the t-test, `calc/stats.py:224`).
- **Why it matters here:** unequal-variance groups are the norm for
  sample-to-sample comparisons (Welch/Games-Howell); "is the new process
  equivalent to the old" is a TOST question; tolerance intervals set
  acceptance limits.
- **Size:** M. **Dependencies:** none; registry pattern from GAP 8 STATUI.
- **Status (lane TESTS2, 2026-11-24, owner-approved recommendation 2026-11-23):** built in
  the Statistical tests workshop: Welch ANOVA, Games-Howell / Tukey / Scheffe / Fisher LSD,
  Bartlett / Levene / Brown-Forsythe / two-sample F, one- and two-sample TOST, normal
  tolerance intervals (exact two-sided factor, noncentral-t one-sided), one-proportion
  (exact and normal), two-proportion and Fisher 2x2 (`calc/stats_group_tests.py`,
  `stats_equivalence.py`, `stats_proportion.py`, `routes/stats_tests_ext.py`). Still open:
  Dunn-Sidak post hoc, nonparametric tolerance intervals, Poisson rate test, Mood's median.
  Provisional, owner to confirm: no default equivalence margin or counts; omega-squared for
  Welch ANOVA is approximate; proportions take typed counts, not a 0/1 column.
- **Status (lane stats-extras, 2026-11-24):** the four leftovers are built in the same workshop
  (`calc/stats_nonparam_ext.py`, `routes/stats_tests_ext.py`): Dunn-Sidak as a fifth post hoc
  method (tie-corrected Dunn z, Sidak-adjusted p, Kruskal-Wallis omnibus), Mood's median test
  (oracle `scipy.stats.median_test`, exact match), Poisson rate test one- and two-sample (exact;
  matches R's `poisson.test` documentation examples to 6 digits), and distribution-free tolerance
  limits from order statistics (Wilks; matches the NIST 7.2.6.4 N = 25 table; refuses with the
  required n when the sample is too small). Provisional, owner to confirm: Dunn-Sidak mean-rank
  table has no CI or effect size; the Poisson two-sided one-sample p uses the minimum-likelihood
  rule; the symmetric order-statistic choice for two-sided tolerance limits (tightest equal
  exclusion from each end). The goal section above is otherwise complete for G6.

#### G7. Prediction profiler and contour profiler for fitted models

- **Capability:** JMP Prediction Profiler (traces per factor with CI,
  desirability, optimisation), Contour Profiler, Surface Profiler.
- **Source:** [JMP Profiler](https://www.jmp.com/support/help/en/18.0/jmp/profiler-2.shtml).
- **Has today:** confidence/prediction bands for 1-D fits
  (`calc/stats_band.py`, `curvefit/FitBandsSection`), surface fit residual
  map (`workshops/surfacefit/SurfaceResidualMap.tsx`), fit initial-guess
  preview. Grep for `profiler|desirability` finds only unrelated depth-profile
  code.
- **Why it matters here:** "which temperature and pressure give the target
  lattice parameter" from a fitted model; also makes surface fits and
  multi-input custom equations explorable.
- **Size:** M. **Dependencies:** G1 (for multi-factor models); usable earlier
  on Surface fit.

#### G8. Life / reliability distribution with censoring

- **Capability:** JMP Life Distribution, Fit Life by X, Fit Parametric
  Survival; Origin 2026b Parametric Distribution Analysis for arbitrary
  censored data, Distribution Identifier, Life Test Plans, Regression with
  Life Data. Weibull probability plot with CI, B10 life.
- **Source:** [Origin 2026b](https://www.originlab.com/2026b) (Reliability analysis);
  [JMP documentation library](https://www.jmp.com/support/help/en/16.0/jmp/jmp-documentation-library.shtml) (Reliability and Survival Methods).
- **Has today:** Kaplan-Meier / log-rank / Cox (`calc/stats_survival.py`,
  Statistical tests), uncensored distribution fits incl. Weibull
  (`calc/stats_dist.py`), Q-Q / probability plots (`calc/statplots.py`).
  Grep for `reliability|censor` in `stats_dist.py` finds no censored
  parametric fit.
- **Why it matters here:** dielectric breakdown (TDDB, Weibull slope β, field
  acceleration) and device-lifetime tests on oxide/ferroelectric films are
  censored Weibull problems. Workaround: KM + external Weibull fit.
- **Size:** M. **Dependencies:** decision D6 (does the lab do breakdown or
  lifetime testing?).
- **Status (2026-11-24, lane gap9-life): shipped, provisional.** Two tests in
  the Statistical tests workshop. *Life distribution*: right-censored MLE (censor
  column, 1 = censored as in JMP) for Weibull, lognormal, exponential,
  loglogistic and smallest-extreme-value; parameters with SE and Wald CIs; AICc
  and BIC model comparison; Kaplan-Meier with pointwise exponential-Greenwood
  bands; B-life quantiles and failure probabilities at entered times with
  delta-method bands; a probability plot with the axes linearised per
  distribution, the fitted line and its Wald band (median-rank or
  Kaplan-Meier-midpoint plotting positions). *Fit Life by X*: one regressor,
  Arrhenius (C or K), inverse power law or linear, common-sigma location-scale
  regression, activation energy, life at a use condition, acceleration factors
  (`calc/life_*.py`, `calc/stats_life*.py`, `routes/stats_life.py`,
  `workshops/statstests/Life*.tsx`). Refuses fewer than 2 failures, negative
  times, a censor column that is not 0/1, and (log families) zero times.
  Validated against lifelines (Weibull, lognormal, exponential, log-logistic,
  Kaplan-Meier, Weibull/lognormal AFT; agreement 5e-7 to 5e-5 relative, measured),
  scipy (uncensored), and the NIST/SEMATECH e-Handbook 8.4.1.3 censored Weibull
  example (eta 606.528, beta 1.7208, log-likelihood -75.135, AIC 154.27 / 154.39).
  Provisional, owner to confirm: Weibull default, 95% level, Wald (not
  likelihood-ratio) intervals, median-rank plotting default, default B-lives
  B1/B10/B50, the transform list, and the D6 priority itself. Still open:
  likelihood-ratio / profile intervals, Turnbull (interval-censored) and
  left-censoring, mixture / competing-risk distributions, Fit Life by X with
  several regressors or a stress-wise probability plot, life test plans, and
  extending `calc/figure_statplots.py` (its probability plot is the uncensored
  Q-Q; the censored plot is drawn in the workshop, not exported as a figure).

#### G26. Response screening — done (2026-11-24)

- **Status:** shipped as the "Response screening" test (group "Screening") in
  the Statistical tests workshop. `calc/stats_screening.py`,
  `routes/stats_screening.py` (`POST /api/stats/response-screening`),
  `lib/statsTestsScreen.ts`, `workshops/statstests/Screen*.tsx`. Per Y × X pair:
  continuous X is `linregress` (slope, t interval, r); nominal X is a pooled
  t-test (2 levels) or one-way ANOVA (eta-squared). Pairwise missing; a pair
  that cannot be tested is returned with a reason and kept out of the
  adjustment. Raw p adjusted together by BH (default), BY (new in
  `adjust_pvalues`), Holm or Bonferroni; LogWorth = -log10 p (floored at 1e-300).
  UI: adjusted-LogWorth bar chart, p-value plot with the BH line, sortable
  table, saved as a result through the existing statistical-test result path.
  Oracles: scipy `linregress`, `ttest_ind`, `f_oneway`,
  `false_discovery_control` (bh, by), statsmodels `multipletests`.
- **Provisional, owner to confirm:** BH default, alpha 0.05, one adjustment
  family across every pair (JMP's default), pooled-variance t for 2 levels,
  eta-squared / r effect sizes, level order = sorted names, factor kind from
  the column's categorical flag plus a "nominal" override. Still open: a
  per-factor adjustment family, a forest plot of estimates, nonparametric
  (rank) options, ordinal factors, a cap on the pair count beyond 5000.

### P2 — nice to have

| # | Capability | Source | Has today | Why for this lab | Size | Deps |
|---|---|---|---|---|---|---|
| G9 | Linked selection in MDI worksheet windows (JMP dynamic linking everywhere), as an option | [JMP library](https://www.jmp.com/support/help/en/16.0/jmp/jmp-documentation-library.shtml) (Using JMP: row states) | **Downgraded from P1 on re-verification:** the shared brush already reaches every plot: Stage (`components/Stage/PlotStage.tsx`) and background plot windows (`components/windows/BackgroundPlotWindow.tsx:209-219`, incl. frozen statistical figures), and plot brush → worksheet (`components/Stage/usePlotStageActions.ts` `onRangeSelect`). Left: MDI worksheet windows keep their own selection by design (`store/worksheetSelection.ts`, GUI_INTERACTION_PLAN #14), so selecting rows there lights no plot | outlier hunting from a table window | S/M | decision D7 |
| G10 | Wavelet transforms (CWT, DWT, wavelet denoise), IIR filter design (Butterworth / Chebyshev / elliptic, causal), coherence, FIR decimation | [Origin Signal processing](https://www.originlab.com/index.aspx?go=Products/Origin/DataAnalysis/SignalProcessing) | FFT-domain Butterworth-shaped filter (`calc/spectral.py` `fft_filter`), SG/LOWESS/median/despike/Wiener/Hilbert (`calc/signal_filters.py`), STFT (`calc/spectrogram.py`). Grep `wavelet|cwt|chebyshev|elliptic|coherence`: none | noise removal on transport / SQUID traces without peak distortion | M | permissive dep (PyWavelets, MIT) or scipy only. **Status 2026-11-24:** IIR design (Butterworth / Chebyshev I-II / elliptic / Bessel, LP/HP/BP/BS, causal or zero-phase, magnitude + phase preview) shipped scipy-only as the "IIR design" method of the Signal processing Frequency filter (`calc/iir_filter.py`, `calc/iir_workbench.py`, recipe `iir` block). Still open: wavelets (D8), coherence, FIR decimation. |
| G11 | Robust (bisquare / Huber) and quantile regression; fit models defined by an ODE, by convolution with an instrument function, or piecewise | [Origin Curve fitting](https://www.originlab.com/index.aspx?go=Products/Origin/DataAnalysis/CurveFitting) (fit with convolution, Fit ODE, Piecewise Fit, Quantile Regression) | weighting, ODR, implicit, global, bumps (`calc/fit_*.py`); `huber` only in `signal_filters.py` LOWESS; grep `solve_ivp|odeint|piecewise fit|quantile`: none | outlier-robust fits; resolution-convolved lineshapes; rate-equation (ODE) kinetics | M | new files (`curvefit/useCurveFit.ts` is 402 lines, `routes/fitting.py` 448)<br>**Partly built 2026-11-24 (lane gap9-robust):** robust loss (soft-L1 / Huber / Cauchy, scipy `least_squares`), Tukey-bisquare IRLS (matches statsmodels `RLM` to 1e-10) and quantile regression (LP; matches `QuantReg`, coefficients 2e-5) in Curve Fit → Advanced → "Robust and quantile fit" (`calc/fit_robust.py`, `calc/fit_quantile.py`, `routes/fitting_robust.py`). Still open: piecewise / segmented fit, convolution, ODE models. Provisional, owner to confirm: automatic scale, outlier flag (weight < 0.5), approximate nonlinear errors, quantile SE tie-break. |
| G12 | PLS regression / multivariate calibration, PCA with spectra as observations, discriminant analysis, factor analysis, MDS | [Origin Statistics](https://www.originlab.com/index.aspx?go=Products/Origin/Statistics) (PLS, discriminant); [JMP library](https://www.jmp.com/support/help/en/16.0/jmp/jmp-documentation-library.shtml) (Multivariate Methods) | PCA / correlation / SPLOM (`calc/stats.py` `pca_analysis`, `workshops/multivar`). Grep `partial least|pls|discriminant`: none | composition from Raman/XPS/XRF spectra; sorting spectra families | M | domain family (spectroscopy), after G1 |
| G13 | Time series: ACF/PACF plot, ARIMA, seasonal decomposition, stationarity, change-point | [Origin Statistics](https://www.originlab.com/index.aspx?go=Products/Origin/Statistics) (Time Series); [JMP library](https://www.jmp.com/support/help/en/16.0/jmp/jmp-documentation-library.shtml) (Time Series) | cross-correlation / autocorrelation helper (`calc/spectral.py`), MCMC ACF (`calc/mcmc.py`); no UI | drift of long logs (chamber pressure, temperature, cryostat stability) | M | none<br>**Built 2026-11-25 (lane time-series):** Analyze > Statistics > Time series (lazy `workshops/timeseries/`, `routes/timeseries.py`, `calc/ts_*.py`): ACF/PACF with Bartlett and white-noise bands and Ljung-Box (vs statsmodels to 1e-12), KPSS (own, Kwiatkowski 1992 table; equals statsmodels) and ADF (statsmodels), classical additive/multiplicative decomposition (vs statsmodels), PELT / binary-segmentation change points on mean/variance with a penalty option (PELT vs exact DP; Nile break 1899), ARIMA(p,d,q) fit and forecast via statsmodels from the existing optional `[stats]` extra (no D8 dependency; scale-equivariance oracle). Each result commits as a linked worksheet (`commitComputedOutput`). Provisional, owner to confirm: modified-BIC default penalty `(p+2) ln n`, robust MAD noise scale for the mean cost, p and q at most 5 and d at most 2, uneven X refused unless ticked, first d ARIMA fitted values blank. Still open: seasonal ARIMA, a figure-builder export of the panel plots (they are on-screen only; the committed worksheet plots normally), reopen-in-tool for the committed worksheets, ADF without the `[stats]` extra. |
| G14 | Predictive modelling: decision tree / bootstrap forest / boosted tree, neural net, KNN, SVM, Gaussian process, validation column, model screening and comparison, formula depot | [JMP Pro](https://www.jmp.com/en/software/predictive-analytics-software); [Origin 2026b](https://www.originlab.com/2026b) (Random Forest, Predictive Modeling Advisor) | logistic / Poisson GLM (`calc/stats_glm.py`), ROC (`calc/stats_roc.py`); grep `random forest|neural|decision tree|svm`: none | modest; process-outcome prediction from run logs | L | decision D2; scikit-learn (BSD) |
| G15 | More plot types: parallel coordinates, radar, hexbin and 2-D kernel density, ternary contour/heatmap, Bland-Altman, Pareto, dot/interval plot, stem-and-leaf; Origin 2026b slope annotation | [Origin Graphing](https://www.originlab.com/index.aspx?go=Products/Origin/Graphing); [Origin 2026](https://www.originlab.com/2026); [Origin 2026b](https://www.originlab.com/2026b) | 22 gallery types (`frontend/src/lib/plotTypes.ts`), ternary scatter with a colour value (`calc/figure_ternary.py`), 1-D KDE (`calc/statplots.py`). Grep `parallel coord|radar|hexbin|kde2d|bland|pareto|ternary contour`: none | parallel coords for multi-parameter growth runs; ternary maps of composition-spread libraries; Bland-Altman for instrument cross-calibration | M (S each) | screen + export parity per type  **Built 2026-11-24 (lane gap9-plots2, owner-approved recommendation):** parallel coordinates, hexbin, 2-D KDE, Pareto and Bland-Altman as plot-type tiles with a lazy Plots2 Stage (server render = export) via `FigureRequest.plots2` (`calc/plots2_stats.py`, `figure_parallel|density2d|agreement.py`, `routes/export_figures_plots2.py`, `workshops/plots2/`). Bland-Altman after Bland & Altman 1986/1999 (checked on the 1986 PEFR data, values verified against the published table at york.ac.uk/~mb55); KDE bandwidth Scott's rule, provisional, owner to confirm; 1999 variance for the limits' CIs, provisional. Still open: ternary contour/heatmap, radar, dot/interval, stem-and-leaf, slope annotation; File > Export figure while a Plots2 view is open still exports the XY plot (use the Stage's Export). |
| G16 | Text and date functions in formulas, Flash Fill (derive "300K" / sample ID from a name by example) | [Origin 2026](https://www.originlab.com/2026) (Flash Fill and Smart Formula) | numeric math + text `==`/`!=` only (`lib/formulaFuncs.ts`, `lib/formulaRefs.ts`); Metadata → factors workshop (`workshops/metafactors`) covers file metadata | factor columns from sample names in pasted tables | S/M | categorical write path (J1, shipped) |
| G17 | Connectors: JSON, Parquet, TDMS (LabVIEW), Prism `.pzfx`, JMP `.jmp`, SPSS / SAS, ODBC / Postgres, Raman `.wdf` / `.spe` | [Origin third-party formats](https://docs.originlab.com/origin-help/import-thirdpartyformats/); [New in JMP 19](https://www.jmp.com/en/software/new-release/new-in-jmp) (SQL, Snowflake, S3) | SQLite query (`io/sqlite_query.py`), HDF5/NetCDF/MAT/Excel/IBW/JCAMP/SPC/OPUS (`io/registry.py`). Grep `tdms|parquet|pzfx|odbc|wdf|\.spe`: none | LabVIEW-run transport rigs write TDMS; Raman | M | G5's registry split; decision D5 |
| G18 | In-app scripting: embedded Python console / notebook acting on the open project | [originpro package](https://docs.originlab.com/python/documentation-for-originpro-package/); [New in JMP 19](https://www.jmp.com/en/software/new-release/new-in-jmp) (JMP Notebook, Python 3.13, R) | headless `qz run`, exported Python scripts, `quantized.api`, `client.py`, plugins (`docs/headless-recipes.md`, `docs/plugins.md`). Grep `python console|notebook`: none in UI | power users script one-off reductions without leaving the app | L | decision D3 (security: code runs in the server process) |
| G19 | Dashboards and live reports: a report or dashboard that re-renders when its data recalculates | [Origin 2026b](https://www.originlab.com/2026b) (result sheet toolbar); [New in JMP 19](https://www.jmp.com/en/software/new-release/new-in-jmp) (JMP Live linked refresh) | report sheets with text/table/params/figure blocks and docx/pptx/html/tex export (`components/workshops/report/`, `io/report_office.py`); the statistics result book's per-table Copy / Send to report / Open as worksheet (#942, #944) covers Origin's result-sheet toolbar; report blocks are snapshots (**verify**). Grep `dashboard`: none | weekly group-meeting deck rebuilt from updated data | M | result lifecycle (shipped) |
| G20 | Animation / movie export: step a figure through By levels or a series (T-dependent maps, field sweeps) | [Origin Graphing](https://www.originlab.com/index.aspx?go=Products/Origin/Graphing) (Movie Creator, Graph Anim) | batch figure export (`routes/export_figure_batch.py`); grep `movie|mp4|gif export`: none | talks; temperature series of RSMs | M | ffmpeg-free path (animated GIF/APNG, or PNG sequence) |
| G21 | Spectroscopy extras: Fourier self-deconvolution / peak resolution enhancement, 2-D correlation spectroscopy (Noda), peak onset | [Origin Peak analysis](https://www.originlab.com/index.aspx?go=Products/Origin/DataAnalysis/PeakAnalysis) | peak find/fit/wizard/batch, Wiener deconvolution (`calc/signal_filters.py`). Grep `self.?deconvolution|2d correlation|onset` (peaks): none | resolving overlapped Raman/FTIR bands; perturbation series | M | domain family; after ANALYSIS_CAPABILITY_ROADMAP spectroscopy presets (#21) |
| G22 | 2-D FFT, 2-D FFT filter and image filters on maps/images | [Origin Signal processing](https://www.originlab.com/index.aspx?go=Products/Origin/DataAnalysis/SignalProcessing) (2D FFT, 2D FFT filter, 2D wavelet) | image import (`io/image_import.py`), 1-D FFT only. Grep `fft2|2d fft|image filter`: none | AFM/STM periodicity, moiré, map denoise | M | G3 (map ops shell). **Status 2026-11-25:** shipped as three map ops (`calc/map_fft.py` 2-D FFT + radial FFT filter, `calc/map_imgfilt.py` Gaussian / median / uniform / Sobel / Laplacian), scipy/numpy only, no new dependency. Oracles: `numpy.fft`, `scipy.ndimage`, analytic plane-wave peak, Parseval, constant-preserving low-pass. Provisional, owner to confirm: amplitude normalised by N, frequency in cycles per unit (no 2 pi), pixel-unit filter sizes. Still open: rectangular / periodic-spot mask, 2-D wavelet (D8). |
| G23 | Find across several project files on disk | [Origin 2026](https://www.originlab.com/2026) (Find in Project Files) | Find in project (`lib/projectSearch.ts`, one open project) | "which project had the sample 2311-B fit?" | S | `.dwk` reader (`io/workspace_dwk_read.py`) |
| G24 | Persistent row states: colour / marker by row, shared by every graph (JMP Color or Mark by Column, row legend) | [JMP library](https://www.jmp.com/support/help/en/16.0/jmp/jmp-documentation-library.shtml) (Using JMP) | per-plot colour-by-column (`lib/colorscatter.ts`), row exclusion (`store/rowState.ts`) | one colour per sample across all figures without restyling each | M | G9 |
| G25 | Bayesian optimisation / Gaussian-process surrogate for sequential experiments | [New in JMP 19](https://www.jmp.com/en/software/new-release/new-in-jmp) (JMP Pro Bayesian Optimization) | none (grep `bayes|gaussian process`: only `client.py`) | choosing the next growth run | L | D1, D2; after G1/G7 |
| G26 | Response screening: many Y × X tests at once with FDR, forest plots | [New in JMP 19](https://www.jmp.com/en/software/new-release/new-in-jmp) (Response Screening) | Batch and By for the statistics tools (CHANGELOG 0.40); BH adjustment (`calc/stats_anova2.py` `adjust_pvalues`) | screening dozens of extracted parameters against process factors | M | G1 |
| G27 | Column tags / groups and a spec-limit column property | [New in JMP 19](https://www.jmp.com/en/software/new-release/new-in-jmp) (Column tags, nested groups); [JMP library](https://www.jmp.com/support/help/en/16.0/jmp/jmp-documentation-library.shtml) (Manage Spec Limits) | units, long name, comments, modeling type, hide/freeze columns (`components/Stage/worksheet/useColumnVisibility.ts`); grep `spec limit`: none | spec limits feed conditional formatting (shipped) and later SPC/capability | S | **Shipped 2026-11-24 (lane col-specs; choices provisional, owner to confirm):** LSL / USL / Target and free-text tags are `columnProps` fields edited in the column header editor, saved and undoable like comments; process capability fills blank limits from the measurement column (visible note, typed value wins). Not done: worksheet filter by tag, conditional-format "outside spec", control-chart use of spec limits (the chart has no spec inputs; after #994, the EWMA/CUSUM target could fall back to the column Target). Precursor of J14. |

- **G23 status (lane find-files, 2026-11-24): shipped, provisional.** `io/workspace_search.py` + `routes/project_search.py` (`POST /api/project-search/folder`) + the "In folder…" scope in `workshops/search/FolderSearch.tsx`. Reads raw `.dwk` JSON (no numpy load); limits (500 files, 64 MiB/file, depth 8, 20 s) and the synchronous scan instead of `jobs_api` are provisional, owner to confirm. Only `.dwk` is searched (not Origin projects or packed bundles' sources).

## Still open from earlier audits (not re-reported)

| Item | Where | State |
|---|---|---|
| J13 clustering (k-means, hierarchical, dendrogram) | `plans/JMP_GAP_PLAN.md` Tier 3; `ANALYSIS_CAPABILITY_ROADMAP.md:1681` | census-gated; grep `kmeans|dendrogram`: still none |
| J14 control charts + process capability (IMR, X̄-R, EWMA/CUSUM, run rules, Cp/Cpk) | same | **Shipped 2026-11-24 (lane gap9-spc, hold lifted for SPC by the owner, 2026-11-24):** X-bar/R, X-bar/S, I-MR, P, NP, C, U charts with ±3σ limits and Western Electric rules 1-4 (each an option), plus Cp/Cpk/Pp/Ppk (Cpm with a target), Cpk/Ppk CIs (Bissell 1990), ppm and a histogram with spec limits and normal fits, as two tests in the Statistical tests workshop (`calc/spc_*.py`, `routes/stats_spc.py`, `workshops/statstests/Spc*.tsx`). Validated on NIST 6.3.2.2 (I-MR) and 6.1.6 (capability) worked examples, GEAR.DAT X-bar/R, and the published constants table. **Update (lane stats-extras, 2026-11-24):** EWMA and tabular CUSUM (`calc/spc_cumulative.py`; NIST 6.3.2.3 / 6.3.2.4 worked examples reproduced) and rules 5-8 (`nel5`-`nel8`: 6 trending, 14 alternating, 15 within 1 sigma, 8 beyond 1 sigma; Nelson 1984, numbered here as the continuation of we1-we4) are built. EWMA lambda 0.2 / L 3 and CUSUM k 0.5 / h 5 are provisional, owner to confirm; EWMA/CUSUM take target and sigma as options and otherwise estimate them from the same data (stated in the result). Still open: varying-size X-bar charts, capability for non-normal data. Provisional, owner to confirm: constants are unverified until checked against the owner's textbook; one-sided specs accepted; rule 4 default run of 8; rules off by default. |
| J15 Gauge R&R / MSA | same | census-gated (variability chart J8 shipped) |
| J16 DOE (factorial / screening / RSM generation + analysis) | same | **built 2026-11-24** (owner lifted the J16 hold; branch `claude/gap9-doe`): generation, alias structure, effects/half-normal and Analyze design via Fit Model. See `plans/OPEN_ITEMS.md` (Design of experiments) |
| Gate J: JMP usage census + switch trial | `plans/JMP_GAP_PLAN.md:243` | owner |
| One expandable result book across the statistics tools | `plans/OPEN_ITEMS.md` #5 | partial: every statistics tool now uses the shared book (#942, #944); open are the owner's calls on its provisional choices |
| Rendered-output visual equivalence, owner review | `plans/OPEN_ITEMS.md` #6 | partial |
| Progress/cancel residues | `plans/OPEN_ITEMS.md` #15 | mostly done (#950); open: pipeline replay Cancel (owner design call), `/posterior` as a job, a parse fraction |
| XRD: phase batch comparison, stick-group legend, CIF import; a true `matchPhases` port | `OPEN_ITEMS.md` #19–#20, `plans/PORT_CHECKLIST.md:239` | built-in-phase search/match shipped (#947, `calc/xrd_search.py`, scoring provisional); the rest open |
| Spectroscopy peak-family presets, area/ratio tables | `OPEN_ITEMS.md` #21 | gated on owner data |
| Reflectometry linked fit families | `OPEN_ITEMS.md` #22 | gated on owner data |
| Magnetometry derived quantities | `OPEN_ITEMS.md` #35–#36 | Compare and Derived tabs shipped (#949); left: isotherm UI, M-uncertainty into ΔS / Arrott Tc, reopen |
| Thin-film planning: more substrates, one material record; UI for Wulff and terminations | `OPEN_ITEMS.md` #26, #28, #32, #34 | critical thickness, Bauer, Wulff, CIF symmetry, terminations and film stack → Parratt shipped (#945, #946, #948); Wulff and terminations are API-only |
| > 2 Y axes; Origin graphic objects | `PRIMARY_SOFTWARE_AUDIT_PLAN.md:348`, P4.4 | specimen-gated |
| Interactive 3-D | `PRIMARY_SOFTWARE_AUDIT_PLAN.md:6035` | gated by GOTO Q4 |
| ROI statistics/export | `PRIMARY_SOFTWARE_AUDIT_PLAN.md:5465` | gated on real need |
| EMF export; editable embedded figures | `PRIMARY_SOFTWARE_AUDIT_PLAN.md:9890–9891` | gated |
| Rigaku variable-step `.raw`, unsupported SPC, Oxford import | P4.4, `PORT_CHECKLIST.md:94` | sample-gated (G5 is the separate `.ras/.rasx/.uxd/.vms` ask) |
| Stat Stage horizontal-bar orientation; multi-column histogram residue | `ORIGIN_PLOT_TYPE_PARITY_PLAN.md` #10, #15 | partial |
| Headless replay gaps (stack/unstack/transpose/split, signal recipes, spectrogram, SIMS not replayable by `qz run`) | `docs/headless-recipes.md`; `OPEN_ITEMS.md` #7 | open |
| WebGL dense scatter, Web Worker plot prep, process-parallel fits | `plans/FUTURE_SCOPE.md` | parked |
| Origin import residues (#37–#68) | `OPEN_ITEMS.md` §4 | masks and worksheet filters now applied for proven cases (#940, #953; #43, #51 partial); rest blocked on COM / specimens; follow `origin-change` |
| Pole-figure stereographic view | archived `plans/archive/GAP_TIER3_PLAN.md` #6 ("later view") | not booked in any active plan, so promoted here as G2 |

## Already at parity or better (where quantized leads)

- **Origin project import**: `.opj`/`.opju` decode with graphs, legends,
  error bars, category axes and a corpus regression gate
  (`io/origin_project/`, `docs/origin_re/`); Origin-ASCII/`.ogs`/`.opj` export.
  JMP cannot open Origin files; Origin itself is Windows-only.
- **Result provenance and honesty**: every result records its inputs, goes
  out of date when inputs change, reopens in its tool, and refuses rather than
  guesses (RESULT_ACCEPTANCE_AUDIT, 37/37 writers). Neither Origin's operation
  locks nor JMP's scripts give this per-result audit trail.
- **Domain workbenches neither product has built in**: RSM strain/relaxation,
  XRR/PNR with DREAM posteriors, Pawley, Williamson-Hall, XRD indexing,
  SIMS depth-profile processing/alignment/regions, magnetometry
  (hysteresis, demag, Curie-Weiss, internal field), optical gap, FFT film
  thickness, DiraCulator calculators, film-stack/epitaxy planning. (Origin
  has an XRD app; nothing comparable for the rest.)
- **Fitting**: ~120 models with auto-guess (MATLAB-parity + Origin built-ins,
  `docs/fit_models.md`), custom equations, global/shared, implicit, ODR,
  surface fit, constraints and holds, bootstrap, MCMC/bumps, model scan and
  compare, CI/PI bands, find-X-from-Y, fit result on the graph, initial-guess
  preview, batch and By.
- **Peaks and baseline**: wizard, multi-peak with shared/independent
  backgrounds, batch, SNIP/ALS/Shirley/rolling ball baselines.
- **Signal processing**: SG/LOWESS/median/despike/(de)convolution/Hilbert/
  FFT/PSD/STFT with X range and saved recipes.
- **Publication output**: vector-default PDF/SVG/EPS, journal presets,
  multi-panel pages, text-as-paths, Office copy with SVG blip, docx/pptx
  reports with embedded vector figures.
- **Plot annotation**: significance brackets and compact letters, point labels
  from a column, fit/LOWESS/ellipse overlays, axis breaks, insets,
  magnifier, rich text.
- **JMP-style exploration**: Graph Builder with Group/Facet wells, column
  switcher, local data filter, Fit Y by X, Distribution, Multivariate,
  Variability chart, Tabulate, Recode, outlier screening, test chooser,
  survival, ROC, GLM, power.
- **Data cleaning**: dedupe, fill missing, standardise, stack/unstack/
  transpose/join/merge and Extract rows as recorded, undoable transforms; conditional
  formatting; cross-sheet formula references (Origin 2026b "mirror columns"
  equivalent via `sheet()`); live source watch (Origin periodic refresh).
- **Uncertainty propagation** through derived columns (`calc/errors.py`) — a
  first-class feature neither product makes routine.
- **Format conversion**: `qz convert`, File ▸ Export ▸ Quick Convert and a
  `/convert` page write CSV / Excel / `.xy` / HDF5-NeXus / `.mat` / JSON /
  `.npz` per file or as one container, with an opt-in right-click entry
  (`io/convert_*.py`, #952, #954). Origin and JMP have no batch converter.
- **Statistics results**: one result book for every statistics tool, with
  Copy table, Send to report and Open as worksheet (#942, #944).
- **Domain additions since 0.42**: XRD phase search/match (#947),
  magnetometry Compare / Derived (χ, μB/f.u., #949), film stack → Parratt
  model (#948), CIF symmetry, terminations, critical-thickness, Bauer and Wulff
  models (#945, #946).
- **Automation without a licence**: `qz run` batch over files, pipeline
  studio, recipe library, exported Python scripts, plugins; Apache-2.0,
  cross-platform (Linux/macOS/Windows), no per-seat cost.

## Suggested lanes (top 13, general first)

Order follows the owner rule: any-plot/any-dataset first, then domain
families, technique-specific last. Sizes as above. "Disjoint" means no shared
source file inside a wave; the usual serial hot files (`CHANGELOG.md`,
`frontend/src/architecture.test.ts`, `lib/api/schema.d.ts`, bundle budget,
`commands/analysisCommands.ts`, `store/useApp.ts`) are merged by the
orchestrator one lane at a time.

| # | Lane | Gap | Files (new unless noted) | Model | Wave |
|--:|---|---|---|---|:-:|
| 1 | **FXBY** grouped aggregates + text/date functions | G4, G16 | `frontend/src/lib/formulaGroupAgg.ts`, `lib/formulaText.ts`, register via `lib/formulaExt.ts`; `src/quantized/recipe_run.py` subset check only if the headless subset grows | Sonnet | 1 |
| 2 | **LINK** MDI worksheet-window selection feeds the shared brush (option) | G9 (P2, small; kept for its low cost) | `store/worksheetSelection.ts`, `store/rowState.ts`, Preferences toggle | Sonnet | 1 |
| 3 | **POLMAP** polar heatmap/contour + pole-figure projection | G2 | `src/quantized/calc/figure_polar_map.py`, `routes/export_figures_polar.py` (extend), `frontend/src/components/Stage/PolarMapStage.tsx`, `lib/plotTypes.ts` tile | Sonnet | 1 |
| 4 | **MAPOPS** map operations (crop/flip/rotate/transpose/arithmetic/plane level) | G3 | `calc/map_ops.py`, `routes/map_ops.py`, `components/workshops/mapops/*`, `components/Stage/MapToolbar.tsx` entry only | Sonnet | 1 |
| 5 | **TESTS2** hypothesis-test completion | G6 | `calc/stats_tests_ext.py`, `routes/stats_tests_ext.py`, `lib/statsTests.ts`, `lib/statsTestsResults.ts`, `workshops/statstests/*` | Sonnet | 1 |
| 6 | **REGSPLIT + IMPORT2** registry split, then `.ras/.rasx`, `.uxd`, VAMAS, PANalytical `.raw` | G5 | `io/registry.py` (split, 499/500), `io/rigaku_ras.py`, `io/vamas.py`, `io/bruker_uxd.py`, tests with specimens; the quick converter picks new readers up through the registry | Sonnet (split) | 1 |
| 7 | **FITMODEL** multi-factor linear model | G1 | design note first; `calc/stats_linear_model.py`, `routes/stats_model.py`, `components/workshops/fitmodel/*`, `lib/api/statsModel.ts` | **Opus** design, Sonnet build | 2 |
| 8 | **PLOTS2** parallel coords, hexbin/2-D KDE, Bland-Altman, Pareto, ternary contour | G15 | `calc/figure_parallel.py`, `calc/figure_density2d.py`, `calc/figure_ternary.py` (extend), Stat Stage renderers, `lib/plotTypes.ts` (after lane 3 merges) | Sonnet | 2 |
| 9 | **ROBUST** robust/quantile fits, convolution/ODE/piecewise models | G11 | `calc/fit_robust.py`, `calc/fit_models_ode.py`, `routes/fitting_robust.py`, `curvefit/useRobustFit.ts` | Sonnet | 2 |
| 10 | **WAVE** wavelets + IIR filters | G10 | `calc/wavelet.py`, `calc/iir_filter.py`, `routes/spectral.py` (extend), `workshops/signalprocessing/*`, `lib/signalRecipe.ts` | Sonnet | 2 |
| 11 | **PROFILER** prediction/contour profiler | G7 | `components/workshops/profiler/*`, `routes/model_evaluate.py` (new; there is no evaluate route in `routes/fitting.py` today), `calc/profile_model.py` | Sonnet | 3 (after 7) |
| 12 | **LIFE** censored life distributions, Weibull plot, Fit Life by X | G8 | `calc/stats_life.py`, `routes/stats_life.py`, `lib/statsTests.ts` (after lane 5), `calc/figure_statplots.py` probability-plot axes | Sonnet | 3 |
| 13 | **PLS** PLS / spectra PCA (domain family) | G12 | `calc/stats_pls.py`, `routes/stats_multivar_ext.py`, `workshops/multivar/*` | Sonnet | 3 |

Wave notes:

- Wave 1 lanes touch disjoint trees: formula libs / row-state store / polar
  stage / map ops / stats tests / io.
- FITMODEL waits for wave 1 only because it shares the Analyze menu and the
  stats API surface with TESTS2; its design note (Opus) can start in wave 1.
- PLOTS2 edits `lib/plotTypes.ts` after POLMAP adds its tile.
- LIFE edits `lib/statsTests.ts` after TESTS2.
- Every lane: characterisation tests before changing established behaviour,
  screen = export parity for any plot, new behaviour behind a UI option,
  500/400-line caps (note `io/registry.py` 499, `MapStage.tsx` 399,
  `formulaRefs.ts` 448), run the `gate` skill, workers commit locally.
- J14/J16 lanes (SPC, DOE) are not listed: they wait on decision D1. If
  lifted, put **SPC** (IMR/X̄-R/EWMA + Cp/Cpk + spec limits G27) in wave 2 and
  **DOE** (2-level factorial, CCD/Box-Behnken generation; analysis = FITMODEL)
  in wave 3.

## Decisions the owner must make

- **D1 — Lift the J-census gate for J13–J16?** The 2026-07-28 directive
  ("fully replace JMP and OriginPro") and this brief ("top-tier, replace
  Origin and JMP") read as the demand signal, but `JMP_GAP_PLAN.md` still
  says "do not build speculatively" until Gate J's census. Recommendation:
  lift for J14 (SPC + capability) and J16 (DOE, after FITMODEL); keep J13
  clustering and J15 MSA gated until real use.
- **D2 — Predictive modelling scope (G14, G25).** Out of scope, a minimal set
  (tree, forest, GP with a validation column), or JMP-Pro breadth? Adds
  scikit-learn (BSD, pre-approved) and installer size.
- **D3 — In-app Python console (G18).** Code would run inside the server
  process with the user's file access. Options: never (keep headless API),
  opt-in desktop-only with a visible "unsafe" mode, or a sandboxed
  subprocess. Fail-closed default: off.
- **D4 — Pole-figure projection default (G2).** Stereographic (Wulff) vs
  equal-area (Schmidt); both as a UI option, the default to be named.
  **DECIDED 2026-11-24 (owner): equal-area (Schmidt) default, stereographic
  (Wulff) as an option.** Built in lane `gap9-polemap` (G2): `calc/polar_map.py`,
  `calc/figure_polar_map.py`, `polar.polar_map` on `/api/export/figure`,
  `Stage/PolarMapStage.tsx`, plot-type tile "Polar map / pole figure". Column
  form, plus (lane `map-extras`, 2026-11-25) a matrix-worksheet input: rows = one
  angle, columns = the other, axes from the X column / headers or a start and step;
  uneven or ambiguous axes refused. Provisional, owner to confirm.
- **D5 — Which instrument formats matter (G5, G17)?** Specimens needed for
  `.ras/.rasx`, `.uxd`, VAMAS, PANalytical binary `.raw` (OPEN_ITEMS overnight
  decision 2), TDMS, Raman; formats are only built with a
  real file and a trusted reading of it.
- **D6 — Reliability priority (G8).** Promote to P1 work only if the lab runs
  breakdown / lifetime tests; otherwise demote to P2.
- **D7 — Linked selection from worksheet windows (G9).** Plots already share
  one brush; GUI_INTERACTION_PLAN #14 chose independent selection per MDI
  worksheet window, while JMP links everything. Proposed:
  a Preferences option "Link selection across windows" (off by default, per
  "new behaviour is a UI option").
- **D8 — New permissive dependencies.** PyWavelets (MIT) for G10/G22; confirm
  scipy-only alternatives are not preferred for bundle/installer size.

## Re-verification against `d10c70c1` (2026-11-24)

The first draft was checked against a detached `v0.42.0` checkout 173 commits
behind `origin/main`. Every gap, the "Still open" table and the parity list
were re-grepped in a worktree of `origin/main` (`d10c70c1`, v0.43.1). Changes:

- **G9 downgraded P1 → P2.** Background plot windows already draw the shared
  brush (`components/windows/BackgroundPlotWindow.tsx:209-219`); only MDI
  worksheet windows' deliberate independent selection remains.
- **G4** workaround updated for Analyze ▸ Normalize (#968); the gap
  (per-group aggregates) stands.
- **G5** adds PANalytical binary `.raw` (OPEN_ITEMS overnight decision 2);
  notes the quick converter reads only what the registry reads.
- **G19** notes the result book's table actions (#942, #944) cover Origin's
  result-sheet toolbar; the live-refresh gap stands.
- **File references fixed:** `components/Shell/appMenuPlacement.ts` exists
  (menu homes); `curvefit/useCurveFit.ts` is 402 lines (not 499),
  `routes/fitting.py` 448; the OPEN_ITEMS provisional-decisions section exists.
- **Still open** rows updated for #940/#953 (Origin masks/filters), #942/#944
  (result book), #945/#946/#948 (thin-film), #947 (phase search/match), #949
  (magnetometry), #950 (cancel/progress).
- **Parity** list gains Quick Convert, the result book and the 0.43 domain
  additions.
- **Unchanged, re-grepped and still absent:** G1 (`ancova|covariate|manova|
  lsmeans`), G2 (`polar contour|polar heatmap|stereograph`; the
  `_xrdml_scan.py:173` "later view" note is still there), G3 (no map
  flip/crop/rotate/arithmetic), G6 (`welch.?anova|games.?howell|bartlett|
  tolerance.?interval|proportion.?test|binomial.?test`), G7 (`profiler|
  desirability`), G8 (censoring only in KM/Cox), G10–G27, J13–J16
  (`kmeans|dendrogram|control chart|cusum|cpk|factorial design`).
