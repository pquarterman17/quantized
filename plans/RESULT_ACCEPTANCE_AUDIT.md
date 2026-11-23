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
- C9 (fixed in this lane): the envelope records `producer.version`, `parameters.settings`, `sourceFingerprint` and now `parameters.inputs` (`lib/resultInputsRecord.ts`: `{ total, items }`, per source the channels with units, X label/unit, total and included rows, X range of the included rows, taken from the X column the tool used: see "Fixed in the C9 lane" 2). Capped at 32 sources and 64 channels per source (true counts kept) because the reopen sanitizer drops a result's whole `parameters` past 100,000 nodes. One place, so every writer below gets it.

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
| 31 | Statistical tests | `store/statisticalTestResults.ts`, `lib/statisticalTestAnalysisResult.ts:101` | n/a | P | P (fixed here) | P |
| 32 | Snapshot results (Distribution, Variability, Multivariate, Outlier screening, Fit Y by X) | `store/snapshotResultSave.ts:41` (dedupe key line 62) | n/a | P | P | P |
| 33 | Williamson-Hall (and its batch) | `store/williamsonHallResults.ts:10`, `lib/williamsonHallBatch.ts:74` | n/a | P | P | P |
| 34 | Analysis batch (By-level / Analysis selection; fixed here) | `components/workshops/analysisselection/AnalysisBatchControls.tsx:260`, `lib/analysisBatchDedupe.ts` | n/a | P | P | P |
| 35 | Curve fit / Peak analysis / Reflectivity fit records | `lib/fitAnalysisResultLive.ts:42`, `lib/peakAnalysisResult.ts:33`, `lib/reflFitAnalysisResult.ts:46` | n/a | ~ | P | P |

Notes: C9 for 31-34 (fixed here): every builder (statistical test, Distribution, Fit Y by X, Variability, Outlier screening, Multivariate, Williamson-Hall, Williamson-Hall batch, Analysis batch) adds `parameters.inputs` through `recordedInputs` (`lib/resultInputsRecord.ts`, the same `{ total, items }` shape as group A): channels with units, total and included rows, X range of the included rows. 35 stays `~`: the fit / peak / reflectivity records are presentation envelopes over a dataset-resident record (`fitSpec`, `peakTable`, `reflFits`) that owns the parameters and (for a fit) the range, so the record belongs there and not in a copy on the envelope; owner to confirm (provisional). The record is NOT part of any identity: the statistical-test and analysis-batch repeat checks compare `parameters` minus `inputs` (`parametersWithoutInputs`), the snapshot key is built from `parameters.recipe`, and stale marking reads `sourceFingerprint`, so commit keys, dedupe (row 11) and stale marking (row 13) are unchanged, and a result saved before this change still matches an identical re-run. 34 C11 (fixed here): an identical re-run (same producer, source fingerprint, sources, parameters, tables and warnings) saves nothing new and says so; changed data, settings or numbers still save a new result. 35 C11: one deterministic result id per dataset (a re-fit replaces, never duplicates); C13: `staleFits`.

## Tally (37 writers)

| Criterion | Pass | Partial | Fail | n/a |
|---|--:|--:|--:|--:|
| C8 raw data never overwritten | 32 | 0 | 0 | 5 (result-only) |
| C9 inputs/params/version recorded | 32 | 5 | 0 | 0 |
| C11 one undo, no duplicate | 36 | 0 | 0 | 1 |
| C13 stale on input change | 33 | 0 | 2 | 2 |

Before the gap lane (previous tally): C9 24 / 9 / 4 / 0; C11 31 / 0 / 5 / 1; C13 29 / 1 / 5 / 2. Before the first audit lane: C9 had the producer version, settings and fingerprint only for group A (no channels/units/included rows/range); C11 failed for 26, 27 and 31 and 5 (baseline batch had no duplicate guard); C13 failed for 5.

## Fixed in this lane (each with a test)

1. C9, all 24 shared-contract writers: `parameters.inputs` (`lib/resultInputsRecord.ts`, `lib/committedOutput.ts`). Test: `store/resultLifecycleContract.test.ts`.
2. Baseline batch (5): through `commitAnalysisOutput`; linked results, stale marking, no duplicate on repeat, still one undo step, no empty folder on a repeat. Test: `components/workshops/baseline/BaselinePanel.batch.test.tsx`.
3. Reflectivity curves/bands (26, 27) C11: `store/addDatasetsOneStep.ts`. Test: `store/resultLifecycleContract.test.ts`.
4. Statistical tests (31) C11: a repeat of an identical run returns the saved result. Test: `store/statisticalTestResults.test.ts`.
5. Cross-writer contract test and raw-writer guard (see above).

## Fixed in the C9 lane (each with a test)

