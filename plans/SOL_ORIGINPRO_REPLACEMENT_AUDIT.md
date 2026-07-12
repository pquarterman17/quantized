# Sol Audit — OriginPro Replacement Readiness

**Auditor:** Sol  
**Date:** 2026-07-12  
**Scope:** Independent audit of the quantized codebase and Claude's implementation work, focused on correctness, bugs, feature gaps, and readiness to replace OriginPro as the primary experimental-data analysis and plotting application.

## Executive summary

The architecture and test discipline are strong, but quantized should not yet be trusted as a full OriginPro replacement for unsupervised scientific analysis. The main risk is not missing mathematical functionality: it is that several UI analysis workflows can silently analyze different columns from those shown in the plot.

The highest-priority work is to establish one explicit analysis-selection contract shared by plotting, fitting, peaks, baselines, and magnetometry; surface optimization convergence; persist complete fit provenance; and make autosave cover every persisted workspace artifact.

## Priority findings

### P1 — Analysis tools ignore the selected plot X/Y channels

> **Mostly addressed 2026-07-12.** Migrated to the shared `selectedFitData`
> bridge (`lib/fitselection.ts` — reads rows via `rowstate.analysisData` and
> the plot's own `effectiveChannels` contract; `fullPlottedX` keeps overlays
> aligned to the full-length plot x):
> - **Curve Fit** (PR13) — parity/auto-guess/model-scan/equation/bootstrap/bumps.
> - **Peaks** (PR #16) — detect + fit-multi + fit-each.
> - **Peak Analyzer / peakwizard** (PR #17) — the `segment` chokepoint (baseline/
>   find/fit/integrate) + marker overlay.
> - **Hysteresis** (PR #18) — M-H analysis + bg-subtract now use plotted H/M
>   (the headline "M-vs-H" danger: a timestamp `.time` with Field/Moment as
>   channels).
>
> STILL OPEN (deliberately deferred — these are NOT simple channel swaps):
> - **magtools** (M(T) bg-subtract + unit convert) — self-contained but writes
>   a column-collapsing new dataset over FULL (unpruned) data with physics
>   metadata (`x_column_name`); doable but higher regression surface, wants its
>   own careful pass. Currently still `time`/`values[0]`.
> - **baseline processing** — entangled with the BACKEND corrections pipeline:
>   the anchor method's Apply runs through `applyCorrections`'s `bgAnchors`,
>   which subtracts from column 0. A real fix needs a channel parameter through
>   the corrections/recalc DAG, not a frontend-only read.
> - **pipeline execution** (`executeSteps` fit step) — runs headless over MANY
>   target datasets (folder batches) that may not share a column layout, so a
>   live-view `yKey` could be out of range. The correct fix is per-step channel
>   provenance (record `xKey`/`yKey` in the step, reproduce via `fitDataForSpec`)
>   — a P1 #3 extension, not a live-view read.

At audit time, Curve Fit analyzed `DataStruct.time` against `values[0]`, regardless of the user's selected X, Y, Y2, series ordering, or channel roles:

- `frontend/src/components/workshops/curvefit/useCurveFit.ts:61`
- `frontend/src/components/workshops/curvefit/useCurveFit.ts:87`
- `frontend/src/components/workshops/curvefit/useBumpsFit.ts:55`

The same hard-coded pattern appears in model scan, custom-equation fitting, peaks, Peak Analyzer, baseline processing, pipeline execution, and several magnetometry workflows.

This is especially dangerous for M-vs-H, transport, and other multi-column data. The visible graph can show one relationship while the fit or analysis is calculated against another. Live inspection confirmed that the Curve Fit panel does not disclose which columns it uses and provides no X/Y selector.

**Required correction:** introduce one explicit `AnalysisSelection` contract containing the dataset, X channel, Y channel, optional error channel, and included-row mask. Every analysis workshop should consume that contract rather than independently choosing `time` and `values[0]`.

### P1 — Non-converged fits are presented as successful results

> **Partially addressed 2026-07-12 (PR #14):** A shared `FitConvergenceWarning`
> now surfaces `exitFlag=0` (a failed Nelder-Mead run) on both the standard and
> custom-equation Curve Fit panels — the result stays inspectable but is marked
> unreliable with a `role="alert"`. The DREAM/bumps half below is NOT yet
> addressed: `BumpsFitResult` carries no convergence flag, so exposing R-hat /
> ESS / multi-chain diagnostics (and sampling controls) remains the open piece.

The parity fitter returns `exitFlag=0` when optimization fails, but the frontend displays parameters, R², RMSE, and AIC without checking or showing that flag:

- `src/quantized/calc/fitting.py:135`
- `src/quantized/calc/fitting.py:195`
- `frontend/src/components/workshops/curvefit/CurveFitPanel.tsx:96`

This allows a max-iteration or otherwise unsuccessful optimization to look like a valid completed fit.

DREAM has the same problem at higher scientific stakes. Fresh test runs emitted `Did not converge!`, yet the returned result is labeled as a posterior without R-hat, multiple-chain diagnostics, effective sample size, convergence state, or a user-visible warning. Its posterior result contains only medians, central 68% intervals, and draw count:

- `src/quantized/calc/fit_bumps.py:245`
- `frontend/src/components/workshops/curvefit/BumpsSection.tsx:96`

The current default is a fixed budget of 10,000 samples, burn-in 100, and population 10, described as enough for a usable posterior without evidence that it is adequate for a particular model or dataset.

**Required correction:** failed deterministic fits should be refused or prominently marked unsuccessful. DREAM should expose convergence diagnostics, allow sampling controls, and never present intervals as trustworthy when convergence criteria are unmet.

### P1 — Fit provenance is not durable enough to reproduce an analysis

> **Partially addressed 2026-07-12 (PR #15):** `fitSpec` now records a
> reproducible RECIPE — the plotted `xKey`/`yKey` fit at record time plus a
> `params`/`exitFlag` result snapshot — and the recalc graph reproduces those
> exact channels on recompute (legacy `{model}` specs fall back to the live
> plotted selection). This also fixed a leftover of P1 #1: recompute previously
> re-ran against `time`/`values[0]`. Round-trips through `.dwk`. STILL OPEN:
> error/weight channel, explicit fit range, starting values, parameter bounds,
> covariance/uncertainty method, and preprocessing state — captured when the
> weighted/equation fit paths surface them (registry fits expose no user
> bounds); and a UI distinction between a historical result and a recomputed
> one.

A persisted `fitSpec` contains only the model name:

- `frontend/src/lib/types.ts:285`
- `frontend/src/components/workshops/curvefit/useCurveFit.ts:98`

It omits:

- X and Y channel selections
- error/weight channel
- included or excluded rows
- fit range
- starting values
- parameter bounds
- fitted parameters
- optimizer and convergence state
- covariance and uncertainty method
- relevant preprocessing state

The backend supports fit weights, but the normal Curve Fit UI does not pass the selected error-bar channel. Reopening or recalculating a saved fit is therefore not guaranteed to reproduce the original analysis.

**Required correction:** persist a complete, versioned fit recipe and result artifact. Recalculation should use the original channel selections and settings, and the workspace should distinguish a historical result from a newly recomputed result.

### P1 — Autosave does not watch every persisted artifact

> **Addressed 2026-07-12 (PR #14):** Autosave now triggers off the COMPLETE
> `.dwk`-serialized slice via a testable `shouldAutosave(state, prev)` helper
> whose `AutosaveState` field list matches `serializeWorkspace` exactly (adds
> reports, figure docs, macro steps, Origin figures, and recalc mode — the
> previously-omitted fields). Regression tests prove each of those independently
> schedules a save. (The focused-window LIVE-view edit remains a deliberate
> pre-existing tradeoff — an explicit File ▸ Save snapshots it via
> `windowsForSave()`; unchanged by this PR.)

The autosave subscription omits reports, figure documents, macro steps, and focused-window live plot-view edits even though those fields are part of the serialized workspace:

- `frontend/src/useWorkspaceAutosave.ts:24`

Manual **File → Save workspace** captures these artifacts, but changes confined to an omitted field do not schedule autosave. A crash or accidental close can therefore restore an older state even though autosave appeared enabled.

**Required correction:** derive autosave from the complete serialized workspace projection, or subscribe explicitly to every serialized field. Add tests proving that report edits, figure edits, macro changes, and focused plot-view changes independently update the autosave slot.

### P2 — Origin project migration is incomplete

Known gaps include:

- Matrix-only `.opju` projects are expected failures because the MBook codec remains undecoded.
- Multi-scan Bruker `.brml` RSM files are rejected by the 1-D parser; 2-D `.brml` import is not implemented.
- Imported Origin figures drop drawn arrows, lines, standalone rectangles/ellipses, and framed or callout annotations.
- Native `.opj` writing works in real Origin, but `.opju` writing remains deferred.

Evidence:

- `tests/test_parsers_matrix.py:64`
- `plans/ORIGIN_FILE_DECODE_PLAN.md:316`
- `plans/ORIGIN_FILE_DECODE_PLAN.md:414`

These gaps do not invalidate the substantial Origin import/export work already completed, but they prevent lossless migration of every Origin project.

### P2 — Origin replacement readiness has not been proven by an Origin-closed project

The plans correctly propose producing one real deliverable with Origin kept closed and maintaining a friction log, but that acceptance exercise is still an owner gate:

- `plans/GOTO_PLAN.md:91`

Feature inventories and unit tests cannot expose workflow friction, missing interactions, or silent scientific assumptions as effectively as completing a real paper or experimental report.

**Required correction:** make the Origin-closed project a v1 acceptance criterion. Enumerate the required figures and analyses up front, keep Origin closed, record every workaround and time cost, and convert the resulting friction log into prioritized work.

### P3 — Remaining competitive gaps require owner decisions

Open product decisions include:

- interactive rotatable 3-D plotting
- worksheet reshape, stack/unstack, and join-by-key workflows
- real date-time axes for long PPMS/MPMS runs
- wavelets, Hilbert transforms, STFT, and deconvolution

Evidence:

- `plans/GOTO_PLAN.md:78`

Other documented tails include crystal bond angles, reflectivity density/SLD input switching, fuller per-dataset view-state persistence, polarized-neutron consolidated export, and advanced Pawley refinement.

The production JavaScript bundle is also approximately 969 kB minified and triggers Vite's 500 kB chunk warning. Code splitting would improve startup and loading behavior, but it is not a scientific-correctness blocker.

## Verification performed

The audit was performed on an actively changing feature branch. Claude committed the rich-text work while the audit was in progress; all final verification below reflects the resulting current branch state at commit `1078174`.

### Passing checks

- Ruff: clean across `src` and `tests`
- strict mypy: clean across 219 source files
- repository integrity guard: 3 passed
  - pure-layer import enforcement
  - source-module size ceiling
  - dependency/license enforcement
- backend suite: 2,838 passed, 3 skipped, 12 expected failures
- final rich-text backend tests: 24 passed
- frontend suite: 3,227 passed across 237 test files
- frontend production build: passed
- live local-app inspection: no browser console errors observed
- production `.tsx` files: no component exceeded the project's approximate 400-line ceiling

### Expected failures and warnings

The 12 expected backend failures expose real coverage or feature gaps:

- two paths for unsupported multi-scan Bruker `.brml` RSM import
- one matrix-only Origin `.opju` project with an undecoded MBook codec
- nine parser routes without a matching real corpus specimen

Runtime warnings included:

- DREAM test workloads reporting non-convergence
- a deliberately difficult logistic-GLM fixture reporting perfect separation and optimizer non-convergence
- a Starlette/httpx test-client deprecation warning

### Transient rich-text build regression

During the audit, the in-progress rich-text AST was widened with fraction and square-root nodes before all renderers handled the new union members. At that intermediate point, all 3,213 frontend tests passed while the production TypeScript build failed.

Claude repaired and committed the renderer changes during the audit. The final typecheck, 3,227-test run, and production build pass, so this is not a current unresolved defect. It does demonstrate that `npm test` alone is not a sufficient frontend gate; production typecheck/build must remain required in CI and completion claims.

## What is strong

The codebase has several unusually strong qualities for a v0.9 scientific application:

- Clean `calc`/`io` versus route layering is explicit and enforced.
- MATLAB parity coverage is extensive and backed by frozen golden values.
- The project records known MATLAB bugs rather than silently encoding them as desired behavior.
- Publication export supports vector PDF/SVG and high-resolution raster formats.
- Plotting, workspace organization, Origin interoperability, instrument parsers, and domain-specific analysis already exceed the scope of a typical early-stage port.
- Origin project reverse engineering is documented with honest known gaps and real-corpus anchors.
- Parser gaps are represented as expected failures rather than hidden skips.
- Frontend module decomposition and architecture checks are substantially healthier than the predecessor applications.

The project is not a disorganized prototype. Its largest remaining risks are scientific workflow contracts and product validation, not basic architecture.

## Recommended implementation order

1. Introduce the shared `AnalysisSelection` contract and migrate fitting, peaks, baselines, magnetometry, and pipeline execution to it.
2. Refuse or prominently flag non-converged fits; add DREAM convergence diagnostics and configurable sampling.
3. Persist complete fit recipes, provenance, and result artifacts rather than model names alone.
4. Make autosave subscribe to the complete serialized workspace projection.
5. Complete one Origin-closed acceptance project and maintain a friction log.
6. Address Origin migration gaps encountered by that real project.
7. Resolve advanced plotting, worksheet, date-time, and signal-processing gates according to demonstrated usage rather than feature-list parity alone.

## Replacement-readiness verdict

Quantized is already a strong MATLAB-parity analysis platform and a credible OriginPro replacement candidate. It is not yet safe to declare it the primary unsupervised analysis environment because the current channel-selection and convergence gaps can produce scientifically misleading results without a clear error.

The threshold for replacing OriginPro should be:

- the plotted data and analyzed data are guaranteed to share one explicit selection contract;
- failed or unconverged analyses cannot look successful;
- saved workspaces reproduce complete analyses and figures;
- autosave protects all user-created artifacts; and
- one real project has been completed with Origin kept closed.

Once those conditions are met, the remaining feature gaps become normal prioritization decisions rather than blockers to scientific trust.
