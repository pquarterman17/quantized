# GAP AUDIT 8 — general analysis and plotting, after v0.38–v0.40

**Date:** 2026-11-22. **Status:** audit only; no lane started, nothing committed.
**Owner priority applied:** general (any plot, any dataset) first, then domain
families (spectroscopy, XRD), then technique-specific.

**Method.** Read `CLAUDE.md`, `PORT_PLAN.md`, `PORT_CHECKLIST.md`,
`ANALYSIS_CAPABILITY_ROADMAP.md`, `BACKLOG.md`, `BUGS_AND_ISSUES.md`,
`JMP_GAP_PLAN.md`, `PRIMARY_SOFTWARE_AUDIT_PLAN.md` (open boxes) and
`ORIGIN_PLOT_TYPE_PARITY_PLAN.md`. Then grepped `frontend/src` and
`src/quantized` for every candidate before listing it. There are no
`plans/GAP_*` files at this point; this is the first.

## What already exists (do NOT re-propose)

Confirmed in code while auditing; several look like gaps in the older plans and
are not:

- Worksheet: sort (3 keys), find/replace, Set Column Values with a full formula
  language (`if`/`where`, `row`, `lag`, `diff`, `cumsum`, `mean`/`median`,
  `interp`, `shift`; `lib/formula*.ts`), fill column, recode, level order, data
  filter, row statistics, extract rows, stats footer; transpose/stack/unstack/
  join/merge as recorded transforms.
- Plot: window link groups (`useWindowCommands.ts` `cycleFocusedWindowLinkGroup`),
  tile/cascade, insets, image/table layers, axis breaks, top/right axes, custom
  tick labels, reference lines, region shades, shapes, rich text/mathtext, Copy/
  Paste Format, templates, Graph Builder, Figure Builder, multi-panel pages.
- Export: pdf/svg/eps/png/tiff, journal presets (aps/nature/thesis/...), batch
  export, text-as-paths SVG.
- Fitting: registry + custom equations, global/ODR/implicit/bumps, bootstrap,
  model scan/compare, confidence/prediction bands (`curvefit/FitBandsSection`),
  residual plots, weighting, templates, batch/By.
- Statistics UI: distribution, Fit Y by X, test chooser, Mann-Whitney / Kruskal /
  Friedman / sign / Shapiro / Anderson / KS / RM-ANOVA / 2-way ANOVA / Dunnett /
  multiple + stepwise regression / partial correlation / power
  (`lib/statsTests.ts`), PCA/SPLOM, variability, outliers, tabulate, tukey table
  in Fit Y by X.
- Gadgets: fit / integrate / stats / differentiate / FFT / cursors
  (`lib/quickfit.ts` `GADGET_MODES`).

## Ranked lanes

Rank = user value to a scientist doing general analysis/plotting, weighted by
generality. Every "missing" claim below was grepped; the evidence line says
what was searched and what was (not) found.

### 1. SCAT — Line of fit, smoother and density ellipse as plot options

- **User value:** JMP Graph Builder / Prism / Origin staple: put a per-group
  regression line (with CI/PI band), a LOWESS smoother and a 68/95 % data
  ellipse on any scatter without opening a workshop. Today a fit overlay only
  exists from the Curve Fit panel, and Fit Y by X's bivariate line lives inside
  its own window.
- **Evidence missing:** no `smoother` / `line of fit` / `density ellipse` / data
  ellipse anywhere in `frontend/src/lib`, `components/Stage`,
  `components/workshops/graphbuilder`, `src/quantized/calc/figure_marks.py`.
  `lib/plotDecor*.ts` "ellipse" is only a drawn shape. Bands exist only via
  `curvefit/useFitBands.ts` + `lib/fitBandOverlay.ts`; regression only in
  `workshops/fityx/BivariateView.tsx`. LOWESS exists backend-only
  (`calc/signal_filters.py`).
