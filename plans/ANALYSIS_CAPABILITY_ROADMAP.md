# Analysis Capability Roadmap

**Source:** ChatGPT-Sol (Codex)
**Status:** Active
**Created:** 2026-10-06
**Last updated:** 2026-10-06

## Goal

Close the practical analysis gap between Quantized and OriginPro without
turning the application into a collection of unrelated dialogs. A completed
analysis should be easy to discover, preview, commit without altering raw
data, inspect later, rerun after its input changes, reuse on another dataset,
and send to a table, figure, or report.

This roadmap is deliberately GUI-first. Quantized already has a broad
numerical backend; the immediate problem is that capabilities are scattered,
inconsistently exposed, and do not all share the same result lifecycle.

## Evidence from the 2026-10-06 audit

### Already present — reuse rather than rebuild

- Curve fitting includes registry and custom equations, parameter controls,
  uncertainty, diagnostics, model comparison, global fits, ODR, and reports.
- Peak and baseline tools include direct peak curation, a guided Peak
  Analyzer, mixed models, batch recipes, integration, and durable peak tables.
- Statistics include distributions, Fit Y by X, a guided test chooser,
  hypothesis tests, regression, correlation, PCA/SPLOM, outlier screening,
  nested variability analysis, tabulation, GLM, survival, and ROC engines.
- Technique tools cover powder XRD, XRD maps, reflectometry, magnetometry,
  SIMS, transport, and spectroscopy workflows.
- The corrections engine already implements smoothing, normalization, first
  and second derivatives, cumulative integration, and log derivatives.
- The spectral engine already implements FFT/PSD/phase, Welch averaging,
  frequency-domain low/high/band/notch filtering, and cross-correlation.
- Derived worksheets, transformation recipes, Pipeline Studio, reports, and
  editable figures provide most of the persistence primitives needed below.

### Confirmed product gaps

- [ ] General signal processing has no coherent workbench. Common operations
  are split between a collapsed Corrections card, the range gadget, and
  technique-specific FFT tools. General filtering and cross-correlation have
  backend implementations but no normal GUI path.
- [ ] Result lifecycle is inconsistent. Some results become linked worksheets
  or durable tables, some can only be copied to a report, and some disappear
  when a tool window closes.
- [ ] Selection semantics differ by tool: active dataset, plotted channels,
  selected worksheet columns, range ROI, excluded rows, and filtered rows are
  not presented through one understandable contract.
- [ ] Batch and `By` support is inconsistent. Users cannot assume that an
  analysis that works once can be run over selected worksheets or factor
  levels with the same controls.
- [ ] The Analyze menu is a launcher, not an analysis navigator. It does not
  show input requirements, compatibility with the current worksheet, recent
  analyses, or existing results.
- [ ] Statistical engines are extensive but feel like separate utilities.
  Output tables and plots do not yet behave like a single expandable Origin/JMP
  result book.
- [ ] There is no shared "preview -> commit derived output -> rerun/edit"
  workbench shell, so each new analysis can accidentally invent different
  behavior for errors, cancellation, provenance, and stale inputs.

## Product contract for every new analysis

Each analysis added or modernized under this roadmap must satisfy these rules.

- [ ] Raw imported data is never overwritten. Commit creates a linked derived
  worksheet, durable result artifact, or explicit frozen copy.
- [ ] The input dataset, X/Y/error channels, included rows, selected range,
  units, parameters, and algorithm version are recorded.
- [ ] Preview is visibly provisional and Cancel leaves no scientific state.
- [ ] Commit is one undo step and repeated clicks cannot create duplicates.
- [ ] A result can be reopened, inspected, duplicated, renamed, deleted, and
  sent to a figure or report.
- [ ] A changed input marks the result stale; automatic recalculation occurs
  only when the project's recalculation mode permits it.
- [ ] Missing inputs, incompatible units, insufficient rows, non-finite data,
  lazy Origin previews, and cancelled work fail closed with a useful message.
- [x] Excluded/filtered rows and bound uncertainties follow an explicit policy
  shown in the UI rather than an implicit implementation detail.
- [ ] Long work supports cancellation; determinate progress remains for jobs
  whose backend can expose meaningful progress rather than only busy/complete.
- [x] The same saved recipe can run over selected compatible datasets without
  overwriting customized plots or raw data.
