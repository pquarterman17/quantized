# Analysis Capability Roadmap

**Source:** ChatGPT-Sol (Codex)
**Status:** Active
**Created:** 2026-10-06
**Last updated:** 2026-11-22

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

- [x] General signal processing has no coherent workbench. (Resolved: Analyze ▸ Signal Processing… workbench, incl. low-pass/band-pass filtering and cross-correlation, `components/workshops/signalprocessing/*`; multi-sheet apply groups outputs, #760.) Common operations
  are split between a collapsed Corrections card, the range gadget, and
  technique-specific FFT tools. General filtering and cross-correlation have
  backend implementations but no normal GUI path.
- [ ] Result lifecycle is inconsistent. Some results become linked worksheets
  or durable tables, some can only be copied to a report, and some disappear
  when a tool window closes.
  - **Audit (2026-11-22, lane RL): how each tool commits a result today.**
    "Idempotent" = a repeat click on the same computation creates nothing;
    "Stale" = a source change marks the committed result out of date.

    | Tool | Commits to | Idempotent | One undo step | Library result | Stale on input change |
    |------|------------|------------|---------------|----------------|-----------------------|
    | Signal Processing | linked derived worksheet (`derivedFrom` + `analysisRecipe`) | in-flight guard; panel closes on commit | yes (`addDataset` + `registerSignalResult`) | yes | recalc graph (`staleDatasets`), recalculates per recalc mode |
    | Curve fit | `fitSpec` on the source | yes (one result per source) | yes | yes | `staleFits` + fingerprint |
    | Peaks / Peak analyzer | `peakTable` on the source | yes (one result per source) | yes | yes | peak-table fingerprint |
    | Reflectivity fit | `reflFits` history record | per record | yes | yes | channel check |
    | Distribution, Fit Y by X, Variability, Outlier screening, Multivariate | envelope tables (snapshot) | yes, one shared value key (`lib/snapshotResultKey.ts`, `store/snapshotResultSave.ts`; lane RL3) | yes | yes | fingerprint (`snapshotResultState`), mode-independent **by decision** (see RL3 below) |
    | Statistical tests | envelope tables | no guard (each Run is a run) | yes | yes | fingerprint |
    | Williamson–Hall | envelope tables | boolean ref, stuck "saved" after Undo (**fixed**, lane RL) | yes | yes | fingerprint + peak binding |
    | Surface fit, Optical gap, Ellipse fit "Add … as dataset" | plain worksheet | **no** (repeat click duplicated) | yes | **none** | **never** → migrated (lane RL) |
    | Baseline subtract, Tabulate export, Peak batch table, Batch integrate trend, Fit band plot | plain worksheet (batch tables: one worksheet from several sources) | **yes** (shared contract; two clicks during a pending baseline fetch make one commit) | yes (the band's window folds in) | yes | yes, ANY source marks it stale → migrated (lane RL2) |
    | Digitizer Create | plain worksheet, no source worksheet (image input) | **yes** (by calibration + trace + name; no envelope) | yes | none | n/a (no source worksheet) → duplicate fix only (lane RL2) |
    | FFT thickness "→ Library", Magnetometry outputs (normalization, demag, Curie–Weiss) | plain worksheet (Curie–Weiss keeps its `derivedFrom` link) | **yes** (shared contract) | yes | yes | yes → migrated (lane RL4) |
    | Spin asymmetry | plain worksheet from TWO sources (R++ and R--, `alsoFrom`) | **yes** | yes | yes | yes, either channel marks it stale → migrated (lane RL4) |
    | Reflectivity model / SLD profile | plain worksheet, no source worksheet (a simulation of the layer stack) | **yes** (by the output's own digest in its metadata; no envelope) | yes | none | n/a (no source worksheet) → duplicate fix only (lane RL4) |

    Already shared: the `AnalysisResult` envelope with `sources`/`outputs`,
    `staleDatasets` + the recalc engine (`touchDataset`, mode gating), the
    save-side stamp (`stampAnalysisResults`) and load-side scan
    (`staleAnalysisOutputs`), and `asOneEditStep`.
  - [x] **Shared commit contract, first slice (lane RL, 2026-11-22).**
    `store/analysisOutputCommit.ts` (`commitAnalysisOutput`) + hook
    `components/workshops/resultcommit/useAnalysisCommit.ts`, pure parts in
    `lib/committedOutput.ts` / `lib/committedOutputGraph.ts`. A commit writes
    the output worksheet AND an `AnalysisResult` (sources, outputs,
    `parameters.commitKey` + settings, fingerprint) as ONE undo step; a repeat
    commit of the same computation (by value: producer, source, analysis-view
    fingerprint, settings and result digest) creates nothing and shows the
    existing output, the button disabled with the reason; after Undo, deletion
    of the output, or a source change it commits again. A missing, still
    loading or changed source fails closed. Stale marking reuses the recalc
    graph: `touchDataset` marks a committed output stale in Auto/Manual mode
    (None tracks nothing), a recalc pass leaves it stale (no recipe to replay),
    the result workspace disables Recalculate with the reason and says to rerun
    the tool, and the existing stamp/scan carries the state across save/reopen.
    Migrated: Surface fit, Optical gap, Ellipse fit. Tests:
    `store/analysisOutputCommit.test.ts`,
    `resultcommit/committedOutputTools.test.tsx` (fail-before: duplicate on
    repeat Add, no stale mark), `reductions/useWilliamsonHall.test.ts`.
  - [x] **Snapshot save fold (lane RL3, 2026-11-22).** The five bespoke
    duplicate checks are gone: `publishSnapshotResult`
    (`store/snapshotResultSave.ts`) is the one save path (fail-closed source
    check, one undo step via `asOneEditStep`), keyed by `snapshotResultKey`
    (`lib/snapshotResultKey.ts`), which reuses `committedOutputKey`:
    producer + source + analysis-view fingerprint + the question (view-only
    choices such as multivariate score axes, or Rosner `k` under MAD, are not
    part of it). The key of a saved result is derived from its stored
    `parameters.recipe`, so results from older files still block duplicates.
    The check reads the live `analysisResults` (no "saved" flag), so Save works
    again after Undo or delete, and a result marked stale does not block. The
    workshops read it through `useSavedSnapshotResult`. Distribution
    previously guarded only in its open hook (a reopened window or a reopened
    project allowed a duplicate): **fixed**, fail-before test in
    `store/snapshotResultSave.test.ts`. Statistical tests keep NO guard (each
    Run is a run).
  - **Decision (RL3): snapshot staleness does NOT follow the recalc mode.**
    A committed output follows the mode because the recalc graph can
    recompute or mark it and "None" means "I will manage updates". A snapshot
    has no recompute path (only re-running the tool replaces it) and is
    exactly what Send to Report and figure freezing read; if None hid a source
    change, a report could carry numbers for data that no longer exist as
    "Current". The intent of None for statistics is unclear, so it fails
    closed: freshness stays the data fingerprint in every mode, pinned by the
    mode-parametrized test in `snapshotResultSave.test.ts`. Revisit only on an
    owner decision (e.g. a UI option that lets None show a stale snapshot as
    "Current" with a visible caveat).
  - **Row exclusion / filter notify the recalc engine (2026-11-22, lane RX).**
    Root cause: `store/rowState.ts` writers (toggle/set/clear exclusions,
    exclude/keep-only selection, set/clear filter) never called
    `touchDataset`, so linked derived worksheets and committed outputs stayed
    "Current" after the analysis view changed. Snapshot results were already
    correct: their freshness is `analysisDataFingerprint`, which hashes the
    filtered/excluded view (pinned by a mode-parametrized test). Fix: every
    row-state write ends with `touchDataset(id)`, so the recalc mode applies
    unchanged (Auto recalculates, Manual marks stale, None tracks nothing).
    No new timing: the engine's existing 400 ms debounce coalesces a filter
    slider storm into one pass (tested), and a filter edit that changes
    nothing still records nothing. Open points: (1) RESOLVED by lane UH
    (2026-11-22): `undo`/`redo` now touch every dataset whose data,
    `excludedRows` or `filter` reference changed (`store/historyTouch.ts`), so
    Auto recalculates, Manual marks stale, None tracks nothing; unchanged
    datasets are not touched, and the recalc's plain `set` writes record no
    history, so the redo stack survives (`store/historyRecalc.test.ts`). Stale
    marks are still never un-marked by undo (conservative). (2) Fail closed: every
    output type counts a filter/exclusion as an input change; none is
    exempted. Tests: `store/rowStateRecalc.test.ts`.
  - [x] **Second slice (lane RL2, 2026-11-22).** Migrated Baseline subtract,
    Tabulate, Peak batch table, Batch integrate trend and Fit band plot onto
    `commitAnalysisOutput`. The hook gained `commitAsync` with an in-flight
    guard (a second click during a pending compute does not run `prepare`
    again: one commit); the contract gained `alsoFrom` (multi-source outputs:
    every source is fingerprint-checked, keyed and listed in the envelope, so
    any one changing marks the output stale; `store/commitBatchTable.ts`
    for batch tables) and `beforeWrite`/`intoFocused` (a tool that opens its
    output in its own window creates it inside the one undo step). Digitizer
    Create got a duplicate guard only (no source worksheet to go stale).
    Tests are the fail-before cases beside each tool
    (`useBaseline.commit.test.ts` incl. the held-open race,
    `useTabulate.commit.test.ts`, `BatchIntegrateWindow.test.tsx`,
    `PeakBatchView.test.tsx`, `useFitBands.test.ts`, `useDigitizer.test.ts`,
    the `alsoFrom` block of `analysisOutputCommit.test.ts`). Batch tables show
    the "already added" status instead of a disabled button.
  - [x] **"Open in <tool>" for committed outputs (lane RO, 2026-11-22).**
    The result workspace (linked results) and the Library result's context
    menu offer "Open in <tool>" (`lib/committedOutputReopen.ts` decides,
    `store/toolReopenOpen.ts` opens, `store/toolReopen.ts` holds the editing
    session). Supported: Surface fit, Optical gap, Ellipse fit, Baseline
    subtract, Tabulate. The tool reopens on the RECORDED source (made active;
    Baseline also re-plots the recorded channel) and its controls START from
    the envelope's keyed `settings` plus an unkeyed `parameters.reopen` record
    (the source view it was computed on, the output's own view, and tool extras
    such as Surface fit's start values and bounds). Seeding is at mount: a new
    session remounts the tool body, and each tool's reset/auto-guess effects
    leave the seeded values alone until the user changes a column or model.
    Closing the tool ends the session.
    - **Decision: the re-commit REPLACES by default, as an explicit choice.**
      The user opened THIS result to adjust it, so the banner's "Replace
      “output”" is preselected and the commit button says so; "Add as a new
      output" is one click away. Replace writes into the SAME worksheet id
      and the SAME result id (plots, figures, notes and the Library item
      follow; a user's rename of the output is kept, compared against the
      tool's own recorded name) as one undo step
      (`store/analysisOutputReplace.ts`). Only identity and Library
      organisation fields carry over to the new data. Replace is disabled with
      the reason, and the commit adds new instead, when the output worksheet
      was deleted or edited since it was added (data, or data-shaped worksheet
      state such as formulas, column roles/designations, exclusions, fits),
      when the result predates the output record (older files), or when the
      source is missing. The Replace/Add-as-new choice is read at commit time,
      so switching it during a slow Baseline fetch is honoured.
    - Baseline re-plots the recorded channel only when it differs, as ONE
      undoable view step ("plot the recorded Baseline channel", no macro step)
      that the status line names.
    - StrictMode-safe: the session ends on a deferred unmount check, and the
      tools' reset effects skip by VALUE (`useSeedHold`: the deps still equal
      their values at mount), not by "first run".
    - **Fail closed:** a missing source opens the tool with a notice and NO
      settings (never seeded onto another worksheet); a changed source opens
      seeded with a notice to re-run on the current data (the commit itself
      still refuses a computation older than the source). Undo of a replace
      keeps the stale state honest: `staleDatasets` is outside undo, so a
      stale old output's envelope is marked `stale` before the step;
      `findCommittedResultId`, the result workspace status and the save stamp
      (`stampAnalysisResults` keeps `stale` for committed outputs) honour it,
      so it is still stale after save and reopen.
    - **Not supported, disabled with the reason:** Peak batch table and Batch
      integrate trend (multi-source), Fit band plot (follows a live Curve Fit
      the result does not record). Signal Processing outputs keep their own
      path (Recalculate in place / Rerun as new from the recipe; no reopen into
      the workbench). Snapshot results keep their existing Edit (`openWith`).
    - Tests: `lib/committedOutputReopen.test.ts` (plan per case),
      `store/analysisOutputReplace.test.ts` (one undo step, idempotent, rename
      kept across replaces, edited output and column roles refused, stale
      across Undo and save/reopen),
      `resultcommit/reopenInTool.test.tsx` (seed round-trip for all five tools,
      replace vs add-as-new through the panel, StrictMode double mount, a mode
      switch during a pending commit, missing/changed source notice,
      disabled-with-reason in the workspace and the Library menu).
  - [x] **Third slice (lane RL4, 2026-11-22).** Migrated FFT thickness,
    spin asymmetry (two sources) and the Magnetometry outputs (normalization,
    demag, Curie–Weiss) onto the contract (`store/commitComputedOutput.ts`
    wraps `commitAnalysisOutput` for tools that compute and write in one
    step: the key carries a digest of the output, so the same run finds the
    existing worksheet; the output builder gained `derivedFrom`, so
    Curie–Weiss stays a linked worksheet). Reflectivity model and SLD profile
    have no source worksheet (a simulation), so they get the duplicate guard
    only (`store/commitModelOutput.ts`), like Digitizer. Fail-before tests sit
    beside each tool (`useFftThickness.test.ts`, `useSpinAsymmetry.test.ts`,
    `useReflectivity.test.ts`, `useMagNormalization.test.ts`,
    `useDemagCorrection.test.ts`, `useCurieWeiss.test.ts`); each fails on the
    old hook. **Reopen stays disabled with a reason** for all of them (spin
    asymmetry is multi-source; FFT thickness, the Units/Internal-field/
    Curie–Weiss tabs do not record their picks as reopenable settings yet).
    The BUG-020 list in `architecture.test.ts` moved these hooks (and
    `useReflectivity`) from "mint ids themselves" to "delegating", since the
    id is now minted in the store; the private-sequence check still covers
    them.
  - [ ] Remaining: reopen for multi-source batch tables, spin asymmetry and
    fit bands, and for the tools above once their settings are recorded; the
    other "add as dataset" writers outside the audit (Pawley, reflectivity
    FFT, ROI cuts, resample, hysteresis, the Magnetometry background
    subtraction) are not migrated.
- [ ] Selection semantics differ by tool: active dataset, plotted channels,
  selected worksheet columns, range ROI, excluded rows, and filtered rows are
  not presented through one understandable contract.
  - **First slice landed (lane SEL):** one resolver (`lib/analysisInputs.ts`)
    with a single precedence rule and an explicit row policy, plus one
    summary line (`AnalysisInputSummary`). Curve fit, Peaks, Distribution,
    Outlier screening and Signal Processing use it; the audit, design and
    what remains are in Workstream D, "D1".
- [ ] Batch and `By` support is inconsistent. Users cannot assume that an
  analysis that works once can be run over selected worksheets or factor
  levels with the same controls.
- [x] The Analyze menu is a launcher, not an analysis navigator. (Resolved by #764.) It does not
  show input requirements, compatibility with the current worksheet, recent
  analyses, or existing results.
  - **Navigator slice landed** (`lib/analysisRequirements.ts`,
    `lib/analysisNavigator.ts`; menu in `appMenuModel.ts`, palette in
    `CommandPalette.tsx`). Every metadata-described Analyze item is shown
    DISABLED with a one-line reason when the active worksheet does not fit
    ("Needs a numeric Y column", "Needs 2 or more worksheets", "Needs a 2θ X
    axis", ...); the menu and the palette read the same predicate
    (`withAnalysisRequirements`), so they cannot disagree. Analyze opens with
    "Recent analyses" (last 5, the Analysis Center's persisted `recent` list,
    now fed by every launch path) and "Open results (N)" for the active
    worksheet. The Analysis Center's own
    `compatibility()` is converged (lane C, 2026-11-21): the worksheet-count
    and 2θ checks now live in `lib/analysisExtraRequirements.ts`
    (`EXTRA_REQUIREMENTS`), read by both the menu/palette predicate and
    `analysisTools(actions, dataset, datasets)`, so Average curves, Pawley and
    XRD reference are unavailable in the Center for the same reason as in the
    menu (`lib/analysisCenterExtra.test.ts`).
  - **Audit (2026-11-19): input needs vs. batch / By support.** "Batch" = run
    over selected worksheets; "By" = per-level of a grouping column.

    | Tool | Needs | Batch | By |
    |------|-------|-------|----|
    | Curve fit | numeric Y, 3+ rows | yes | yes |
    | Surface fit | X,Y,Z or map | yes (summary) | yes |
    | Optical gap (Tauc) | numeric Y | yes (summary) | yes |
    | Ellipse fit | 2 numeric columns | yes (summary) | yes |
    | Hysteresis | numeric Y (magnetometry) | yes | no |
    | Magnetometry tools | numeric Y (magnetometry) | no | no |
    | Find peaks | numeric Y | yes (integrate windows) | yes |
    | Peak analyzer (wizard) | numeric Y | yes | yes |
    | Baseline | numeric Y | yes (estimate summary) | yes |
    | Reflectivity / Reflectometry view | numeric Y (refl/XRD) | no | no |
    | RSM, ROI cuts | 2-D map | ROI cuts only | no |
    | Williamson-Hall | any (typed peaks ok) | yes | no |
    | Pawley, XRD reference | 2θ X axis | no | no |
    | Film thickness FFT, Reflectivity FFT | numeric Y | no | no |
    | Signal Processing | numeric Y | yes (summary) + recipes | yes |
    | Average curves | 2+ worksheets | n/a (is the batch) | no |
    | SIMS | numeric Y (SIMS) | yes | no |
    | Distribution | numeric Y | no | yes |
    | Fit Y by X | X + Y | no | yes |
    | Multivariate, Variability, Outlier screening, Stats tests/chooser | 2+ numeric / factors / numeric Y | no | no |
    | Calculators, Digitizer | none | n/a | n/a |

    Gaps (recorded, not built): Batch is missing for Magnetometry tools, Pawley, XRD reference, both FFT tools,
    Reflectivity, and every statistics tool; By is missing everywhere except
    Curve fit, Distribution, Fit Y by X and (lane C, 2026-11-22) Find peaks,
    Peak analyzer, Baseline, Signal Processing and (lane C2) Surface fit,
    Optical gap and Ellipse fit. Signal Processing reaches
    batch only through Pipeline Studio recipes.
  - **By slice landed (#22, lane C):** one shared runner
    (`components/workshops/byrun/`: `useByLevelRun`, `ByLevelRunSection`,
    `levelPairs`) runs a tool's own computation once per level of a
    categorical column and shows one summary row per level (display-only; a
    failing level is an error row). Wired into Find peaks (peaks, strongest
    centre / SNR), Peak analyzer (recipe baseline + find; step 2), Baseline
    (baseline range, residual RMS; the hand-placed anchor method is refused
    with a reason) and Signal Processing (correction and spectral operations;
    the sigop filters and two-worksheet correlation say they are not
    available). Tests: `byrun/byLevelTools.test.tsx`.
  - **Batch slice: Baseline (#18/#19, lane C):** Baseline now carries Review
    inputs and the shared batch (`baseline/BaselineBatchSection.tsx`): the
    chosen method and settings are estimated on every selected worksheet's
    plotted channel and one result table (baseline min / max, residual RMS,
    per-input status) is recorded. Estimate-only; "Apply to N selected" still
    writes the subtracted worksheets. Anchor method refused with a reason.
    Tests: `baseline/BaselineBatchSection.test.tsx`.
  - **Batch slice: Signal Processing (#18/#19, lane C):** Review inputs plus
    the shared batch (`signalprocessing/SignalBatchSection.tsx`): the
    configured correction or spectral operation runs on every selected
    worksheet's own measured channels / rows / X range and one result table
    (rows out, finite outputs, mean of the first output) is recorded.
    Summary-only (Create new worksheet and the Library recipe apply still
    write outputs); sigop filters and two-worksheet correlation refuse with a
    reason. Tests: `signalprocessing/SignalScopeAndBy.test.tsx`.
  - **Batch + By slice: Surface fit, Optical gap, Ellipse fit (#18/#19/#22,
    lane C2):** each tool carries Review inputs plus the shared batch
    (`SurfaceFitBatchSection`, `OpticalGapBatchSection`,
    `EllipseFitBatchSection`) and a `*ByLevel` section over `byrun/`. A batch
    reads each worksheet's REVIEWED roles (X, then Y; Surface fit needs X plus
    exactly two channels, or a flagged 2-D map's own axes), honouring its row /
    range selection, via `analysisextras/batchColumns.ts`, not the panel's
    column pickers. Surface fit auto-guesses start values per worksheet / level
    (typed starts describe the active sheet) and takes the panel's model and
    bounds; Optical gap applies the panel's X unit, signal, transition and
    window (a worksheet whose X unit reads differently is flagged; transmittance
    without a thickness is refused); Ellipse fit applies the fit kind (under 5
    points fails with a reason). Summary-only: the Add-dataset buttons still
    write the active worksheet. Tests: `SurfaceFitBatchSection.test.tsx`,
    `OpticalGapBatchSection.test.tsx`, `EllipseFitBatchSection.test.tsx`,
    `byrun/byLevelExtras.test.tsx`. Deferred (item 3): By and batch for
    Multivariate, Variability, Outlier screening and Stats tests (factor /
    multi-column inputs need a per-tool decision on what a level or a
    worksheet means).
- [ ] Statistical engines are extensive but feel like separate utilities.
  Output tables and plots do not yet behave like a single expandable Origin/JMP
  result book.
  - **Audit (2026-11-22, lane RB): how each statistics tool presents results.**
    "Workspace" = the result workspace (`components/workshops/analysisresults`)
    a saved Library result opens in; "Book" = the result-book view added by RB.

    | Tool | In-tool panel | Saved snapshot: tables / figures | Workspace before RB | Report | Reopen | Book |
    |------|---------------|----------------------------------|---------------------|--------|--------|------|
    | Distribution | histogram + box strips, per-level sections, compare table; Save result, → Report | Summary, Histogram(s), Distribution fits, Fitted quantiles / histogram drafts | six tabs (Overview, Table, Figures, Diagnostics, Provenance, Notes); tables and figures on separate tabs | in-tool → Report; workspace "Send summary" = first table only | Edit / rerun… | **yes** |
    | Fit Y by X | bivariate / oneway / contingency views; Save result, → Report | mode summary + detail tables, Tukey, Test chooser, Fitted curve, Regression band / group, curve, contingency, interval drafts | same six tabs | same as Distribution | Edit / rerun… | **yes** |
    | Multivariate | correlation matrix, PCA, SPLOM tabs; Save result (no in-tool report) | r / p matrices, PCA summary, loadings, scaling, scores / scores + explained-variance drafts | same six tabs | workspace "Send summary" only | Edit / rerun… | **yes** |
    | Variability | variability chart + variance components; Save result, → Report | Nested ANOVA, Variance components, Cell and Factor A summaries / components + cell-mean drafts | same six tabs | same as Distribution | Edit / rerun… | **yes** |
    | Outlier screening | method controls + flagged rows; Save result | Flagged rows, Rosner sequence / flagged + Rosner drafts | same six tabs | workspace "Send summary" only | Edit / rerun… | **yes** |
    | Statistical tests | sentence + tables; Copy, Export CSV, → Report; every Run saves a result | test tables / none | same six tabs | in-tool and "Send summary" | Edit / rerun… | not yet |
    | Test chooser | recommendation list; → Report | no result of its own (Fit Y by X saves its recommendations as a table) | — | in-tool only | — | n/a |

    Shared already: snapshot save (`store/snapshotResultSave.ts`), the
    freshness authority (`snapshotResultState`), per-table Copy/Export and
    multi-output Freeze, frozen figure drafts (`lib/statisticalResultFigures`),
    the shared input line (`AnalysisInputSummary`). What was missing: one view
    reading a result top to bottom, a per-table report handoff (only the first
    table could be sent), and a per-table "open as worksheet".
  - **Design (lane RB).** A "Result book" tab in the existing result workspace
    (no new window; Overview stays the default tab). Pure model
    `lib/resultBook.ts` (one per-producer entry: method, settings, the columns
    the tool resolves); view `analysisresults/resultbook/`. Header: method,
    freshness badge and saved date, the inputs, the settings, the warnings,
    and Reopen in tool / Expand all / Collapse all. The input line is the
    shared `AnalysisInputSummary`, re-resolved from the source only while the
    result is current (same analysis-view fingerprint, so the same rows);
    otherwise the book prints the saved input and says why the saved values
    can no longer be verified (fail closed). Sections in one fixed order for
    every producer: the saved tables in saved order, then the figures in
    draft order; the first section opens expanded. Table sections: Copy
    table, Send to report (that table, titled "result · table"; current
    results only), Open as worksheet (freezes that table into an
    independent worksheet and shows it; disabled with the Freeze reason for
    a table that cannot become one). Figure sections: Create editable figure
    (the existing frozen-draft path; send the figure to a report from its
    window). Every action sits in the section header, so it works collapsed.
    The recipe is parsed without the live source, so a source that lost a
    column still shows its (out-of-date) book; an unparsable recipe shows no
    book tab.
  - **First slice done (lane RB):** Distribution, Fit Y by X, Multivariate,
    Variability and Outlier screening. Remaining: Statistical tests (no
    figure drafts; one entry in `lib/resultBook.ts` once its method/settings
    line is designed), Williamson–Hall and analysis batches; a direct
    "send figure section to report" (today via the created figure); an
    option to make the book the default tab (owner decision).
- [ ] There is no shared "preview -> commit derived output -> rerun/edit"
  workbench shell, so each new analysis can accidentally invent different
  behavior for errors, cancellation, provenance, and stale inputs.
  Progress (lane RL): the commit half exists (`useAnalysisCommit` +
  `commitAnalysisOutput`, see the audit above); preview/cancel and rerun/edit
  are not yet part of it.

## Product contract for every new analysis

Each analysis added or modernized under this roadmap must satisfy these rules.

- [ ] Raw imported data is never overwritten. Commit creates a linked derived
  worksheet, durable result artifact, or explicit frozen copy.
- [ ] The input dataset, X/Y/error channels, included rows, selected range,
  units, parameters, and algorithm version are recorded.
- [ ] Preview is visibly provisional and Cancel leaves no scientific state.
- [ ] Commit is one undo step and repeated clicks cannot create duplicates.
  Progress (lanes RL, RL2, RL4): every plain-worksheet tool in the audit
  above now commits through the shared contract (Reflectivity model/SLD with a
  duplicate guard only); writers outside the audit are not migrated, so this
  stays open.
- [ ] A result can be reopened, inspected, duplicated, renamed, deleted, and
  sent to a figure or report.
- [ ] A changed input marks the result stale; automatic recalculation occurs
  only when the project's recalculation mode permits it.
  Progress (lane RL): committed outputs now join the recalc graph (stale in
  Auto/Manual, nothing in None, never auto-recomputed); every tool in the
  audit with a source worksheet now joins it (lane RL4); writers outside the
  audit keep this open.
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
- [x] Cross-correlation between two channels or two compatible worksheets,
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
- [x] Cross-correlation supports either two columns in one worksheet or one
  column from each of two compatible worksheets, with peak lag/correlation.
  The second worksheet is an explicit persisted dependency: edits to either
  source mark the output stale, save/reopen and pipeline replay retain the
  relationship, and missing or changed inputs fail visibly. Different grids
  are refused unless the user explicitly enables overlap-only resampling at
  the coarser spacing.
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

- [x] A PANalytical XRD scan from the private corpus: PSD completed, emitted
  `Frequency (1/deg)`, and retained the source bytes.
- [x] A SIMS depth profile from the private corpus: two-channel correlation completed
  with explicit irregular-grid resampling; peak lag was reported in nm; source
  bytes remained unchanged.
- [x] A polarized neutron reflectometry curve from the private corpus: low-pass
  filtering completed with explicit resampling, preserved `Qz (1/Ang)`, and
  produced a transfer diagnostic without mutating source bytes.
- [x] A VSM hysteresis loop from the private corpus: FFT with Resample was
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
- [x] Cross-worksheet correlation uses Workstream D's multi-source dependency
  contract. Both inputs remain explicit through result freshness, pipeline
  replay, linked recalculation, workbook transfer, and project persistence;
  missing or incompatible sources fail closed.

## Workstream B — Durable analysis result artifacts

**Priority:** P0 after A1/A2 establish the reusable shell

**Goal:** make an analysis result a first-class Library object instead of
temporary contents of a floating window.

- [x] Define one versioned `AnalysisResult` envelope: identity, producer,
  source references, selection snapshot, parameters, scalar values, tables,
  optional plot bindings, warnings, timestamps, and stale state.
- [x] Add an Analysis Results section under the appropriate workbook/folder.
- [x] Open a result into a result workspace with Overview, Tables, Diagnostics,
  Figures, Provenance, and Notes tabs as applicable.
- [x] Add Recalculate, Rerun as new, Duplicate, Freeze, Send to report, Build
  figure, Export tables, Rename, and Delete actions.
- [x] Add producer-aware Edit and rerun without creating a second settings
  authority beside the linked worksheet.
- [x] Migrate curve fits, statistics, peak outputs, and signal-processing
  results incrementally; do not create a second authority beside existing
  durable `fitSpec`, peak tables, or reflectivity-fit history.
- [x] Preserve old `.dwk` files and tolerate unknown future result kinds.

Implementation status (2026-10-08):

- [x] Added a versioned, future-producer-tolerant result envelope. Signal
  results reference the linked worksheet's established `analysisRecipe`
  authority instead of copying parameters or scientific arrays. Current/
  stale/missing state is derived from the live dependency graph so a second
  persisted stale flag cannot disagree with the actual worksheet.
- [x] Added Analysis Result nodes to the canonical Library hierarchy, located
  under the source/output workbook with Tree, Tiles, Details, filters,
  selection, rename, context-menu, and missing-source behavior shared with
  other artifacts.

Update (2026-10-09):

- [x] Signal results recalculate their linked output or rerun as a new result;
  fitted peak results reopen the existing peak authority for Edit / Re-fit;
  curve-fit results reopen the saved recipe or recalculate that one fit.
- [x] Migrated source-owned fitted peak tables and curve fits without copying
  scientific arrays into result envelopes. Both use durable references to the
  source worksheet authority, survive project save/reopen, display stale and
  missing-source states, and preserve a user's result name/notes across re-fit.
- [x] Curve-fit results provide diagnostics, provenance, a parameter and
  uncertainty table, CSV export, regenerated fitted-curve plotting, editable
  source-figure launch, and Send to report. Recalculation replays recorded
  channels, weighting, starting values, bounds, fixed parameters, and row-gap
  policy as one undoable action.
- [x] Migrated reflectivity-fit history as one Library result per saved fit.
  Results keep the existing `Dataset.reflFits` record as their only scientific
  authority, expose live overview/parameter/provenance views, diagnose changed
  or missing channels, and reopen the exact historical fit in the workbench.
  Publication and undo are atomic; old projects migrate once; deleted catalog
  entries stay deleted; bounded-history eviction removes only the matching
  result; Append Project remaps both envelopes and raw fit-record channels.
- [x] Statistics completes the incremental migration checkbox above through
  durable Statistical Tests, Distribution, Outlier Screening, Multivariate,
  Fit Y by X, and Variability results.
- [x] Statistical Tests workshop runs now publish one durable, undoable result
  containing the exact saved question, interpretation, and bounded tables.
  Results survive save/reopen, detect numeric, row-scope, categorical-label,
  level-order, and modeling-type changes, reopen a compatible question for
  editing/rerun, and support duplicate, CSV export, and report handoff.
- [x] Distribution now publishes explicit, undoable Library snapshots with
  descriptive statistics, validated histogram bins, normality, per-level By
  summaries, fit comparison and quantiles, exact control reopening, source
  freshness, bounded persistence, CSV/report actions, and save/reopen support.
  Reports and saves fail closed if their source or workbench question changes;
  repeated actions do not create duplicate artifacts.
- [x] Outlier Screening now saves compact, undoable Library snapshots with
  exact method settings, flagged source rows, method-specific statistics,
  freshness checks, and a reopen path. The snapshot explicitly records that
  screening never excludes or deletes data and discloses non-finite rows
  omitted by the calculation.
- [x] Multivariate now publishes explicit, undoable Library snapshots with
  the exact selected columns, correlation method, PCA standardization and
  displayed component axes. Saved output includes correlation coefficients
  and p-values plus PCA summaries, loadings, centering/scaling, and bounded
  score rows tied back to original worksheet row numbers. The adapter rejects
  stale or structurally mismatched async responses, follows filtered/excluded
  source freshness, discloses listwise deletion and truncation, and reopens
  the exact workbench question. PCA scores are intentionally retained as
  useful derived observations; together with loadings and scaling they can
  reconstruct the selected numeric inputs, so this result is bounded for
  responsiveness rather than intended as privacy-minimized output. Workstream
  E remains the later unified statistical workspace rather than a prerequisite
  for preserving these focused-workbench results.
- [x] Fit Y by X now saves explicit, undoable Library snapshots for oneway,
  bivariate, and contingency analyses, including bounded By-level output,
  assumption/subtest warnings, Tukey comparisons, fitted points and bands,
  contingency cells, and the exact controls needed to reopen the workbench.
  Source fingerprints prevent stale values from being reported as current;
  malformed detail geometry is diagnosed instead of silently truncated.
- [x] Variability now saves an explicit, undoable Library snapshot containing
  labeled nested-ANOVA, variance-component, cell-summary, and factor-summary
  tables without copying raw observations. It preserves legitimate
  non-estimable results and clamping/unbalanced-design disclosures, reopens
  the exact response and nested-factor columns, follows filtered/excluded
  analysis-view freshness, bounds oversized tables with an explicit warning,
  and prevents duplicate saves until the analysis view changes or Undo removes
  the saved result.
- [x] Added a lazy result workspace with Overview, Tables, Figures, Diagnostics,
  Provenance, and Notes views. The first 100 output rows are inspectable
  without creating an unbounded DOM table; the complete worksheet remains
  one click away. Tabs support standard arrow/Home/End keyboard navigation.
- [x] Added Signal result actions for Open worksheet, Recalculate in place,
  Rerun as new, Rename, Notes, and Delete result. Delete deliberately keeps
  the linked worksheet/data; rerun deliberately creates a new result.
- [x] Added the common result-output actions: a recorded-binding Figures view,
  editable-figure launch seeded from the recorded series, Send to report,
  safe full-table CSV export, linked-output Duplicate, and single-output
  Freeze to an independent worksheet. Lazy-load failure and mid-load result
  changes fail closed; repeated-click guards prevent duplicate side effects.
- [x] Multi-output Freeze: per-producer output adapters (data table in `lib/analysisResultFreezeOutputs.ts`) feed an explicit chooser (nothing preselected, one undo step, fail-closed on mid-choice change); single-output keeps one-click Freeze; peak/curve-fit/reflectivity own no result-level output and show "not available".
- [x] Producer-aware
  Edit/Re-fit is present for peaks, curve fits, and reflectivity fits;
  Recalculate/Rerun as new cover Signal and exact curve-fit replay.
- [x] New signal operations create a result in the same undo gesture as their
  linked worksheet. Legacy `.dwk` files with linked signal worksheets migrate
  deterministic records exactly once; an explicitly saved empty result list
  remains empty; unknown producer ids and missing references remain
  inspectable rather than being discarded.
- [x] Result edits participate in undo/redo, dirty-state detection, debounced
  autosave, explicit save/reopen, Remove All/open-replacement protection, and
  the Library's exhaustive icon/accessibility contracts.
- [x] The focused-statistics migration is complete: Statistical Tests,
  Distribution, Fit Y by X, Variability, Outlier Screening, and Multivariate
  all publish durable results. Signal processing, peak tables, curve fits,
  and reflectivity-fit history are also migrated.

## Workstream C — Analysis Center and discoverability

**Priority:** P1

**Goal:** answer "what can I do with this data?" without requiring knowledge of
menu names.

- [x] Add a searchable full-stage Analysis Center reachable from Analyze and
  the Workflow view.
- [x] Organize tools by Fit, Peaks/Baseline, Signal Processing, Statistics,
  XRD/Reflectivity, Magnetometry, SIMS, and Data Preparation.
- [x] For each tool show a one-sentence purpose, required inputs, compatibility
  with the active worksheet, and why it is unavailable.
- [x] Show Recommended for this data, Recent, Favorites, All tools, and Existing
  results without auto-running or making scientific guesses.
- [x] Seed a tool with the current dataset, plotted channels, selected rows, and
  range when compatible.
- [x] Keep command-palette and menu actions canonical; the Center launches the
  same implementations rather than duplicating them.

## Workstream D — Shared selection, batch, and `By` behavior

**Priority:** P1

- [x] Define a versioned `AnalysisSelection` contract for dataset(s), X/Y/error
  roles, analysis-row ids, factor/By roles, and optional ranges/ROIs.
- [x] Let plot-range, worksheet-column, Library multi-selection, and factor
  grouping create that same contract.
- [x] Add a standard Review inputs panel to every migrated workbench.
- [x] Add Run by factor level and Run over selected worksheets where the
  algorithm supports it; show a preflight matrix before a batch begins.
- [x] Produce one navigable batch result with per-input status, warnings,
  comparable summary columns, and a clear partial-cancellation state.

### D1. One input-selection contract (audit 2026-11-22, lane SEL)

How each tool resolved its inputs before this slice (✱ = migrated here):

| Tool | Dataset | X / Y / error | Range / ROI | Excluded + filtered rows | Selected rows | What the user saw |
|---|---|---|---|---|---|---|
| Curve fit ✱ | `AnalysisSelection` item, else active; a deleted handoff worksheet silently fell back to the active one | item roles (plot X/Y/errors), editable in Review inputs | fit range / integral / selected-row range narrows | dropped | narrow | "Analysing: name — Y vs X" + card |
| Peaks ✱ | same as Curve fit (same fallback) | item roles | narrows | dropped | narrow | same card |
| Hysteresis, batch sections (Baseline, Optical gap, Ellipse, Surface fit, W–H, Signal batch) | `AnalysisSelection` | item roles | narrows (batch) | dropped (`analysisSelectionData`) | narrow | same card |
| Signal Processing ✱ | active worksheet | X = time axis; own signal-column checkboxes | none | **kept** (full worksheet) | ignored | "Source: name · X" + a separate "Scope: N rows (… excluded)" note |
| Distribution ✱ | active worksheet | own column pick (default first column) | ignored | dropped | ignored (it writes them by brushing) | nothing; a lazy Origin preview was profiled |
| Outlier screening ✱ | active worksheet | own pick (first continuous) | ignored | dropped | ignored (it writes them) | nothing; a lazy Origin preview was screened |
| Fit Y by X ✱ | active worksheet | own X/Y picks | ignored | dropped | ignored | nothing; preview computed, report waits for the full load |
| Multivariate ✱, Variability ✱, Stats tests ✱, Stats chooser ✱ | active worksheet | own picks | ignored | dropped (`analysisView`/`analysisData`) | ignored | nothing |

**Design.** `resolveAnalysisInputs(request)` returns inputs or a refusal.
One precedence rule: *dataset* = the tool's selection item (a handoff, or the
live plot capture) else the active worksheet, and a handoff naming a deleted
worksheet refuses instead of swapping (`analysisTargetDataset`, also used by
the Curve fit and Peaks hooks); *columns* = an explicit in-tool pick, else the
item's roles; *rows* = the row policy's base, then narrowed. The row policy
is explicit per tool (`ROW_POLICY.analysisView` / `.selection` /
`.fullWorksheet`) and is printed in full under the summary, so tools that
disagree keep their behaviour and say so ("Uses every row, including 2
excluded or filtered-out rows" for Signal Processing; "Excluded and
filtered-out rows are left out (1 excluded row, …). Selected rows are not
used. The plot X range is not applied." for the statistics tools). It fails
closed on no worksheet, a deleted worksheet or column, no response column,
an explicitly empty row selection, zero remaining rows, and a lazy Origin
preview (the hook requests the full load, so the refusal clears itself).
Summary line: `Input: <sheet> · X: … · Y: … · N of M rows · X lo–hi`.

**Behaviour changes (bugs, not defaults):** Distribution and Outlier screening
no longer compute on a lazy Origin preview; Curve fit and Peaks no longer
analyse the active worksheet when an Analysis Center/worksheet handoff names
a worksheet that was deleted. Every default selection is otherwise unchanged
(characterization: `inputContract.characterization.test.tsx`). Signal
Processing's batch section states its own, different policy ("Input for batch
runs": exclusions left out) rather than being converged.

**Slice 2 (lane SEL2).** Fit Y by X, Multivariate, Variability, Statistical
tests and the Test chooser now take their data from `resolveAnalysisInputs`
(policy `ROW_POLICY.analysisView`, picks passed as `xKey`/`yKeys`; defaults and
row policy unchanged, pinned first by
`inputContract.statistics.characterization.test.tsx`) and show
`AnalysisInputSummary`. Behaviour changes: none of the five computes on a lazy
Origin preview any more (the hook requests the full load; Fit Y by X's leg and
By partition run when the real rows land). Fit Y by X keeps its queued
report-after-load and the Test chooser's "Which test?" stays enabled on a
pending preview so it still queues (both tested). Statistical tests keeps its
on-demand Run through `withResolved` and resolves the contract on the loaded
worksheet inside it, so a refusal shows as the run error. A failed lazy load
is now its own refusal, `load-failed`, with the recorded reason
(`lib/bookData.lastBookError`), for every tool on `useAnalysisInputs`.
Curve fit's custom-equation mode (`useEquationFit`) now shares the Curve fit
dataset precedence, roles, selected rows and X range (fail-before tests in
`useEquationFit.handoff.test.ts`).

- [x] Fit Y by X, Multivariate, Variability, Stats tests/chooser onto the
  resolver and summary; lazy Origin previews refuse; failed lazy loads refuse
  distinctly.
- [x] Curve fit custom-equation mode reads the handoff like the other modes.
**Slice 3 (lane SEL3).**
- The summary line omits "X:" for a tool that declares it has none
  (`noX` on the request / `useAnalysisInputs`): Multivariate, Variability,
  Statistical tests, the Test chooser, Distribution and Outlier screening.
  Fit Y by X, Optical gap, Baseline and the rest keep it.
- Signal Processing has a "Use excluded/filtered rows" option. Default ON is
  the old full-worksheet single run (unchanged); OFF runs the single run on
  `ROW_POLICY.analysisView`, and the summary line and policy note follow. The
  choice is recorded in the signal recipe (`inputRows: "analysis-view"`,
  absent = every row), which is also its persistence: it is part of the preview
  key (a preview of the other choice cannot be committed), the commit, a saved
  Recipe Library recipe, Pipeline/macro replay (`computeSignalTransform`) and
  recompute of linked worksheets (correction and spectral), so old recipes and
  projects replay unchanged. Cross-worksheet correlation applies the choice to
  both inputs. The batch and By paths keep their own policy (exclusions left
  out) and do not record the option.
- Baseline and Optical gap show the shared summary. Baseline states its
  existing full-worksheet policy (its data path already resolved the full data
  first, so it never ran on a preview). Optical gap, Surface fit and Ellipse fit
  load their columns through the resolver (`useLoadColumns`, analysis view as
  before); a refusal (no rows left, deleted column) now rejects with its
  reason. Surface fit and Ellipse fit do not show the summary line yet.
- Hysteresis's single run already reads the analysis view narrowed by the
  reviewed selection (`selectedFitData`), and its Review inputs header is the
  resolver's summary. The magnetometry tools (Background, Units, Internal
  field, Curie-Weiss) show the summary over their unchanged data paths:
  Background/Units/Internal field convert every worksheet row (outputs are
  row-aligned with the source) and say so; Curie-Weiss fits the analysis view.
  Characterization first: `inputContract.general.characterization.test.tsx`.

- [x] Summary omits X for tools with no X; Signal Processing "Use
  excluded/filtered rows"; Baseline, Optical gap, magtools summary; Optical gap
  / Surface fit / Ellipse fit loads on the resolver.
- [ ] Remaining: the Analysis Center "Review inputs" for the own-pick
  statistics tools; the magtools, Hysteresis, Baseline data paths still call
  `magXY` / `selectedFitData` / `baselineInput` rather than `resolved.data`
  (their rows are the stated policy, verified by tests, but not one code path);
  Surface fit / Ellipse fit / Peak wizard / Tabulate / Pie / Ternary summaries;
  a linked Signal output is not marked Out of date when only the source's
  exclusions change while its recipe uses the analysis view (it follows data
  edits, as before); the Fit Y by X/Stats chooser queue paths still use
  `resolveDataset` beside the hook's `ensureBookData`.

## Workstream E — Statistical result workspace

**Priority:** P1/P2; build on Workstream B

- [x] Combine Distribution, Fit Y by X, Test Chooser, Statistical Tests,
  Multivariate, Variability, and Outlier Screening into one expandable result
  workspace while retaining focused launch shortcuts.
- [x] Standardize effect sizes, confidence intervals, assumption checks,
  multiple-comparison adjustment, missing-data policy, and plain-language
  interpretation. The common result overview now indexes the evidence saved by
  every statistical producer under the same five headings and explicitly says
  when a producer did not record an item; absence is never presented as a
  passed assumption.
- [x] Add linked result tables/plots whose row and group selections highlight
  the source worksheet and plot.
  - [x] Exact saved source rows plus Distribution, Fit Y by X, and Variability
    aggregate rows can highlight their originating worksheet rows. The action
    is disabled when the saved result is stale, pending, or missing its source.
  - [x] Carry that linked selection into result figures and plot-side brushing.
    Frozen saved-result figures now render from their own snapshot when focused
    or in the background, so they remain visible if the source is missing.
    Histogram bins, grouped summaries, contingency bars, variability cells,
    PCA scores, and outlier rows map a brush to the exact current analysis
    rows; synthetic fitted curves and interval bands map to the full observation
    group that produced them rather than pretending their generated grid points
    are raw observations. The same worksheet selection is highlighted in source
    and result plots. Missing, pending, changed, legacy, or malformed sources
    disable only the live link—the frozen figure remains editable and exportable.
    The source row mapping is rebuilt from current worksheet state and its
    fingerprint rechecked when a brush commits, closing both value-edit and
    duplicate-row exclusion races between pointer-down and pointer-up.
    Literal `All` and blank factor labels remain distinct real groups; missing
    or invalid grouping metadata disables the link instead of guessing.
- [x] Make every saved statistical table directly copyable and exportable,
  individually or as a complete result.
- [x] Make saved statistical figures open as normal editable Quantized figures.
  Distribution histograms, Fit Y by X group summaries/fitted curves/contingency
  counts/regression intervals, PCA scores/explained variance, Variability components/cell means, and
  Outlier flagged observations/Rosner sequences now materialize as ordinary
  reopenable FigureDocuments. Each uses a frozen copy of the bounded saved
  result table (never silently recomputed source values), records result/draft
  provenance in figure metadata, survives a missing source worksheet, and
  supports the normal figure editing/export lifecycle. Error-bar figures keep
  SD columns bound as uncertainty rather than displaying them as data series.
- [ ] Defer clustering, control charts/capability, Gauge R&R, and DOE until the
  owner confirms actual use; these remain the existing JMP census-gated items.

## Workstream F — Technique-specific expansion

**Priority:** P2, driven by real-data sessions

- [ ] XRD: phase/reference overlays, better search/match handoff, crystallite
  analysis history, and batch comparison after the current peak/Pawley tools.
  - [x] First reference-overlay slice: a completed Pawley refinement can add
    its calculated in-range reflection positions to the current plot as
    deduplicated vertical reference lines in one undoable action.
  - [x] Second reference-overlay slice: import a bounded trusted CSV/TSV/XY/
    text 2θ/intensity pattern, preview/exclude/relabel its reflections, convert
    positions between recorded source and active-data wavelengths, and add one
    undoable grouped stick pattern. Relative heights, plot-frame offset,
    labels, colour and visibility persist in projects/editable figures and
    render equivalently on screen and in publication export. The Inspector
    styles/removes the group without mounting thousands of per-stick rows.
    Unknown labeled axes fail closed unless the user explicitly overrides
    them. External phase-library search/match remains.
  - [x] Crystallite-history slice: Williamson–Hall fits can be saved as
    durable Library results with the exact included 2θ/FWHM rows, wavelength,
    K factor, instrumental broadening, peak-table binding, transformed fit
    table, diagnostics, and source/peak freshness checks. Saved results reopen
    their exact controls, export/copy/report through the common result
    workspace, and create an ordinary editable observed-plus-fit figure.
  - [x] Added selected-worksheet crystallite batch comparison with per-source
    peak-table/wavelength preflight, bounded sequential execution, cancellation,
    per-input status and warnings, exact provenance, peak-table freshness, and
    editable crystallite-size/microstrain/R² comparison figures. The
    single-peak Scherrer calculator intentionally remains a separate model and
    calculator-history concern: it estimates size from one reflection and must
    not be presented as interchangeable with a multi-peak Williamson–Hall fit.
    External phase-library search/match also remains intentionally separate.
- [ ] Reflectometry: parameter-correlation and posterior-diagnostic workspace,
  linked fit families, and constrained batch series.
  - [x] First posterior-diagnostic slice: retain the backend's exact free-
    parameter order with each DREAM summary, validate the saved square
    correlation matrix, and expose a labeled diverging heatmap plus ranked
    strong parameter trade-offs. The full matrix can be copied or exported as
    a publication heatmap; oversized matrices keep those complete outputs but
    do not mount an unusable quadratic inline grid. Older valid summaries infer
    free labels from untied parameters, while ambiguous matrices fail closed.
  - [ ] Add linked fit families and constrained batch-series comparison after
    representative owner datasets establish the required sharing constraints.
- [ ] Magnetometry: unit-aware sample geometry normalization, temperature/field
  series comparison, and derived magnetic quantities.
  - [x] First normalization slice: mass, direct volume, rectangular-film,
    direct-area-film, and circular-film inputs accept independent laboratory
    units; the UI previews canonical volume, blocks incomplete normalized
    conversions, supports emu/g, emu/cm³, A/m, and kA/m, and records the entered
    geometry plus canonical divisor on the derived worksheet without changing
    the source.
  - [x] First series-comparison slice: Hysteresis consumes the shared reviewed
    multi-worksheet selection, resolves lazy Origin worksheets before running,
    and saves one durable status table containing Hc, Mr, Ms, squareness, loop
    area, SFD peak, per-row units, warnings, gaps, partial failures, and
    cancellation state. Every selected X axis must be explicitly identifiable
    as magnetic field; M(T), conflicting, and unlabeled axes fail closed rather
    than being interpreted as loops. The focused single-loop view and its
    background subtraction now enforce the same field-axis rule.
  - [x] Promote a reviewed comparison table into editable trend figures once a
    series variable (temperature, field, angle, thickness, or user-selected
    metadata) is explicit. Never infer the independent variable from a filename
    without confirmation, and never plot mixed field/moment units on one scale
    until the user converts them. Hysteresis comparison now offers table-only,
    numeric-metadata, and manual series-axis modes; records the exact axis and
    per-dataset values; offers nearly constant scientific companion columns
    such as Temperature while hiding parser bookkeeping; blocks incomplete or
    mixed-unit axes; and
    creates frozen editable Hc/SFD, Mr/Ms, squareness, and loop-area trends from
    completed saved rows, split into separate figures by result unit.
  - [ ] Add the remaining derived magnetic quantities with unit-aware
    provenance and uncertainty propagation; do not duplicate calculations that
    already belong to the normalization or hysteresis authorities.
    - [x] Internal-field slice: create a non-destructive derived M(H) worksheet
      using an explicit named sample geometry/orientation and
      `H_internal = H_applied - N M`. The calculation converts through SI,
      accepts only declared field axes and volume-normalized magnetization,
      stores both SI N and CGS 4πN provenance, preserves acquisition order and
      gaps, and propagates committed magnetization uncertainty onto the field
      axis (including the correct reversal of asymmetric ± directions). It
      refuses existing applied-field uncertainty rather than understating it,
      and prevents a derived internal-field worksheet from being corrected a
      second time. Geometry-factor uncertainty remains explicitly excluded.
    - [x] Loaded Curie–Weiss slice: fit an explicitly molar χ(T) response or
      derive molar susceptibility from total moment / mass-normalized moment
      only when the required applied-field column, sample mass, and molar mass
      are supplied. The fit range is visible and editable, defaults to the
      high-temperature regime, honors worksheet exclusions/filters, and never
      falls back silently to a different range. It creates a separate editable
      1/χ-plus-fit worksheet with source-row provenance, fit statistics, and
      propagated committed response uncertainty (including asymmetric-side
      reversal). Non-K temperature, unsupported units, field uncertainty,
      stale inputs, and incomplete sample context fail closed; ordinary least
      squares and exact sample quantities are disclosed rather than hidden.
    - [x] M(H)-isotherm slice (backend/API only; UI is a follow-up): Maxwell
      magnetic-entropy change + RCP (`POST /api/magnetic/entropy-change`,
      `calc/magnetic_entropy.py`), Arrott/Arrott-Noakes lines with Tc from the
      intercept sign change (`/arrott`, `calc/magnetic_critical.py`), and
      law-of-approach-to-saturation Ms/a/b/chi_hf/K1 with standard errors
      (`/approach-to-saturation`, `calc/magnetic_saturation.py`). Unit-aware
      via `calc/magnetic_isotherms.py` (Oe/T/mT/A/m/kA/m; normalized M only,
      fail-closed otherwise). M-uncertainty propagation into dS and Arrott Tc
      is not done, so the parent item stays open.
- [ ] SIMS: multi-profile alignment, interfaces/junction comparison, and batch
  region tables.
- [ ] Spectroscopy: peak-family presets, component area/ratio tables, and batch
  recipe review.
- [ ] Add only against representative owner data and trusted expected results.

## Recommended implementation sequence

1. [x] A1 + A2: Signal Processing workbench using existing processing code.
2. [x] A3: expose the spectral/filter/correlation engines, including explicit
   cross-worksheet correlation on Workstream D's multi-source contract.
3. [x] A4: pipeline replay, persistence, and real-corpus qualification.
4. [x] B: migrate statistics. The envelope, Library integration, common
   actions, all focused-statistics producers, signal migration, fitted peaks,
   curve-fit results, and reflectivity-fit history are complete.
5. [x] C: build the Analysis Center on canonical commands and result inventory.
6. [x] D: unify selection and batch behavior, then migrate curve fit/peaks.
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
| 2026-11-22 | Project team | Lane RB: audited how the statistics tools present results and added the Result book tab to the result workspace (`lib/resultBook.ts`, `analysisresults/resultbook/`) for Distribution, Fit Y by X, Multivariate, Variability and Outlier screening: one header (shared input line while current, method, settings, freshness), collapsible table and figure sections in one order, per-section Copy, Send to report and Open as worksheet, and Reopen in tool. | Characterization tests of the existing tabs (written first) still pass; book tests cover section order, collapse state, each action, a stale result and each migrated tool; `sendAnalysisInlineTableToReport(id, tableIndex)` store test; tsc, lint, build (bundle OK). |
| 2026-11-22 | Project team | Lane SEL: audited how analysis tools resolve inputs (Workstream D, D1) and added one resolver + summary (`lib/analysisInputs.ts`, `AnalysisInputSummary`) with a single precedence rule and an explicit exclusion/filter/selection policy. Curve fit, Peaks, Distribution, Outlier screening and Signal Processing migrated (slice 2 adds Fit Y by X, Multivariate, Variability, Stats tests and the chooser); lazy Origin previews and deleted handoff worksheets now refuse. | Characterization tests before migration; resolver unit tests (precedence, stale/deleted ids, lazy Origin refusal, empty selections, each row policy); component tests for the summary and the migrated panels; forced tsc, lint, touched-area vitest, architecture test and bundle gate. |
| 2026-11-22 | Project team | Lane SEL2: moved Fit Y by X, Multivariate, Variability, Stats tests and the Stats chooser onto the resolver and summary; added the distinct `load-failed` refusal for a failed lazy Origin load; Curve fit's custom-equation mode now reads the handoff like the other modes. | Characterization tests before migration; Fit Y by X queued-report and By-partition tests; summary/refusal tests for all five panels; fail-before tests for the equation-mode fix; forced tsc, lint, touched-area vitest, architecture test and bundle gate. |
| 2026-10-15 | Project team | Added a loaded-data Curie–Weiss workflow to the Magnetometry workshop. It accepts declared molar susceptibility or converts a real M(T) sweep from total moment / emu per gram using the dataset's explicit field column plus entered sample and molar mass. It writes a normal inverse-susceptibility worksheet with an in-range fit line, exact source-row and sample-context provenance, visible θ/C/μeff/R²/n, and propagated confirmed response errors. The adversarial pass added absolute-K enforcement, filtered/excluded-row alignment, parameter/row-state/source race refusal, asymmetric inverse-error direction and label reversal, explicit unweighted/exact-input disclosures, bounded large-array range selection, and a minimum-three-row high-temperature default. | Pure calculation and route checks cover total and mass-normalized moment, T/Oe conversion, uncertainty, zero field, non-positive χ, explicit fit-range refusal, JSON-safe gaps, and missing context. Focused frontend checks cover unit/axis qualification, field selection, derived output/provenance, exclusions, missing errors, stale source and stale-control changes. Forced TypeScript, full ESLint/Ruff/mypy, clean production build, architecture and full-suite CI remain the PR gate. The private Quantum Design `mpms_mvst.dat` imported as 300 M(T) rows with its real Temperature, DC Moment, DC Moment Error, and 999.9075 Oe field; a 180.63–299.90 K fit used 120 positive rows (R² 0.99996) without modifying the source file. |
| 2026-10-15 | Project team | Added the first derived-magnetic-quantity slice: a loaded M(H) dataset can produce a separate internal-field worksheet for an explicit sphere, in-plane/out-of-plane thin film, or axial/transverse long cylinder. The transform requires volumetric magnetization, uses SI internally while reproducing the CGS 4πN form, records exact geometry/factors/formula/units, carries confirmed Y uncertainty and creates matching X uncertainty, and leaves the source untouched. Unsupported axes/units, existing field uncertainty, and repeat correction fail closed. | Pure-calculation and route coverage checks SI/CGS equivalence, invalid factors/units/shapes, propagated errors, and OpenAPI freshness. Focused UI coverage checks prerequisites, provenance, gaps, exact error-role remapping, asymmetric-side reversal, double-correction refusal, and stale async source replacement. The reviewed backend gate passes 82 tests with one expected corpus skip plus Ruff/mypy; frontend architecture passes 56/56, forced TypeScript/full ESLint pass, and production build/preload verification pass at 817.1/817.9 kB eager. A private Quantum Design M(H) loop (401 points, non-monotonic acquisition order) was parsed and transformed row-for-row without mutating its source arrays. CI remains the complete-suite PR gate. |
| 2026-11-19 | Project team | Added multi-output Freeze to the result workspace: per-producer output adapters, an explicit chooser, and one-undo independent worksheets. | Adapter, chooser, fail-closed, double-click and single-output tests pass; build and eager-bundle gate unchanged. |
| 2026-10-15 | Project team | Completed the first magnetometry comparison-to-figure slice. Hysteresis batch analysis can now record an explicit numeric sweep variable from reviewed metadata, a nearly constant scientific companion column, or manual values. It never infers a value from a filename, excludes parser bookkeeping, requires at least two finite values, and refuses mixed declared axis units until the user explicitly converts them. The durable batch result stores the exact per-worksheet values and promotes completed Hc/SFD, Mr/Ms, squareness, and loop-area summaries into ordinary frozen editable figures; incompatible result units are split onto separate scales. | Focused hysteresis, batch, result-figure, freshness, and architecture checks pass 170/170; forced TypeScript, full ESLint, preload verification, production build, and the unchanged 817.9 kB eager-bundle gate pass at 817.1 kB. The adversarial pass removed array-sized candidate-scan allocations, bounded candidate presentation, hid internal parser coordinates, guarded colliding unit-derived figure keys, made shared selection provenance authoritative over tool parameters, and required an exact saved series axis before any figure is offered. Representative Quantum Design M(H) imports exposed and verified the constant Temperature-companion path without changing source data. CI remains the complete-suite PR gate. |
| 2026-10-15 | ChatGPT-Sol (Codex) | Added the first reflectometry posterior-diagnostic slice. DREAM summaries now preserve the backend's exact free-parameter ordering instead of leaving the stored correlation matrix unlabeled. Finished fits expose a collapsible diverging heatmap, ranked |r| ≥ 0.7 parameter trade-offs with a model-identifiability explanation, full-matrix clipboard copy, and publication heatmap export. Inline rendering is bounded at 30 parameters while Copy/Export retain the complete validated matrix. Legacy summaries infer labels only from untied sampled parameters; malformed, duplicate, non-square, asymmetric, out-of-range, or non-unit-diagonal matrices fail closed, and one-parameter fits explain why no pairwise diagnostic exists. | Focused posterior persistence, decoder, diagnostic, component, and full DREAM-hook tests pass 25/25. The adversarial pass added strict legacy/corrupt label discrimination, symmetry/diagonal validation, bounded quadratic rendering, and a synchronous repeated-export guard. Forced TypeScript, full ESLint, 56/56 architecture ratchets, preload verification, and the 817.0/817.9 kB eager-bundle gate pass; the UI remains in the lazy Reflectivity chunk. The complete CI matrix remains the PR gate. |
| 2026-10-15 | ChatGPT-Sol (Codex) | Completed the selected-worksheet crystallite comparison slice. Library multi-selection now drives a visible preflight of each published fitted-peak table; valid worksheets run sequentially with their own recorded wavelength plus shared K/instrument settings, invalid inputs are named and skipped, and cancellation stops between fits. One durable result records exact per-source peak rows/bindings, completion/failure/cancellation status, scientific warnings, and editable categorical figures for crystallite size, microstrain, and R². The Scherrer calculator remains explicitly separate because a single-reflection size estimate is not the same scientific model as a multi-peak Williamson–Hall fit. | Focused batch helper and UI tests cover mixed wavelengths, fallback disclosure, partial backend failure persistence, status persistence, exact fitted inputs, freshness after peak-table drift, one undoable result, and all three figure drafts. Forced TypeScript, full ESLint, 56/56 architecture ratchets, preload verification, and the 816.9/817.9 kB eager-bundle gate pass; the batch runner remains an 8.36 kB lazy chunk. Real-corpus qualification imported independent `La2NiO4_1.xrdml` (6,474 points/24 strict peaks) and `peakpo_feooh.xrdml` (7,822 points/9 strict peaks) patterns and exercised both through the unchanged Williamson–Hall backend; their deliberately weak fits produced low R²/negative-strain values that this UI surfaces as warnings rather than silently presenting as trustworthy. The complete CI matrix remains the PR gate. |
| 2026-10-15 | ChatGPT-Sol (Codex) | Added durable Williamson–Hall crystallite-analysis history. A completed reduction now saves exact included peak rows and fit settings as a Library result, binds fitted-peak inputs to the precise peak-table revision, refuses save-after-source-change races, survives project sanitization, reopens the exact controls, exports/copies/reports bounded tables, and promotes the saved observed-plus-fit values to a normal editable figure. Diagnostics disclose the unweighted fit, two-point fits, weak R², negative strain, undefined size, and instrument-width clamping. | Focused result, store, hook, workspace, and result-panel tests pass; forced TypeScript, full ESLint, Ruff, architecture ratchets, clean-install production build, preload verification, and the 816.9/817.9 kB eager-bundle gate pass. Real-corpus qualification imported `test-data/panalytical/xrd/La2NiO4_1.xrdml` (6,474 points), found 24 strict-prominence peaks, and ran eight strongest included widths through the unchanged golden backend: 94.636 nm, microstrain 0.0011035, R² 0.2584. The deliberately weak R² is surfaced as a review warning rather than hidden. CI remains the complete-suite PR gate. |
| 2026-10-15 | ChatGPT-Sol (Codex) | Added the second Workstream F XRD reference-overlay slice: strict local stick-pattern import and preview, optional per-reflection exclusion/label edits, wavelength-aware Bragg conversion, grouped relative-height overlays, Inspector styling/removal, undo, persistence, editable-figure promotion, and matching screen/publication rendering. The adversarial pass added a synchronous repeated-click guard, quoted and common unquoted CSV parsing, Unicode 2θ and separate h/k/l support, Å/nm wavelength metadata, explicit wrong-axis refusal/override with immediate reparse, bounded file/reflection counts, safe invalid-stick sanitization, excluded dense sticks from full-height drag hit-testing, prevented imported sticks from being mistaken for Pawley peaks, retained pattern identity across legacy editable-figure promotion, stored group provenance once rather than per reflection, and summarized patterns instead of mounting thousands of Figure Builder controls. External database search/match is still intentionally separate. | The final focused parser/component/persistence/render/export/architecture review gate passes 317/317; forced TypeScript and full ESLint pass. Backend export/validation passes 36/36 and full Ruff passes. The private-corpus PANalytical `La2NiO4_1.xrdml` imports as 6,474 points on a 5.0066–89.9989° 2θ axis with λ=1.540598 Å, satisfying the same compatibility path used by the importer without modifying source data. A clean-install production build and preload verification pass; the importer/UI remains in the lazy Reductions chunk, while the measured 836,485-byte eager contract is the synchronous project sanitizer plus first-frame renderer, documented under the bundle ratchet's minimal-raise rule. The otherwise complete frontend run reproduces the repository's documented Windows ~10⁻²⁴ JSON fixture rounding mismatch; this branch does not touch that fixture or autoscaling. CI remains the complete-suite PR gate. |
| 2026-10-14 | ChatGPT-Sol (Codex) | Completed A3's deferred cross-worksheet correlation slice. The workbench can correlate one named channel from each of two worksheets; the second source is an explicit versioned recipe dependency rather than hidden UI state. Both source worksheets participate in stale detection, recalculation, pipeline replay, result provenance, save/reopen, and workbook copy. Missing, ambiguous, pending, changed, or unit-incompatible inputs fail closed. Unequal monotonic X grids require explicit overlap-only resampling at the coarser measured spacing, while exact uniform grids are never interpolated. Cross-workbook copies that cannot carry either source retain their computed values but are deliberately frozen instead of keeping dangling live or raw-data references. The self-review removed double interpolation, bounded pathological shared grids, made recipe provenance authoritative during registration races, checked both sources for freshness, disclosed exclusions and uncertainty limits for both inputs, and made workbook-qualified selectors usable at normal dialog widths. | Focused backend/API/OpenAPI/repository checks pass 51/51; Ruff and focused mypy pass. The reviewed frontend durability and architecture subsets pass 334/334 (including every changed persistence, replay, result, recalculation, transfer, and workbench surface); the original 406-test pre-review gate also passed. TypeScript, full ESLint, production build, preload verification, and the unchanged bundle gate pass at 814.6 kB eager against 814.7 kB. Real-corpus qualification correlated two independent powder-XRD scans into 12,945 finite lag/correlation points with explicit resampling, and a deliberately unit-unknown CSV pairing was correctly refused rather than guessed. Both source arrays remain unchanged. |
| 2026-10-14 | ChatGPT-Sol (Codex) | Completed Workstream E's linked-figure slice and fixed the blank saved-statistical-figure workspace. Frozen result figures now render from their own immutable snapshot in focused and background windows, while bounded source-link descriptors carry shared selection between supported saved figures, worksheets, and source plots. Links fail closed for missing, pending, stale, legacy, or malformed sources; synthetic regression geometry selects its complete contributing observation group instead of claiming grid points are observations. Unlinked frozen figures intercept brushes so snapshot row numbers can never be applied to an unrelated active worksheet. To keep startup performance inside its unchanged ratchet, the focused adapter and linked-selection action load only with frozen figures, and desktop working-folder state now loads only when a native Open/Import action requests it. | Focused result-adapter, link-resolution, selection, window, plotting-action, native Open/Import, working-folder, architecture, and preload checks pass; TypeScript, full ESLint, production build, preload verification, and the unchanged 814.7 kB eager-bundle gate pass at 814.2 kB. The full frontend reached 17,261 passing tests plus 2 expected failures; its two failures were the documented Windows flat-autoscale numeric fixture mismatch and a load-sensitive Origin retry test that passed immediately in isolation. The Windows worker-path tests required an unsandboxed rerun after Vite hit its known `realpath` EPERM; both passed there. CI remains the complete-suite PR gate. |
| 2026-10-12 | ChatGPT-Sol (Codex) | Closed the independent review of Workstreams E/F and its follow-up re-review. Reporting now recognizes non-finite source-row omissions; figure refusals and disabled result actions explain how to recover; grouped row links exclude non-finite responses. Pawley lines are limited to the fitted source/2θ axis, resolution-deduplicated, carry unambiguous spaced hkl labels on both the HiDPI plot canvas and Inspector, survive recipe/project persistence through one strict shared field sanitizer with boundary-specific collision handling, and remain removable as one group. New Outlier results use one-based worksheet row numbers, and legacy version-1 results are migrated on load so their tables, warnings, figures, and copy/export paths use that same convention. The result workspace was split into dedicated tabs and toolbar modules, while its remaining 368-line coordinator stays below the architecture ceiling. Statistical figure bands retain matching saved fit points, use the selected channel units, and refuse stale or lazy-preview creation up front. Restored precise lazy-load diagnostics, corrected a duplicated accessible name, and removed private corpus values from this log. | The final review gate passes 232 focused frontend checks and all 56 architecture checks; 14 focused magnetometry and 13 repository-integrity checks also pass. Forced TypeScript, full ESLint, Ruff, mypy, preload verification, and production build pass. The unchanged 834,257-byte eager-bundle gate passes at 834,226 bytes. CI remains the full-suite gate. |
| 2026-10-12 | ChatGPT-Sol (Codex) | Completed Workstream E's standardized-reporting slice and the worksheet half of linked result selection, then began two orthogonal Workstream F depth slices. Statistical result overviews now use one evidence-first reporting structure for effect sizes, intervals, assumptions, multiple comparisons, and missing-data handling. Saved outlier/PCA source rows and grouped Distribution/Fit Y by X/Variability rows can select their exact current source rows, but stale results cannot drive selection. Magnetometry normalization now accepts mass and four geometry paths with per-field units and records reproducible derived-data provenance; A/m volume magnetization is supported. Pawley results can add calculated reflection positions as deduplicated plot reference lines. | Focused frontend reporting/selection/geometry/magnetometry/Pawley checks pass 260/260 and architecture passes 56/56; forced TypeScript, full ESLint, Ruff, mypy, production build, and the unchanged 834,257-byte eager-bundle gate pass. The complete backend passes 7,672 tests with 240 skips and 25 expected failures. Representative private-corpus qualification covered a real magnetometry loop and a powder-XRD scan, verified a mixed-unit thin-film A/m conversion without changing the source array, and produced finite Pawley reference positions. The monolithic Windows frontend runner entered its documented zero-test pre-collection failure state; every changed frontend suite passed individually, and CI remains the complete-suite PR gate. |
| 2026-10-11 | ChatGPT-Sol (Codex) | Completed Workstream E's editable-statistical-figure slice. Saved Distribution, all three Fit Y by X modes (including saved regression-interval bounds), PCA, Variability, and Outlier outputs now offer figure-ready cards in the result workspace and create normal frozen editable figures. The figures derive strictly from the result envelope's saved tables, carry compact result/producer/draft provenance, preserve categorical labels and saved SD uncertainty, remain usable without the source worksheet, and refuse creation if scientific tables change during lazy loading. Observed bivariate points intentionally remain in the source worksheet because the durable result stores the fitted curve rather than duplicating raw observations. | Focused adapters, creation lifecycle, result UI, frozen persistence, render-contract, workspace round-trip, and architecture verification pass 210/210; the final review-fix regression gate passes 98/98. The full local frontend run reached 17,122 passing tests plus 2 expected failures, and the complete clean-install CI matrix subsequently passed. Changed-file ESLint, forced TypeScript, preload verification, production build, and the unchanged 834,257-byte eager-bundle gate pass at exactly 834,256 bytes. The adversarial and external review passes added table-identity concurrency guards, same-render double-click protection, one-gesture Undo, malformed/non-finite-row refusal, explicit empty-outlier behavior, provenance metadata, visible busy-state locking, named confidence/prediction intervals, truthful missing-SD descriptions, histogram units, PCA variance labels, stale-result refusal, frozen freshness/fingerprint stamps, removal of entirely empty SD bindings, and a click-only action boundary that leaves the eager graph unchanged from the base. |
| 2026-10-11 | ChatGPT-Sol (Codex) | Began Workstream E with a unified Statistics workspace inside the Analysis Center. Distribution, Fit Y by X, Test Chooser, Statistical Tests, Multivariate, Variability, and Outlier Screening retain their canonical focused launchers, while all six result-producing families now collect in one searchable, expandable inventory. Each result shows its source, shared freshness state, interpretation, warnings, and bounded inline table previews; active-worksheet filtering is explicit rather than automatic. Every saved table can now be copied or exported individually, and each result can be copied/exported as a complete set from either the unified workspace or the full result window. At the end of this slice, standardized statistical semantics, linked table/plot selection, and editable statistical figures remained. | Focused helper/store/Analysis Center/full-result verification passes 59/59; architecture/preload verification passes 67/67; forced TypeScript, full ESLint, production build, preload verification, and the unchanged 814.7 kB eager-bundle gate pass. The adversarial pass bounded mounted tables/rows, kept non-statistical and batch results out of the workspace, handled missing/invalid timestamps, synchronously guarded double-clicks, refused a table action when its result changed during lazy loading, validated stale table indexes, and preserved existing all-table export behavior. CI remains the final PR gate. |
| 2026-10-11 | ChatGPT-Sol (Codex) | Completed Workstream D with a shared versioned `AnalysisSelection` contract and migrated Curve Fit and Peaks. Plot ranges, exact worksheet column/row selections, Library multi-selection, uncertainty bindings, and categorical factors now converge on one reviewable input model. Both workbenches expose Review inputs, preserve exact row/range provenance through save/reopen and recalculation, support Run By and selected-worksheet batches where scientifically valid, and publish one durable batch result with preflight, comparable summaries, per-input warnings/status, bounded input count, and explicit partial cancellation. A direct tool launch intentionally follows the visible plot's selected rows and X range; Review inputs discloses that scope before a run. Cancellation finishes the in-flight worksheet and marks every not-yet-started input Cancelled. The adversarial pass fixed stale tool-default selection on reopen, asymmetric-error replacement, subset/full-view result mixing, source-fingerprint drift, lazy Origin inputs, repeat-click races, row-id expansion limits, and architecture/bundle regressions. | Focused selection/Curve Fit/Peaks/batch verification passed 214/214; architecture ratchets passed 56/56; focused backend fit/peak checks passed 61 with 2 skips. A complete frontend pass reached 17,171 passing tests plus 2 expected failures; its three Workstream D failures exposed the stale-remount bug and passed after the fix, leaving only the documented pre-existing Windows flat-autoscale subnormal-float fixture mismatch in untouched code. Forced TypeScript, ESLint, preload verification, production build, and the eager-bundle gate passed. The local import sweep and a representative XRD peak regression from the private corpus passed 21/21. CI remains the final PR gate. |
| 2026-10-11 | Project team | Completed Workstream C with a lazy full-stage Analysis Center reachable from Analyze and Workflow. It searches the canonical tool catalog, groups tools by scientific purpose, explains structural, command-state, and declared-technique compatibility, offers Recommended/Recent/Favorites/All/Existing Results views, and preserves each existing command as the sole launch authority. Pending Origin previews resolve before launch and fail closed if the source disappears, fails to load, or the active worksheet changes. Preferences are bounded session UI state; the Center never changes scientific data or runs a tool by itself. | Final focused Center/navigation/store/Help/command/architecture/preload coverage passed 575/575 after the adversarial pass added active-worksheet race, offline-source, disabled-command, corrupted-preference, and Library-retarget guards. A complete serial frontend run excluding the documented Windows flat-autoscale fixture passed 17,115 tests plus 2 expected failures and exposed five Help aliases shortened during bundle work; all original aliases were restored and their exact suite reran green. Forced TypeScript, full ESLint, preload verification, and the production build passed, including the unchanged 814.7 kB startup budget at 814.3 kB eager. CI remains the final PR gate. |
| 2026-10-10 | ChatGPT-Sol (Codex) | Completed the focused-statistics migration with a Multivariate producer adapter. Correlation, SPLOM/PCA inputs, correlation matrices, PCA summaries/loadings/scaling/scores, exact controls, source row identities, and listwise-deletion disclosure now participate in the durable result lifecycle. Results reopen the exact workbench question and use the common inspect/export/report/duplicate/delete/Undo workspace. The adversarial pass prevents prior async correlation/PCA responses, wrong-method payloads, or dimensionally inconsistent responses from being saved under changed controls; large inline tables are bounded and constructed without first copying oversized score/matrix output. | Final focused multivariate/adapter/workspace/freshness verification passed 98/98. The full frontend passed 17,109 tests plus 2 expected failures; its only failure was the documented pre-existing Windows flat-autoscale subnormal-float fixture mismatch in untouched code. Forced TypeScript, full ESLint, preload verification, production build, and the unchanged 814.7 kB eager-bundle gate passed at 814.5 kB. CI remains the merge gate. |
| 2026-10-10 | ChatGPT-Sol (Codex) | Added the Outlier Screening producer adapter: Grubbs, Rosner ESD, Dixon Q, and robust MAD screens can now be explicitly saved as durable Library snapshots, reopened with exact controls, checked against the filtered/excluded analysis view, exported/reported, duplicated, and removed with Undo. Snapshots retain original source-row identities, compact method-specific statistics, bounded Rosner sequences, and non-finite-row disclosure without persisting raw score arrays; screening remains non-destructive. | Focused workshop/adapter/workspace/freshness/architecture/preload verification passed 131/131; TypeScript, ESLint, production build, and the unchanged 814.7 kB eager-bundle gate passed at 814.4 kB. The full frontend passed 17,098 tests plus 2 expected failures; its sole failure was the documented pre-existing Windows flat-autoscale subnormal-float fixture mismatch in untouched code. The adversarial pass added a source-fingerprint run key to prevent an old asynchronous result being saved after an in-place worksheet edit, bounded diagnostics, guarded same-render duplicate saves, and fixed the row-state architecture naming collision. CI remains the merge gate. |
| 2026-10-10 | ChatGPT-Sol (Codex) | Added the Variability producer adapter: completed nested analyses can now be saved as durable Library snapshots, reopened with exact response/factor controls, checked against filtered/excluded source freshness, duplicated/exported/reported through the shared workspace, and removed with Undo. Saved content is compact labeled output rather than raw observations; non-estimable components, clamped negative estimates, unbalanced designs, and table truncation stay explicit. | Focused adapter/workshop/workspace/freshness/architecture verification passed 115/115; TypeScript, ESLint, preload verification, production build, and the 814.7 kB eager-bundle gate pass at 814.2 kB. The full frontend passed 17,088 tests plus 2 expected failures; its only failure was the documented pre-existing Windows flat-autoscale subnormal-float fixture mismatch in untouched code. CI remains the merge gate. |
| 2026-10-09 | ChatGPT-Sol (Codex) | Added the Distribution producer adapter: an explicit Save result action records the exact column/By/fit/percentile question plus descriptive, histogram, normality, fit-ranking, quantile, and per-level outputs as a durable Library snapshot. The shared snapshot workspace now inspects and reopens both Statistical Tests and Distribution. The adversarial pass rejects malformed histogram geometry, caps By snapshots, preserves project round-trips, diagnoses lazy/unverifiable sources, blocks stale async report handoffs, and prevents duplicate Save/Report actions while allowing Save again after Undo. | Focused result/workshop/workspace/freshness/schema plus architecture checks pass 150/150, with the final tightened rerun at 111/111 after the Undo guard. Distribution backend checks pass 11/11. Verified on a real SIMS depth profile from the private corpus; all five candidate fits completed. Forced TypeScript, ESLint, production build, preload verification, and the unchanged bundle gate pass at 813.9 kB eager (0.8 kB headroom). CI remains the complete-suite PR gate. |
| 2026-10-09 | ChatGPT-Sol (Codex) | Added the first statistics producer adapter: completed Statistical Tests runs now create durable Library results with the exact saved question, interpretation, compact tables, provenance, Edit / rerun, duplicate, export, report, undo, save/reopen, missing-source, and out-of-date behavior. The adversarial pass made freshness follow the exact filtered/excluded analysis view plus categorical meaning, bounded serialized tables and DOM previews, refused malformed/future rerun recipes, prevented repeated actions, and blocked stale values from report handoff. | Final focused result/schema/freshness/workspace/store/workshop/UI plus architecture checks pass 313/313; forced TypeScript and ESLint pass. Production build/preload verification passes at 813.8 kB eager under the unchanged 814.7 kB pin. The Windows full-suite runner hit its pre-collection temporary-module failure and was discarded rather than counted; CI remains the complete-suite PR gate. |
| 2026-10-09 | ChatGPT-Sol (Codex) | Added the Workstream B reflectivity-history adapter on top of the existing `Dataset.reflFits` authority: atomic result publication/undo, one-time project migration with deletion tombstones, current/out-of-date/missing diagnostics from live channel digests, parameter/posterior tables, provenance, and exact historical-fit reopening. The adversarial pass fixed independent-project record-id collisions, Append Project's nested channel-id remap, bounded-history catalog retirement, partial-restoration host selection, already-open workshop mode switching, misleading Signal-result copy, malformed-history catalog entries, and startup-budget regressions. | Focused final hardening passed 138/138 after the broader persistence/result suites; TypeScript, ESLint, architecture, preload, production build, and the restored 814.7 kB startup pin passed. Full frontend passed 17,037 tests plus 2 expected failures apart from the documented pre-existing Windows flat-autoscale subnormal-float fixture mismatch in untouched code. CI passed after rerunning one unrelated Library focus flake; PR #564 merged as `4018103c`. |
| 2026-10-09 | ChatGPT-Sol (Codex) | Added the Workstream B curve-fit adapter on top of the existing `Dataset.fitSpec` authority: producer publication from the full Curve Fit and Quick Fit paths, one-time workspace migration, stale/missing lifecycle, overview/provenance/diagnostics, parameter and uncertainty table with CSV export, Edit / Re-fit, exact one-result recalculation, and fitted-curve regeneration for normal plots and reports. The review pass removed stale-summary carryover when a backend omits a diagnostic, kept startup-only code out of the eager bundle, preserved renamed results and notes across re-fit, and refused malformed refits or legacy recipes without exact channel bindings instead of guessing. | Focused scientific, persistence, producer, UI, workspace, and architecture suites passed 129/129 after review fixes; the final recomputation/lazy-boundary gate passed 116/116. ESLint, TypeScript, preload verification, the production build, and the unchanged 814.7 kB startup limit passed (814.7 kB eager). The full frontend run passed 17,008 tests plus 2 expected failures; the only remaining failure was the documented pre-existing Windows flat-autoscale subnormal-float fixture mismatch in untouched code. CI remains the merge gate. |
| 2026-10-08 | Project team | Finished the common Workstream B result-output workspace: recorded-series figure previews, exact-binding Open plot and editable-figure launch, Send to report, bounded multi-table preview, safe full-table CSV export, linked-output Duplicate, and Freeze to independent data. Added transient seeded mappings so Build figure does not silently re-add unrelated worksheet channels, plus repeated-click, lazy-load, mid-load mutation, missing-reference, and project-reload guards. | TypeScript, ESLint, production build, architecture ratchets, and bundle gate passed (813.6 kB eager against 814.7 kB budget). Focused result/builder/hydration checks passed 128/128. Full frontend reached 16,955 passed plus 2 expected failures; two unrelated load-sensitive failures passed immediately in isolation, while the pre-existing Windows flat-autoscale fixture has a subnormal-float serialization mismatch in an untouched file. CI remains the merge gate. |
| 2026-10-08 | Paige | Implemented the first Workstream B vertical slice: durable versioned result envelopes, canonical Library placement, autosave/save/reopen and legacy signal-result migration, generic future/missing-reference diagnostics, and a lazy Signal result workspace with inspect/recalculate/rerun/rename/notes/delete lifecycle. Scientific settings and arrays remain in the linked worksheet authority rather than being duplicated. | TypeScript, ESLint, 56 architecture ratchets, production build, and the eager-bundle gate passed under the unchanged 834,639 B pin (834,526 B measured after the review fixes). A full frontend run passed 16,876 tests plus 2 expected failures and exposed two new-kind completeness omissions (autosave and icon render-site coverage); both were fixed and their focused suites then passed 64/64. Focused result/store/workspace/Library/component regressions also passed. CI remains the merge gate. |
| 2026-10-07 | Project team | Completed A1, A2, and A4 around the existing A3 spectral work: technique-workspace launch, row-scope disclosure, X-range controls, reference normalization, editable smoothing/detrend polynomial order, contextual Help, named Recipe Library templates, one replayable `signal` transform path, unit-aware rebinding, source-race refusal, cancellation, undo, and project persistence. Cross-worksheet correlation remains explicitly deferred to Workstream D. | Focused frontend workbench/pipeline/workspace checks passed (including record → save → reload → replay); focused correction API/calc checks passed (121). Real-corpus qualification passed on an XRD scan, a SIMS depth profile, a reflectometry curve, and a VSM hysteresis loop from the private corpus, with source arrays and file hashes unchanged. |
| 2026-10-07 | ChatGPT-Sol (Codex) | Completed the single-worksheet A3 spectral tranche: FFT/PSD/phase, four frequency filters, transfer-function and before/after previews, two-channel cross-correlation, linked plottable outputs, versioned recipe persistence/rebinding, and explicit irregular-grid resampling. Cross-worksheet correlation remains explicitly deferred to the multi-source dependency workstream. Two adversarial passes fixed filter detrending semantics, stale metadata/error-role leakage, malformed recipe/orphan transfer handling, duplicate-label rebinding, event-loop decoding, cutoff provenance, reciprocal-unit display, large-array handling, startup-bundle loading, oversized Welch provenance, unbounded transfer previews, zero-energy correlation, implicit-notch provenance, hidden-setting recipe corruption, stale previews, and async source-change/orphan races. | Focused frontend: 311 passed; focused backend/API/off-loop: 131 passed; Ruff, focused mypy, TypeScript, ESLint, architecture ratchets, production build, and 814.5 kB eager-bundle gate passed. Full frontend before the second focused hardening pass: 16,824 passed / 2 expected failures; three unrelated lazy-workspace timing tests failed under the 322-second full run and then passed 4/4 in isolation. Real corpus: XRD PSD, SIMS resampled correlation, reflectivity filtering/transfer diagnostic, and correct refusal of a non-monotonic magnetometry loop, with source bytes unchanged. |
| 2026-10-06 | ChatGPT-Sol (Codex) | Completed the first A1/A2 tranche: channel-targeted correction API, unit/error semantics, general Signal Processing workbench, linked-output uncertainty retention, and Savitzky-Golay compatibility fix. The adversarial pass added strict channel indices, stale-preview and duplicate-commit guards, no-finite-output and invalid-area refusal, shared preview scaling, and deterministic workspace-busy tests. | Full backend: 8,139 passed / 101 skipped / 13 expected failures; focused post-review backend/API: 109 passed. Full frontend: 1,163 files, 16,806 passed / 2 expected failures. Ruff, mypy, TypeScript, ESLint, architecture ratchets, production build, and 834,392 B eager-bundle gate passed. Real corpus (private): an XRD scan (smoothing), a Raman spectrum (derivative with reciprocal-axis units), and a Rigaku XRD scan (peak normalization), all finite with source arrays unchanged. |
| 2026-10-06 | ChatGPT-Sol (Codex) | Created the GUI/backend capability audit and roadmap; selected General Signal Processing as the first coherent tranche. | Inspected current Analyze/Data commands, technique workflows, workshops, routes, calculation modules, derived worksheets, pipeline replay, and existing PRIMARY/JMP plans on `origin/main` after PR #550. |