- **Scope (one PR):** a `PlotView.overlays` option set `{line, smoother,
  ellipse}` + per-group, a pure `calc/figure_overlays.py` (OLS + CI band via
  existing `calc/stats_band.py`, LOWESS reuse, covariance ellipse), a small
  `/api/plot` route, uPlot draw hook, Inspector toggles, and the same overlay in
  the matplotlib export (screen = export parity). Linear/LOWESS/ellipse only;
  no polynomial/nonlinear.
- **Files likely touched:** `src/quantized/calc/figure_overlays.py` (new),
  `calc/figure_render.py` or `figure_marks.py` (call-site), `routes/plot.py`,
  `routes/export_figures_render.py` + schema, `frontend/src/lib/plotOverlays.ts`
  (new), `lib/uplotOpts.ts`, `components/Stage/usePlotPayload.ts`,
  `components/Inspector/SeriesMarkMapControls.tsx` (or a new card),
  `lib/types.ts` (`PlotView`).
- **Risk:** medium. Screen vs export parity (two renderers); `.dwk` field
  addition needs sanitizer + persistence round trip; excluded/filtered rows must
  not enter the fit (use `analysisInputs`).
- **Model:** Sonnet.

### 2. SIG — Significance brackets and compact-letter display on stat plots

- **User value:** Prism's signature feature. After a Tukey/Dunnett/pairwise test,
  draw p-value brackets or a/b/c letters over box/bar/violin/strip plots, in the
  Stat Stage and the exported figure. Scientists currently do this by hand in a
  drawing tool.
- **Evidence missing:** grep for `bracket`, `compact letter`, `letters`,
  `significance`, `asterisk` over `frontend/src` + `src/quantized` finds no
  stat-plot annotation (the only hits are unrelated). Data exist:
  `routes/stats_design.py` `/tukey`, `/dunnett`, `/adjust-p`;
  `calc/stats_anova_ext.py`; Fit Y by X already shows the Tukey table
  (`workshops/fityx/OnewayView.tsx`). Stat-plot renderers have no hook:
  `components/Stage/statRender*.ts`, `statDrawMarks.ts`, `calc/figure_stat_marks.py`.
- **Scope (one PR):** a `StatMarks.comparisons: "off"|"brackets"|"letters"` option
  (+ method Tukey/Dunnett/Bonferroni), computed in the Stat Stage from the plotted
  groups (respecting excluded rows), drawn on canvas and in
  `calc/figure_stat_marks.py`. Pairwise limited to the shown groups; p shown as
  stars + optional exact value; no new test engine.
- **Files likely touched:** `frontend/src/lib/statMarks.ts`,
  `components/Stage/StatMarksControls.tsx`, `statDrawMarks.ts`, `statRender*.ts`,
  `useStatStage*.ts`, `lib/api/stats.ts` (wrapper reuse), `src/quantized/calc/
  figure_stat_marks.py`, `routes/export_statplots.py`, `calc/figure_statplots.py`.
- **Risk:** medium (bracket stacking/collision layout, facets; parity test needed).
  Stay out of `workshops/fityx` and `statschooser` so it does not collide with
  lane 8.
- **Model:** Sonnet.

### 3. LBL — Point labels from a column, and hover context, on any plot

- **User value:** label each point by a "Label" column (sample IDs, wafer, peak
  names) and see the row number plus label columns when hovering — the JMP
  "Label" role / Origin data labels, essential for outlier hunting.
- **Evidence missing:** `ChannelRole = "label" | "ignore"` (`lib/types.ts:604`) only
  EXCLUDES a column from the plot. Point labels exist solely as a Quick Figure
  Builder conversion to capped annotations (`lib/quickFigureLabels.ts`,
  `quickFigureMapping.ts` `MAX_QUICK_POINT_LABELS`). The live readout
  (`components/Stage/PlotReadouts.tsx`, 88 lines) shows x and series values only —
  no row index, no label column. No live "data labels" option in the Inspector.
