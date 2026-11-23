# Result-lifecycle acceptance audit (2026-11-23)

Audits every analysis writer against four product-contract criteria from
`plans/ANALYSIS_CAPABILITY_ROADMAP.md` (the "Product contract for every new
analysis" list, about lines 923-953; `plans/OPEN_ITEMS.md` rows 8, 9, 11, 13):

- **C8** raw data is never overwritten; a commit makes a linked derived worksheet, artifact or frozen copy.
- **C9** the input dataset, channels, included rows, range, units, parameters and algorithm version are recorded.
- **C11** a commit is one undo step and repeated clicks cannot create duplicates.
- **C13** a changed input marks the result stale; automatic recalculation only when the recalculation mode permits.

Legend: `P` pass, `~` partial (works, gap named), `F` fail (gap recorded below), `n/a` not applicable.
Method: grep of `commitComputedOutput`, `useAnalysisCommit`, `commitAnalysisOutput`, `commitBatchTable`, `commitBatchOutputs`, `addDataset(` (workshops, stores, lib), `registerAnalysisResult` and the `analysisResults:` writers, then reading each call site. Paths are under `frontend/src/`; line numbers are the call site as of this audit.

## The shared contract (what group A inherits)

`store/analysisOutputCommit.ts` `commitAnalysisOutput` (line 81) is the one entry point:

- C8: writes a NEW worksheet (never the source) and a `linked-worksheet` envelope (`lib/committedOutput.ts` `committedOutputResult`).
- C11: `asOneEditStep` (line 133) folds the worksheet and result into one undo entry; the by-value commit key (`commitKeyFor`, line 70; `findCommittedResultId`) makes a repeat find the existing output; a changed source refuses (lines 87-99).
- C13: `lib/committedOutputGraph.ts` joins the output to the recalc graph (`store/recalcEngine.ts:94`, `store/recalcDatasets.ts:130`): stale in Auto/Manual, nothing in None, never auto-recomputed (no recipe to replay); `lib/analysisResultFreshness.ts` re-derives it on load.
- C9 (fixed in this lane): the envelope records `producer.version`, `parameters.settings`, `sourceFingerprint` and now `parameters.inputs` (`lib/resultInputsRecord.ts`: `{ total, items }`, per source the channels with units, X label/unit, total and included rows, X range of the included rows). Capped at 32 sources and 64 channels per source (true counts kept) because the reopen sanitizer drops a result's whole `parameters` past 100,000 nodes. One place, so every writer below gets it.

Cross-writer contract test: `store/resultLifecycleContract.test.ts` (table over `commitAnalysisOutput`, `commitComputedOutput`, `commitBatchTable`, `commitBatchOutputs`; a new shared entry point is added to its `WRITERS` table). Guard against new raw writers: `components/workshops/resultcommit/rawWriterGuard.test.ts` (a raw `addDataset` / `addWorksheetQuietly` (comments stripped, bare identifier) in `components/workshops` fails unless allowlisted with a reason; the list may only shrink).

## Inventory

### A. Shared-contract writers (new worksheet + result)

All 24 pass C8, C9, C11, C13 through the contract above. `P*` on C9: the generic `inputs` record covers channels, units, included rows and the X range of the included rows; a tool's OWN selected fit range/parameters are in its `settings` (spot-checked: Curie-Weiss `useCurieWeiss.ts:341` records `fit_range_k`; not every tool's settings were individually verified for a user-chosen range key).

