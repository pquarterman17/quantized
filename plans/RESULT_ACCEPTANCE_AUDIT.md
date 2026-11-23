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
| 25 | `runTransform` family (Reshape/merge, Dataset math, SIMS, Signal-processing worksheet, sigop) | `lib/transformRun.ts:455` raw `addDataset`, then `registerSignalResult` (`store/analysisResultActions.ts:50`, signal only) | P | ~ | F | ~ |
| 26 | Reflectivity fit curves (live fit and saved-fit history) | `reflectivity/useReflFit.ts:414`, `useReflFitHistory.ts:181` | P | ~ | P (fixed here) | F |
| 27 | Reflectivity uncertainty bands | `reflectivity/useReflDream.ts:234` | P | ~ | P (fixed here) | F |
| 28 | Image digitizer | `digitizer/useDigitizer.ts:117` | P | F | P | n/a |
| 29 | RSM map cuts (Stage tools, RSM panel) | `Stage/useCutLanding.ts:75` (`land`; callers `Stage/useMapCuts.ts:40`, `useMapRoi.ts:313`, `useMapRuler.ts:301`, `useMapSectorWedge.ts:255`, `rsm/useRsm.ts:230`) | P | F | F | F |
| 30 | Pipeline replay / templates | `pipeline/runTemplate.ts:291`, `useTemplates.ts:202-251` | P | ~ | n/a | n/a |
| 36 | Curve-fit batch summary worksheet (found by the strengthened guard) | `curvefit/CurveFitBatchSection.tsx:170` `addWorksheetQuietly` | P | F | F | F |
| 37 | Curve-fit results worksheet (found by the strengthened guard) | `curvefit/FitOutputSection.tsx:80` `addWorksheetQuietly` | P | F | F | F |