- **Scope (one PR):** `PlotView.labelKey` (a column index or text column) with
  max-N + collision-thin rule; draw in uPlot and export; the cursor readout gains
  "row N" and the label value. Reuse `lib/richtext*` and quickFigureLabels'
  placement. No auto-label of arbitrary expressions.
- **Files likely touched:** `lib/types.ts`, `components/Inspector/ChannelsCard.tsx`,
  `components/Stage/PlotReadouts.tsx`, `lib/uplotTools.ts`, `lib/uplotOpts.ts`,
  `components/Stage/usePlotPayload.ts`, `calc/figure_labels.py`,
  `routes/export_figures_schema.py`/`_labels.py`, `lib/quickFigureLabels.ts`
  (share code).
- **Risk:** medium (perf on dense data, parity, `.dwk` persistence).
- **Model:** Sonnet.

### 4. FITANN — Fit results on the graph (live annotation)

- **User value:** every paper figure carries the fit equation, parameters ± error
  and R². Today the Curve Fit panel sends results to Report/worksheets only; a
  user retypes numbers into a text box that then goes stale on re-fit.
- **Evidence missing:** no `addAnnotation` / annotation call anywhere in
  `components/workshops/curvefit/` (grep; only `peaks/usePeaks.ts` annotates).
  `FitOutputSection.tsx` offers only linked columns / result worksheet.
  `Stage/PlotResultChips.tsx` covers only the gadget/integral/FWHM chips and is not
  exported. `TableLayerFields.tsx` is a one-time snapshot of worksheet cells.
- **Scope (one PR):** "Add result to graph" on the fit result: a text annotation
  generated from the fit (equation, parameters with uncertainty and units, R²,
  n), tagged with the fit's id so a re-fit updates it in place (and an Out-of-date
  fit marks it stale), editable like any annotation, present in export. Format
  options: parameters only / + stats / LaTeX-ish equation.
- **Files likely touched:** `components/workshops/curvefit/FitOutputSection.tsx`,
  new `curvefit/fitAnnotationText.ts`, `lib/plotDecor*.ts` / `store` annotation
  action, `lib/fitCurve.ts` (read), tests.
- **Risk:** low-medium. NOTE `curvefit/useCurveFit.ts` is 499/500 lines and
  `routes/fitting.py` is 492/500: do not grow them; put new logic in new files, or
  split first (justify any pin raise in the commit).
- **Model:** Sonnet.

### 5. CLEAN — "Clean data" recordable transforms (dedupe, fill/drop missing, standardize, rank)

- **User value:** routine cleaning before analysis: remove duplicate rows,
  linearly interpolate or drop NaN gaps, z-score / min-max / rank a column. Today
  each is a hand-written formula or impossible (dedupe, drop-missing).
- **Evidence missing:** the transform op list is exactly merge / join / stack /
  unstack / transpose (`components/workshops/transformPreview/transformForm.ts`
  `OP_OPTIONS`). No `removeDuplicates`/dedupe, fill-missing or rank anywhere
  (grep of `frontend/src`, `src/quantized`). Data-filter hides rows but does not
  produce a cleaned dataset; formulas can `interp` but not delete rows.
- **Scope (one PR):** add 3 ops to the existing preview -> commit -> pipeline
  path: `dedupe` (by chosen key columns, keep first/last, warn on conflicts),
  `fill_missing` (linear / previous / drop rows), `standardize` (z / minmax /
  rank for chosen columns). Each reuses `transformRun` warnings, one undo step,
  recipe replay, provenance. No new backend.
- **Files likely touched:** `components/workshops/transformPreview/*`,
  `lib/transformPreviewCompute.ts`, `lib/transformRun.ts`, `lib/transformParams.ts`,
  `lib/transformWarnings.ts`, `components/workshops/pipeline/executeSteps.ts`,
  `transformStepForm.ts`, `commands/dataCommands.ts`, menu entries.