| # | Writer | Call site | C8 | C9 | C11 | C13 |
|--:|---|---|:-:|:-:|:-:|:-:|
| 1 | Surface fit | `components/workshops/surfacefit/useSurfaceFit.ts:234` | P | P* | P | P |
| 2 | Fit bands | `components/workshops/curvefit/useFitBands.ts:154` | P | P* | P | P |
| 3 | Tabulate | `components/workshops/tabulate/useTabulate.ts:255` | P | P* | P | P |
| 4 | Baseline subtract | `components/workshops/baseline/useBaseline.ts:300` | P | P* | P | P |
| 5 | Baseline batch (fixed here) | `components/workshops/baseline/baselineBatch.ts:77` | P | P* | P | P |
| 6 | Optical gap | `components/workshops/opticalgap/useOpticalGap.ts:227` | P | P* | P | P |
| 7 | FFT thickness | `components/workshops/reductions/useFftThickness.ts:144` | P | P* | P | P |
| 8 | Pawley | `components/workshops/reductions/usePawley.ts:304` | P | P* | P | P |
| 9 | Pawley model worksheets | `components/workshops/reductions/PawleyModelSheets.tsx:49` | P | P* | P | P |
| 10 | Reflectivity FFT | `components/workshops/reductions/useReflectivityFft.ts:152` | P | P* | P | P |
| 11 | Ellipse fit | `components/workshops/implicitfit/useEllipseFit.ts:112` | P | P* | P | P |
| 12 | Spectrogram | `components/workshops/signalprocessing/useSpectrogramRun.ts:39` | P | P* | P | P |
| 13 | Spin asymmetry | `components/workshops/reflectivity/useSpinAsymmetry.ts:95` | P | P* | P | P |
| 14 | Hysteresis | `components/workshops/hysteresis/useHysteresis.ts:254` | P | P* | P | P |
| 15 | MagTools background | `components/workshops/magtools/useMagTools.ts:352` | P | P* | P | P |
| 16 | Magnetometry normalization | `components/workshops/magtools/useMagNormalization.ts:284` | P | P* | P | P |
| 17 | Internal field | `components/workshops/magtools/useDemagCorrection.ts:265` | P | P* | P | P |
| 18 | Curie-Weiss | `components/workshops/magtools/useCurieWeiss.ts:341` | P | P* | P | P |
| 19 | ROI cuts / ROI batch | `components/Stage/useCutLanding.ts:95` (callers `roicuts/useRoiCuts.ts:376`, `useRoiBatch.ts:246`) | P | P* | P | P |
| 20 | Frequency count | `store/worksheetStatsRun.ts:175` | P | P* | P | P |
| 21 | Gadget FFT | `store/gadget.ts:312` | P | P* | P | P |
| 22 | Batch integrate | `components/workshops/peaks/useBatchIntegrate.ts:220` | P | P* | P | P |
| 23 | Peak batch | `components/workshops/peakwizard/usePeakBatch.ts:431` | P | P* | P | P |
| 24 | Resample / Average curves | `store/commitTransformOutput.ts:67` | P | P* | P | P |

### B. Worksheet writers outside the contract

| # | Writer | Evidence | C8 | C9 | C11 | C13 |
|--:|---|---|:-:|:-:|:-:|:-:|
| 25 | `runTransform` family, interactive (Reshape/merge, Dataset math, SIMS, Signal filter / Reduce XY; fixed here) | now `store/commitTransformOutput.ts` (generalised from Resample/Average), `lib/transformProducer.ts`; replay keeps `lib/transformRun.ts:455` | P | P* (signal worksheet `~`) | P | P |
| 26 | Reflectivity fit curves (live fit and saved-fit history) | `reflectivity/useReflFit.ts:414`, `useReflFitHistory.ts:181` | P | ~ | P (durable, fixed here) | F |
| 27 | Reflectivity uncertainty bands | `reflectivity/useReflDream.ts:234` | P | ~ | P (durable, fixed here) | F |
| 28 | Image digitizer (fixed here) | `digitizer/useDigitizer.ts:117` | P | P | P | n/a |
| 29 | RSM map cuts (Stage tools, RSM panel; fixed here) | `Stage/useCutLanding.ts` `landCommitted` + `mapCutCommit` (callers `Stage/useMapCuts.ts`, `useMapRoi.ts`, `useMapRuler.ts`, `useMapSectorWedge.ts`, `rsm/useRsm.ts`) | P | P* | P | P |
| 30 | Pipeline replay / templates | `pipeline/runTemplate.ts:291`, `useTemplates.ts:202-251` | P | ~ | n/a | n/a |
| 36 | Curve-fit batch summary worksheet (fixed here) | `curvefit/CurveFitBatchSection.tsx` `commitComputedOutput` | P | P* | P | P |
| 37 | Curve-fit results worksheet (fixed here) | `curvefit/FitOutputSection.tsx` `commitComputedOutput` | P | P* | P | P |