- [x] Tests use representative files from the sibling `test-data` repository
  where a relevant real format exists.

## Workstream A — General Signal Processing workbench

**Priority:** P0 — first implementation tranche

**Goal:** provide the Origin-style general analysis operations currently hidden
or unavailable in the GUI through one previewed, non-destructive workflow.

### A1. Shared workbench and input contract

- [x] Add `Analyze > Signal Processing…` and a technique-workflow action.
- [x] Show the active worksheet, X channel, one or more Y channels, units,
  included/excluded row counts, and optional X range.
- [x] Support choosing the plot's current channels or worksheet columns.
- [x] Add live preview with an obvious original/processed comparison.
- [x] Add Preview, Commit as derived worksheet, Save recipe, Cancel, and Help.
- [x] Refuse lazy/downsampled Origin data until the canonical resolver loads the
  full worksheet; guard against the active worksheet changing during the load.

Implementation status (2026-10-06):

- [x] Added the canonical `Analyze > Signal Processing…` command and an
  on-demand workbench.
- [x] Added measured-column selection seeded from the plotted channels, with
  categorical and bound uncertainty columns excluded from the signal choices.
- [x] Added debounced original/processed preview with stale-response rejection.
- [x] Commit creates and activates a linked derived worksheet in the source
  workbook/folder; preview and Cancel do not mutate the source.
- [x] Full-worksheet scope, excluded-row policy, linkage, uncertainty limits,
  and lazy-data refusal are stated in the UI.
- [ ] Add the technique-workspace action, explicit X/range controls, included
  row counts, Save Recipe, and contextual Help before checking A1 complete.

Update (2026-10-07):

- [x] Added explicit, opt-in X-range controls to the shared workbench.
- [x] Added technique-workspace launch, included/excluded row counts, named
  Recipe Library saving, and contextual Help. Preview and commit requests are
  abortable; cancelling cannot publish a hidden late output.

### A2. Time/domain operations

- [x] Smoothing: moving average, Gaussian, and Savitzky-Golay; odd-window and
  polynomial-order validation; clear edge behavior.
- [x] Normalization: range, peak, area, Z-score, and a user-specified reference
  value/range.
- [x] Calculus: first derivative, second derivative, cumulative integral, and
  log-log derivative with units derived and displayed.
- [x] Detrending: constant, linear, and polynomial with previewed residual.
- [x] Resampling: uniform-grid helper when an operation requires even spacing;
  never silently interpolate.

Implementation status (2026-10-06):

- [x] Exposed moving-average, Gaussian, and Savitzky-Golay smoothing through
  the shared workbench; repaired the pre-existing `savgol`/canonical-key
  mismatch while retaining saved-project compatibility.
- [x] Exposed range, peak, area, and Z-score normalization, plus first/second
  derivative, cumulative integral, and log derivative for selected channels.
- [x] Derived units now change with normalization/calculus, including readable
  reciprocal-axis units; bound Y-error values and units follow supported
  normalizations, while unsupported nonlinear propagation fails closed.
- [x] Added an API-level `signalChannels` contract so transforming one column
  cannot silently transform every numeric column.
- [x] Added reference-value/range normalization with bound-error scaling,
  editable Savitzky–Golay polynomial order, polynomial detrending (orders
  0–5), optional X-range output, and the explicit spectral resampling gate.

### A3. Frequency and correlation operations

- [x] General FFT with magnitude, PSD, and phase; one/two-sided output; common
  windows; optional Welch averaging; frequency-axis units.
- [x] Low-pass, high-pass, band-pass, and notch filters with cutoff validation,
  transfer-function preview, and before/after comparison.
- [ ] Cross-correlation between two channels or two compatible worksheets,
  including peak lag and correlation readout.
- [x] Create ordinary plottable output worksheets for spectra, filtered data,
  and correlation traces.

Implementation status (2026-10-07, ChatGPT/Codex):

- [x] Added FFT magnitude, PSD, and phase; one/two-sided output; five common
  windows; optional Welch averaging; detrending; zero-padding; and canonical
  reciprocal X-axis units/labels.
- [x] Added low/high/band-pass and notch filtering with cutoff, Nyquist,
  bandwidth, and order validation; before/after preview; and a live transfer-
  function diagnostic that is deliberately omitted from persisted outputs.