- **Risk:** low (pure client math with existing preview/replay harness); must
  update the pipeline Python export subset check (`lib/pipeline.ts`).
- **Model:** Sonnet.

### 6. FITPRE — Live initial-guess preview and nudging for the fit

- **User value:** the top Igor/Origin/Prism fitting-UX win: see the model curve
  at the current starting parameters over the data before pressing Fit, drag/step
  parameters until it is close. Cuts failed fits on hard models (peaks, oscillations).
- **Evidence missing:** `useCurveFit.ts` only calls `autoGuessFor` (backend
  `/fit/autoguess`) and fits; no preview overlay for registry models. The only
  preview is `EquationPreview.tsx`, a KaTeX rendering of the equation text. No
  evaluate route in `routes/fitting.py` (routes: models, autoguess, fit,
  bootstrap, equation/fit, scan, posterior, find-xy).
- **Scope (one PR):** a `POST /fit/evaluate` (model/equation + params + x) route,
  a debounced preview series drawn as a dashed overlay on the active plot, step
  buttons / sliders in `FitParamTable` for p0, "Use as start" + "Reset to auto".
  Registry models + custom equations; global/ODR modes out of scope.
- **Files likely touched:** new `routes/fitting_eval.py` (do not grow the 492-line
  `routes/fitting.py`), `calc/fit_models.py` (read), `lib/api/curvefit.ts`,
  `components/workshops/curvefit/FitParamsSection.tsx`, `FitParamTable.tsx`, new
  `curvefit/useFitPreview.ts`, a plot-overlay hook in `Stage` (reuse the
  `fitOverlay` column path in `lib/fitCurve.ts`).
- **Risk:** medium (debounce/race and stale-dataset guards; overlay must never
  persist as a scientific result). `useCurveFit.ts` is at the 500-line cap: add
  the hook in a new file and only wire it.
- **Model:** Sonnet.

### 7. RL2 — Finish the result lifecycle for the remaining "add as dataset" writers

- **User value:** consistent commit / Out-of-date / reopen behaviour. Roadmap
  Workstream B still lists writers outside the contract: users get duplicates on
  repeat clicks and no stale marking.
- **Evidence missing:** `useAnalysisCommit` / `commitAnalysisOutput` are used only
  by surfacefit, fit bands, tabulate, baseline, opticalgap, FFT thickness,
  ellipse fit (grep). Still on raw `addDataset`: `resample/useResample.ts`,
  `roicuts/useRoiCuts.ts` + `useRoiBatch.ts`, `reductions/usePawley.ts`,
  `useReflectivityFft.ts`, `hysteresis/useHysteresis.ts`,
  `magtools/useMagTools.ts`, `store/gadget.ts`, `store/worksheetStatsRun.ts`,
  `datasetmath` curve average, `digitizer/useDigitizer.ts`. The roadmap line
  (ANALYSIS_CAPABILITY_ROADMAP.md ~230) names these as "not migrated".
- **Scope (one PR):** migrate the five general ones: Resample, ROI cuts, gadget
  FFT, Row statistics, Average curves. Pawley / refl-FFT / hysteresis / magtools
  stay for a follow-up (technique-specific).
- **Files likely touched:** `components/workshops/resample/useResample.ts`,
  `roicuts/useRoiCuts.ts`, `store/gadget.ts`, `store/worksheetStatsRun.ts`,
  `components/workshops/datasetmath/useCurveAverage.ts`, tests; `store/
  analysisOutputCommit.ts` only if the contract needs a new output kind.
- **Risk:** low-medium (characterization tests first; double-click and undo).
- **Model:** Sonnet.

### 8. SEL2 — Move the statistics tools onto the shared input resolver

- **User value:** one "Input: sheet · X · Y · N of M rows" line and one exclusion
  policy across all analyses; today Fit Y by X, Multivariate, Variability, Test
  Chooser / Statistical Tests still resolve inputs privately, so excluded and
  filtered rows can be treated differently from tool to tool.