Notes: 25: the interactive non-signal ops (transpose, stack, unstack, join, append, clean, Dataset math, SIMS, SIMS compare, Signal filter / Reduce XY) commit through `commitComputedOutput` like Resample / Average (one undo step, a repeat adds nothing and says so, every input worksheet is a source so a change to ANY marks the output Out of date, inputs recorded); the macro step is recorded only for a real creation. The Signal Processing worksheet keeps its own linked result (`analysis-<output id>`, recipe on the worksheet), so C9 stays `~` for it; its interactive Create finds an identical current output (same recipe, same unchanged source, same numbers) instead of making a second (`lib/signalOutputGuard.ts`). Pipeline / macro replay (30) and the worksheet "Re-run" of a signal result still make a NEW output each time on purpose (a replay is a recorded run). Split and the in-place metadata ops make no single output and are outside this row. 26/27 C13 `F`: the curve and band worksheets are not stale-marked when the fitted data changes (the fit record itself is, via `staleFits`); they are several outputs of one fit, which the one-output envelope cannot yet hold (see Deferred). 26/27 C11 (fixed here): besides the in-session ids, a repeat is now found by the provenance the curves carry (`metadata.reflFit.fitId`, `metadata.band.ranAt`; `existingFitDatasetIds`), so it survives a reload. 28: the output now carries the calibration (`metadata.digitizer`: reference points, axis model, traced point count); no source worksheet, so nothing can go out of date. 30 is by design: each replay is a recorded run.

### C. Result-only writers (no worksheet; an envelope or a dataset-resident record)

C8 is `n/a` (nothing is written over raw data).

| # | Writer | Evidence | C8 | C9 | C11 | C13 |
|--:|---|---|:-:|:-:|:-:|:-:|
| 31 | Statistical tests | `store/statisticalTestResults.ts`, `lib/statisticalTestAnalysisResult.ts:101` | n/a | ~ | P (fixed here) | P |
| 32 | Snapshot results (Distribution, Variability, Multivariate, Outlier screening, Fit Y by X) | `store/snapshotResultSave.ts:41` (dedupe key line 62) | n/a | ~ | P | P |
| 33 | Williamson-Hall (and its batch) | `store/williamsonHallResults.ts:10`, `lib/williamsonHallBatch.ts:74` | n/a | ~ | P | P |
| 34 | Analysis batch (By-level / Analysis selection; fixed here) | `components/workshops/analysisselection/AnalysisBatchControls.tsx:260`, `lib/analysisBatchDedupe.ts` | n/a | ~ | P | P |
| 35 | Curve fit / Peak analysis / Reflectivity fit records | `lib/fitAnalysisResultLive.ts:42`, `lib/peakAnalysisResult.ts:33`, `lib/reflFitAnalysisResult.ts:46` | n/a | ~ | P | P |

Notes: C9 `~` for 31-35: the envelope keeps the question (columns with units, parameters or recipe, source fingerprint over the analysis view) but not an explicit included-row count or X range (the fingerprint covers the analysis view, so a changed row set reads out of date). 34 C11 (fixed here): an identical re-run (same producer, source fingerprint, sources, parameters, tables and warnings) saves nothing new and says so; changed data, settings or numbers still save a new result. 35 C11: one deterministic result id per dataset (a re-fit replaces, never duplicates); C13: `staleFits`.

## Tally (37 writers)

| Criterion | Pass | Partial | Fail | n/a |
|---|--:|--:|--:|--:|
| C8 raw data never overwritten | 32 | 0 | 0 | 5 (result-only) |
| C9 inputs/params/version recorded | 28 | 9 | 0 | 0 |
| C11 one undo, no duplicate | 36 | 0 | 0 | 1 |
| C13 stale on input change | 33 | 0 | 2 | 2 |

Before the gap lane (previous tally): C9 24 / 9 / 4 / 0; C11 31 / 0 / 5 / 1; C13 29 / 1 / 5 / 2. Before the first audit lane: C9 had the producer version, settings and fingerprint only for group A (no channels/units/included rows/range); C11 failed for 26, 27 and 31 and 5 (baseline batch had no duplicate guard); C13 failed for 5.