- [ ] Cross-correlation now supports exactly two columns in one worksheet and
  displays peak lag/correlation. Cross-worksheet correlation remains blocked
  on Workstream D's multi-dataset selection/dependency contract; do not fake a
  second source through the current single `derivedFrom` edge.
- [x] FFT, filtered, and correlation outputs are ordinary linked worksheets.
  They save/load a versioned label-bound recipe, rebind only an unambiguous
  moved label, fail closed on a missing/duplicated label, recalculate through
  the existing stale-result graph, and can be frozen into an independent copy.
- [x] Irregular monotonic grids require an explicit Resample choice;
  non-monotonic/closed sweeps are refused even when resampling is selected.
- [x] Bound uncertainties are not silently transformed; the UI states that
  policy and no stale `errorRoles` are attached to spectral outputs.

### A4. Persistence and real-data acceptance

- [x] Record every operation as a replayable Pipeline Studio step.
- [x] Save/load recipes with column rebinding and unit compatibility checks.
- [x] Mark output stale when source values, row state, channels, or parameters
  change; rerun deterministically.
- [x] Exercise at least: an XRD pattern (smoothing/derivative), a SIMS profile
  (normalization/smoothing), a reflectivity trace (FFT/filter), and a
  magnetometry loop (closed/non-monotonic-axis refusal where appropriate).
- [x] Confirm raw data remains byte-identical through preview, cancel, commit,
  undo, save/reopen, and rerun.

Qualification log (2026-10-07, ChatGPT/Codex):

- [x] `panalytical/xrd/La2NiO4_1.xrdml`: PSD completed (4,097 bins), emitted
  `Frequency (1/deg)`, and retained the source bytes.
- [x] `eag/sims/sims_depth_profile.xlsx`: two-channel correlation completed
  with explicit irregular-grid resampling; peak lag was reported in nm; source
  bytes remained unchanged.
- [x] `ncnr/reflectometry/PNR_NoSpinFlip/S3_650Oe_From700mT.refl`: low-pass
  filtering completed with explicit resampling, preserved `Qz (1/Ang)`, and
  produced an 81-point transfer diagnostic without mutating source bytes.
- [x] `quantum-design/magnetometry/vsm_mh_perp_a.dat`: FFT with Resample was
  correctly refused because the hysteresis X axis is not strictly monotonic.
- [x] Automated round trips cover valid recipes, malformed/future recipes,
  workbook transfer, label rebinding/ambiguity, linked recalculation, and
  source-error-role removal.
- [x] Every correction and spectral operation now commits through one recorded
  `signal` transform. Save/load JSON round trips, Pipeline Studio replay,
  source-change refusal, unit-aware rebinding, named Recipe Library templates,
  cancellation, undo, and project reopen are covered by focused tests.
- [x] A local-corpus regression now exercises XRD smoothing with polynomial
  order and X trim, SIMS reference-range normalization, two-channel
  reflectometry reference normalization, and magnetometry detrending while
  checking both in-memory arrays and source-file hashes remain unchanged.
- [ ] Cross-worksheet correlation remains the one deliberately deferred A3
  item; it requires Workstream D's multi-source dependency contract rather
  than an unsafe second ad-hoc source edge.

## Workstream B — Durable analysis result artifacts

**Priority:** P0 after A1/A2 establish the reusable shell

**Goal:** make an analysis result a first-class Library object instead of
temporary contents of a floating window.

- [ ] Define one versioned `AnalysisResult` envelope: identity, producer,
  source references, selection snapshot, parameters, scalar values, tables,
  optional plot bindings, warnings, timestamps, and stale state.
- [ ] Add an Analysis Results section under the appropriate workbook/folder.
- [ ] Open a result into a result workspace with Overview, Tables, Diagnostics,
  Figures, Provenance, and Notes tabs as applicable.
- [ ] Add Edit and rerun, Recalculate, Duplicate, Freeze, Send to report, Build
  figure, Export tables, Rename, and Delete actions.
- [ ] Migrate curve fits, statistics, peak outputs, and signal-processing
  results incrementally; do not create a second authority beside existing
  durable `fitSpec`, peak tables, or reflectivity-fit history.
- [ ] Preserve old `.dwk` files and tolerate unknown future result kinds.

## Workstream C — Analysis Center and discoverability

**Priority:** P1

**Goal:** answer "what can I do with this data?" without requiring knowledge of
menu names.