- **Evidence missing:** roadmap D1 "Remaining" (ANALYSIS_CAPABILITY_ROADMAP.md
  ~731): only Curve fit, Peaks, Distribution, Outlier screening and Signal
  Processing use `lib/analysisInputs.ts`. Grep of `analysisInputs` imports shows
  no use under `workshops/{fityx,multivar,variability,statstests,statschooser}`.
- **Scope (one PR):** migrate Multivariate, Variability and Fit Y by X first
  (own-pick tools: each column pick resolves through the resolver; keep the
  queued report-after-load / By partition behaviour), add the summary line.
  Statistical Tests and Chooser in a second PR if too large. Characterization
  tests before changes.
- **Files likely touched:** `lib/analysisInputs.ts`, `components/workshops/
  {fityx,multivar,variability}/*`, `AnalysisInputSummary`, the roadmap D1 note.
  Excludes `statstests/` and `statschooser/` in this PR (see wave plan).
- **Risk:** medium (behavioural change to excluded-row handling must be
  deliberate and a visible option, per "new behaviour is a UI option").
- **Model:** Sonnet.

### 9. STATUI — UI for backend-only statistics (ROC/AUC, logistic/Poisson GLM, chi-square GoF, p-adjust)

- **User value:** classification/threshold work (ROC, Youden), binary/count
  regression, goodness-of-fit and multiple-comparison correction without leaving
  the app. The engines exist and are tested; there is no way to reach them.
- **Evidence missing:** routes with no frontend caller (grep for the path strings
  and names across `frontend/src`, excluding `schema.d.ts` and tests):
  `/stats/glm-logistic`, `/glm-poisson`, `/roc-curve`, `/auc`, `/youden-threshold`,
  `/adjust-p`, `/chi-square-gof`, and the survival endpoints `/kaplan-meier`,
  `/logrank`, `/cox-ph` (`routes/stats_design.py`). `lib/statsTests.ts` registry
  lists none of them. PRIMARY P2.6 line ~5213 says these wait for demand; the
  2026-07-28 owner JMP-replacement directive recorded there is that demand.
- **Scope (one PR):** extend the Statistical Tests registry with chi-square GoF,
  p-value adjustment, ROC/AUC/Youden and logistic/Poisson GLM (inputs/results/
  durable result adapter via the existing `StatsTestId` pattern). Survival (KM/
  log-rank/Cox) as a follow-up PR.
- **Files likely touched:** `lib/statsTests.ts`, `lib/statsTestsResults.ts`,
  `lib/api/statsTests.ts`, `components/workshops/statstests/*`,
  `lib/statisticalTestAnalysisResult.ts`, `lib/statschooser.ts` (recommend map).
- **Risk:** low-medium (input-shape variety; ROC curve may want a stat-figure
  adapter). Same files as lane 8's follow-up: keep them in separate waves.
- **Model:** Sonnet.

### 10. CFMT — Worksheet conditional formatting and column colouring

- **User value:** highlight values outside a spec, colour-scale a column, flag
  rows (Origin cell colour / JMP row states); quick visual QC of long tables.
- **Evidence missing:** grep of `components/Stage/worksheet/*` for conditional /
  colour-scale / cell fill finds only selection highlight in `GridRow.tsx` /
  `GridHeader.tsx`; no rule model or store. `cellFormat.ts` is number formatting
  only.
- **Scope (one PR):** per-column rules `{>,<,between,=,top-N, colour-scale}` with
  fixed token colours (theme-aware), stored per dataset view, applied in the
  virtualized grid; Format menu + dialog. No effect on data or plots.
- **Files likely touched:** `components/Stage/worksheet/GridRow.tsx`,
  `GridViewport.tsx`, `cellFormat.ts`, new `worksheetRules.ts` + dialog, the view
  persistence path (`.dwk` field; sanitizer + round trip; mind the v7 workspace
  rule in CHANGELOG 0.39).