## Fixed in this lane (each with a test)

1. C9, all 24 shared-contract writers: `parameters.inputs` (`lib/resultInputsRecord.ts`, `lib/committedOutput.ts`). Test: `store/resultLifecycleContract.test.ts`.
2. Baseline batch (5): through `commitAnalysisOutput`; linked results, stale marking, no duplicate on repeat, still one undo step, no empty folder on a repeat. Test: `components/workshops/baseline/BaselinePanel.batch.test.tsx`.
3. Reflectivity curves/bands (26, 27) C11: `store/addDatasetsOneStep.ts`. Test: `store/resultLifecycleContract.test.ts`.
4. Statistical tests (31) C11: a repeat of an identical run returns the saved result. Test: `store/statisticalTestResults.test.ts`.
5. Cross-writer contract test and raw-writer guard (see above).

## Fixed in the gap lane (each with a test)

1. 36/37 Curve-fit worksheets: `FitOutputSection` and the batch summary go through `commitComputedOutput` (`quiet`, so the plot and panel stay where they are). Test: `components/workshops/curvefit/FitOutputSection.lifecycle.test.tsx`.
2. 25 `runTransform` family: `store/commitTransformOutput.ts` takes every single-output interactive op (producer per op in `lib/transformProducer.ts`); Reshape, Dataset math, SIMS, SIMS compare and Signal filter use it. Signal worksheet Create: duplicate guard (`lib/signalOutputGuard.ts`). Tests: `store/commitTransformOutput.test.ts`, `lib/signalOutputGuard.test.ts`.
3. 34 Analysis batch: identical re-run deduped (`lib/analysisBatchDedupe.ts`). Tests: `lib/analysisBatchDedupe.test.ts`, `components/workshops/analysisselection/AnalysisBatchControls.dedupe.test.tsx`.
4. 29 RSM map cuts: map cut tool, ROI / ruler, sector wedge and the RSM panel go through `landCommitted` (`mapCutCommit`). Test: `components/Stage/useMapRoi.test.ts`.
5. 26/27 durable duplicate guard (`existingFitDatasetIds`). Test: `components/workshops/reflectivity/reflFitCurves.test.ts`.
6. 28 Digitizer records its calibration. Test: `components/workshops/digitizer/useDigitizer.test.ts`.

## Deferred gaps, with a proposed fix

| Gap | Proposed fix | Size |
|---|---|:-:|
| 26/27 C13: curve and band worksheets not stale-marked when the fitted data changes | A fit's curves (or a band run's) are several outputs of ONE computation; the envelope holds one primary output (`outputs[0]` is read as THE output in the commit key, reopen and replace). Either let the envelope list several outputs of one commit or commit each with `commitBatchOutputs` (one Library result per curve, which floods the results list). Needs an owner decision on the shape. | M |
| 31-35 C9 partial: no explicit included-row count / range in result-only envelopes | Add `recordedInput` (`lib/resultInputsRecord.ts`) to their `parameters` in each builder. | S each |
| 25 C9 (signal worksheet only): the recipe records the inputs, not the generic `inputs` block | Register the signal result through the shared envelope builder. | S |

## Ticks

C8 (every writer passes or is result-only) and C11 (every writer passes) are ticked in `plans/ANALYSIS_CAPABILITY_ROADMAP.md` and `plans/OPEN_ITEMS.md` rows 8 and 11. C9 (9 partial) and C13 (reflectivity curve/band worksheets, 26/27) stay open; their lines carry the current counts. The C11 tick covers the writers this audit enumerated (grep of the commit entry points and every `addDataset` / `addWorksheetQuietly` in `components/workshops`, enforced by `rawWriterGuard.test.ts`); a writer outside `components/workshops` that adds a worksheet raw would not be caught by that guard.

## Provisional decisions