1. 31-34 C9: the nine result-only builders record `parameters.inputs` (included rows, X range, channels, units). Tests: the `records its input (acceptance C9)` cases in `lib/{distribution,fitYByX,multivariate,outlierScreening,variability,williamsonHall,statisticalTest}AnalysisResult.test.ts`, `lib/williamsonHallBatch.test.ts`, `components/workshops/analysisselection/AnalysisBatchControls.dedupe.test.tsx`; identity unchanged: `lib/analysisBatchDedupe.test.ts`, `store/statisticalTestResults.test.ts`.
2. C9 X range is the X the tool used (fixed): `recordedInput` / `recordedInputs` took the range from the dataset's `time` axis whatever column the tool read. They now take the X column explicitly (`xKey`: a channel index, `null` = the time axis, `undefined` = no X / unknown) and record the range, label and unit of THAT column; `undefined`, a non-integer or an out-of-range index record NO range (fail closed). Writers that pass a channel X: Analysis batch (each item's selection `xKey`), Fit Y by X (`xCol`), Curve Fit results, Baseline, Optical gap, Ellipse fit, Surface fit, the four Magnetometry tools and Hysteresis background (the X each read, `ownXKey`), Gadget FFT. Tools with no X of their own (Distribution, Variability, Outlier screening, Multivariate, Statistical tests, Williamson-Hall: the peak table, not a column, is their input) record no range. The shared contract takes an optional `xKey` (`AnalysisOutputCommit`, `commitComputedOutput`, `commitBatchTable`); a writer that does not declare one records no range. Follow-up (same lane): the remaining writers declare the X they compute on. Time axis (`xKey: null`, each verified at its request builder): Resample, Average, Signal ops, SIMS and SIMS comparison (`commitTransformOutput`, `TIME_AXIS_OPS`), FFT thickness (`two_theta_deg: d.time`), Reflectivity FFT, Spectrogram, Spin asymmetry (`readChannel` reads `d.time`), Pawley single run and model sheets (2θ). A channel: Frequency count (the counted column), Kaplan-Meier (the time-to-event column), fit bands (`fitData.xKey`). The batch writers pass each worksheet's own resolved column (a map by dataset id, `InputXSpec`): Batch integrate (`seriesXKey`) and Peak batch (`batchXKey`) resolve the plotted X channel BY NAME in each worksheet; Baseline batch records each item's binding X; Curve Fit batch summary records the X each input's selection item fitted against (a secondary input whose selection X is the time axis records the time range, which is what it fitted), and an input that failed before fitting records none. Commit keys: checked, none changed. Every writer here either carries its X in `settings` (baseline binding, optical gap / ellipse / surface `xCol`, frequency count column, Kaplan-Meier selection, the magnetometry and hysteresis `xKey`) or keys on a digest of its output, which already differs when the X changes (the batch trend and peak table embed the channel labels and the run time; fit-band keys carry the fitted x values); a run identical in every respect still dedupes (existing repeat tests pass). Still open, no range recorded (X unconfirmed or none): reshape and math transforms (transpose, stack, unstack, join, merge, algebra, clean), Tabulate, cut landing (map cuts), Williamson-Hall and the other result-only tools above (no X column of their own). Provisional, owner to confirm. Tests: `lib/resultInputsRecord.test.ts`, `store/resultLifecycleContract.test.ts` (all four shared writers), `AnalysisBatchControls.dedupe.test.tsx`, `lib/fitYByXAnalysisResult.test.ts`, `FitOutputSection.lifecycle.test.tsx`; follow-up: `store/commitTransformOutput.test.ts`, `reductions/useFftThickness.test.ts`, `reflectivity/useSpinAsymmetry.test.ts`, `store/worksheetStatsRunCommit.test.ts`, `curvefit/useFitBands.test.ts`, `curvefit/CurveFitBatchSection.summary.test.tsx`, `peaks/BatchIntegrateWindow.xrange.test.tsx`, `peakwizard/PeakBatchView.test.tsx`, `baseline/BaselinePanel.batch.test.tsx`, `reductions/PawleyModelSheets.test.tsx` (each fails with its declaration removed).

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
| 35 C9 partial: fit / peak / reflectivity-fit records carry no `inputs` block (31-34 fixed) | Decide whether the envelope copies the dataset-resident record (`fitSpec`, `peakTable`, `reflFits`) or points at it; provisional: left as is. | S |
| 25 C9 (signal worksheet only): the recipe records the inputs, not the generic `inputs` block | Register the signal result through the shared envelope builder. | S |

## Ticks