- **Risk:** low-medium (virtualized-grid perf, theme contrast, file format
  addition must fail closed on old readers).
- **Model:** Sonnet.

### 11. STFT — Spectrogram (time-frequency) in Signal Processing

- **User value:** domain-family general signal analysis: see how a spectrum evolves
  along a trace (drifting oscillation, chirps, noise bursts) as a heatmap.
- **Evidence missing:** grep for `stft` / `spectrogram` / `wavelet` / `cwt` over
  `src` and `frontend/src` finds nothing outside an unrelated test name.
  `calc/spectral.py` (391 lines) has FFT/PSD/Welch/filters/cross-correlation only.
- **Scope (one PR):** STFT magnitude with window/overlap/NFFT controls in the
  Signal Processing workbench, committed as a linked map dataset (existing Map
  tab/colour scale), recorded in the signal recipe. Wavelets out of scope.
- **Files likely touched:** new `calc/spectrogram.py` (keep `spectral.py` < 500),
  `routes/spectral.py`, `lib/api/spectral*.ts`, `components/workshops/
  signalprocessing/*`, `lib/signalRecipe.ts`, `lib/signalTransform.ts`.
- **Risk:** medium (new matrix-dataset output through derived-worksheet rules and
  recipe replay; large-array limits).
- **Model:** Sonnet.

## Parallel-safe waves

"Disjoint" = no shared source files between lanes of the same wave. Shared hot
files that every lane may touch (`CHANGELOG.md`, `frontend/src/architecture.test.ts`
pins, bundle budget, `lib/api/schema.d.ts`, `store/useApp.ts`) must be merged
serially by the orchestrator; rebase, do not co-edit.

| Wave | Lanes | Why they are disjoint |
|---|---|---|
| **1** | 2 SIG, 5 CLEAN, 7 RL2, 8 SEL2, 10 CFMT | SIG = Stage stat* + `calc/figure_stat_*`; CLEAN = `transformPreview`/`transformRun`/pipeline; RL2 = resample/roicuts/gadget/worksheetStatsRun/curve average; SEL2 = `fityx`/`multivar`/`variability`; CFMT = `Stage/worksheet/*`. No shared file. |
| **2** | 1 SCAT, 4 FITANN, 9 STATUI | SCAT = plot payload/overlays + `calc/figure_overlays`; FITANN = `curvefit/FitOutputSection` + annotation action; STATUI = `statstests`/`statsTests.ts` (needs SEL2 done: both end in statistics inputs). SCAT must not touch `PlotReadouts` or `types.ts` fields lane 3 uses. |
| **3** | 3 LBL, 6 FITPRE, 11 STFT | LBL = `PlotView.labelKey`/readouts/labels export (after SCAT, which edits `usePlotPayload`/`uplotOpts`); FITPRE = curvefit params/preview + a new route (after FITANN, same panel); STFT = `calc/spectral*` + signalprocessing. |

Wave notes:

- SIG avoids `workshops/fityx` and `statschooser` so it can run beside SEL2.
- SCAT and LBL both edit `usePlotPayload.ts`/`uplotOpts.ts`/`lib/types.ts`;
  hence different waves. FITANN and FITPRE both edit `curvefit/*`; hence different
  waves.
- STATUI follows SEL2 because both edit statistics-tool inputs.
- If only two or three agents run at once, run in this order: SCAT, SIG, LBL,
  FITANN, CLEAN, FITPRE, SEL2, RL2, STATUI, CFMT, STFT (rank order).

## Still-open plan items that are genuinely open (not stale)

General-code items (candidates for the lanes above or later):