- [ ] Add a searchable full-stage Analysis Center reachable from Analyze and
  the Workflow view.
- [ ] Organize tools by Fit, Peaks/Baseline, Signal Processing, Statistics,
  XRD/Reflectivity, Magnetometry, SIMS, and Data Preparation.
- [ ] For each tool show a one-sentence purpose, required inputs, compatibility
  with the active worksheet, and why it is unavailable.
- [ ] Show Recommended for this data, Recent, Favorites, All tools, and Existing
  results without auto-running or making scientific guesses.
- [ ] Seed a tool with the current dataset, plotted channels, selected rows, and
  range when compatible.
- [ ] Keep command-palette and menu actions canonical; the Center launches the
  same implementations rather than duplicating them.

## Workstream D — Shared selection, batch, and `By` behavior

**Priority:** P1

- [ ] Define a versioned `AnalysisSelection` contract for dataset(s), X/Y/error
  roles, analysis-row ids, factor/By roles, and optional ranges/ROIs.
- [ ] Let plot-range, worksheet-column, Library multi-selection, and factor
  grouping create that same contract.
- [ ] Add a standard Review inputs panel to every migrated workbench.
- [ ] Add Run by factor level and Run over selected worksheets where the
  algorithm supports it; show a preflight matrix before a batch begins.
- [ ] Produce one navigable batch result with per-input status, warnings,
  comparable summary columns, and a clear partial-cancellation state.

## Workstream E — Statistical result workspace

**Priority:** P1/P2; build on Workstream B

- [ ] Combine Distribution, Fit Y by X, Test Chooser, Statistical Tests,
  Multivariate, Variability, and Outlier Screening into one expandable result
  workspace while retaining focused launch shortcuts.
- [ ] Standardize effect sizes, confidence intervals, assumption checks,
  multiple-comparison adjustment, missing-data policy, and plain-language
  interpretation.
- [ ] Add linked result tables/plots whose row and group selections highlight
  the source worksheet and plot.
- [ ] Make every table directly copyable and exportable; figures should open as
  normal editable Quantized figures.
- [ ] Defer clustering, control charts/capability, Gauge R&R, and DOE until the
  owner confirms actual use; these remain the existing JMP census-gated items.

## Workstream F — Technique-specific expansion

**Priority:** P2, driven by real-data sessions

- [ ] XRD: phase/reference overlays, better search/match handoff, crystallite
  analysis history, and batch comparison after the current peak/Pawley tools.
- [ ] Reflectometry: parameter-correlation and posterior-diagnostic workspace,
  linked fit families, and constrained batch series.
- [ ] Magnetometry: unit-aware sample geometry normalization, temperature/field
  series comparison, and derived magnetic quantities.
- [ ] SIMS: multi-profile alignment, interfaces/junction comparison, and batch
  region tables.
- [ ] Spectroscopy: peak-family presets, component area/ratio tables, and batch
  recipe review.
- [ ] Add only against representative owner data and trusted expected results.

## Recommended implementation sequence

1. [x] A1 + A2: Signal Processing workbench using existing processing code.
2. [ ] A3: expose the existing spectral/filter/correlation engines.
3. [x] A4: pipeline replay, persistence, and real-corpus qualification.
4. [ ] B: introduce the durable result envelope and migrate signal results.
5. [ ] C: build the Analysis Center on canonical commands and result inventory.
6. [ ] D: unify selection and batch behavior, then migrate curve fit/peaks.
7. [ ] E: migrate statistical tools into the result workspace.
8. [ ] F: expand technique-specific depth according to real use.

## Model/agent routing

| Work | Best owner | Suggested model | Reason |
|---|---|---|---|
| Workbench UX, Analysis Center, result workspace | ChatGPT/Codex | current workhorse, high reasoning | Cross-panel GUI behavior and interaction consistency dominate. |
| Processing/spectral numerical APIs and units | Claude | Sonnet-class | Backend scientific correctness, validation, and API reliability. |
| Persistence schema/recalculation graph | Claude with Codex review | strongest available | Silent corruption and migration risk justify deeper review. |
| Mechanical command wiring, tests, docs | Either | cheaper model | Bounded patterns with explicit acceptance criteria. |
| Real-data browser acceptance and adversarial GUI review | ChatGPT/Codex | workhorse | Interaction and scientific-workflow failures require holistic review. |