- The generic `inputs` record is added under `parameters` (not a new envelope field), so the sanitizer, reopen and replace paths carry it unchanged and the commit key is unaffected.
- Statistical-test dedupe compares producer, source fingerprint, sources, parameters and tables: a stochastic test whose tables differ between runs still saves a new result (fail open on the dedupe, never hides a different result).
- Baseline batch has its own producer id (`baseline-batch`), so it has no reopen-in-tool session; reopen is not claimed.
- (gap lane) Interactive transforms that the user can re-run on purpose (Reshape, Dataset math, SIMS) keep creating a new output when the inputs, settings OR result differ, and now say "already added" when all three are identical (the commit key includes a digest of the output). Replay and the signal result's "Re-run" are unchanged: each makes a new output.
- (gap lane) The signal worksheet's duplicate guard is interactive-only (`skipDuplicate`), so a Pipeline Studio replay of the same recipe on the same file still makes a second output.
- (gap lane) Reflectivity curve and band worksheets get the durable duplicate guard only; stale marking waits on a multi-output envelope (owner decision on its shape).
- (gap lane) The digitizer records the calibration on the output's `metadata.digitizer` (JSON, saved with the worksheet) rather than a Library result: there is no source worksheet to link, mark or recompute.
- (gap lane, review) The batch SIMS summary now fails an already-added profile's row with "already added as …; nothing was duplicated" instead of counting it as created.

---

# Part 2: preview/Cancel (C10) and fail-closed (C14) audit (2026-11-23)

Covers `plans/OPEN_ITEMS.md` rows 10 and 14 (roadmap "Product contract" boxes 3 and 7).