- ANALYSIS_CAPABILITY_ROADMAP.md: result lifecycle B "Remaining" (reopen for
  multi-source batch tables, spin asymmetry, fit bands; non-migrated writers ->
  lane 7); selection D1 "Remaining" (-> lane 8; plus a UI option for Signal
  Processing to honour exclusions; Analysis Center "Review inputs" for own-pick
  statistics tools); "no shared preview -> commit -> rerun/edit shell" (only the
  commit half exists); Workstream E "defer clustering/control charts/Gauge R&R/
  DOE until the census" (J13-J16); Workstream F technique bullets (XRD reference
  matching, reflectometry posterior diagnostics, linked fit families + constrained
  batch-series comparison, magnetometry unit-aware normalization/derived
  quantities, SIMS multi-profile alignment, spectroscopy peak-family presets and
  area/ratio tables). Items "Add only against representative owner data" stay gated.
- PORT_CHECKLIST.md: only two unticked boxes. `importOxford` (blocked, not
  attempted) and `matchPhases` phase matching (not ported; the interim
  nearest-reference-stick match is in `lib/peakPhaseMatch.ts`).
- JMP_GAP_PLAN.md: J13 clustering, J14 control charts/capability, J15 Gauge R&R,
  J16 DOE (census-gated; do not build speculatively); Gate J census + switch trial.
- PRIMARY_SOFTWARE_AUDIT_PLAN.md: P2.6 line ~5213 (GLM/survival/ROC UI, see lane 9);
  "Add ROI statistics/export only from real need" (~5465); interactive 3-D gated
  by GOTO Q4 (~6035); P1.1/P1.3/P1.4/P1.5/P1.6/P1.7 campaign boxes per BACKLOG.md
  table (native bridge, categorical channels, import-wizard multi-row metadata,
  Graph Builder live parity, recipe templates, relink).
- FIGURE_AUTHORING_WORKFLOW_PLAN.md: F2.3i facet editing (blocked on a multi-panel
  Publication Preview contract), F4.4 SPATIAL/BREAK composition rebuild,
  F2.1f/F2.1g legacy-convergence (owner-gated), acceptance A1-A10 (owner-run).
- ORIGIN_PLOT_TYPE_PARITY_PLAN.md (14) and ORIGIN_FILE_DECODE_PLAN.md (21):
  Origin-import residues (offset-stacked layers, vector XYXY, bubble-size scale,
  `.opju` curve residues #67/#68/#71/#73). Origin-only, follow `origin-change`.
- BACKLOG.md performance follow-ups: eager `guess_settings` tokenization,
  model-scan starting points (Poly4/bi-exp/Bloch), thread-based job queue for
  import/export, `response_model` gaps, 33 `test_api_*.py` files without shared
  fixtures, seven ESLint rules left off.
- FUTURE_SCOPE.md (parked, not scheduled): Web Worker for plot preparation,
  process-level parallelism for heavy fits, WebGL renderer for dense scatter;
  native vector clipboard default-on after a Windows Office smoke test.

Owner-run, not code (do not assign to agents): real switch-trigger project,
60-90 min real-data session, Windows/macOS install/upgrade checks, screenshot
review of the 62 Origin pairs, BUG-001 Reductus variant, UX-008 menu scaling at
100/125/150 %, Map ROI gesture design call.

Stale or already done (verified; do not re-open): J1/J3/J5-J12 shipped per
JMP_GAP_PLAN header; level order; Recode; Fit Y by X UI; Variability UI; Analysis
Center/navigator; window link groups; journal-style export presets; custom
formula language; floating column, horizontal/stacked bar, pie, 100 % stack plot
types.

## Guard rails for every lane (from CLAUDE.md)

500-line source / 400-line `.tsx` caps (note `useCurveFit.ts` 499 and
`routes/fitting.py` 492 are at the edge); `calc/` stays free of fastapi/pydantic;
new behaviour is a UI option, not a changed default; characterization tests before
changing established behaviour; screen and export must agree; run the `gate` skill
before any PR; Sonnet for lanes, Opus only for design-heavy work (none of the above
needs it); workers commit locally, the orchestrator pushes.