## Required verification for every PR

- [ ] Characterization tests precede changes to established behavior.
- [ ] Backend unit/API tests and frontend hook/component tests pass.
- [ ] Test stale selection, deleted/reused ids, lazy Origin data, cancellation,
  repeated clicks, save/reopen, and non-finite input.
- [ ] Run typecheck, lint, architecture ratchets, production build, bundle-size
  gate, and relevant browser journeys.
- [ ] Run the feature against representative sibling `test-data` files and log
  exact files, operations, and observed output.
- [ ] Perform an adversarial self-review before external review; fix findings
  rather than moving them into technical debt unless the limitation is an
  explicit product decision.

## Progress log

| Date | Author | Change | Evidence |
|---|---|---|---|
| 2026-10-07 | Project team | Completed A1, A2, and A4 around the existing A3 spectral work: technique-workspace launch, row-scope disclosure, X-range controls, reference normalization, editable smoothing/detrend polynomial order, contextual Help, named Recipe Library templates, one replayable `signal` transform path, unit-aware rebinding, source-race refusal, cancellation, undo, and project persistence. Cross-worksheet correlation remains explicitly deferred to Workstream D. | Focused frontend workbench/pipeline/workspace checks passed (including record → save → reload → replay); focused correction API/calc checks passed (121). Real corpus passed on `La2NiO4_1.xrdml`, `sims_depth_profile.xlsx`, `S3_650Oe_From700mT.refl`, and `vsm_mh_perp_a.dat`, with source arrays and file hashes unchanged. |
| 2026-10-07 | ChatGPT-Sol (Codex) | Completed the single-worksheet A3 spectral tranche: FFT/PSD/phase, four frequency filters, transfer-function and before/after previews, two-channel cross-correlation, linked plottable outputs, versioned recipe persistence/rebinding, and explicit irregular-grid resampling. Cross-worksheet correlation remains explicitly deferred to the multi-source dependency workstream. Two adversarial passes fixed filter detrending semantics, stale metadata/error-role leakage, malformed recipe/orphan transfer handling, duplicate-label rebinding, event-loop decoding, cutoff provenance, reciprocal-unit display, large-array handling, startup-bundle loading, oversized Welch provenance, unbounded transfer previews, zero-energy correlation, implicit-notch provenance, hidden-setting recipe corruption, stale previews, and async source-change/orphan races. | Focused frontend: 311 passed; focused backend/API/off-loop: 131 passed; Ruff, focused mypy, TypeScript, ESLint, architecture ratchets, production build, and 814.5 kB eager-bundle gate passed. Full frontend before the second focused hardening pass: 16,824 passed / 2 expected failures; three unrelated lazy-workspace timing tests failed under the 322-second full run and then passed 4/4 in isolation. Real corpus: XRD PSD, SIMS resampled correlation, reflectivity filtering/transfer diagnostic, and correct refusal of a non-monotonic magnetometry loop, with source bytes unchanged. |
| 2026-10-06 | ChatGPT-Sol (Codex) | Completed the first A1/A2 tranche: channel-targeted correction API, unit/error semantics, general Signal Processing workbench, linked-output uncertainty retention, and Savitzky-Golay compatibility fix. The adversarial pass added strict channel indices, stale-preview and duplicate-commit guards, no-finite-output and invalid-area refusal, shared preview scaling, and deterministic workspace-busy tests. | Full backend: 8,139 passed / 101 skipped / 13 expected failures; focused post-review backend/API: 109 passed. Full frontend: 1,163 files, 16,806 passed / 2 expected failures. Ruff, mypy, TypeScript, ESLint, architecture ratchets, production build, and 834,392 B eager-bundle gate passed. Real corpus: `La2NiO4_1.xrdml` (6,474 rows, smoothing), `rohanisaac_raman.spc` (3,632 rows, derivative with reciprocal-axis units), and `YIG_Py_S7.raw` (15,385 rows, peak normalization), all finite with source arrays unchanged. |
| 2026-10-06 | ChatGPT-Sol (Codex) | Created the GUI/backend capability audit and roadmap; selected General Signal Processing as the first coherent tranche. | Inspected current Analyze/Data commands, technique workflows, workshops, routes, calculation modules, derived worksheets, pipeline replay, and existing PRIMARY/JMP plans on `origin/main` after PR #550. |