Notes: 25 C9 `~`: a signal output records its recipe on the worksheet (`settingsRef` `analysisRecipe`) with source and algorithm in the recipe; the other ops record a macro step but no envelope. 25 C11 `F`: one undo entry per run (the output's snapshot also restores the signal result), but a repeat click runs again and adds a second output (replay of a recorded step is deliberately a new run; the interactive workshops have no duplicate guard). 25 C13 `~`: a signal output is re-derived by the recalc engine from its recipe; the other ops were not traced. 26/27 C13 `F`: the curve and band worksheets are not stale-marked when the fitted data changes (the fit record itself is, via `staleFits`). 26/27 C11: a repeat is guarded by in-session ids (`presentIds`), not by value, so it is lost on reload. 30 is by design: each replay is a recorded run.

### C. Result-only writers (no worksheet; an envelope or a dataset-resident record)

C8 is `n/a` (nothing is written over raw data).

| # | Writer | Evidence | C8 | C9 | C11 | C13 |
|--:|---|---|:-:|:-:|:-:|:-:|
| 31 | Statistical tests | `store/statisticalTestResults.ts`, `lib/statisticalTestAnalysisResult.ts:101` | n/a | ~ | P (fixed here) | P |
| 32 | Snapshot results (Distribution, Variability, Multivariate, Outlier screening, Fit Y by X) | `store/snapshotResultSave.ts:41` (dedupe key line 62) | n/a | ~ | P | P |
| 33 | Williamson-Hall (and its batch) | `store/williamsonHallResults.ts:10`, `lib/williamsonHallBatch.ts:74` | n/a | ~ | P | P |
| 34 | Analysis batch (By-level / Analysis selection) | `components/workshops/analysisselection/AnalysisBatchControls.tsx:260` | n/a | ~ | F | P |
| 35 | Curve fit / Peak analysis / Reflectivity fit records | `lib/fitAnalysisResultLive.ts:42`, `lib/peakAnalysisResult.ts:33`, `lib/reflFitAnalysisResult.ts:46` | n/a | ~ | P | P |

Notes: C9 `~` for 31-35: the envelope keeps the question (columns with units, parameters or recipe, source fingerprint over the analysis view) but not an explicit included-row count or X range (the fingerprint covers the analysis view, so a changed row set reads out of date). 34 C11 `F`: each Run saves a new timestamped result; a second identical run adds an identical one. 35 C11: one deterministic result id per dataset (a re-fit replaces, never duplicates); C13: `staleFits`.

## Tally (37 writers)

| Criterion | Pass | Partial | Fail | n/a |
|---|--:|--:|--:|--:|
| C8 raw data never overwritten | 32 | 0 | 0 | 5 (result-only) |
| C9 inputs/params/version recorded | 24 | 9 | 4 | 0 |
| C11 one undo, no duplicate | 31 | 0 | 5 | 1 |
| C13 stale on input change | 29 | 1 | 5 | 2 |

Before this lane: C9 had the producer version, settings and fingerprint only for group A (no channels/units/included rows/range); C11 failed for 26, 27 and 31 and 5 (baseline batch had no duplicate guard); C13 failed for 5.

## Fixed in this lane (each with a test)

1. C9, all 24 shared-contract writers: `parameters.inputs` (`lib/resultInputsRecord.ts`, `lib/committedOutput.ts`). Test: `store/resultLifecycleContract.test.ts`.
2. Baseline batch (5): through `commitAnalysisOutput`; linked results, stale marking, no duplicate on repeat, still one undo step, no empty folder on a repeat. Test: `components/workshops/baseline/BaselinePanel.batch.test.tsx`.
3. Reflectivity curves/bands (26, 27) C11: `store/addDatasetsOneStep.ts`. Test: `store/resultLifecycleContract.test.ts`.
4. Statistical tests (31) C11: a repeat of an identical run returns the saved result. Test: `store/statisticalTestResults.test.ts`.
5. Cross-writer contract test and raw-writer guard (see above).

## Deferred gaps, with a proposed fix

| Gap | Proposed fix | Size |
|---|---|:-:|
| 25 runTransform family: no envelope for non-signal ops, no duplicate guard, C13 not traced for Reshape / Dataset math / SIMS | Route the interactive workshops through `commitTransformOutput` (as Resample/Average already are, `store/commitTransformOutput.ts`); keep `runTransform` for replay. Dataset math and Reshape each need a settings digest. | M |
| 26/27 curve and band worksheets not stale-marked; duplicate guard lost on reload | Commit them with `commitBatchOutputs` against the fitted dataset(s) (multi-source `alsoFrom`), key on the fit record id + digest; adds reopen-less envelopes. | M |
| 28 digitizer: calibration (reference points, axis types) not recorded in the output | Add a `digitizer` metadata block (refs, traced point count) to the output `DataStruct.metadata`; no source worksheet, so no stale. | S |
| 29 RSM map cuts: raw `land`, no link, no duplicate guard | Move `useMapCuts`, `useMapRoi`, `useMapRuler`, `useMapSectorWedge`, `useRsm` onto `landCommitted` (already used by ROI cuts) with the map dataset as source. | M |
| 34 analysis batch result: identical re-run saves a second result | Dedupe on producer + sources fingerprint + `parameters` + `tables`, as `publishStatisticalTestResult` now does. | S |
| 31-35 C9 partial: no explicit included-row count / range in result-only envelopes | Add `recordedInput` (`lib/resultInputsRecord.ts`) to their `parameters` in each builder. | S each |

| 36/37 curve-fit worksheets: no envelope, no duplicate guard, not stale-marked, no recorded inputs | Commit through `commitComputedOutput` / `commitBatchTable` with the fitted dataset(s) as sources. | M |

## Ticks

No roadmap box and no `OPEN_ITEMS.md` row is ticked: every criterion has at least one writer that is partial or failing (counts above), so none can be ticked on the evidence. The two lines were annotated with this audit.

## Provisional decisions

- The generic `inputs` record is added under `parameters` (not a new envelope field), so the sanitizer, reopen and replace paths carry it unchanged and the commit key is unaffected.
- Statistical-test dedupe compares producer, source fingerprint, sources, parameters and tables: a stochastic test whose tables differ between runs still saves a new result (fail open on the dedupe, never hides a different result).
- Baseline batch has its own producer id (`baseline-batch`), so it has no reopen-in-tool session; reopen is not claimed.

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
| F | none for a result (Library "Add to Report..." :120 is editable figures only) | Figures tab: `AnalysisResultFigures.tsx:79-81` (Open plot, Build figure, Send to report -> `sendAnalysisResultPlotToReport` `store/analysisResultActions.ts:197`); `StatisticalFigureCard` "Create editable figure" :109; snapshot "Send summary to report" `AnalysisResultSnapshotToolbar.tsx:38` (`sendAnalysisInlineTableToReport` `store/analysisResultInlineTableActions.ts:85`) |

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
| 7 | FFT thickness | ~ | not in `REOPEN_TOOLS`; its picks are not recorded as reopenable settings |
| 8, 9 | Pawley, Pawley model worksheets | ~ | not in `REOPEN_TOOLS` |
| 10 | Reflectivity FFT | ~ | not in `REOPEN_TOOLS` |
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
| 38 | Kaplan-Meier curve | ~ | not in `REOPEN_TOOLS` |

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
| 35c | Reflectivity fit record | P (:139) | P | F | P | P | ~ ("No figure-ready output", `AnalysisResultFigures.tsx:131`; send from the reflectivity workbench) |

D `F` for 35: the record lives on its source worksheet and the workspace has never offered Duplicate for it; the Library now says so with the reason (`lib/analysisResultDuplicate.ts`) instead of the old wrong "use Rerun as New".

## Tally (38 writers; the 35a-c rows count as the one writer 35, graded by its worst record)

| Verb | Pass | Partial | Fail |
|---|--:|--:|--:|
| R reopen | 16 | 15 | 7 |
| I inspect | 38 | 0 | 0 |
| D duplicate | 37 | 0 | 1 (35) |
| N rename | 38 | 0 | 0 |
| X delete | 38 | 0 | 0 |
| F figure/report | 35 | 3 (31, 34, 35) | 0 |

R `~`: 5, 7-10, 12, 14, 15, 19-21, 24, 25, 34, 38. R `F`: 26-30, 36, 37. Counted from the grid above; the 24 shared-contract writers are grouped, with 19 (ROI cuts and ROI batch) as one.

## Fixed in this lane (with a test that fails without it)

1. **D from the Library** (`components/Library/artifactContextActions.ts:86`): `Duplicate` was disabled for every analysis result with the reason "use Rerun as New from the result workspace", which is wrong for every committed output (only signal outputs have a recipe) while the result workspace duplicates them. It now runs the workspace's own `duplicateAnalysisResult` under one shared gate (`lib/analysisResultDuplicate.ts`: a snapshot with tables, or a linked result with exactly one existing output), and a refusal names its reason (missing output, fit/peak/reflectivity record, not exactly one output). Test: `components/Library/artifactContextActions.test.ts`, "artifact.duplicate for analysis results" (3 cases; fail on the old code, verified).

## Open (documented, not fixed here)

| Gap | Proposed fix | Size |
|---|---|:-:|
| R `~` for 5, 7-10, 12, 14, 15, 19-21, 24, 38 (no recorded reopenable settings) | per tool: record `settings` + `reopen` as lane RO3 did for Units, then add to `REOPEN_TOOLS` with a producer version bump | M each |
| R `F` for worksheet-only writers (26-29, 30, 36, 37) | needs envelopes first (part 1 gaps 25-29, 36-37) | M |
| R `~` for 34 and the W-H batch (no saved recipe in the envelope) | record the batch recipe in `parameters`, add an Edit path | S |
| D `F` for fit / peak / reflectivity records | decision needed: duplicate the record onto a copied worksheet, or keep "duplicate the worksheet" as the answer | S |
| F `~` for the reflectivity fit record (no figure-ready output), statistical tests and analysis batch (summary only) | add `plotBindings` / figure drafts to those envelopes | S each |
| F from the Library: no result-level "Add to Report..." / "Build figure" (workspace only) | add a Library action that calls `sendAnalysisResultPlotToReport` / `sendAnalysisInlineTableToReport`; not done: it opens plot state as a side effect and needs the same gating as the workspace | S |
| F for a map-shaped output (Spectrogram, ROI/RSM): the recorded binding plots every column as lines | record a map-aware binding; not verified in the UI | S |
| Toolbar "Duplicate" tooltip does not state why it is disabled | reuse `duplicateBlockedReason` | S |
| Part 3 reads the code; it did not click each surface in a running app | an e2e pass over one writer per group | S |

## Tick

Row 12 and the roadmap box are **not ticked**: R is `~` or `F` for 22 of 38 writers, D fails for the dataset-resident fit, peak and reflectivity records (35) and F is partial for 31, 34 and 35. Both lines are annotated with this part.

## Provisional decisions (owner to confirm)

- Library Duplicate is enabled only where the workspace's Duplicate is (fail closed); fit, peak and reflectivity records stay not duplicable, with a reason.
- A disabled-with-reason "Open in <tool>" is graded `~`, not `P`: the verb is not available.
- A copy made by Duplicate carries the original's commit key (it is a copy of the same computation); a later identical tool run finds the first match and a Replace of either is refused as "already holds this exact computation". Provisional, owner to confirm.