- **C10** a preview is visibly provisional, and Cancel/Close leaves no scientific state (no worksheet, result, overlay or recorded step).
- **C14** missing inputs, unit mismatch, too few rows, non-finite data, lazy Origin previews and cancelled work each fail closed with a message (never a silent no-op, never analysing a lazy preview's downsample).

Legend as in part 1. Paths under `frontend/src/`. Method: a per-folder inventory of `components/workshops/*` (greps for `WorkbenchPreviewFrame`, `OutOfDateNote`, `discard(`, `Refusal`, `resolveAnalysisInputs`, finite/row-count checks, `resolveDataset`), then reading each hook's run path. Shared pieces already carry most of C14: `lib/analysisInputs.ts:161-208` refuses no/deleted worksheet, missing/deleted column, no response, empty selection, zero rows and a lazy preview (`pending`, `load-failed`), and is used by Baseline, Peaks, Curve fit, MagTools, Hysteresis, the stats tools, Distribution, Fit Y by X, Multivariate, Outliers, Variability and Signal Processing.

## C10 inventory

| Group | Tools | Provisional marking | Cancel / Close leaves | C10 |
|---|---|---|---|:-:|
| Migrated workbenches (the "six") | Signal Processing, sigop, Reduce rows, Resample, Reshape, Baseline | `WorkbenchPreviewFrame` ("Preview (not saved)"): `signalprocessing/SignalProcessingPanel.tsx:336`, `SigopBody.tsx:78`, `resample/ResamplePanel.tsx:58`, `ReduceXYSection.tsx:60`, `transformPreview/ReshapePanel.tsx:38`, `baseline/BaselinePanel.tsx:219` | nothing: `workbench/useWorkbenchCommit.ts:8-11` (Cancel and unmount abort), `baseline/useBaseline.ts:176-197` (`discard`) | P |
| Spectrogram | Signal Processing spectral | `signalprocessing/SpectrogramBody.tsx:98` | commit aborted by the shared commit hook | P |
| Recode | column recode | **fixed here**: mapping table inside the frame (`recode/RecodePanel.tsx:82`) | `store/recode.ts` `closeRecode` clears the draft mapping; test added | P (was F) |
| Metadata cleanup | Metadata to factors, Clean up | **fixed here**: change table inside the frame (`metafactors/CleanupSection.tsx`) | `close` drops the seed; writes only on Apply | P (was F) |
| Fits holding a result (not previews) | Curve fit family, Peaks, Peak analyzer, ODR, equation, compare, global, scan, Bumps, reflectivity fit/DREAM/FFT, FFT thickness, Pawley, stats tests/chooser, Surface/Ellipse/Optical gap, Curie-Weiss, MagTools, RSM, ROI cuts | not a preview: a result stamped with its inputs and marked `OutOfDateNote` with report/export/commit withheld (roadmap WB3-WB7 consolidated table; tests named there) | the result is tool state, not scientific state; nothing is written until a commit | P |
| Live / receipt tools | Distribution, Fit Y by X, Multivariate, Variability, Outliers, Hysteresis, Tabulate, Calculators, Film stack, Waterfall, Williamson-Hall | recompute or clear on every input change (WB6/WB7 table) | nothing held | P |
| SIMS Process / Compare / Region | preview plot with no "Preview (not saved)" mark (`sims/SimsPanel.tsx:212-233`) | commit path is PR #903's | **open** (excluded lane) | ~ |
| Figure previews | ternary, pie, vector field (`ternary/AuxFigureFrame.tsx`) | server image, not a result; no mark | nothing | ~ (by design) |
| Dataset math / Average curves | `datasetmath/useDatasetMath.ts:84` calls `runTransform` (`lib/transformRun.ts:382`, which accepts an optional AbortSignal) without one, so closing the window mid-Combine (during a lazy-book resolve or request) can still add the output | the unit-mismatch review is a gate, not a preview | **open** (transform commit path, PR #903) | F |
| Data filter | `datafilter/*` | applies live to the analysis view, undoable; no deferred commit | nothing | n/a |
| Pipeline apply / recipe | `pipeline/*` | each replay is a recorded run by design | by design | n/a |
| Digitizer | hand traced input | no computed preview | nothing | n/a |

## C14 inventory

Columns: **MI** missing inputs, **UM** unit mismatch, **FR** too few rows, **NF** non-finite data, **LZ** lazy Origin preview, **CX** cancelled work. `P` pass (message shown), `~` partial, `F` fail, `-` not applicable.

| Tool | MI | UM | FR | NF | LZ | CX | Evidence / note |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| Resolver tools (Baseline, Peaks, Curve fit, MagTools, Hysteresis, stats, Distribution, Fit Y by X, Multivariate, Outliers, Variability, Signal Processing) | P | - | P | P | P | P | `lib/analysisInputs.ts:161-208`; refusals surface through `WorkbenchMessage` / the tool's error line |
| Curve fit family (single, ODR, equation, scan, Bumps, global, compare) | P | - | P | P | P | P | `curvefit/curveFitRun.ts:56`, `useEquationFit.ts:303`, `useGlobalFit.ts:216,234`, `useBumpsFit.ts:171`; typed `Refusal` (`workbench/refusal.ts`) |
| Peak analyzer | P | - | P | P | P | P | `peakwizard/usePeakWizard.ts:329-335`, `peakBatchPrep.ts:153`, `recipeSteps.ts:60` |
| Surface fit, Ellipse fit, Optical gap | P | P (Optical gap X unit is an explicit option) | ~ (backend states the minimum) | **fixed here** | P | **fixed here** | `analysisextras/columnPicks.ts:57-76` now rejects a vanished worksheet and an all-blank pick with a message; before, a null made the Fit button do nothing and say nothing, and an empty series went to the backend. Test `columnPicks.load.test.ts` |
| FFT thickness, Reflectivity FFT | P (wavelength, `useReflectivityFft.ts:110`) | ~ (nm-1 Q converted, not asked) | ~ (backend: needs >= 10 points) | **fixed here** | P | **fixed here** | `reductions/reductionRequests.ts:13` `gapProblem`, `useFftThickness.ts:129`, `useReflectivityFft.ts:134`; a gap used to be a bare 422, a vanished worksheet a silent return. Test `useReductionFftRefusals.test.ts` |
| Pawley | P | - | P | P | P | P | `reductions/usePawley.ts:246-258` |
| Williamson-Hall | P | - | P | P | - | P | `reductions/useWilliamsonHall.ts:246` |
| Spin asymmetry | P | ~ | P | P | P | P | `reflectivity/useSpinAsymmetry.ts:82-86` (pairing, finite rows) |
| Dataset math, Average curves | P | P | P | P | P | ~ | unit review with explicit ack (`datasetmath/useDatasetMath.ts:90`, `useCurveAverage.ts:93`); cancel gap above |
| Resample, Reshape, Reduce rows | P | P | P | P | P | P | `resample/ResamplePanel.tsx:183`, `lib/transformResample.ts:17`, `useReshapePreview` review |
| Metadata promote / merge | P | P | - | - | - | P | `metafactors/PromoteSection.tsx:66` |
| Pipeline apply recipe | P | P | P | ~ | P | P | `lib/recipePreflight.ts`, `pipeline/ApplyRecipeSection.tsx:96` |
| Batch over worksheets | P | P | P | P | P | P | `analysisselection/AnalysisBatchControls.tsx:222`, `reductions/reductionBatchItems.ts:16` |
| Tabulate | P | - | - | P | P | - | `tabulate/useTabulate.ts:320` |
| RSM peaks / strain | P | - | P | P | P | ~ | `rsm/useRsm.ts:165,178,216` |
| ROI cuts | P | - | P | ~ | P | - | `roicuts/useRoiCuts.ts:141` |
| Calculators | P | P | - | P | - | P | per-card validation (`calculators/*`) |
| Digitizer | P | - | - | - | - | - | hand input |
| SIMS | P | P | P | P | P | ~ | excluded lane (PR #903); batch has Cancel with `WorkbenchProgress` |

## Tally

| Criterion | Pass | Partial | Fail |
|---|--:|--:|--:|
| C10 (12 groups with a preview or result) | 8 | 2 (SIMS marking, figure previews) | 1 (Dataset math Cancel); 1 n/a |
| C14 (19 groups) | 12 | 7 (some conditions `~`: backend-stated minimum rows, Dataset math cancel, ROI/Pipeline non-finite, RSM cancel) | 0 after the fixes |

Counts are of groups, not of individual tools; `~` cells were read but not given a failing test.

## Fixed in this lane (each with a test that fails without it)

1. `useLoadColumns` (Surface fit, Ellipse fit, Optical gap) rejects with a message for a vanished worksheet and for no finite row, instead of resolving null (silent no-op) or sending empty series. `analysisextras/columnPicks.load.test.ts`.
2. FFT thickness and Reflectivity FFT refuse a blank/non-finite cell with a count (was a bare 422) and report a worksheet removed while its full data loaded (was a silent return). `reductions/useReductionFftRefusals.test.ts`.
3. Recode mapping table and Metadata cleanup change table are marked "Preview (not saved)". `recode/RecodePanel.test.tsx`, `metafactors/MetaFactorsPanel.test.tsx`.

## Left open (documented, not fixed)

| Gap | Why left | Proposed fix | Size |
|---|---|---|:-:|
| Dataset math / Average curves: Close mid-Combine can still add the output (the hooks pass no AbortSignal into `runTransform`) | transform commit path belongs to PR #903 | route through `commitTransformOutput` with `useWorkbenchCommit` (as Resample) | M |
| SIMS previews are not marked "Preview (not saved)" | sims lane belongs to PR #903 | wrap the `SimsPanel` / `SimsCompareView` / `SimsRegionView` previews in `WorkbenchPreviewFrame` | S |
| FFT batch (`reductionBatchItems.ts`) does not use `gapProblem` | batch rows already report per-row failures | call `gapProblem` per item | S |
| ROI cuts / Tabulate / RSM non-finite and cancel wording not individually proven | no failing case found | add a refusal test per tool if one is found | S |

## Ticks

Rows 10 and 14 are not ticked as done: each has a documented open row above. Both are annotated "audited, mostly closed" with this file as evidence.

## Provisional decisions (owner to confirm)

- A gap (blank / NaN) in an FFT scan is refused with a count, not dropped (`lib/api/finitePairs.ts` drops for fits; for an FFT the sampling is part of the result). Dropping would be an opt-in option if wanted.
- `useLoadColumns` rejecting on "no finite row" and "worksheet gone" shows as the tool's error line, not a toast.
- The Recode and Cleanup tables stay editable inside the provisional frame (the frame is a label, not a lock).
