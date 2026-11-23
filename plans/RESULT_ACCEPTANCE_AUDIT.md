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
- C9 (fixed in this lane): the envelope records `producer.version`, `parameters.settings`, `sourceFingerprint` and now `parameters.inputs` (`lib/resultInputsRecord.ts`: per source the channels with units, X label/unit, total and included rows, X range of the included rows). One place, so every writer below gets it.

Cross-writer contract test: `store/resultLifecycleContract.test.ts` (table over `commitAnalysisOutput`, `commitComputedOutput`, `commitBatchTable`, `commitBatchOutputs`; a new shared entry point is added to its `WRITERS` table). Guard against new raw writers: `components/workshops/resultcommit/rawWriterGuard.test.ts` (a raw `addDataset(` in `components/workshops` fails unless allowlisted with a reason; the list may only shrink).

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

## Tally (35 writers)

| Criterion | Pass | Partial | Fail | n/a |
|---|--:|--:|--:|--:|
| C8 raw data never overwritten | 30 | 0 | 0 | 5 (result-only) |
| C9 inputs/params/version recorded | 24 | 9 | 2 | 0 |
| C11 one undo, no duplicate | 31 | 0 | 3 | 1 |
| C13 stale on input change | 29 | 1 | 3 | 2 |

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

## Ticks

No roadmap box and no `OPEN_ITEMS.md` row is ticked: every criterion has at least one writer that is partial or failing (counts above), so none can be ticked on the evidence. The two lines were annotated with this audit.

## Provisional decisions

- The generic `inputs` record is added under `parameters` (not a new envelope field), so the sanitizer, reopen and replace paths carry it unchanged and the commit key is unaffected.
- Statistical-test dedupe compares producer, source fingerprint, sources, parameters and tables: a stochastic test whose tables differ between runs still saves a new result (fail open on the dedupe, never hides a different result).
- Baseline batch has its own producer id (`baseline-batch`), so it has no reopen-in-tool session; reopen is not claimed.