C8 (every writer passes or is result-only) and C11 (every writer passes) are ticked in `plans/ANALYSIS_CAPABILITY_ROADMAP.md` and `plans/OPEN_ITEMS.md` rows 8 and 11. C9 (5 partial: 25 signal worksheet, 26, 27, 30, 35) and C13 (reflectivity curve/band worksheets, 26/27) stay open; their lines carry the current counts. The C11 tick covers the writers this audit enumerated (grep of the commit entry points and every `addDataset` / `addWorksheetQuietly` in `components/workshops`, enforced by `rawWriterGuard.test.ts`); a writer outside `components/workshops` that adds a worksheet raw would not be caught by that guard.

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
| SIMS Process / Compare / Region | preview plot, comparison preview and region measures are inside `WorkbenchPreviewFrame` ("Preview (not saved)"); Add to Reports / Create stay outside the frame | Close drops the preview; nothing was written (tests in `sims/*.test.tsx`) | **fixed 2026-11-23** | P |
| Figure previews | ternary, pie, vector field (`ternary/AuxFigureFrame.tsx`) | server image, not a result; no mark | nothing | ~ (by design) |
| Dataset math / Average curves | `datasetmath/useDatasetMath.ts` and `useCurveAverage.ts` called the commit without an AbortSignal, so closing the window mid-Combine (during a lazy-book resolve or request) could still add the output | the unit-mismatch review is a gate, not a preview | **fixed in the Dataset math lane**: both hooks pass the `useWorkbenchCommit` signal (Cancel button, Close/unmount) into `commitTransformOutput`; an aborted run commits nothing and shows no error | P (was F) |
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
| Dataset math, Average curves | P | P | P | P | P | ~ | unit review with explicit ack (`datasetmath/useDatasetMath.ts`, `useCurveAverage.ts`); cancel gap closed |
| Resample, Reshape, Reduce rows | P | P | P | P | P | P | `resample/ResamplePanel.tsx:183`, `lib/transformResample.ts:17`, `useReshapePreview` review |
| Metadata promote / merge | P | P | - | - | - | P | `metafactors/PromoteSection.tsx:66` |
| Pipeline apply recipe | P | P | P | ~ | P | P | `lib/recipePreflight.ts`, `pipeline/ApplyRecipeSection.tsx:96` |
| Batch over worksheets | P | P | P | P | P | P | `analysisselection/AnalysisBatchControls.tsx:222`, `reductions/reductionBatchItems.ts:16` |
| Tabulate | P | - (one dataset, no unit arithmetic) | P (empty table says "No finite rows to summarize"; a queued export/report that finds none now says so, **fixed here**) | P (non-finite group or value cells are skipped by `lib/tabulate`, counted in the `count` stat; all-blank gives the empty-table message) | P (export / copy / report load the full book; the on-screen table is labelled a sampled preview only when the preview really is sampled (`rowsAreSampled`), **fixed here**) | - (no Cancel control; a queued action is dropped with a message when the setup or dataset changes, `useTabulate.test.ts`) | `tabulate/useTabulate.ts`; `useTabulate.refusals.test.ts` |
| RSM peaks / strain | P | - (Q centres are in the file's own units) | P ("No peaks found above threshold") | P (strain refuses a peak pair without finite Q centres) | P (**fixed here**: a book that cannot be resolved was a silent return in Find peaks and in the peak cuts; both now say so) | P (Clear / a new dataset bumps the run id; a late answer lands nowhere, proven in `useRsm.refusals.test.ts`) | `rsm/useRsm.ts`; `useRsm.refusals.test.ts` |
| ROI cuts | P (**fixed here**: Run / Stats with no box, and the profiles with no dataset, did nothing and said nothing; now a status line, a button tooltip and an inline hint) | - (the box space is an explicit 2θ/ω or Q choice, never converted) | P (backend "box selects no data" shows as "cut failed: ...", nothing added) | P (**fixed here**: a non-finite box or sector bound was sent as `null` to a 422; now refused client-side. NaN pixels inside the map are excluded by the backend and counted in the "N points" channel, a documented cut policy) | P (cuts take the loaded map; the batch card resolves its books) | - (no Cancel control: Run is one request the user asked for; closing the window does not withdraw it. Provisional, owner to confirm) | `roicuts/cutGuards.ts`; `useRoiCuts.refusals.test.ts` |
| Calculators | P | P | - | P | - | P | per-card validation (`calculators/*`) |
| Digitizer | P | - | - | - | - | - | hand input |
| SIMS | P | P | P | P | P | P | previews marked (2026-11-23); batch has Cancel with `WorkbenchProgress`; the batch toggle is locked while a Create runs |

## Tally

| Criterion | Pass | Partial | Fail |
|---|--:|--:|--:|
| C10 (12 groups with a preview or result) | 10 | 1 (figure previews, by design) | 0 after the Dataset math lane and the SIMS marking; 1 n/a |
| C14 (19 groups) | 12 | 7 (some conditions `~`: backend-stated minimum rows, Pipeline non-finite; ROI cuts, Tabulate and RSM are now proven pass or n/a) | 0 after the fixes |

Counts are of groups, not of individual tools; `~` cells were read but not given a failing test.

## Fixed in this lane (each with a test that fails without it)

1. `useLoadColumns` (Surface fit, Ellipse fit, Optical gap) rejects with a message for a vanished worksheet and for no finite row, instead of resolving null (silent no-op) or sending empty series. `analysisextras/columnPicks.load.test.ts`.
2. FFT thickness and Reflectivity FFT refuse a blank/non-finite cell with a count (was a bare 422) and report a worksheet removed while its full data loaded (was a silent return). `reductions/useReductionFftRefusals.test.ts`.
3. Recode mapping table and Metadata cleanup change table are marked "Preview (not saved)". `recode/RecodePanel.test.tsx`, `metafactors/MetaFactorsPanel.test.tsx`.

## Fixed in the Dataset math lane (each with a test that fails without it)

1. Dataset math and Average curves pass an AbortSignal (from `useWorkbenchCommit`) into `commitTransformOutput`; Cancel (new button while busy), Close and unmount abort it, an aborted run commits nothing (no worksheet, no macro step, no Library result) and shows no error. Tests (answer held pending, gesture dispatched, then released): `datasetmath/useDatasetMath.test.ts` ("forces the Cancel race", "forces the Close race"), `AverageCurvesSection.test.tsx` (same two).
2. Same-shape callers: SIMS Compare Create now aborts on unmount (`sims/SimsCompare.test.tsx`, "forces the Close race"); SIMS single Create shares the batch's AbortController (Close aborts it, an abort shows no error) and the SIMS batch's per-item commit receives the batch signal. Reshape, Resample, Signal filter / Reduce rows already passed a signal. Replay passes its own. The SIMS single-Create and batch-commit signals have no new test (the batch already stops between items; commit-level abort is covered by the shared contract).
3. Dataset math message: the "units differ" text is now shown only when the review itself declined for an unacknowledged unit mismatch; any other null (and any refusal) says "not combined — nothing was created" or the thrown reason. A worksheet removed mid-Combine already threw its own message after #903 (the commit path throws, it no longer returns null): `useDatasetMath.test.ts` pins that it never says "units differ" (this test passes without the fix; the abort path was the one that mis-surfaced).

## Left open (documented, not fixed)

| Gap | Why left | Proposed fix | Size |
|---|---|---|:-:|
| (none) | | | |

## Ticks

Rows 10 and 14 are ticked. Row 10: its last open gap (SIMS preview marking) is closed. Row 14: ROI cuts, Tabulate and RSM were each checked against all six conditions (C14 table and the lane below). The FFT batch gap check landed in #908.

## Fixed in the ROI cuts / Tabulate / RSM lane (each test fails without its fix)

1. ROI cuts: Run, Stats and the two profiles refuse with a message when there is no box or dataset, or a bound is not finite (`roicuts/cutGuards.ts`); the Box buttons carry the reason as a tooltip and an inline hint. `useRoiCuts.refusals.test.ts`.
2. RSM: Find peaks and the peak cuts say the full dataset is unavailable instead of returning silently. `useRsm.refusals.test.ts`.
3. Tabulate: a queued export / report whose full data has no finite rows reports it; the on-screen table is labelled a sampled preview while the book is lazy. `useTabulate.refusals.test.ts`.
Other tests in those files (backend refusal, NaN strain centres, zero peaks, Clear race, missing dataset) pin behaviour that already failed closed and pass without a fix.

## Provisional decisions (owner to confirm)

- ROI cuts have no Cancel and a Run is not aborted by closing the window (provisional, owner to confirm); Tabulate shows the sampled preview with a label rather than withholding it.

- Dataset math / Average curves gain a visible Cancel button while busy (provisional, owner to confirm); Close alone would also have satisfied the fail-closed rule.
- A Combine whose answer arrives after Cancel is discarded silently (no message): the user asked for it.
- A gap (blank / NaN) in an FFT scan is refused with a count, not dropped (`lib/api/finitePairs.ts` drops for fits; for an FFT the sampling is part of the result). Dropping would be an opt-in option if wanted.
- `useLoadColumns` rejecting on "no finite row" and "worksheet gone" shows as the tool's error line, not a toast.
- SIMS Region: the frame wraps the measures table, notes and warnings; Export CSV and Add to Reports are outside it (Add to Reports is an explicit save). Provisional, owner to confirm.
- `useSims.setBatchMode` ignores a flip while busy (fail closed), on top of the disabled checkbox. Single Create does share `batchAbort` (Close aborts it) but never sets `batchProgress`, so Stop is not rendered for it; the batch toggle was already disabled while busy, so it could not be flipped mid-Create. The guard and a test (`SimsPanel.test.tsx`) pin that.
- The Recode and Cleanup tables stay editable inside the provisional frame (the frame is a label, not a lock).


---

# Part 3: the six result verbs (OPEN_ITEMS row 12, 2026-11-23)

Criterion (`plans/ANALYSIS_CAPABILITY_ROADMAP.md:988`): a result can be **reopened (R), inspected (I), duplicated (D), renamed (N), deleted (X) and sent to a figure or report (F)**. Writers are the 37 of part 1 (numbering kept) plus one found here: **38 Kaplan-Meier curve** (`components/workshops/statstests/useKmCurveCommit.ts:19`, producer `km-curve`, a committed linked output like group A).

Legend as above (`P`, `~`, `F`). For R, `~` means the action exists but is disabled with a named reason (never silent); R on a writer with no tool to reopen is `n/a` only where the output is an ordinary worksheet and the verb is the worksheet's.

## The surfaces (paths under `frontend/src/`; one implementation each, no parallel ones)

| Verb | Library menu (`components/Library/artifactContextActions.ts`) | Result workspace (`components/workshops/analysisresults/`) |
|---|---|---|
| R | `artifact.reopenInTool` :63 (`planReopen`, `lib/committedOutputReopen.ts:123`; `REOPEN_TOOLS` :21) | `ReopenInToolButton.tsx` (linked mode, `AnalysisResultToolbar.tsx:65`); snapshot "Edit / rerun..." `AnalysisResultSnapshotToolbar.tsx:34` (`editSnapshot` `AnalysisResultPanel.tsx:150`); fit "Edit / Re-fit..." (:130), peaks (:123), reflectivity "Open fit workbench" (:139) |
| I | `artifact.open` :55 | Overview / Result book / Table / Figures / Diagnostics / Provenance / Notes tabs (`AnalysisResultTabs.tsx:6`); linked "Open worksheet" `AnalysisResultToolbar.tsx:64` |
| D | `artifact.duplicate` :86 (**fixed here**, was disabled for every result) | linked `AnalysisResultToolbar.tsx:68`, snapshot `AnalysisResultSnapshotToolbar.tsx:37`; both `duplicateAnalysisResult` (`store/analysisResultActions.ts:98`) |
| N | `artifact.rename` :79 (`lib/libraryRename.ts` -> `renameAnalysisResult` :62) | `AnalysisResultToolbar.tsx:71` (`rename` Panel :189) |
| X | `artifact.delete` :150 (`removeAnalysisResult` :82; keeps worksheets; one undo) | `AnalysisResultToolbar.tsx:72` (`remove` Panel :196) |
| F | none for a result (Library "Add to Report..." :120 is editable figures only) | Figures tab: `AnalysisResultFigures.tsx:79-81` (Open plot, Build figure, Send to report -> `sendAnalysisResultPlotToReport` `store/analysisResultActions.ts:197`); `StatisticalFigureCard` "Create editable figure" :109; snapshot "Send summary to report" `AnalysisResultSnapshotToolbar.tsx:39-42` (`sendAnalysisInlineTableToReport` `store/analysisResultInlineTableActions.ts:85`) |

A worksheet-only output (no result envelope) has the worksheet verbs: `lib/datasetContextActions.ts` plot :29, duplicate :62, rename :63, delete, and the Plot menu's Add to Report (`commands/plotCommands.ts:58`).

## Evidence grid

Group A (all 24 shared-contract writers + 38): I, N, X are `P` for all (the surfaces above act on any result by id; `plotBindings` of every output column are recorded at `lib/committedOutput.ts:95`, so F is `P` through the Figures tab; D is `P` (one output each, `commitBatchOutputs` makes one result per output, `store/commitBatchOutputs.ts:23`). Only R differs:

| # | Writer | R | Evidence / reason when `~` |
|--:|---|:-:|---|
| 1 | Surface fit | P | `REOPEN_TOOLS` `lib/committedOutputReopen.ts:22` |
| 2 | Fit bands | P | :31 (needs producer v2) |
| 3 | Tabulate | P | :25 |
| 4 | Baseline subtract | P | :24 |
| 5 | Baseline batch | ~ | producer `baseline-batch` not in `REOPEN_TOOLS`; reason shown by `planReopen` :130 |
| 6 | Optical gap | P | :22 |
| 7 | FFT thickness | P | **fixed in the reopen lane**: `REOPEN_TOOLS` (producer v2 records the picked column by position and name beside the settings) |
| 8, 9 | Pawley, Pawley model worksheets | ~ | not in `REOPEN_TOOLS` |
| 10 | Reflectivity FFT | P | **fixed in the reopen lane**: same as 7 |
| 11 | Ellipse fit | P | :23 |
| 12 | Spectrogram | ~ | Signal Processing outputs use Recalculate/Rerun, no reopen |
| 13 | Spin asymmetry | P | :28 |
| 14 | Hysteresis background | ~ | not in `REOPEN_TOOLS` |
| 15 | MagTools background | ~ | not in `REOPEN_TOOLS` |
| 16, 17, 18 | Mag normalization, Internal field, Curie-Weiss | P | :29-31 (producer v2) |
| 19 | ROI cuts / ROI batch | ~ | not in `REOPEN_TOOLS` |
| 20, 21 | Frequency count, Gadget FFT | ~ | not in `REOPEN_TOOLS` |
| 22 | Batch integrate | P | :27 |
| 23 | Peak batch | P | :26 |
| 24 | Resample / Average curves | ~ | not in `REOPEN_TOOLS` |
| 38 | Kaplan-Meier curve | P | **fixed in the reopen lane**: producer v2 records the time / event / group columns by position and name; reopens in Statistical tests |

Group B (worksheet writers, no result): the worksheet verbs apply. I/D/N/X/F `P` through `datasetContextActions.ts` (a derived worksheet is an ordinary dataset). R: 25 `~` (a signal output has Recalculate / Rerun as new; the rest have only a recorded macro step), 26, 27, 28, 29, 30, 36, 37 `F` (no record of the producing settings, so nothing to reopen; rerun the tool). Their lack of a result is the part 1 C9/C11/C13 gap, not a new one.

Group C (result only, no worksheet):

| # | Writer | R | I | D | N | X | F |
|--:|---|:-:|:-:|:-:|:-:|:-:|:-:|
| 31 | Statistical tests | P (Edit / rerun, needs a saved recipe) | P | P | P | P | ~ summary to report only (no figure drafts, `lib/statisticalResultFigures.ts:421`) |
| 32 | Snapshot results (Distribution, Variability, Multivariate, Outlier, Fit Y by X) | P | P | P | P | P | P (figure drafts :423-427) |
| 33 | Williamson-Hall (+ batch) | P (single; batch `~`, no recipe) | P | P | P | P | P (:428-429) |
| 34 | Analysis batch | ~ (no recipe in the envelope) | P | P | P | P | ~ figures only for the hysteresis tool (:430), else summary to report |
| 35a | Curve fit record | P (Edit / Re-fit, :130) | P | F | P | P | P (live binding) |
| 35b | Peak analysis record | P (:123) | P | F | P | P | P (source curve only, by design) |
| 35c | Reflectivity fit record | P (:139) | P | F | P | P | ~ ("No figure-ready output", `AnalysisResultFigures.tsx:132`; send from the reflectivity workbench) |

D `F` for 35: the record lives on its source worksheet and the workspace has never offered Duplicate for it; the Library now says so with the reason (`lib/analysisResultDuplicate.ts`) instead of the old wrong "use Rerun as New".

## Tally (38 writers; the 35a-c rows count as the one writer 35, graded by its worst record)

| Verb | Pass | Partial | Fail |
|---|--:|--:|--:|
| R reopen | 19 | 12 | 7 |
| I inspect | 38 | 0 | 0 |
| D duplicate | 37 | 0 | 1 (35) |
| N rename | 38 | 0 | 0 |
| X delete | 38 | 0 | 0 |
| F figure/report | 35 | 3 (31, 34, 35) | 0 |

R `~`: 5, 8, 9, 12, 14, 15, 19-21, 24, 25, 34 (12 writers; 7, 10 and 38 were fixed in the reopen lane). R `F`: 26-30, 36, 37. Counted from the grid above; the 24 shared-contract writers are grouped, with 19 (ROI cuts and ROI batch) as one.

## Fixed in this lane (with a test that fails without it)

1. **D from the Library** (`components/Library/artifactContextActions.ts:86`): `Duplicate` was disabled for every analysis result with the reason "use Rerun as New from the result workspace", which is wrong for every committed output (only signal outputs have a recipe) while the result workspace duplicates them. It now runs the workspace's own `duplicateAnalysisResult` under one shared gate (`lib/analysisResultDuplicate.ts`: a snapshot with tables, or a linked result with exactly one existing output), and a refusal names its reason (missing output, fit/peak/reflectivity record, not exactly one output). Test: `components/Library/artifactContextActions.test.ts`, "artifact.duplicate for analysis results" (3 cases; fail on the old code, verified).

## Fixed in the reopen lane (each test fails without its fix; verified by reverting the source)

Three of the 15 disabled-reopen writers now reopen: **7 FFT thickness, 10 Reflectivity FFT, 38 Kaplan-Meier curve**. Per writer: the commit records the picked columns by position AND name (`parameters.reopen.extra.picks`, unkeyed, so no commit key changes), the producer version goes to 2 and `REOPEN_FROM_VERSION` makes a version-1 result refuse with the existing "saved before its settings were recorded" reason, the producer joins `REOPEN_TOOLS`, and the tool seeds from the recorded settings at mount.

Shared pieces (all lazy; the eager cost is the three `REOPEN_TOOLS` entries and three version pins in `lib/committedOutputReopen.ts`): `lib/reductionsReopenSeed.ts` (strict seed readers: null unless every setting is present and well typed; pick record and check), `lib/kaplanMeierReopenSeed.ts`, `store/toolReopenPicks.ts` (the opener's guard).

Fail-closed, per writer (tests in `components/workshops/resultcommit/reopenReductionsFft.test.tsx` for 7 and 10, `reopenKaplanMeier.test.tsx` for 38):

| Case | Behaviour | Test |
|---|---|---|
| Reopen | every recorded setting and column comes back exactly (non-default values; a plain open is asserted to start from the defaults first); Replace preselected; the tool's method / test is selected | "restores the exact recorded settings" |
| Old result (producer v1, no record) | `planReopen` refuses with the existing reason; nothing opens, no session | "an old result without the recorded settings refuses" |
| v2 result missing its column record | opens the tool WITHOUT settings, notice, Replace off | "column pick is missing" |
| Deleted source | existing behaviour (opens without settings, notice, Replace off); asserted for the tool state | "a deleted source" |
| Changed column set (the recorded column's name is no longer at its index, or a lazy source not yet loaded) | no settings seeded, the notice names the column, Replace off | "a changed column set is NOT guessed" |
| Kaplan-Meier only | Replace then commits into the old worksheet (one result, same output id) | "Replace commits into the old output" |

Revert check: with the tracked source files reverted every new test fails (16 of 16); with only the opener's guard (`guardRecordedPicks`) removed, the missing-record and changed-column-set cases fail (6 of 16) and the rest pass.

## Left open in the reopen lane (the 12 writers still `~`)

| # | Writer | Why not done |
|--:|---|---|
| 14 | Hysteresis background | its tool state lives in the large `useHysteresis` loop state and the reopen needs the plotted channels restored (the `CHANNEL_TOOLS` path); a scoped lane of its own |
| 15 | MagTools background | settings `{path, fraction, xKey, yKey}` are keyed, but the routine follows the data's detected axis and the Background mode; seeding needs the tab opener (`magReopen.ts`) and the channel replot extended, and `useMagTools.ts` is 406 of 500 lines |
| 5, 8, 9, 12, 19, 20, 21, 24 | Baseline batch, Pawley (+ model worksheets), Spectrogram, ROI cuts / batch, Frequency count, Gadget FFT, Resample / Average curves | not attempted: each needs its settings recorded in full first (several are multi-source or run on a selection of worksheets, which the single-source plan refuses by design) |
| 25 | Signal worksheet | outputs use Recalculate / Rerun as new by design; no per-tool settings record |
| 34 | Analysis batch | no recipe in the envelope (see the Open table) |

## Open (documented, not fixed here)

| Gap | Proposed fix | Size |
|---|---|:-:|
| R `~` for 5, 8, 9, 12, 14, 15, 19-21, 24 (no recorded reopenable settings; see the reopen lane below for each reason) | per tool: record `settings` + `reopen` as lane RO3 did for Units, then add to `REOPEN_TOOLS` with a producer version bump | M each |
| R `F` for worksheet-only writers (26-29, 30, 36, 37) | needs envelopes first (part 1 gaps 25-29, 36-37) | M |
| R `~` for 34 and the W-H batch (no saved recipe in the envelope) | record the batch recipe in `parameters`, add an Edit path | S |
| D `F` for fit / peak / reflectivity records | decision needed: duplicate the record onto a copied worksheet, or keep "duplicate the worksheet" as the answer | S |
| F `~` for the reflectivity fit record (no figure-ready output), statistical tests and analysis batch (summary only) | add `plotBindings` / figure drafts to those envelopes | S each |
| F from the Library: no result-level "Add to Report..." / "Build figure" (workspace only) | add a Library action that calls `sendAnalysisResultPlotToReport` / `sendAnalysisInlineTableToReport`; not done: it opens plot state as a side effect and needs the same gating as the workspace | S |
| F for a map-shaped output (Spectrogram, ROI/RSM): the recorded binding plots every column as lines | record a map-aware binding; not verified in the UI | S |
| Toolbar "Duplicate" tooltip does not state why it is disabled | reuse `duplicateBlockedReason` | S |
| Part 3 reads the code; it did not click each surface in a running app | an e2e pass over one writer per group | S |

## Tick

Row 12 and the roadmap box are **not ticked**: R is `~` or `F` for 19 of 38 writers (was 22), D fails for the dataset-resident fit, peak and reflectivity records (35) and F is partial for 31, 34 and 35. Both lines are annotated with this part.

## Provisional decisions (owner to confirm)

- Library Duplicate is enabled only where the workspace's Duplicate is (fail closed); fit, peak and reflectivity records stay not duplicable, with a reason.
- A disabled-with-reason "Open in <tool>" is graded `~`, not `P`: the verb is not available.
- A copy made by Duplicate carries the original's commit key (it is a copy of the same computation); a later identical tool run finds the first match and a Replace of either is refused as "already holds this exact computation". Provisional, owner to confirm.
- Reopen lane: a changed column set (or a source still loading) opens the tool without settings and with Replace off rather than seeding the recorded positions; the existing 16 writers show a "changed" notice but still seed. Provisional, owner to confirm.
- Reopen lane: Kaplan-Meier reopens the Statistical tests panel on the recorded test, columns and grouping only; its other parameters (alpha, tails, ...) do not affect the curve and start from their defaults. Provisional, owner to confirm.
- Reopen lane: a version-1 result of the three writers never reopens (their column was not recorded and is not guessed); run the tool again to replace it. Provisional, owner to confirm.

---

# Part 4: cancellation and determinate progress (OPEN_ITEMS row 15, 2026-11-23)

Paths under `frontend/src/` unless they start `src/quantized/`. "Cancel" = what stops the work and what state is left; "Progress" = D determinate, I indeterminate, N none; "Backend could?" = whether the server could expose a fraction.

| # | Operation | Cancel | Progress | Backend could? |
|--:|---|---|:-:|---|
| 1 | Job queue: fit scan, global fit, compare datasets, bumps/DREAM, reflectivity DREAM, peak model batch (`jobs.py:70` `report` raises `JobCancelled`; routes `fitting.py:371`, `fitting_global.py:251,326`, `fitting_bumps.py:83`, `reflectivity.py:313`, `peaks_batch.py:116`) | `POST /api/jobs/{id}/cancel`; a cancelled job never stores a result (`jobs.py:119`); UI Cancel in `ModelScanSection.tsx:49`, `BumpsSection.tsx:75`, `GlobalFitSection.tsx:109`, `ReflUncertainty.tsx:78`, StatusBar via `trackJob` (`pendingOpActions.ts:14`) | D (fraction + message polled) | already does |
| 2 | Shared `WorkbenchProgress` runners: Peak batch (`PeakBatchView.tsx:121`), SIMS (`SimsBatchControls.tsx:43`), Batch Figure Builder (`BatchFigureBuilder.tsx:339`), Pack project (`PackProjectPanel.tsx:142`), Resample (`ResamplePanel.tsx:188`) | Stop after the item in flight (`sequentialBatch.ts:62`); completed items stay valid; Resample aborts the request in flight | D (done/total, bytes for Pack) | n/a (client loop) |
| 3 | Analysis batches (Stats, Baseline, Surface/Ellipse/Optical gap, Mag, Hysteresis, Reductions, Signal, ...) | `AnalysisBatchControls.tsx:215` StatusBar Cancel between worksheets | D (label "n/N", `:215`) | n/a |
| 4 | **ROI cuts batch** (`roicuts/useRoiBatch.ts`) | **was none; now Stop** (cuts landed stay, no overlay or summary of a partial set) | **was none; now D** `WorkbenchProgress` | n/a |
| 5 | Import files / paths (`store/importDatasets.ts:394`) | StatusBar Cancel aborts the upload (`:394`); nothing partial lands for the file in flight | D label "Importing i/N: name" (`:386`) | single-file upload percent needs a streaming progress channel (open, below) |
| 6 | **Import & append** (`commands/fileCommands.ts:101`, `store/importAppendRun.ts`) | **was none; now Cancel**: aborts the in-flight upload, lands nothing, does NOT fall back to separate imports | **was I; now D** "Importing i/N to append: name" | n/a |
| 7 | Workspace open / append (`lib/openWorkspaceCommand.ts:87,123`) | none (`withOp` without cancel); the parse is a Worker/lazy codec, the apply happens only after it | I | worker could post parse progress; not done (see open) |
| 8 | Workspace save (`store/workspaceIO.ts:64-130`) | none; nothing is written until every book is resolved, so a cancel would leave no partial file | I (status "fetching N books", `:75`; a count is known) | n/a (client fetches) |
| 9 | Lazy Origin full load (`store/dataIntake.ts:135,155`: `resolveDataset(s)`, 6 at a time) | none; a failed load is reported, never half-installed | I (400 ms "fetching full data" toast) | n/a (count known, not threaded) |
| 10 | Command wrapper (`store/commands.ts:119` `runAction` -> `withOp`) | none by design: it cannot cancel an arbitrary command; commands that can (exports, imports) register their own `runCancellable` / `beginOp` cancel | I (busy label) | n/a |
| 11 | Lazy chunk loads (`lib/runLazy.ts:43`) | none: a dynamic `import()` cannot be aborted; `importDatasetsLazy.ts:134` drops the follow-up logically | I | n/a |
| 12 | Exports / report / figure page (`runCancellable`, 15+ sites, e.g. `ReportPanel.tsx:202`) | StatusBar Cancel aborts the request; nothing saved on abort | I (server renders one file; no fraction) | would need a server job (open) |
| 13 | Reflectivity single fit (`useReflFit.ts:296`, `routes/reflectivity.py:208`) | Cancel aborts the request (`:351`); fit result not applied (`:302,306`) | I | scipy `least_squares` could report iterations via the job queue (open) |
| 14 | Bootstrap CIs / posterior (`routes/fitting.py:154,401`) | request abort only; the server keeps computing | I | yes: Monte Carlo draws are countable; needs a job route (open) |
| 15 | **Pipeline replay**, active dataset (`pipeline/usePipeline.ts:173`, `executeSteps.ts:72`) | none: no signal passed. Steps edit the active dataset in place (`addFormula`, `applyCorrections`), so a cancel needs a rollback design | **was I "Running…"; now D "Running k/N…"** (`PipelinePanel.tsx:262`, from the step log the run already kept) | n/a |
| 16 | Pipeline template batch over files (`pipeline/useTemplates.ts:192`) and Apply recipe (`useApplyRecipe.ts:95`, `ApplyRecipeSection.tsx:139`) | Cancel; the in-flight file's import and derived outputs are rolled back, completed files are kept (`useTemplates.ts:211-224`) | D (`batch` state; recipe "Applying k of n") | n/a |

## Fixed in this lane (each test fails without its fix; verified by reverting the source)

1. **ROI cuts batch: Stop + determinate progress** (`roicuts/useRoiBatch.ts`, `BatchCard.tsx`). Test `useRoiBatch.stop.test.ts`: the first cut is held on a deferred, Stop pressed, then released; asserts progress `{done:0,total:3}`, one cut landed, the other two never requested, no summary dataset and no overlay, status says stopped; a second test shows an idle Stop does not leak into the next run.
2. **Import & append: Cancel + "i/N"** (`commands/fileCommands.ts`, `store/importAppend.ts`, `importAppendRun.ts`). Test `commands/importAppendCancel.test.ts`: the second upload is held until its signal aborts; the op label reads "Importing 2/3 to append: b.dat…", Cancel leaves no dataset, runs no fallback `importFiles`, releases the import guard.
3. **Pipeline Run shows k/N** (`PipelinePanel.tsx`). Test in `PipelinePanel.test.tsx`: the fit is held; the button reads "Running 2/3…".

## Left open (documented, not fixed here)

| Gap | Why not here | Size |
|---|---|:-:|
| Workspace open/append Cancel (row 7) | Adding the op's cancel to the eager `openWorkspaceCommand.ts` costs eager bytes; the eager bundle had 0.5 kB of headroom and the append fix used 0.2 kB. Safe semantics are clear (drop the parsed result before `dispatch`) | S |
| Workspace save Cancel + "k of N books" (rows 8, 9) | needs a signal threaded through `resolveDatasets` and a per-book count; touches `dataIntake` | M |
| Pipeline replay Cancel (row 15) | steps mutate the active dataset in place; cancel needs a snapshot/rollback or "run on a copy" design. Owner to confirm | M |
| Upload percent for one large import (row 5), parse percent for workspace open (row 7) | a new progress channel (XHR upload events / worker `postMessage`) | M |
| Reflectivity single fit and bootstrap/posterior as jobs with a fraction (rows 13, 14) | new backend job routes | M |
| Export progress (row 12) | server renders one file; no meaningful fraction | n/a |
| Stop during ROI cut does not abort the request in flight | by design (a half-landed cut is worse); Resample's abort pattern could be copied. Owner to confirm | S |

## Tick

Row 15 and the roadmap box are **not ticked**: rows 7-9, 13-15 above remain without Cancel and/or a fraction.

## Provisional decisions (owner to confirm)

- A stopped ROI batch keeps the cuts already landed but builds no overlay figure and no summary table over a partial selection (fail closed).
- A cancelled import-append lands nothing and does not degrade to separate imports (a cancel is not a failure).
- Stop on the ROI batch is "after the dataset in flight", not an in-flight abort.
