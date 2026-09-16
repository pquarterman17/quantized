# Quantized living bugs and usability issues

**Status:** Active working checklist  
**Created:** 2026-09-08  
**Updated:** 2026-09-16 (BUG-017 fixed: NaN/±Infinity/-0 cells round-trip through `.dwk` save, autosave, Pack Project and workbook transfer; BUG-012 and BUG-013 review rounds closed; UX-003 filed)  
**Initial author:** ChatGPT-Sol (not Claude)  
**Purpose:** A durable, additive record of defects and usability friction found while using Quantized as an OriginPro replacement.

This is a working document, not a claim that every observation is already reproduced or assigned. Add new reports using the template below. Do not check off an item merely because code was written: its acceptance criteria and relevant automated tests must pass. Items requiring owner testing should remain open until that testing occurs.

## Status key

- `[ ]` Open or not yet verified
- `[~]` In progress (use only while a named PR or branch exists)
- `[x]` Verified complete; add the date, PR/commit, tests, and verifier
- **P0:** data loss or scientifically incorrect result that can escape notice
- **P1:** blocks or seriously damages a primary workflow
- **P2:** substantial friction or confusing behavior with a workaround
- **P3:** polish or low-frequency inconvenience

## Active queue

| ID | Priority | Area | Issue | Owner | Status/evidence |
|---|---:|---|---|---|---|
| BUG-001 | P0 | NCNR `.refl` import/plot | Uncertainty and resolution are plotted as ordinary Y curves | Claude | Every code-verifiable box closed 2026-09-12; owner Windows visual check + a Reductus variant check remain |
| UX-001 | P1 | Origin project Library | Large worksheet cards are difficult to interpret and consume too much space | Claude | Compact Tree row + both residuals (icon audit, selected-vs-open) test-verified 2026-09-12; owner visual verification of the reported project remains |
| BUG-002 | P2 | Desktop bridge write consent | A hard-linked alias of a declared raw source defeats the never-overwrite-your-own-source check | Unassigned | Reproduced by strict `xfail`, 2026-09-09 |
| UX-002 | P3 | Workbook copy/paste | Cross-workbook lineage (`versionOf`, external `derivedFrom`) is dropped silently — the count is computed but never shown | Unassigned | Found in review, pinned by test, 2026-09-09 |
| BUG-003 | P2 | Data Filter workbench | A filter predicate survives a column's type change with a stale `kind`, applied everywhere but invisible/uneditable in the panel that wrote it | Unassigned | Design-time finding, sabotage-verified, 2026-09-09 |
| BUG-004 | P3 | Stat Stage workbench | A picked "group by" column survives a `channelTypes` override that de-categorizes it, stranding a stale index the picker no longer offers (facet is deliberately NOT affected — see the entry) | Unassigned | Design-time finding, fixed + sabotage-verified, 2026-09-09 |
| BUG-005 | P2 | Corrections / Resample | A categorical channel is transformed like numeric data — its level codes become fractional and its level table is (correctly) discarded, so the column silently degrades to meaningless numbers | Unassigned | Found in the Group J propagation audit, strip pinned by test, 2026-09-09 |
| BUG-006 | P2 | Row slices, row edits, merge, corrections, pending previews | A row slice carried the `text_columns` sidecar through UNSLICED, so an extracted subset's text cells no longer lined up with its rows | Claude | **10 of 10 code sites fixed, re-verified 2026-09-14 by grepping every call site rather than trusting the count** (see the entry's "Every caller covered" box); `lib/barlayout.ts`'s label path was the last one, shipped 2026-09-12. The deferred end-to-end reproduction test (filter + Extract, at the `planExtract` layer) was added 2026-09-14 — see the entry's Reproduction checklist. Declared closed three times before it actually was, and FOUR review rounds each found defects in the previous round's fix — twice HIGH every round, with a fully green suite every time. The suite had caught essentially none of it; adversarial review, per-branch sabotage and measuring claims caught all of it. Owner's real-data visual confirmation remains open |
| BUG-007 | P2 | Test hygiene | A `void`-ed async store action in a test made its assertion vacuous AND leaked `set()` into a later test — misdiagnosed by me as a module-init-order hazard | Claude | **FIXED** 2026-09-09; reduction collected, pin lowered |
| BUG-008 | P2 | Split Dataset | An explicit `cat_levels` level table was invisible to Split, so a few-row categorical column MERGED all its samples into one child dataset (and, at row counts where the shape heuristic agreed, named the children after raw float codes) | Claude | **FIXED** 2026-09-10 after ONE review round that found 2 HIGH — the first cut fixed only the `cat_levels` shape and its chokepoint ratchet was evadable by an aliased import. 22 behaviour tests + a 2-test ratchet, every fix sabotage-verified |
| BUG-009 | P2 | Pending-dataset contract | Five ad-hoc guards rather than one contract; the data-CORRUPTING sites and the row-state family are guarded + ratcheted, and a failed fetch now names its reason instead of promising a retry forever — but "refuse" should still be "resolve-then-apply" | Unassigned | Found across five review rounds, 2026-09-10; corrupting sites, row state and the misleading message fixed, the deferral refactor open. A load-path fix for the row-state/pending clamp (Group AF, 2026-09-13) was built and reverted after adversarial review — see the entry |
| BUG-010 | P2 | Workspace load status | `migrationWarnings` are folded into the load status only on a plain File ▸ Open; crash recovery, silent autosave restore and Append Project each overwrite `status` one statement later, and workbook-package import never reads them at all | Claude (agent) | Found 2026-09-13 reviewing Group AF; **fixed 2026-09-13** (commit pending merge): one shared `notifyMigrationWarnings` toast from all four loaders, `duplicateWorkbook` a pinned structural non-goal. Adversarial review round (2026-09-13) closed the one real gap the fix missed — File ▸ Open itself never joined the toast channel — plus doc/citation cleanup; see the entry |
| BUG-011 | P1 | Pack Project (portable export) | `serializeCurrentWorkspaceForPack` never resolved pending datasets before serializing, so packing a workspace with an unopened lazy Origin book shipped that book's downsampled PREVIEW rows (and a stray `pending` field) as the portable project's real data | Claude (agent) | Found 2026-09-13 reviewing Group AF; **fixed 2026-09-13** (commit pending merge) — both the preview and Start-pack paths resolve first and abort by name if a book can't be fetched; 5 sabotage-verified specs. Adversarial review round (2026-09-13) closed both CONFIRMED code findings (Start pack's own resolve window, a book turning pending mid-fetch) plus doc/nit cleanup. Review rounds 2/3 (2026-09-13) closed further regressions, finished the finding #5 fix, and widened the terminal-status fix to every `failed`/`cancelled` transition. Residual closed 2026-09-13: `store/workspaceIO.ts`'s Save/Save As now shares the identical post-await `pending` re-check (see the entry) — every explicit export path (Save, Save As, workbook transfer, Pack Project) now closes finding #2's window. Owner call on abort-vs-partial-pack still open |
| FEATURE-001 | P3 | Faceted plots | Per-series styling (dash/width/colour/marker) is ignored by faceted plots on BOTH screen and export; panels can also resolve different channel sets, so one style list cannot serve the grid | Unassigned | Measured 2026-09-09; a fix was built, reviewed, and reverted — see the entry |
| BUG-012 | P2 | Figure export/reopen — axis breaks | A saved figure's x-axis break reaches export and survives reopen in the document, but nothing on screen ever renders it after reopen | Claude (agent) | Found by the P4.2 regression matrix (`1593cdee`); **FIXED 2026-09-14** — `Stage/useEffectiveComposition`'s durable fallback derives the paneled break from `plot.axisBreaks.x` via `lib/facet.durableComposition`, which wraps the SAME builder `breakAtGaps` uses (one construction site, no new persisted field). Divergence test inverted, `break` is a full matrix fixture again (screen ≡ export ≡ reopen + golden), facet-beats-break precedence defined and tested against the export path's own ordering. **Review round closed 2026-09-15** (F1-F5 + nits): panel x-ranges now come from the break BOUNDS so screen and export elide the same range for endpoints that are not data points; the stack toggle and a genuine dataset switch both clear the authored break; background windows panel it too; two residuals recorded |
| BUG-013 | P2 | Figure export — waterfall view | A waterfall view's per-series vertical offset is applied on screen but never reaches the export wire, so the exported figure draws overlaid, un-offset curves | Claude (agent) | Found by the P4.2 regression matrix (`1593cdee`); **FIXED 2026-09-14** — `FigureSpec`/`FigureRequest` grew `waterfall_offsets`, a per-plotted-series shift in Y data units resolved by the new `lib/waterfallOffset.ts` (the canvas' own step, keyed by DISPLAY position) and applied by `calc.plotting.apply_waterfall_offsets`. The divergence test is inverted and `waterfall` is a full matrix fixture (screen ≡ export ≡ reopen) |
| BUG-014 | P3 | Figure export — legend rename | A legend rename replaces the whole on-screen label, but on export only the channel label is replaced and the backend re-appends the unit ("Loop 1" exports as "Loop 1 (au)") | Claude (agent) | Found by the P4.2 regression matrix (`1593cdee`); **FIXED 2026-09-15** — the rename rides its own per-series presentation field (`series_styles[i].legend`), used VERBATIM by `calc.figure_labels.series_display_name`, and the wire `dataset` keeps the DATA's labels/units. The divergence test is inverted. **Review round 2026-09-16** closed the FACET branch, which still shipped `"Loop 1 (au)"` (and showed no rename at all on screen), and `lib/spatialPageExport.ts`'s decoded Origin captions; an EMPTY rename stays a named residual |
| BUG-015 | P2 | Figure export — hidden series palette | Hiding a series shifts later series' palette colour on export only; the canvas keeps a hidden series in the display list with `show:false` so later series keep their position, but the export's filtered channel list recolours them by their new, filtered index | Claude (agent) | Found by the P4.2 regression matrix (`1593cdee`); **FIXED 2026-09-14** — `lib/figureSpec.ts` derives each plotted channel's UNFILTERED display position unconditionally and `buildExportStyles` colours by it always (the P3.3 dash/marker cycle stays opt-in on top of the same positions). The divergence test is inverted, and `hidden` is now a full matrix fixture (screen ≡ export ≡ reopen + golden) |
| BUG-016 | P2 | Figure export — grouped per-series styling | A grouped figure's per-series style (colour/width/dash/marker) reaches the canvas — every level of the channel draws with it — but `routes/export_figures.py`'s `group_col` branch drops `series_styles` entirely, so the exported figure draws default-coloured, solid, default-width curves | Unassigned | Found by the 2026-09-14 review round of the P4.2 regression matrix; reproduced by `regressionMatrix.test.ts`'s `DIVERGENCE (BUG-016)` test, not fixed |
| UX-003 | P3 | Lazy chunk loading (whole app) | A failed `lazy()` chunk fetch unmounts the React root — 17 `lazy()` sites, zero error boundaries, so the window goes blank with no toast, no status and no console error, and React caches the rejection so the gesture cannot retry | Unassigned | Found in the 2026-09-15 adversarial review of the `b749f804` bundle diet; measured (0 boundary files vs 17 `= lazy(` sites) and reproduced in a scratch spec, not fixed — the two over-broad plan claims were narrowed instead |
| BUG-017 | P1 | Workspace save/reopen — NaN/±Infinity cells | `workspaceSerialize.ts`'s `data: d.data` has no NaN/±Infinity replacer, `JSON.stringify` turns them into `null`, and `workspaceDatasetParse.ts`'s `isNumberArray` rejects `null` and throws — so the WHOLE workspace fails to reopen after saving a dataset with one such cell (reachable by a plain `insertRows`, whose blank rows are minted as `Number.NaN`); `-0` separately round-trips silently to `0` | Claude (agent) | Found by the P2.1 round-3 review (pre-existing, outside that commit); **FIXED 2026-09-16** — the new `lib/nonFiniteCells.ts` encodes the four values JSON cannot represent as the sentinel strings `"NaN"`/`"Infinity"`/`"-Infinity"`/`"-0"` on the way out and decodes them on the way in, applied symmetrically by `workspaceSerialize.ts` (`.dwk`, autosave, Pack Project) and `workspaceDatasetParse.ts`, plus the same-shaped hole in `lib/workbookTransfer.ts`'s clipboard package. The encoders return their input by reference when nothing needs a sentinel, so an ordinary document is byte-identical to before (no schema bump); `null` deliberately stays a rejection and a malformed entry deliberately still refuses the whole workspace — see the entry for both rulings |

---

## BUG-001 — NCNR `.refl` uncertainty roles are plotted incorrectly

**Priority:** P0 — scientifically misleading default visualization  
**State:** Open — every CODE-VERIFIABLE checklist box is now closed (2026-09-12);
what remains needs a human or an external file: the owner's Windows visual
check on the reported file (Acceptance criteria), the reproduction-checklist
item asking to check a Reductus variant beyond the repository fixture, and
the reproduction-checklist item asking for a manual Error-Columns UI check
"in the current release" (a running-app check, not a unit test).
Plot-window-rebinding preservation of the declared roles (drag/drop a
dataset onto an existing window) is now also verified — see the Completion
record's second 2026-09-12 entry.  
**Reported:** 2026-09-08 by owner  
**Investigated:** 2026-09-08 by ChatGPT-Sol  
**Suggested implementation owner/model:** Claude Sonnet for parser/state reliability; ChatGPT-Sol for final interaction and visual review  
**Likely scope:** `src/quantized/io/ncnr.py`, import-role/default plotting logic, and their backend/frontend tests

### User-visible problem

Opening `S3_6500e_From700mT.refl` produces three independent curves named approximately:

- `counts per incident count`
- `uncertainty`
- `resolution`

That default is wrong. The latter two columns describe uncertainty; they are not independent measured Y series. Plotting them as curves also gives them colors and legend entries, making a plausible-looking but scientifically misleading figure.

### Confirmed implementation evidence

- [x] The NCNR Reductus parser currently maps Qz to the independent axis and puts every remaining file column into `DataStruct.values`.
- [x] Unlike the NCNR refl1d-style parser, `import_ncnr_refl` supplies no `default_value_channels` or `error_channels` plotting hints.
- [ ] ~~Generic label inference can recognize the standalone `uncertainty` label and associate it with the preceding measured channel.~~ **Corrected 2026-09-09 (Claude): this is not what happens for this file.** Measured against the fixture's own labels: `inferErrorBindings({labels: ["Intensity","uncertainty","resolution"]})` returns `[]`. The context-free classifier does return a spurious hit on `uncertainty` — it strips a leading `unc` and reports base `"ertainty"` — and the sibling-evidence gate then correctly rejects it, since no `ertainty` column exists. So no binding was produced by inference, and the roles had to come from the parser.
- [x] Generic default channel selection does not hide inferred error-role channels from the initial plot.
- [x] `resolution` is not a generic error token, so label inference does not identify its scientific role.
- [x] The existing fixture declares columns `[Qz, Intensity, uncertainty, resolution]` with units `[1/Ang, counts, counts, 1/Ang]`, which provides a stable regression case.

### Intended scientific mapping

- Qz is X.
- Intensity/reflectivity (`counts per incident count` in the reported file) is the plotted Y series.
- `uncertainty`, with the same units as intensity, is the symmetric vertical/Y uncertainty for the measured series.
- `resolution`, with Q units (`1/Ang`), is the symmetric horizontal/X uncertainty (dQ/resolution).
- Both uncertainty columns remain accessible and editable as data, but are hidden as standalone curves by default.

The implementation must use the file format's semantics, not merely the exact display names shown in one file. If Reductus variants use different column names or omit one uncertainty column, the importer must fail safely and leave ambiguous roles unassigned.

### Reproduction checklist

- [x] Import an NCNR Reductus `.refl` file containing Qz, measured intensity, uncertainty, and resolution.
- [x] Observe all three value columns drawn as lines on the default log-Y plot.
- [x] Observe uncertainty and resolution included as ordinary legend series.
- [ ] Confirm whether manually assigning the two roles in **Error Columns** immediately produces correct X/Y whiskers in the current release.
- [ ] Check at least one Reductus file variant beyond the repository fixture before broadening name matching.

### Implementation checklist

- [x] Define parser-owned default semantics for a recognized four-column Reductus reflectometry layout.
- [x] Default the plotted channel set to the measured intensity/reflectivity only.
- [x] Bind the intensity uncertainty as symmetric Y error.
- [x] Bind resolution/dQ as symmetric X error using the canonical rich error-role model.
- [x] Ensure bound error columns do not appear as independent curves or ordinary legend entries by default.
- [x] Preserve all imported numeric columns in the worksheet; do not alter raw values.
- [x] Keep every role overridable through the import/error-column UI. NCNR-`.refl`-SPECIFIC (2026-09-12, Claude): `frontend/src/components/Stage/usePlotPayload.errorRoles.test.ts`'s "NCNR .refl error roles are overridable through the store action ErrorRolesCard calls" describe block imports the real fixture's declared roles via `useApp.importPaths`, confirms they land, then overrides one binding through `useApp.getState().setErrorRoles` — the EXACT action `ErrorRolesCard.tsx`'s Side `<Select>` `onChange` calls via its `patch` helper — and confirms both that the store keeps the override (not the parser's declaration) and that the NEXT render of the real `usePlotPayload` hook draws accordingly (the resolution binding's horizontal whisker disappears once its `side` is overridden to an incomplete asymmetric pair; the untouched Y/uncertainty whisker is unaffected). Sabotage-verified: making `setErrorRoles` a no-op (write back the dataset's existing roles instead of the new ones) made both new tests fail; reverted.
- [x] Handle files that omit uncertainty, omit resolution, or contain additional value columns without shifting indices incorrectly.
- [x] Ensure workspace save/reopen and duplication preserve the intended roles. **Save/reopen, confirmed 2026-09-12 (Claude):** `frontend/src/lib/workspace.test.ts:2149` ("BUG-001: an NCNR .refl's declared Y+X roles round-trip through a workspace save/reopen", landed 2026-09-09) already round-trips the exact declared Y+X shape through `serializeWorkspace`/`parseWorkspace` — read and confirmed, not re-done. **Reimport (the store's `reimportDataset` action), unchanged-shape case, now also covered:** `frontend/src/store/reimport.test.ts`'s BUG-001 describe block (see the visibility item below) asserts the declared `errorRoles` survive a same-shape reimport unchanged. **Plot-window rebinding (dragging/dropping a dataset onto an existing window), confirmed 2026-09-12 (Claude):** `frontend/src/components/Stage/usePlotPayload.errorRoles.test.ts`'s "rebindWindow (drag/drop) preserves an NCNR .refl's declared error roles (BUG-001, plot-window rebinding)" describe block drives the real `useApp.getState().rebindWindow` action (not a hand-built window record) against a real NCNR `.refl` import, covering both the FOCUSED-window rebind path and the BACKGROUND (unfocused) window rebind path, and confirms the resulting window's own payload (via the real `usePlotPayload` hook, fed `documentErrors` exactly as `PlotStage`/`BackgroundPlotWindow` thread it) draws both the Y and X whiskers. A third case confirms an explicit `setErrorRoles` override made on the dataset BEFORE the rebind survives it — the rebind reads the dataset's CURRENT roles, not a stale parser default.
- [x] Verify that user-customized channel visibility is not overwritten after the initial default is established. NCNR-`.refl`-SPECIFIC (2026-09-12, Claude): `frontend/src/store/reimport.test.ts`'s "reimportDataset — NCNR .refl channel-visibility customization survives a same-shape reimport" describe block confirms the default (`defaultDenseChannels` on the fixture's own shape returns `[0]` only — the measured channel alone), then customizes BOTH directions — widen (`yKeys: [0, 1]`, plotting `uncertainty` as an ordinary series) and hide (`hiddenChannels: [0]`, hiding the default series) — and reimports the SAME-shape fixture (real rows 5-9 of `tests/golden/ncnr_j395_default.json` fed in place of rows 0-4): both customizations, and the declared `errorRoles`, survive untouched. Sabotage-verified: forcing `store/reimport.ts`'s `viewReset` to always fire (dropping the `shapeChanged` gate) made all three new assertions fail — and also broke the PRE-EXISTING generic pin ("keeps the live view's channel-keyed state when the shape is unchanged"), confirming the sabotage genuinely exercised the shared chokepoint; reverted.

### Automated-test checklist

- [x] Backend parser test asserts the semantic hints/roles emitted for `tests/fixtures/ncnr_j395.refl`.
- [x] Backend tests cover missing and reordered optional columns if the format permits them.
- [x] Frontend import test asserts the canonical Y- and X-error bindings stored on the dataset.
- [x] Default-channel test asserts only the measured series is selected initially.
- [x] Rendering/payload test asserts uncertainty and resolution are absent as standalone series.
- [x] Overlay test asserts Y uncertainty and X resolution produce vertical and horizontal spans respectively.
- [x] Log-axis regression test confirms valid uncertainty rendering without changing the underlying data.
- [x] Relevant backend, frontend, type-check, and production-build gates pass. Run in full 2026-09-12 (see Completion record): `npx tsc -b --force` clean; `npx eslint` (touched files) clean; targeted `npx vitest run` (touched/new files + `architecture.test.ts`) 468 passed/0 failed; FULL `npx vitest run` **625 test files, 10049 tests, all passed, 0 failed**; `npm run build` (via `npm ci` first) succeeded — `tsc -b && vite build` clean, bundle 896.3 kB eager (budget 897.3 kB, 0.9 kB headroom).

### Acceptance criteria

- [x] A freshly imported recognized `.refl` file opens with only its measured reflectivity/intensity curve selected. **2026-09-14 (Claude):** backend, `tests/test_io_ncnr.py::test_refl_declares_uncertainty_and_resolution_roles` asserts `ds.metadata["default_value_channels"] == [0]` on the real fixture; frontend, `frontend/src/lib/plotdata.test.ts`'s "BUG-001: an NCNR .refl import selects only the measured channel by default" pins `defaultDenseChannels` to `[0]` on an all-equally-dense 3-channel dataset (so the hint, not the density heuristic, is what is doing the work), and `frontend/src/store/reimport.test.ts`'s "only the measured channel is the default (before any customization)" (inside the BUG-001 describe block) asserts the same against the real NCNR-shaped metadata — its own comment names this exact acceptance criterion.
- [x] Vertical bars represent the intensity uncertainty. **2026-09-14 (Claude):** `frontend/src/lib/errorbars.test.ts`'s "NCNR reductus .refl role bindings (BUG-001)" describe block, case "binds the uncertainty channel to a VERTICAL (y-axis) span on the measured series" — asserts `buildErrorSpans` produces a y-axis span from the uncertainty column's own values; end-to-end confirmation through the real render hook in `usePlotPayload.errorRoles.test.ts`'s "draws a VERTICAL span from the uncertainty binding and a HORIZONTAL span from the resolution binding".
- [x] Horizontal bars represent Q resolution when provided. **2026-09-14 (Claude):** same describe block, case "binds the resolution channel to a HORIZONTAL (x-axis) span, not a y one" — asserts an x-axis span from the resolution column; same end-to-end hook test as above.
- [x] Neither uncertainty column appears as a normal legend series unless the user explicitly chooses to plot it. **2026-09-14 (Claude):** default-hidden half — `errorbars.test.ts`'s "draws neither uncertainty nor resolution as a plotted series alongside the spans" (only channel 0 is ever passed as `plotted`) and `usePlotPayload.errorRoles.test.ts`'s "plots only the measured channel; uncertainty/resolution never appear as series". Explicit-choice half — `reimport.test.ts`'s "a customization that WIDENS the default (plotting uncertainty as an ordinary series) survives a same-shape reimport" drives the real store (`yKeys: [0, 1]`, the Channels-card checkbox path) and confirms uncertainty stays plotted once the user asks for it.
- [x] The worksheet still exposes every original column and value. **2026-09-14 (Claude):** `tests/test_io_ncnr.py::test_refl_declares_uncertainty_and_resolution_roles` asserts `ds.labels == ("Intensity", "uncertainty", "resolution")` and `ds.values.shape == (325, 3)` on the real fixture — every imported column present and untouched, exactly this criterion's wording.
- [x] Ambiguous/unrecognized layouts are not silently given confident but unsupported bindings. **2026-09-14 (Claude):** `tests/test_io_ncnr.py::test_refl_roles_fail_safe_on_unrecognised_layouts` (parametrized: swapped uncertainty/resolution order, and no recognisable token at all) asserts `_refl_role_metadata(...) == {}` — no roles emitted, rather than a confident but wrong binding.
- [ ] Owner verifies the reported file visually on Windows.

### Completion record

- PR/commit: in progress on `claude/repo-evaluation-l7y7k9` (parser roles + the
  frontend consumer they needed)
- Automated tests: `tests/test_io_ncnr.py` (declared roles, unit-gating,
  fail-safe layouts, the `R`/`dR`/`dQ` spelling);
  `frontend/src/store/importDatasets.test.ts` (declared roles honoured
  including the X binding, precedence over the label guess, malformed entries
  dropped with fallback intact). The two behavioural frontend tests were
  verified to fail without the change.
- Agent verification: the parser emits the roles and the store stores them;
  the rendered plot draws horizontal whiskers from an X binding on this
  dataset (`usePlotPayload.errorRoles.test.ts`); save/reopen round-tripping of
  the declared roles is confirmed (`workspace.test.ts:2149`) and same-shape
  reimport round-tripping of them is now covered too
  (`reimport.test.ts`); the "role overridable through the UI" and
  "user-customized visibility is not overwritten" criteria are now covered by
  NCNR-`.refl`-specific tests (2026-09-12, Claude — see the Implementation
  checklist above). Plot-window-rebinding preservation for this shape is now
  covered too (2026-09-12, Claude, second pass — see below).
- Owner verification: pending — required for this item (Windows, reported file)
- Notes: the fix needed a contract gap closed first. `metadata["error_roles"]`
  was written by the backend and read by NOTHING, so no parser could express an
  X error at all; `store/importErrorRoles.ts::parserErrorRoles` is that missing
  reader. `io/ncnr.py`'s `import_ncnr_dat` has the same latent problem for its
  own `dQ` column and is deliberately NOT changed here — out of scope for this
  item, and it needs its own fixture evidence.

- **2026-09-09 (Claude), verification pass closing the remaining automated-test
  checklist boxes + the omitted/extra-column parser gap:**
  - `_refl_role_metadata` (`src/quantized/io/ncnr.py`) changed from an
    all-or-nothing exact-3-column match to PER-COLUMN recognition: each
    candidate uncertainty/resolution channel binds (or not) purely on its own
    name+unit evidence (uncertainty: immediate-preceding-channel unit match;
    resolution: x-unit match), so a real variant that omits one of the pair, or
    carries extra value columns anywhere in the layout, still gets the
    bindings that ARE unambiguous, and an unidentifiable column is simply left
    plotted rather than voiding the whole file's roles. Channel indices are
    read from wherever the columns actually are — never reassigned to a fixed
    0/1/2 position. `tests/test_io_ncnr.py` gained 7 new/rewritten tests
    (omitted resolution, omitted uncertainty, leading/trailing extra columns,
    two duplicate-"uncertainty" columns beside a valid resolution, an
    unrecognised-token column beside a valid resolution) plus a rewrite of the
    unit-mismatch test for the new per-column semantics; all 7 were confirmed
    to FAIL against the pre-change parser before the rewrite (ncnr.py stayed
    424 lines, under the 500-line ceiling — no extraction needed).
  - Default-channel test: `frontend/src/lib/plotdata.test.ts` — a
    `.refl`-shaped, equal-density 3-channel dataset with
    `metadata.default_value_channels: [0]` asserts `defaultDenseChannels`
    returns `[0]` only (the density heuristic alone would have returned all
    three).
  - Rendering/payload test: `frontend/src/lib/plotdata.test.ts`'s
    `buildColumns` case, and `usePlotPayload.errorRoles.test.ts`'s first case
    (below) — both assert `series`/labels never contain "uncertainty" or
    "resolution".
  - Overlay/span test: `frontend/src/lib/errorbars.test.ts`'s new "NCNR
    reductus .refl role bindings" describe block asserts `buildErrorSpans`
    produces a y-axis span (vertical) from the uncertainty binding and an
    x-axis span (horizontal) from the resolution binding, keyed on the one
    plotted column — plus an end-to-end version through the real hook,
    `frontend/src/components/Stage/usePlotPayload.errorRoles.test.ts` (new
    file; `fetchPlot` mocked to delegate to the real `buildColumns`, matching
    the established `usePlotPayload.quickFigureParity.test.ts` pattern).
  - Log-axis regression: `frontend/src/lib/uplotOverlays.test.ts`'s new
    `errorSpansPlugin (item 4: log-Y axis, ...)` describe block — a
    `valToPos` stub mimicking a real log-scale uPlot (NaN for any
    non-positive input) confirms the plugin hands the RAW, unclamped
    lower-whisker value through (producing NaN, which a real canvas silently
    skips) rather than altering the magnitude, and that neither the plotted
    data nor the span magnitudes are mutated by drawing.
  - Round-trip test: `frontend/src/lib/workspace.test.ts` gained a
    BUG-001-labeled case round-tripping the exact declared Y+X shape through
    `serializeWorkspace`/`parseWorkspace` (the pre-existing generic
    asymmetric/X-error round-trip test already covered the mechanism; this
    pins the actual NCNR shape). `frontend/src/store/useApp.test.ts` gained a
    `duplicateDataset` case for a RICH (X-error) binding specifically — the
    pre-existing F5 test only covered the `errorRoles: []` marker, not a rich
    binding — confirming the clone gets an independent array with the same
    bindings. Reimport and plot-window-rebinding preservation were NOT
    exercised this pass; still open (2026-09-12: reimport round-tripping is
    now covered — see below and the Implementation checklist; plot-window
    rebinding remains open).
  - **Review round (same day), two real defects in the above, both fixed:**
    (1) `_measured_channel_for_uncertainty` rejected a BLANK unit outright, so a
    dimensionless reflectivity — `R`/`dR` with no units, an ordinary reductus
    spelling — got no Y binding and `dR` was still drawn as its own curve: the
    original BUG-001 symptom, and a test had locked it in. Units must now
    AGREE, and two blanks agree. The asymmetry with `_resolves_to_x_axis`
    (which still demands a non-empty unit) is deliberate and documented: the
    uncertainty pairing already has its own name plus adjacency to a non-error
    column as independent evidence, whereas an x-axis binding has neither, so
    there the unit is the only evidence. (2) `default_value_channels` listed
    EVERY unbound channel, and a non-empty hint short-circuits
    `defaultDenseChannels`' density heuristic (`lib/plotdata.ts:189`, verified)
    — so a monitor/`Lambda`/unit-mismatched column the parser explicitly
    declined to reason about was PINNED as a plotted curve where the heuristic
    used to hide it, turning "I don't know what this is" into a confident
    plotting decision. It now lists the identified measurement targets only,
    which is what this item's own acceptance criterion asks for ("only its
    measured reflectivity/intensity curve selected"); unrecognised columns stay
    in the worksheet and stay toggleable. Pinned by
    `test_refl_roles_bind_a_dimensionless_r_dr_dq_file_and_plot_only_r`.
  - Gates run: `uv run ruff check src tests tools`, `uv run mypy src`,
    `uv run pytest tests/test_io_ncnr.py -q` (26 passed) all green;
    `npx tsc --noEmit -p tsconfig.json` clean; `npx eslint <touched files>
    --max-warnings=0` clean; targeted `npx vitest run` on every touched/new
    file plus `src/architecture.test.ts` — 757 passed, 0 failed (confirms the
    weak-wait ratchet and size-ceiling guards are unaffected). Full frontend
    suite and `npm run build` intentionally NOT run (left to the requester
    per instructions).
  - Still open / not verified this pass: owner's Windows visual check on the
    reported file; the "role overridable through the UI" and
    "user-customized visibility survives the default" criteria (no NCNR-.refl-
    specific test written for either); reimport and plot-window-rebinding
    round-tripping.

- **2026-09-12 (Claude), closing the remaining code-verifiable checklist
  boxes (owner/hardware boxes untouched):**
  - **Implementation checklist item "Keep every role overridable..."**:
    NCNR-`.refl`-specific test added, `frontend/src/components/Stage/
    usePlotPayload.errorRoles.test.ts` — see that checklist line for detail.
    Sabotage-verified (no-op override) FAILED both new tests before revert.
  - **Implementation checklist item "Verify that user-customized channel
    visibility is not overwritten..."**: NCNR-`.refl`-specific test added,
    `frontend/src/store/reimport.test.ts` — see that checklist line for
    detail. Sabotage-verified (always-reset `viewReset`) FAILED all three new
    assertions (and the pre-existing generic pin) before revert.
  - **Stale-record reconciliation**: the "reimport/save/reopen round-trip"
    mention above was stale for the save/reopen half — `workspace.test.ts:2149`
    already covers the exact NCNR Y+X shape (landed 2026-09-09, confirmed by
    reading it, not redone). The reimport half is now genuinely covered too
    (this pass, unchanged-shape case). Plot-window rebinding (drag/drop onto
    an existing window) was the one sub-case of this item that remained
    unverified after this pass — now covered, see the follow-up 2026-09-12
    entry below.
  - **Automated-test checklist item "Relevant backend, frontend, type-check,
    and production-build gates pass."**: run in full this pass (previously
    deferred to the requester).
    - `npx tsc -b --force`: clean (exit 0).
    - `npx eslint src/components/Stage/usePlotPayload.errorRoles.test.ts
      src/store/reimport.test.ts src/store/importErrorRoles.ts
      src/store/reimport.ts --max-warnings=0`: clean.
    - `npx vitest run` (targeted: both new/touched files + every file this
      item's Completion record already names + `architecture.test.ts`): 468
      passed, 0 failed.
    - `npx vitest run` (FULL suite, 2026-09-12, after `npm ci`): **625 test
      files, 10049 tests, all passed, 0 failed** (606s).
    - `npm run build` (via `npm ci` first, per this repo's own
      "vite's transform cache also lies" lesson): **succeeded** — `tsc -b`
      clean, `vite build` clean (955 modules), `check-bundle-size.mjs`:
      "bundle-size: OK — 896.3 kB eager, 0.9 kB under budget" (897.3 kB).
  - No backend/parser code touched this pass (scope was additive frontend
    tests + this plan file), so `uv run pytest tests/test_io_ncnr.py -q`
    (26 passed, per the prior pass) was not re-run.
  - Still open after this pass: owner's Windows visual check on the reported
    file (Acceptance criteria); the "check a Reductus variant beyond the
    fixture" and "confirm manual Error-Columns assignment in the current
    release" reproduction-checklist items (need a human/external file);
    plot-window-rebinding preservation of the declared roles across a
    reshape/rebind — now covered, see the follow-up 2026-09-12 entry below.

- **2026-09-12 (Claude), second pass — the plot-window-rebinding checklist box
  closed (the last code-verifiable box on this item):**
  - Found the existing rebind action: `store/windows.ts`'s `rebindWindow` (the
    EXPLICIT drag/drop gesture) already threaded `errors: ds?.errorRoles,
    resetErrors: true` into `store/windowDocuments.ts`'s `syncPlotWindow` for
    BOTH the focused-window path (`focusedRebindPatch`) and the
    background-window path — reading the dataset's rich `errorRoles` fresh off
    the store at rebind time, not a value captured at import. Reading the code
    first (per the verify-before-building rule) found the wiring already
    correct; the gap was verification, not implementation.
  - New tests: `frontend/src/components/Stage/usePlotPayload.errorRoles.test.ts`'s
    "rebindWindow (drag/drop) preserves an NCNR .refl's declared error roles
    (BUG-001, plot-window rebinding)" describe block (3 cases), mirroring the
    file's own established fixture-loading pattern (the real
    `useApp.getState().importPaths` against a hand-built payload matching
    `tests/golden/ncnr_j395_default.json`'s first five rows, exactly as the
    two describe blocks above it and `store/reimport.test.ts`'s BUG-001 block
    already do):
    1. A FOCUSED window opened on a plain dataset, then rebound via the real
       `rebindWindow` action onto the NCNR dataset: the window's own
       `document.bindings.errors` equals the parser-declared roles, AND the
       window's own rendered payload (the real `usePlotPayload` hook, fed
       `documentErrors` exactly as `PlotStage` threads it for a focused
       window) draws both the Y (uncertainty) and X (resolution) whiskers.
    2. The SAME rebind onto a BACKGROUND (unfocused) window: the declared
       roles land on that window's own document too, and rebinding it never
       touches `focusedWindowId` or the other (focused) window's binding —
       exercises `rebindWindow`'s OTHER branch (the non-focused-window `else`
       in `store/windows.ts`).
    3. An explicit `setErrorRoles` override applied to the NCNR dataset
       BEFORE it is ever dropped onto a window: the rebound window ends up
       with the OVERRIDE, not the parser's original declaration — confirming
       `rebindWindow` reads the dataset's CURRENT roles, not a stale value.
  - Sabotage-verified, each restored immediately after: removing
    `errors: ds?.errorRoles, resetErrors: true` from `focusedRebindPatch`'s
    `syncPlotWindow` call made cases 1 and 3 FAIL (2 failed/8); separately
    removing the same option from `rebindWindow`'s background-window
    `syncPlotWindow` call made case 2 FAIL (1 failed/8, exactly the
    background test) — confirming both branches are independently covered
    and the tests genuinely exercise the code they guard, not a shared
    incidental path.
  - Gates run (frontend-only; no `src/quantized/` code touched, so no backend
    gate): `npx tsc -b --force` clean (exit 0); `npx eslint` on every touched
    file clean; targeted `npx vitest run` (the new/touched file plus
    `architecture.test.ts` and every DatasetRow/FigureRow/WorkbookRow/
    FolderRow/ArtifactRow/window test this pass also touched for UX-001) —
    671 passed, 0 failed; FULL `npx vitest run` (after `npm ci`) — see the
    combined gate summary at the end of the UX-001 entry below (this session
    ran ONE full suite + build covering both items).
  - Not done / out of scope: the owner's Windows visual check, the Reductus
    variant check, and the manual Error-Columns UI check remain open (need a
    human/external file, per the item's own State line) — not touched here.

---

## UX-001 — Origin workbook worksheet cards are oversized and unclear

**Priority:** P1 — major friction parsing imported Origin projects  
**State:** In progress — compact Tree row implemented and test-verified; owner visual verification still required before this can be marked complete  
**Reported:** 2026-09-08 by owner  
**Investigated:** 2026-09-08 by ChatGPT-Sol  
**Suggested implementation owner/model:** ChatGPT-Sol or a lower-cost Codex frontend model for interaction/CSS; Claude Sonnet for integration/reliability review  
**Related plan:** `plans/LIBRARY_WORKBOOK_UX_PLAN.md`

### User-visible problem

Expanded Origin books show large rectangular worksheet/dataset cards in the left Library. The cards contain a sparkline, point count, channel count, duplicate/delete icons, and an add/plot control, but that structure is not apparent. Similar truncated names and weak type cues make it difficult to tell:

- whether a box represents a book, worksheet, dataset, or saved graph;
- why some items are large preview cards while others are compact rows;
- what each icon does;
- which item owns the currently displayed plot; and
- whether clicking, double-clicking, or the `+` control opens, plots, or adds the item.

The result is particularly difficult in a large imported Origin project, where hierarchy comprehension matters more than decorative previews.

### Design direction

Use a compact, scan-first Origin-like tree as the default for expanded workbook contents. A worksheet row should communicate type, name, status, and key size information before offering a preview. Thumbnails remain valuable, but should be an explicit expanded state or part of the existing Tiles view rather than forcing every tree item to become a tall card.

### Research and decision checklist

- [x] Inventory every row/card type that can appear beneath an imported Origin folder and workbook. — `LibraryTree.tsx`'s dispatcher: `worksheet`→`DatasetRow`, `origin-figure`→`FigureRow`, `workbook`→`WorkbookRow`, `folder`→`FolderRow`, everything else→`ArtifactRow`.
- [x] Document what each existing icon and badge means and which actions are duplicated elsewhere. **Tree-wide audit, 2026-09-12 (Claude):** `frontend/src/components/Library/rowIconAccessibility.test.tsx` renders each of the five row kinds (`DatasetRow` in both its full-card and compact-Tree layouts, `FigureRow`, `WorkbookRow`, `FolderRow`, `ArtifactRow`) and asserts every icon-only interactive control (`<button>`/`role="button"`) carries an `aria-label` or `title` — all already did except none found needing a fix on the interactive side. A second describe block in the same file targets informative count/icon BADGES (non-interactive) the same way and found one real inconsistency: `FolderRow`'s dataset-count chip had no `title` at all, unlike `WorkbookRow`'s identically-shaped worksheet-count chip — fixed by giving it one (`FolderRow.tsx`). No duplicated action was found among any row's icon-only controls (each names a distinct action — drag/menu/expand/duplicate/remove/move/tag-add/tag-remove/preview-toggle/open-in-new-window/etc.) — a read-through finding, not test-asserted, since "no duplicate" has no single automatable signal here.
- [x] Determine why the reported worksheets render as large cards while Graph2/Graph8/Graph9 render as compact rows. — a component choice, not CSS: `DatasetRow.tsx` rendered a 4-part stacked card with an always-mounted `Sparkline`; `FigureRow.tsx` was already a single-line `.qzk-fig-item`.
- [x] Check whether the current Tree/Tiles/Details preference already provides a compact alternative for these exact nodes. — `LibraryDetails.tsx` already renders every kind as a uniform compact `<tr>`; this was a Tree-view component gap, not a missing capability.
- [x] Reconcile this item against unfinished work in `LIBRARY_WORKBOOK_UX_PLAN.md`; do not create a second competing hierarchy model. — the fix changes only how a `worksheet` node renders inside Tree; `lib/libraryHierarchy.ts`'s `buildLibraryHierarchy`/`flattenLibraryHierarchy` is untouched and still the single structural truth.
- [ ] Test hierarchy comprehension with a project containing several books, sheets, and saved graphs with similar names. — needs a real user/owner session; not exercised here.

### Interaction checklist

- [x] Make the node type explicit: Folder, Workbook, Worksheet/Data, or Graph/Figure. — Folder (▦)/Workbook (▤) already had glyphs; added Worksheet (▥, `DatasetRow.tsx`) and Graph (⌁, `FigureRow.tsx`), same aria-hidden+title convention.
- [x] Use compact worksheet rows by default in Tree view. — `DatasetRow.tsx`'s `treeMode` branch is now a single `.qzk-ds-compact-row` line; the flat/search-list and Smart Folders card is unchanged (they never pass `treeMode`).
- [x] Allow an optional inline thumbnail expansion without changing selection or opening a plot. — `DatasetRowPreview.tsx`'s toggle mounts/unmounts the existing `Sparkline`; `stopPropagation` keeps it out of the row's select/open handlers. Test-verified (see Automated tests).
- [x] Keep richer thumbnails in Tiles view. — Tiles/`TilePreview.tsx`/`useThumbnail.ts` untouched.
- [x] Show the complete name through resizing and a short hover tooltip when truncation is unavoidable. — `DatasetRowParts.tsx`'s `DatasetRowName` keeps the pre-existing `.qzk-ds-name` (flex:1/min-width:0/ellipsis) + full-name title tooltip, shared by both row layouts.
- [x] Give icon-only actions one-sentence tooltips and accessible names. — within the rows touched: added `aria-label` to Duplicate/Move up/Move down (previously title-only); the preview toggle and every relocated `DatasetRowControls` icon carry both. Not a full tree-wide icon audit (see the open research item above).
- [x] Make the primary row click behavior consistent and discoverable. — click/dblclick/selection semantics (L0.25) are unchanged, just relocated behind the same handlers.
- [x] Put secondary actions in a consistent right-click/overflow menu; avoid a permanent strip of unexplained icons. — the compact row drops the always-visible ▲▼⧉✕ strip; Duplicate/Remove/Add tag/etc. stay reachable through the existing "⋯"/context menu (`datasetRowMenu.ts`), unchanged.
- [x] Clearly distinguish selection from the item currently open in a plot or worksheet. **2026-09-12 (Claude):** "open" reads as the dataset shown in the ACTIVE window (the obvious reading per this item's own steer) — the existing `activeId` store state `LibraryTree.tsx` already passes to `DatasetRow` as `active={node.entity.id === activeId}`, no new state added. The `.active` CSS class (distinct from multi-select's `.selected` — separate border/box-shadow vs. background recipes in `shell.css`, both design tokens only) already carried this visually; the gap was a semantic marker, so `DatasetRow.tsx`'s row now also carries `aria-current="true"` exactly when `active`, independent of `selected` in both directions (a row can be plotted AND part of a multi-selection at once). Tested at the DOM layer: `frontend/src/components/Library/DatasetRow.test.tsx`'s "DatasetRow — aria-current marks the OPEN item, independent of multi-select (UX-001)" describe block (5 cases: active-only, selected-only, both, neither, and the compact Tree layout) asserts the `aria-current` attribute and both classes independently. Sabotage-verified: removing the `aria-current` prop made exactly the 3 cases that expect it present FAIL (3 failed/50), the 2 negative-case tests stayed green; reverted.
- [x] Preserve keyboard navigation, multiselect, drag/drop, and context-menu behavior. — `LibraryTree.test.tsx` (705 lines) and `DatasetRow.test.tsx` (538 lines) pass unmodified against the new layout.
- [x] Ensure large projects remain performant when thumbnails are collapsed. — the always-mounted `Sparkline` (~120+ synchronous SVG builds per Tree render) is now opt-in per row.
- [x] Do not lose Origin book/sheet provenance or saved-graph relationships when simplifying the presentation. — sheet chip, Origin routing, `DerivedWorksheetMark`, drag/drop all preserved verbatim in `DatasetRowParts.tsx`'s `DatasetRowControls`.

### Suggested compact row contents

- Disclosure arrow where the node has children
- Type icon plus plain-language tooltip
- Fullest practical worksheet/graph name
- Concise secondary text such as `322 rows · 3 columns`
- Small state badges only when meaningful, for example `Origin` or `missing source`
- One visually clear overflow/actions button
- Optional thumbnail disclosure, not an always-expanded card

### Acceptance criteria

- [ ] A new user can identify folders, workbooks, worksheets, and saved graphs without trial-and-error clicking. — glyphs now exist for all four kinds; a real judgment call needs an actual new-user/owner session.
- [ ] At least six worksheet rows are comfortably visible in a typical-height Library without scrolling past large previews. — very likely true (a compact row is one ~20-24px line vs. the prior ~90-110px card) but not visually confirmed against a rendered viewport — no screenshot taken this pass. **2026-09-14 (Claude), partial evidence added, still left unticked:** `frontend/src/components/Library/LibraryTree.compactRows.test.tsx` renders the real `LibraryTree` with 8 worksheets and confirms, at the DOM+CSS-text layer, the two structural facts that ARE honestly establishable without a real browser: every worksheet row is a single line with no `.qzk-ds-spark`/`.qzk-ds-foot` child mounted by default (no preview, no full-card footer), and `shell.css` declares the compact modifier's padding as measurably smaller than the full card's (`3px 4px` vs `8px 9px`). That is NOT the same as proving six such rows fit in a 480px panel: `shell.css` declares no `height`/`line-height` for `.qzk-ds-compact`/`.qzk-ds-compact-row`/`.qzk-ds-name`, so the row's actual rendered height depends on the browser's font-metric default line-height, which neither CSS-text parsing nor jsdom's layout-free DOM can supply. Sabotage-verified (forcing the preview open by default via `DatasetRowPreview`'s `isPreviewExpanded` call, and inflating the compact padding to the full card's in a scratch edit of `shell.css`) made the corresponding assertions fail; both reverted byte-identical. Left unticked per this box's own honesty requirement.
- [x] A user can reveal a plot thumbnail when desired without opening or replacing the active plot. — test-verified: `selectedIds`/`activeId` unchanged after toggling the preview.
- [x] Names and action meanings are recoverable even when the Library is narrow. — the tooltip/ellipsis mechanism is preserved, not re-tested at a narrow panel width. **2026-09-14 (Claude):** `LibraryTree.compactRows.test.tsx`'s "narrow-panel name/action recoverability" describe block renders the real `LibraryTree` with a deliberately long worksheet name and asserts (1) the name element's `title` attribute contains the full, untruncated name — recoverable regardless of rendered width — and (2) `shell.css`'s `.qzk-ds-name` rule declares `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap` (parsed from the stylesheet text via `styles/cssRules.testkit.ts`, not assumed). Sabotage-verified: stripping the `title` attribute from `DatasetRowParts.tsx`'s name span, and separately dropping the three overflow declarations from `shell.css`'s `.qzk-ds-name` rule, each made its corresponding assertion fail; both reverted byte-identical.
- [x] Tree, Tiles, and Details views retain consistent selection and activation behavior. — Tiles/Details untouched; Tree's selection/activation logic is unchanged (only the worksheet row's markup changed), and `LibraryTree.test.tsx` passes unmodified.
- [ ] The reported Origin project remains navigable with no missing or duplicated nodes. — not tested against the owner's actual reported project (not available here).
- [ ] Owner verifies the revised workflow on the reported project. — pending; required before this item can be marked complete.

### Completion record

- PR/commit: committed locally in this worktree (not pushed, no PR opened per task instructions).
- Automated tests: `frontend/src/components/Library/DatasetRowCompact.test.tsx` (new, 7 cases — compact-row shape, glyph, meta text, opt-in preview mount/unmount, no-selection-change, localStorage persistence, flat-mode regression guard) and `frontend/src/lib/libraryPreviewPrefs.test.ts` (new, 3 cases) all pass and were individually sabotage-verified (broke the code path each covers, confirmed the test failed, restored). Full existing suite green (see Agent verification) — `DatasetRow.test.tsx` and `LibraryTree.test.tsx` pass with ZERO changes to their assertions.
- Agent verification: worksheet Tree rows are now a single compact line (glyph + name + `N pts · Mch` + opt-in preview toggle), matching `FigureRow`'s existing compact shape; the sparkline no longer mounts unconditionally; expanding/collapsing it never touches `selectedIds`/`activeId`; all pre-existing keyboard/drag/context-menu/roving-focus behavior is unchanged (same tests, same assertions, all passing). `tsc --noEmit`, `eslint src`, and the full `vitest run` suite are clean; `npm run build` + the bundle-size ratchet are clean (see gate numbers in the implementation session's own report).
- Owner verification: pending — required for this item (visual review of the reported Origin project, real-viewport row-count check, narrow-panel truncation check).
- Notes: scope was deliberately narrow — only `DatasetRow.tsx`'s `treeMode` (Tree) branch changed; the flat/search-list and Smart Folders card, Tiles, Details, and `LIBRARY_WORKBOOK_UX_PLAN.md`'s hierarchy model are all untouched. A full tree-wide icon/badge audit and the "distinguish selection from the item open in a plot" item remained open at the time this note was written — both closed 2026-09-12 (Claude), see the dated entry below. The eager-bundle ratchet (`frontend/scripts/check-bundle-size.mjs`) needed a raise — 910,748 → 912,503 bytes (+1,755, budget raised to measured + 1,024 = 913,527) — after a measured `React.lazy()` split of the preview toggle came back WORSE (fragmented Sparkline's own shared chunks) and was reverted, and deduplicating the two row layouts' shared JSX/logic recovered 415 of the original 1,146-byte overage; the dated history entry in that file has the full measurement trail.

- **2026-09-12 (Claude), the two remaining UX-001 residuals closed:**
  - **(a) Tree-wide icon/badge audit**: new test file
    `frontend/src/components/Library/rowIconAccessibility.test.tsx` renders
    all five Library row kinds and asserts every icon-only `<button>`/
    `role="button"` carries an `aria-label` or `title`; all already did.
    A second describe block applies the same requirement to non-interactive
    count/icon badges and found one real gap: `FolderRow.tsx`'s dataset-count
    chip had neither, unlike `WorkbookRow.tsx`'s sibling worksheet-count chip
    — fixed with a `title` (`FolderRow.tsx`), mirroring the existing
    convention. Sabotage-verified: reverting the `FolderRow.tsx` fix made
    exactly the one targeted test FAIL (1 failed/8); every other row kind's
    test passed both before and after (no fix was needed there), confirming
    the audit is real, not vacuous.
  - **(b) Selected vs. open**: "open" = the dataset shown in the ACTIVE
    window — the existing `activeId` state `LibraryTree.tsx` already threads
    into `DatasetRow`'s `active` prop (no new state). `DatasetRow.tsx` now
    also sets `aria-current="true"` on the row when `active`, independent of
    `selected`; the pre-existing `.active`/`.selected` CSS classes (both
    design-token-only) already distinguished the two visually. Tested at the
    DOM layer in `DatasetRow.test.tsx` (5 cases covering all four
    active×selected combinations plus the compact Tree layout);
    sabotage-verified (removing the prop failed exactly the 3 cases that
    require it, 3 failed/50; reverted).
  - Gates (frontend-only; `src/quantized/` untouched): `npx tsc -b --force`
    clean; `npx eslint` on every touched file clean; targeted `npx vitest
    run` (all five row-kind test files + `rowIconAccessibility.test.tsx` +
    `usePlotPayload.errorRoles.test.ts`/`.test.ts` + `useApp.test.ts` +
    `windows.test.ts`/`windowDocuments.test.ts`/`reimport.test.ts` +
    `architecture.test.ts`) — 671 passed, 0 failed. `DatasetRow.tsx` landed
    exactly AT the 400-line `.tsx` ceiling (400 after trimming the added
    comment) — no extraction needed, no pin raised. See the combined FULL
    suite + build numbers at the end of this entry (one gate run covered
    both this pass and BUG-001's plot-window-rebinding pass above).
  - Not done / explicitly out of scope, per this item's own steer: the "pick
    the obvious reading" note above IS the product decision for (b) — no
    further decision needed; owner visual verification of the reported
    Origin project remains pending (unchanged from the prior pass).

---

## BUG-002 — a hard-linked alias defeats the declared-source write guard

**Priority:** P2 — substantial, but the worst outcome is a refused-save that
isn't refused, not lost data. See "Why this is P2 and not P0" below; that
bounding is itself test-locked, so re-check it before re-rating.

**Found:** 2026-09-09, by the P1.1 path-shape coverage pass (not by a user).

### User-visible problem

The desktop bridge refuses to let a project save overwrite one of the project's
own raw source files — the guard that stops a "Save" from silently destroying
the data the project was built from. That check compares path STRINGS, so it
does not recognise a second name for the same file. Saving through a hard-linked
alias of a declared source is permitted when it should be refused.

### Confirmed implementation evidence

- `src/quantized/desktop_consent.py:320` (`is_declared_source`) and
  `src/quantized/desktop_project_file.py:139-190`
  (`payload_declares_source`) both key the decision on a path string after
  `realpath`/`normcase`/`normpath` — never on filesystem identity
  (`st_dev`/`st_ino`).
- `realpath` resolves SYMLINKS, so a symlinked alias is already handled. A
  HARD LINK has no link to resolve: two directory entries name one inode and
  both are "real" paths, so string comparison cannot see them as one file.
- Reproduced on Linux, and pinned as a **strict** xfail so it converts to a
  failure the moment the behaviour changes:
  `tests/test_desktop_bridge_path_shapes.py::test_a_hardlinked_alias_of_the_declared_source_is_wrongly_permitted_as_a_write_target`.

### Why this is P2 and not P0

`portable/publish.py`'s `atomic_replace_file` writes to a temp file and then
`os.replace`s it into position. That REPLACES the directory entry rather than
mutating the shared inode, so the alias is severed and the original raw file
survives byte-for-byte even when the guard is bypassed. That mitigation is not
incidental to this rating — it is locked in by
`test_hardlink_bypass_does_not_actually_corrupt_the_shared_inodes_bytes`. If
any write path is ever changed to write in place, this becomes a data-loss bug
and must be re-rated P0.

### Suspected sibling case (NOT reproduced)

The same string-keyed design should also miss an NFC/NFD respelling of one
filename on a normalization-insensitive filesystem (macOS HFS+/APFS), where two
different byte sequences name one file. This could not be reproduced in the
Linux-only gate, so it is recorded as a plausible consequence of the same root
cause, **not** as an established fact. It needs a macOS check before anyone
acts on it.

### Why it was not fixed on discovery

The obvious fix — stat every declared source on every quick-save and compare
`(st_dev, st_ino)` against the destination — is exactly the per-source I/O that
`payload_declares_source`'s own docstring says was deliberately avoided: an
unreachable network source would pay a full SMB timeout on every save. Choosing
between a correct guard and a save that cannot hang is an owner design call,
not a drive-by patch.

### Fix checklist

- [ ] Decide the tradeoff explicitly: identity-based comparison, a bounded/
  cached stat, or an accepted documented limitation.
- [ ] If identity-based: ensure an unreachable source cannot make a save hang
  (a timeout or a skip-on-error path), and test that case.
- [ ] Flip the strict `xfail` to a passing test in the same commit as the fix.
- [ ] Check the macOS NFC/NFD sibling case on real macOS, then either fix or
  explicitly rule it out here.
- [ ] Re-read the P2 rating above once the write path is settled.

### Completion record

_(empty — open)_

---

## UX-002 — copy/paste drops cross-workbook lineage without saying so

**Priority:** P3 — nothing is corrupted and no scientific value is wrong; the
user simply is not told that a link was not carried over.

**Found:** 2026-09-09, in the review round of the derived-data provenance
verification pass (not by a user).

### User-visible problem

Copying or duplicating a workbook drops any lineage link that points OUTSIDE
that workbook, and says nothing. The pasted worksheet looks complete; its
"this is version 2 of ..." relationship is simply gone.

### Why the drop itself is correct

`pasteTransferPackage` rewrites every internal reference to the fresh ids it
mints, and drops any reference whose target is not in the package. The
alternative is a dangling id pointing into a project the destination may not
even have open — exactly what the fresh-id rewrite exists to prevent. **The
drop is not the bug. The silence is.**

### Why it hits `versionOf` essentially every time

"Import as new version" (`store/relink.ts:303`) tags the newly imported dataset
with the OLD dataset's id, and that import created a brand-new workbook
(`store/importDatasets.ts:271` — a single-file import is always its own
workbook). So a version link crosses a workbook boundary **by construction**,
and is therefore dropped by any single-workbook copy. `derivedFrom` is hit in
the narrower case where a derived sheet's source was moved out (Separate
Worksheets sweeps only downstream dependents).

### Confirmed implementation evidence

- `lib/workbookTransfer.ts:375` — `next.versionOf = rewriteRef(d.versionOf)`;
  `rewriteRef` returns `undefined` for an out-of-package target and increments
  `droppedExternalRefs` (`:353-357`). The module header (`:70-76`) documents
  this rule for `bgRef`/`derivedFrom`/`versionOf` explicitly.
- `droppedExternalRefs` is returned from `pasteTransferPackage` (`:405`) and
  read by **nothing** outside tests — verified by grep across `frontend/src`.
- Behaviour pinned by `lib/workbookTransfer.test.ts`'s "drops cross-workbook
  lineage rather than dangling it — versionOf and an external derivedFrom",
  which is sabotage-verified (dangling the ref instead of dropping it fails it).

### Fix checklist

- [x] Surface `droppedExternalRefs` after a paste — a toast or a status line
  saying how many lineage links could not be carried, not a silent success.
  **Shipped 2026-09-09 (Group J).** `store/workbookTransfer.ts`'s `refNote()`
  appends "— N reference(s) to data outside the copy not carried" to BOTH the
  persistent status line and the toast, for Paste AND Duplicate; the toast drops
  from `"ok"` to `"info"` when anything was dropped, because a green check reads
  as "clean". **"reference", not "lineage link", after the review round:**
  `rewriteRef` counts `bgRef` alongside `derivedFrom`/`versionOf`, and a dropped
  BACKGROUND reference is not provenance — it is a subtraction input, so losing
  it changes the plotted data, not just the history. It is therefore counted
  separately (`droppedBackgroundRefs`) and named in the message. Six tests in
  `store/workbookTransfer.test.ts`, all sabotage-verified, including a negative
  control ("does NOT annotate a transfer that carried everything") that fails
  when the note is forced ON.

  The same round found four of Paste's refusals toasted WITHOUT setting the
  status line, so a refused paste left the previous action's success message
  standing on the status bar. All nine refusal sites in the slice now go through
  one `fail()` helper; pinned by "a refused paste replaces the status line
  instead of leaving the last success standing".
- [ ] Decide whether a dropped link is worth preserving as inert historical
  text (e.g. the source dataset's NAME) rather than a resolvable id. This is a
  semantics call about what lineage means across a transfer boundary — do not
  invent it silently.
- [ ] If a "copy with dependents" scope is ever added, revisit: the link would
  then be internal and would not need dropping at all.

### Completion record

- PR/commit: the Group J commit (2026-09-09) — surfacing half only.
- Automated tests: `store/workbookTransfer.test.ts` — "names the dropped link
  count after a paste, and uses info rather than a clean ok", "names the
  dropped link count after a duplicate too", "pluralizes honestly — two dropped
  refs say 'references'", "names a dropped BACKGROUND reference separately — it
  is not provenance", "a refused paste replaces the status line instead of
  leaving the last success standing", "does NOT annotate a transfer that carried
  everything — ok stays ok".
- Agent verification: fix + four sabotage-verified tests.
- Owner verification: —
- Notes: **still open**, because box 2 is an owner semantics call, not work
  that was skipped: whether a dropped link should be preserved as inert
  historical text (the source dataset's NAME) rather than a resolvable id is a
  decision about what lineage MEANS across a transfer boundary. Only the count
  is surfaced; nothing about the drop rule itself changed.

---

## BUG-003 — a Data Filter predicate outlives a column's type change, invisibly

**Priority:** P2 — no data is lost and no scientific result is silently
wrong for the common case (the underlying `dataset.filter` entry is left
completely untouched, so nothing is destroyed and the row-filtering answer
is deterministic), but a user CAN end up staring at a Data Filter panel
that looks unconstrained while rows are still narrowed by a predicate they
can no longer see or edit through that panel. That is exactly the kind of
"can escape notice" mismatch the P0/P1 bar is written around, capped at P2
here only because the escape hatch (Clear) stays reachable — see
"Conservative behaviour implemented" below.

**Reported:** 2026-09-09, by Claude (PRIMARY_SOFTWARE_AUDIT_PLAN's Data
Filter categorical-wiring slice), while verifying the workbench's
`is_categorical`/`isCategoricalChannel` path per the task's own prompt:
"what a filter should do for a column whose type changes while a filter is
active" — the prompt's own example of a question prior art does not
settle.

**Investigated:** — (design-time finding: traced through the code and
pinned by a sabotage-verified test, not surfaced by a user report yet.)

**Suggested implementation owner/model:** — (needs an owner product
decision; see "What is NOT decided" below.)

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md`'s "Data Filter /
Tabulate / Stat Stage workbench wiring" box (P1.4/P1.5-adjacent).

#### User-visible problem

`frontend/src/components/workshops/datafilter/useDataFilter.ts` classifies
each column as `"range"` (continuous) or `"set"` (categorical/level-
membership) via `lib/modeling.ts`'s `channelModelingType` — which honors a
user's `setChannelType` override FIRST, before the `isCategoricalChannel`/
numeric-shape inference. That override can change independently of any
existing filter predicate on the same column (`setChannelType` never
touches `dataset.filter`). If a user:

1. Filters a categorical column down to a level subset (a `kind: "set"`
   predicate), then
2. Overrides that same column's type to "continuous" (or the reverse:
   filters a continuous column by range, then overrides it to "nominal", or
   a reimport changes whether the column carries `cat_levels` at all) —

the STORED predicate keeps its original `kind` forever (nothing rewrites
it), but the panel now renders the OTHER control for that column. A range
field cannot show `.values`; a checkbox list cannot show `.min`/`.max`. The
`Dataset.filter` entry (`lib/datafilter.ts`'s `rowPasses`/`filteredOutRows`,
which every downstream consumer — Tabulate, Distribution, `analysisData` —
reads) evaluates a predicate purely by ITS OWN stored `kind`, with zero
awareness of the column's now-different live classification, so the
predicate keeps narrowing rows exactly as before — just no longer
representable in the UI that wrote it.

#### Conservative behaviour implemented (this slice, Data Filter only)

`useDataFilter.ts`'s `columns` memo now only reports a stored predicate as
a column's `current` (the value the checkbox/range controls read from) when
its `.kind` matches the column's freshly-computed classification; a
mismatched leftover is treated as absent for DISPLAY. It is deliberately
NOT deleted from `dataset.filter` — reverting the override brings the exact
same predicate back as `current`, so no work is lost — and `useDataFilter`'s
`active` flag (which drives the panel's "Clear" button) still reads the RAW
filter array regardless of the mask, so a user who notices "showing fewer
rows than the checkboxes suggest" always has a one-click way to remove
everything. Editing the affected column (any `setRange`/`toggleLevel` call)
replaces whatever was stored for that column outright, so normal use
self-heals on the next interaction. Sabotage-verified:
`useDataFilter.test.ts`'s "a stale kind-mismatched predicate is masked, not
deleted" test (see the PR that introduced this entry for the sabotage
transcript — reverting the `stored?.kind === expectedKind ? stored :
undefined` masking makes it fail as expected).

#### What is NOT decided (needs an owner call)

- Should `lib/datafilter.ts`'s row-filtering (`rowPasses`/`filteredOutRows`
  — shared by Tabulate/Distribution/every `analysisData` consumer, all out
  of scope for this slice) keep applying a kind-mismatched predicate at
  all, or should it stop counting a predicate that no longer matches its
  column's live classification as active anywhere in the app, not just in
  this one panel's display?
- If it should stop being applied everywhere: should the stale entry then
  be auto-dropped from `dataset.filter` (simplest, but a silent auto-
  mutation of saved state with no user action) or just made globally inert
  while still stored (matches this slice's local masking, but means
  `lib/datafilter.ts` itself needs to know about column classification —
  a `DataStruct`/`Dataset`-level concern it currently has zero dependency
  on)?
- Should the panel instead surface the mismatch explicitly (a small
  "N hidden filter(s) don't match this column's current type" notice) so
  the inconsistency is visible rather than merely non-corrupting?

#### Reproduction

- [x] Starting state and sample data identified — a 2-level categorical
  column (`cat_levels`-backed or `channelTypes` override to "nominal") with
  an active `kind: "set"` filter predicate.
- [x] Exact actions recorded — call `setChannelType(id, col, "continuous")`
  (or, for the reverse case, override a continuous column to "nominal")
  while a filter predicate already exists on that column.
- [x] Actual result recorded — the panel now renders the OTHER control
  type for that column with no visible constraint; the stored predicate is
  untouched and (before this slice's fix) was surfaced as `current` on the
  wrong-shaped control.
- [x] Expected result recorded — see "Conservative behaviour implemented"
  above for what ships now; see "What is NOT decided" for the open
  question about `lib/datafilter.ts`'s row-filtering side.
- [x] Reproduced by an agent (`useDataFilter.test.ts`, sabotage-verified).

#### Investigation

- [x] Likely owning components/modules identified —
  `frontend/src/components/workshops/datafilter/useDataFilter.ts` (display
  masking, fixed this slice); `frontend/src/lib/datafilter.ts`
  (`rowPasses`/`filteredOutRows`, the row-filtering side, unresolved).
- [x] Root cause confirmed rather than inferred — read both modules; the
  kind-blind evaluation in `lib/datafilter.ts` and the lack of any
  filter-clearing side effect in `store/useApp.ts`'s `setChannelType` were
  both confirmed by direct inspection, not assumed.
- [x] Related workflows and persistence paths checked — `setChannelType`
  (`store/useApp.ts`), the filter round trip (`lib/workspaceSerialize.ts`/
  `lib/workspaceDatasetParse.ts`).
- [x] Existing plan overlap reconciled — filed against the
  PRIMARY_SOFTWARE_AUDIT_PLAN box this slice closed for Data Filter.

#### Implementation

- [x] Minimal safe behavior defined — see "Conservative behaviour
  implemented" above.
- [ ] Failure and ambiguous-data behavior defined for the UNRESOLVED
  `lib/datafilter.ts` row-filtering side — owner call needed.
- [x] Data integrity and backward compatibility considered — no auto-
  deletion; a saved project with a now-mismatched predicate still opens and
  round-trips it unchanged.
- [ ] UI wording/tooltips/accessibility for a "hidden filter" notice — not
  built; see "What is NOT decided."

#### Tests and acceptance

- [x] Regression test fails before the fix and passes afterward —
  `useDataFilter.test.ts`, sabotage-verified.
- [x] Relevant focused tests pass — full `datafilter` workshop suite green.
- [x] Type-check/build/repository gates pass — see the PR that introduced
  this entry.
- [ ] Agent verifies acceptance criteria for the unresolved half — blocked
  on the owner call above.
- [ ] Owner verifies when required.

#### Completion record

- PR/commit: — (Data Filter's display-masking half shipped in the commit
  that added this entry; the `lib/datafilter.ts` row-filtering half is
  still open.)
- Automated tests: `useDataFilter.test.ts` — "a stale kind-mismatched
  predicate is masked, not deleted (BUG-003)".
- Agent verification: display-masking half only.
- Owner verification: —
- Notes: Tabulate and Stat Stage were out of scope for the slice that filed
  this — worth checking whether either has the same
  `channelModelingType`-vs-stored-state staleness risk in its own state
  (e.g. Tabulate's group-column selection) when they get their own wiring
  slice.

---

## BUG-004 — a Stat Stage GROUP pick outlives its column's type change

**Scope corrected in review (2026-09-09), same day as filing.** This covers
`groupCol` ONLY. The first fix also masked `facetCol`, and that was a
regression: `useGraphBuilder` gates its seeded `groupCol` on
`isCategorical(...)` but passes `facetCol` through ungated, and `facetSlices`
has no categorical gate — so faceting on a non-categorical column is a
SUPPORTED configuration Graph Builder deliberately produces and announces
("faceted by <label>"). Masking it rendered one unfaceted panel while the
status line still claimed a facet. The rule that separates them: a pick is
"stale" only if NO live entry point could have produced it. Every way to set
`groupCol` is categorical-gated; `facetCol` has an ungated one.

**Priority:** P3 — narrower and lower-friction than BUG-003: the only
consumer of the stale value is this same hook (no shared row-filtering
fanout, no scientific-result risk — the fix below closes the gap
completely, on-screen, the same render cycle the override lands), and the
override itself (a manual "treat this column as continuous/nominal" action
on the Channels card) is an infrequent, deliberate user action.

**State:** Verified complete (fix + sabotage-verified regression tests);
owner sign-off still open.

**Reported:** 2026-09-09, by Claude (PRIMARY_SOFTWARE_AUDIT_PLAN's Tabulate/
Stat Stage categorical-wiring slice), while checking Stat Stage for the
same class of bug BUG-003 named for Data Filter, per that slice's own
prompt: "watch specifically for the analogue of the bug the Data Filter
slice found."

**Investigated:** 2026-09-09 by Claude (design-time finding, traced through
the code and pinned by sabotage-verified tests before any user report).

**Suggested implementation owner/model:** — (fix shipped this slice; an
owner may want to review the "mask the computation too, not just the
picker" call below against BUG-003's precedent.)

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md`'s "Data Filter /
Tabulate / Stat Stage workbench wiring" box; BUG-003 (same root cause,
different workbench).

#### User-visible problem

`frontend/src/components/Stage/useStatStage.ts` restricts its "group by"
and "facet by" `<Select>` option lists to `categoricalCols`
(`lib/statstage.categoricalChannels`, itself `channelModelingType`-gated —
override wins first). The PICKED `groupCol`/`facetCol` is separate local
`useState`, set once on mount/dataset-switch and otherwise left alone. If a
user:

1. Picks a categorical column as "group by" (or "facet by"), then
2. Overrides that same column's type to "continuous" via the Channels card
   (`setChannelType`, which never touches `groupCol`/`facetCol`) —

`categoricalCols` correctly drops the column (it's recomputed fresh every
render off the dataset's own — now-changed-by-reference — `channelTypes`),
but the raw `groupCol`/`facetCol` state still held that column's index. The
`<Select>`'s `value` then names an option no longer in its own `options`
list — a mismatched control, the same "stale selection invisible in the
panel that wrote it" symptom BUG-003 named for Data Filter — while, before
this fix, the actual box/violin/bar grouping and facet-slicing math kept
partitioning by that same now-uncategorized column regardless, so the
rendered chart and the toolbar could visibly disagree about what was
driving the split.

#### Fix implemented (this slice, full — not display-only)

`useStatStage.ts` derives `effectiveGroupCol`/`effectiveFacetCol` (masked
to `null` whenever the raw pick is no longer in the freshly-computed
`categoricalCols`) and threads them through EVERY downstream read —
`resolveGroups`/`resolveGroupsIndexed`, `computeBarData`,
`computeFacetBarDraws`/`computeFacetGroupDraws`, `facetSlices`, the
`groupLabel` string, the `showConnectMeans` gate, and the exported picker
values themselves — not only the `<Select>` display. Raw `groupCol`/
`facetCol` state is never cleared, so reverting the override brings the
exact same pick back automatically (the same self-healing property BUG-003
established for Data Filter's masking).

This goes further than BUG-003's "display-level only" masking, and that
divergence is deliberate, not an oversight: Data Filter's row-filtering
(`lib/datafilter.ts`) is shared app-wide (Tabulate, Distribution, every
`analysisData` consumer), so changing ITS behavior needed an owner call
and was left open. Stat Stage's `groupCol`/`facetCol` have exactly ONE
consumer — this same hook — so there is no wider blast radius to defer,
and leaving the computation unmasked while only fixing the display would
have created a WORSE, more visible contradiction than BUG-003's original
bug: the toolbar would read "(per channel)" while the rendered chart kept
showing per-category boxes labeled with the stale column's levels, on the
very same screen, at the very same time. An owner may still want to weigh
this as a data point for BUG-003's own still-open question (whether Data
Filter's row-filtering should likewise stop applying a stale predicate
everywhere, not just mask its display) — that call is not made here.

#### Reproduction

- [x] Starting state and sample data identified — a dataset with a ≥2-level
  categorical "group by" (or "facet by") column, actively picked.
- [x] Exact actions recorded — `setChannelType(id, col, "continuous")` on
  the picked group/facet column (same dataset, same id — the active-id
  reset effect does not fire).
- [x] Actual result recorded (pre-fix) — `groupCol`/`facetCol` stayed at
  the stale index; `categoricalCols` no longer listed it; the `<Select>`
  had a `value` with no matching `<option>`; `resolveGroups`/facet slicing
  kept using the stale column.
- [x] Expected result recorded — see "Fix implemented" above.
- [x] Reproduced by an agent — `useStatStage.test.ts`, sabotage-verified
  (reverting the `effectiveGroupCol`/`effectiveFacetCol` masking to the raw
  state makes all three new tests fail).

#### Investigation

- [x] Likely owning components/modules identified —
  `frontend/src/components/Stage/useStatStage.ts` (fixed this slice).
- [x] Root cause confirmed rather than inferred — read the hook in full;
  confirmed `categoricalCols` recomputes fresh (dataset gets a new object
  reference on every `setChannelType`) while `groupCol`/`facetCol` do not,
  by direct inspection, then reproduced it with a failing test before
  fixing.
- [x] Related workflows and persistence paths checked — neither
  `groupCol`/`facetCol`/`mode`/`valueCol` persist through `.dwk` at all
  (only the `statMode` boolean toggling the Stage view does — `PlotView` in
  `lib/plotview.ts`), so there is no save/reopen angle to this bug
  specifically; see the PRIMARY_SOFTWARE_AUDIT_PLAN slice notes for the
  broader persistence finding.
- [x] Existing plan overlap reconciled — filed against the same
  PRIMARY_SOFTWARE_AUDIT_PLAN box BUG-003 was filed against.

#### Implementation

- [x] Minimal safe behavior defined — mask to `null` (the documented
  "per plotted channel"/"no facet" fallback), applied to both display and
  computation; raw state untouched for self-healing.
- [x] Failure and ambiguous-data behavior defined — masking degrades to an
  already-existing, already-tested code path (the `groupCol === null`/
  `facetCol === null` fallback), not a new failure mode.
- [x] Data integrity and backward compatibility considered — no stored
  state changes shape; nothing persists across save/reopen for this
  picker anyway (see above).
- [x] UI wording/tooltips/accessibility — none needed; the `<Select>`
  simply falls back to its existing "(per channel)"/"(none)" option, no new
  copy.

#### Tests and acceptance

- [x] Regression test fails before the fix and passes afterward —
  `useStatStage.test.ts`'s "stale channelTypes override on groupCol/
  facetCol (BUG-004)" describe block, sabotage-verified by reverting the
  masking and confirming the groupCol tests fail while the rest of the suite
  stays green. **Review round:** the block's facetCol test originally asserted
  facet was masked too and has been INVERTED — it now pins that a
  non-categorical facetCol SURVIVES, with a companion test that a Graph
  Builder seed faceting on a non-categorical column still facets. A test that
  pins a regression is worse than no test, and that is what it was.
- [x] Relevant focused tests pass — full `useStatStage.test.ts` (29 tests)
  and `lib/statstage.test.ts` green; one PRE-EXISTING test in the same file
  ("all facet levels dropping → drawFacets null with the empty-groups
  error") had to be updated — it forced its "no data" edge case via an
  all-NaN GROUP column, which (correctly, now that classification gates
  the computation too) started falling back to the per-plotted-channel
  grouping instead of erroring, since that column was never reachable
  through the real picker to begin with once it stopped classifying as
  categorical. Reworked to force the same zero-groups outcome via an
  all-NaN VALUE column instead, which exercises the same downstream path
  without depending on a groupCol the UI could never actually offer.
- [x] Type-check/build/repository gates pass — see the PR/commit that
  introduces this entry.
- [x] Agent verifies acceptance criteria — **verified 2026-09-13:** read
  `maskStaleCategoricalPicks` (`frontend/src/lib/statstage.ts`) in full —
  `groupCol`/`group2Col` mask to `null` when absent from the freshly
  computed `categoricalCols` index, `facetCol` passes through unmasked,
  matching this entry's "Fix implemented" description exactly. Ran
  `npx vitest run src/components/Stage/useStatStage.test.ts
  src/lib/statstage.test.ts` — 89 passed, including the cited "de-
  categorizing the picked groupCol masks the picker AND stops the grouping
  math from using it" and "a non-categorical facetCol SURVIVES" cases.
  A manual click-through was not performed this slice.
- [ ] Owner verifies when required.

#### Completion record

- PR/commit: — (lands in the commit that adds this entry.)
- Automated tests: `useStatStage.test.ts` — "de-categorizing the picked
  groupCol masks the picker AND stops the grouping math from using it",
  "reverting the override brings the exact same groupCol pick back (raw
  state was never cleared)". The facet side is covered by the two tests that
  assert the OPPOSITE, and deliberately so: "a non-categorical facetCol
  SURVIVES — faceting is not restricted to categorical columns" and "a Graph
  Builder seed faceting on a NON-categorical column still facets" (see the
  scope note above — masking `facetCol` was a regression caught in this
  entry's own review round, not part of the fix).
- Agent verification: fix + sabotage-verified tests, this slice.
- Owner verification: —
- Notes: Tabulate was checked in the same slice and found NOT to have this
  bug — its "Group by" ZoneWell never filters its option list by
  classification (any column stays selectable regardless of type), and its
  one classification-dependent read (`groupIsCategorical`, an informational
  warning) is recomputed fresh every render rather than cached against
  stale state, so it self-heals automatically. See
  `useTabulate.test.ts`'s "a channelTypes override wins for
  groupIsCategorical, without hiding the stale selection or breaking the
  table" test (sabotage-verified against `lib/modeling.ts`'s override
  precedence).

---

## BUG-005 — Corrections and Resample transform a categorical channel like numeric data

**Priority:** P2 — nothing is destroyed (the source dataset is untouched; the
result is a NEW DataStruct) and the degradation is not silent in the worst
sense: the level table is correctly discarded rather than left attached to
values that no longer index it, so the output shows honest raw numbers instead
of confidently wrong labels. It is P2 rather than P3 because the numbers it
does show are meaningless — a smoothed "phase code" of 0.37 is not a
measurement of anything — and nothing warns the user that a column was
transformed that should not have been.

**Reported:** 2026-09-09, by Claude, in the Group J `cat_levels` propagation
audit (a delegated read-only sweep of every DataStruct-deriving site).

**Investigated:** — (design-time finding, confirmed by reading both modules;
not surfaced by a user report.)

**Suggested implementation owner/model:** a backend slice with golden-parity
care — the change touches `calc/corrections.py`'s whole pipeline.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P1.4's "Preserve
factors through derived data, filter/join, reopen, recipes, and export" box.

#### User-visible problem

`calc/corrections.py`'s `apply_corrections` and `calc/resample.py`'s
`resample_data` both transform **every channel unconditionally** — the
corrections pipeline with `for k in range(values.shape[1])` loops plus
whole-matrix `smooth_data`/`normalize`/`derivative` calls, and resample by
interpolating each column onto a new grid. Neither has any notion of a channel
being categorical.

A categorical channel's values are level CODES (0..n-1) that index
`cat_levels`. Smoothing, differentiating, normalizing or interpolating them
produces fractional numbers that index nothing. So a dataset carrying, say,
`[Moment (numeric), Phase (categorical)]` comes out of Corrections with a
`Phase` column of arbitrary decimals.

#### Why the drop WAS conservative (superseded — see the CLOSED entry below) — not simply correct

Both functions used to discard `cat_levels` unconditionally; they now discard it unless the codes provably survived (see the CLOSED entry below). Both functions discard `cat_levels`. That is now **explicit and documented in
both modules** (it used to be an accidental omission that read like a bug in
the propagation audit). For a transform that actually changes values, keeping
the table would be strictly worse: the output would claim level labels for
values that cannot have them. The drop is damage control there, not a solution
— the column is still garbage, just honestly-typed garbage.

**But the drop is over-broad, which is the second half of this bug.** Both
functions drop the table whenever they run, including paths where nothing
happened to the codes:

- `apply_corrections` with a parameter set that touches only x (or is empty)
  returns the codes bit-identical, and drops the table anyway.
- `resample_data` onto a grid COINCIDENT with the input x is an identity
  interpolation — the codes come back exact, and the table is dropped anyway.

So a user who resamples "onto the same grid to normalize a batch", or applies an
x-offset-only correction, silently loses labelling that was never invalidated.
The two tests below assert the codes are invalidated only for the parameters
they use; they do NOT establish that the strip is always warranted, and this
entry no longer claims they do.

#### What the real fix requires

Corrections must not transform a categorical channel at all: carry such a
channel through untouched, and carry its level table with it. That needs a
channel mask threaded through every step of the pipeline (offset, background,
reference subtraction, unit conversion, smoothing, normalization, derivative)
plus the whole-matrix helpers, and it carries real golden-parity regression
risk against the frozen MATLAB outputs. It was deliberately NOT attempted
inside the audit slice that found it.

Open sub-questions for whoever takes it:

- Should Resample *refuse* a categorical channel rather than pass it through?
  Nearest-neighbour resampling of a code column is defensible and would
  preserve valid codes, but it is a different interpolation than the one the
  user picked for the numeric channels — silently mixing methods within one
  operation needs a deliberate ruling.
- Should the UI warn before running a correction on a mixed dataset, or should
  the pass-through be silent because it is now correct?

#### Reproduction

- [x] Starting state identified — any `DataStruct` with `cat_levels` on at
  least one channel and at least one numeric channel.
- [x] Exact actions recorded — `apply_corrections(data, {"smoothEnabled":
  True, ...})`, or `resample_data(data, n_points=N)`.
- [x] Actual result recorded — the categorical channel's codes come back
  fractional; `cat_levels` is `None` on the result.
- [x] Reproduced by an agent — the two strip tests below assert exactly this,
  including that the codes really are no longer valid.
- [ ] Reproduced through the UI on real owner data.

#### Investigation

- [x] Likely owning modules identified — `src/quantized/calc/corrections.py`
  (`apply_corrections`), `src/quantized/calc/resample.py` (`resample_data`).
- [x] Root cause confirmed rather than inferred — both were read directly; the
  unconditional per-channel loops and whole-matrix calls are visible in the
  source, and `routes/corrections.py` pipes the result straight to
  `datastruct_payload` with no client-side re-stitching (`store/corrections.ts`
  uses the response as-is), so nothing downstream repairs it.
- [x] Related paths checked — `calc/aggregate.py`'s dataset algebra is n/a (its
  output is a single new arithmetic column unrelated to either source's channel
  indices).

#### Implementation

- [x] Minimal safe behavior defined and shipped — the strip is explicit and
  documented in both modules, with the reasoning inline so a future author
  cannot "fix" it by re-adding `cat_levels=` without reading why.
- [ ] Channel-mask pass-through for categorical channels — the actual fix.
- [x] **DONE 2026-09-10 — stop dropping the table on paths that do not change
  the codes.** `quantized/cat_levels.py`'s `surviving_cat_levels` is the
  predicate, and it is EVIDENCE not inference: it compares each channel's column
  before and after, elementwise, rather than keeping a per-transform allowlist —
  so a transform added later is conservative by default and no existing golden
  output can change (the function can only PRESERVE a table where the numbers are
  bit-identical). PER CHANNEL, because `cat_levels` is: correcting one channel
  must not cost a different, untouched one its labels. It takes `kept_rows` so a
  TRIM compares surviving rows instead of reading the shape difference as a
  change. NaN compares equal — a NaN code is already unresolvable by `level_of`,
  so a NaN that stays a NaN changes nothing the table can describe.
  Three real preservation cases now covered, each measured, not assumed: an
  IDENTITY correction (`{}`), a pure row TRIM, and an X-ONLY shift (`xOff` moves
  the grid, never a value); plus a resample onto a COINCIDENT grid. The drop
  still happens whenever the numbers move — pinned by the smoothing and
  interpolation tests that predate this, which still pass unchanged.
  The per-channel property is demonstrated in the real pipeline by the
  beam-footprint scale, which deliberately SKIPS `dq`-labelled channels: ch0 moves
  (1.0 -> 114.59...), the `dq` channel does not, and only its table survives.
  Seven sabotages verified, including both "always keep" and "always drop".
  New home rather than a new function in `datastruct.py`, for COHESION:
  `row_sidecars.py` owns "which metadata keys are row-indexed", this one owns
  "when does a value transform invalidate a level table". (A line-count reason was
  also cited and was WRONG — 506 was measured against a draft that was then
  rewritten; the shipped single function would have left `datastruct.py` at 496,
  under the ceiling. With `surviving_level_order` it would now be 514, but the
  argument was always cohesion.)
- [ ] Resample's nearest-neighbour-vs-refuse ruling.
- [ ] Any user-facing warning.

#### Tests and acceptance

- [x] The deliberate strip is pinned, with the reasoning in the docstring —
  `test_corrections_strips_cat_levels_because_codes_are_transformed`,
  `test_resample_strips_cat_levels_because_interpolation_breaks_codes`. Each
  also asserts the codes are genuinely no longer valid FOR THE PARAMETERS IT
  USES (a moving-average smooth; a 7-point resample of a 4-point input) — that
  is the honest scope: they prove the strip fires and that these particular
  transforms invalidate the codes. They do NOT prove the strip is always
  warranted, and the identity-parameter cases above are exactly where it is not.
- [ ] A test for an identity-parameter path (codes survive, table still dropped)
  — deliberately NOT added as a passing test, since it would lock in the
  over-broad behavior. It belongs with the fix, as the test that goes green.
- [ ] Pass-through behavior tested — blocked on the fix.
- [ ] Owner verifies on real mixed data.

#### Completion record

- PR/commit: the Group J commit (2026-09-09) — documentation + test-locking of
  the existing behavior only. **The bug itself is open.**
- Automated tests: the two strip tests named above.
- Agent verification: strip behavior only.
- Owner verification: —

---

## BUG-006 — a row slice carries `text_columns` through unsliced, so text cells stop matching their rows

**Priority:** P2 — the numeric data in the child is correct and the parent is
untouched, so nothing is destroyed. But every text cell shown against an
extracted row belongs to a DIFFERENT row of the parent, which is a wrong value
displayed as if it were right: a sample id, operator or run label read off the
child's grid can be silently attributed to the wrong measurement. That is the
"can escape notice" class, capped at P2 only because it requires a sheet that
carries inline text columns at all.

**Reported:** 2026-09-09, by Claude, in the adversarial review round of the
Group J `cat_levels` propagation fix — the review was asked whether
`sliceDataStruct(ds.data, rows)` was truly equivalent to the literal it
replaced, and following that question through the row-index domain surfaced this
separate, older defect.

**Investigated:** — (design-time finding, confirmed by reading the code.)

**Suggested implementation owner/model:** a frontend slice; the decision half
needs a ruling before the code half.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P1.4's
"Preserve factors through derived data, filter/join, reopen, recipes, and
export" box.

#### User-visible problem

`lib/datasetsplit.ts`'s `sliceDataStruct` copies `metadata` wholesale
(`metadata: { ...data.metadata }`). The `text_columns` sidecar lives IN metadata
and is row-indexed — `{ columnHeader: [cell per row] }` (`io/delimited.py:411`,
`io/import_preview.py:455`, `io/sqlite_query.py:169`; read in the frontend by
`lib/columnmeta.ts`'s `originTextColumns`).

So slicing rows `[1, 5, 9]` out of a sheet gives a child whose numeric rows are
the right three, and whose text columns are still the parent's FULL cell lists.
The worksheet renders text columns positionally alongside the numeric grid, so
the child's row 0 shows the parent's row-0 text against the parent's row-1
numbers.

Both consumers of `sliceDataStruct` are exposed:

- **Extract** (`components/Stage/worksheet/extractRows.ts` ->
  `useWorksheetView`'s `extractSubset`) — the Data-Filter-narrowed row set.
- **Split by column** (`store/split.ts`'s `splitDatasetByColumn`) — each child
  gets one group's rows.

`label_rows` is NOT affected: it is indexed by CHANNEL, not by row, so a row
slice leaves it correct.

#### Why it was not fixed on discovery, and why that was over-cautious

It was filed needing "a ruling" on whether to slice the sidecar or drop it.
**On revisiting, there is no ruling to make.** The sidecar is row-indexed by
construction; the operation is a row slice; slicing it is the only
self-consistent answer. Dropping the text columns would LOSE data, and keeping
them unsliced MISATTRIBUTES it — there is no third option worth an owner's
time. Filing it as a decision was the wrong call, and it is recorded that way
rather than quietly re-scoped.

The two hesitations, and what they were actually worth:

1. `sliceDataStruct` is shared, so the primitive stops being a pure
   column-layout-preserving row map and starts knowing about specific metadata
   keys. Real, and the fix leans into it: an explicit `ROW_INDEXED_SIDECARS`
   allowlist naming exactly which keys are per-row, with the reason that
   everything else (`label_rows`' per-CHANNEL cells, `all_column_names`,
   file-level `comments`) must NOT be sliced written next to it. Slicing those
   would be the mirror-image bug.
2. A text-only Origin book (`time.length === 0`, text columns ARE the grid) is
   genuinely different — but Extract already refuses that case outright
   (`planExtract` returns null when no row carries numeric data), so it never
   reaches this code, and Split partitions by a numeric column so it cannot
   arise there either. The edge was real; its reachability was not checked
   before letting it block the fix.

#### Reproduction

- [x] Starting state identified — any dataset whose `metadata.text_columns` is
  non-empty (a generic CSV with a text column, any Origin "Text & Numeric"
  sheet, a SQLite import with a text column) plus an active filter or a
  Split-by-column.
- [x] Exact actions recorded — filter to a row subset, press Extract; or Split
  by any column.
- [x] Actual result recorded — the child's `metadata.text_columns` is the
  parent's, unsliced; every text cell is off by the filter's own offsets.
- [x] Reproduced by a test — deliberately not added yet: a passing test would
  lock in the wrong behavior, and a failing one belongs with the fix.
  **2026-09-14 (Claude):** added now that the fix is shipped everywhere (see
  the "Every caller covered" box below). `frontend/src/components/Stage/
  worksheet/extractRows.test.ts`'s "planExtract — a filtered row subset's
  text cells line up with THEIR OWN rows on Extract (BUG-006)" describe block
  reproduces the original user-visible symptom end to end, at the layer the
  user experiences: a dataset with `metadata.text_columns`, filtered to a
  non-contiguous row subset (simulating the Data Filter), run through
  `planExtract` — the exact function `useWorksheetView`'s `extractSubset`
  calls for the Extract button — then asserts every child row's OWN text cell
  names the same source row its own numeric value came from. Sabotage-
  verified: reverting `lib/datasetsplit.ts`'s `sliceDataStruct` to copy
  `metadata` wholesale (`{ ...data.metadata }`, dropping the
  `sliceRowSidecars` call) made it fail (`expected [...] to have a length of
  4 but got 6`); reverted byte-identical.
- [ ] Confirmed visually on real owner data.

#### Investigation

- [x] Likely owning module identified — `frontend/src/lib/datasetsplit.ts`
  (`sliceDataStruct`), with `extractRows.ts` and `store/split.ts` as the two
  callers.
- [x] Root cause confirmed rather than inferred — read `sliceDataStruct` (it
  spreads `metadata` and names no sidecar), `io/delimited.py`'s
  `text_columns` construction (row-indexed by definition) and
  `lib/columnmeta.ts`'s reader.
- [x] Scope bounded — `label_rows` is channel-indexed and unaffected;
  `cat_levels` is channel-indexed and already handled.

#### Implementation

- [x] Slice `text_columns` in `sliceDataStruct` — the only self-consistent
  option for a row-indexed sidecar under a row slice.
- [x] Applied at every FRONTEND row-SLICING site (row edits and the backend are
  separate boxes below; "EVERY row-slicing site" as this originally read was
  false — see STILL OPEN), via one shared `lib/rowSidecars.ts`:
  `lib/datasetsplit.sliceDataStruct` (Extract, Split-by-column, byPartition),
  `lib/rowstate.pruneExcluded` (the analysis view behind every filter and row
  exclusion — Tabulate and Stat Stage category labels were reading one row off)
  and `lib/facet.facetSlices`. **The first version fixed only the first of
  those and claimed the bug closed**; a review found the other two still live,
  which would have been an overclaim shipped.
- [x] THREE sidecar keys, not two. `origin_report_sheets` is the same
  `{name: [cell per row]}` shape (`io/origin_project/opj.py`) and was missed by
  the first attempt — whose comment asserted, wrongly, that everything else was
  file-level or channel-indexed. Both text-column spellings are handled,
  matching `lib/columnmeta.ts`'s own `??` read order.
- [x] A row past a SHORT text column yields `""` — a blank cell, which is what
  the worksheet renders — rather than `undefined`, which would serialize to
  `null` and read back as a hole.
- [x] A structurally corrupted sidecar (a bare array where `{name: cells[]}`
  belongs) is carried through UNTOUCHED rather than reshaped.

#### Tests and acceptance

- [x] Eight tests in `lib/datasetsplit.test.ts` ("row-indexed metadata sidecars
  (BUG-006)"): same-rows slicing, a NON-ASCENDING slice (the signature accepts
  any order, so text must follow the same permutation as the numbers), the
  SHORT-column blank cell, the `origin_text_columns` spelling, the corrupted
  array shape, and a no-sidecar dataset unchanged.
- [x] Sabotage-verified, and the first attempt was WEAK — worth recording. The
  "channel-indexed sidecars are not sliced" test could not fail: TWO
  independent mechanisms protect them (not in the allowlist, and not
  `{name: array}` objects), so removing either alone left it green. It is now
  labelled as the characterization test it is, and the shape guard got its own
  test that DOES fail when the `Array.isArray` rejection is removed.
- [x] ~~Every caller covered~~ — SIX of eight, see "STILL OPEN" below. This box
  was ticked twice on an enumeration that was never verified against a search;
  the two misses were found by review, not by the suite. The fix is in one
  shared helper, and
  `rowstate`/`facet`/`datasetsplit`/`selectionInvariant` suites all pass. Two
  pre-existing assertions changed from `toBe` to `toEqual` on `metadata`: it is
  no longer carried by REFERENCE (its sidecars must be sliced), and those tests
  had been pinning that aliasing rather than any contract. Content is unchanged
  for a dataset carrying no row-indexed sidecar.
  **RECONCILED 2026-09-14 (Claude):** the "STILL OPEN" this note pointed to is
  a heading inside BUG-009's entry, not this one — a stale cross-reference
  left over from before Group P closed the remaining sites (2026-09-10) and
  the `PREVIEW_SOURCE_ROWS` label-path fix generalized (2026-09-12). Re-verified
  against the CODE, not the prose, by grepping every call site of the shared
  helpers (`ROW_INDEXED_SIDECARS`/`sliceRowSidecars`/`concatRowSidecars`/
  `withoutRowSidecars`/`PREVIEW_SOURCE_ROWS` in `lib/rowSidecars.ts`, and
  `slice_row_sidecars`/`drop_row_sidecars` in `row_sidecars.py`) rather than
  trusting a count. All TEN sites this entry ever named now carry the fix:
  1. `lib/datasetsplit.ts:463` `sliceDataStruct` (Extract, Split-by-column,
     byPartition) — slices.
  2. `lib/rowstate.ts:73` `pruneExcluded` — slices.
  3. `lib/facet.ts:62` `facetSlices` — slices.
  4. `store/cellEdit.ts:161,208` `insertRows`/`deleteRows` — slices (sized by
     `sidecarRowCount`, not `time.length`).
  5. `lib/worksheetTransforms.ts`'s `provenance()` (transpose/stack/unstack) —
     deliberately DROPS both `ROW_INDEXED_SIDECARS` and `PREVIEW_SOURCE_ROWS`;
     no row mapping exists for those reshapes.
  6. `lib/merge.ts:196-197` `mergeDatasets` — `withoutRowSidecars` +
     `concatRowSidecars` (per-input span, no truncation, no silent drop of
     datasets 1..N).
  7. `calc/corrections.py:328` xTrim — `slice_row_sidecars`.
  8. `calc/resample.py:143` — deliberately `drop_row_sidecars`; no output row
     is an input row.
  9. `store/importDatasets.ts` (composes `PREVIEW_SOURCE_ROWS` onto a pending
     book's preview metadata) + `components/Stage/worksheet/textColumns.ts`'s
     `worksheetTextColumns` (suppresses text columns while `rowsAreSampled`,
     never misattributes them) — the render half of site 9.
  10. `lib/barlayout.ts:126` `textLabelsFor` — reads `PREVIEW_SOURCE_ROWS` via
      `asPreviewSourceRows`; the label path closed 2026-09-10 and generalized
      via the `preview_rows` wire field shipped 2026-09-12.
  TEN of ten, by search rather than by enumeration this time.
- [x] `store/cellEdit.ts`'s `insertRows`/`deleteRows` — the worst site, because
  a slice produces a NEW dataset while a row edit is PERSISTED into the
  existing one. Both are slices in disguise and share `sliceRowSidecars`:
  `deleteRows` builds the surviving row list, `insertRows` builds the same kind
  of list with `-1` in the new slots (a miss already yields a blank, so an
  insert needs no second code path — an earlier draft's separate
  `insertBlankRowsInSidecars` was the thing most likely to drift). Both mirror
  what the file already does for `excludedRows` ("REMAP rather than clear: an
  explicit insert knows exactly what moved").
- [x] Both index lists are sized from `sidecarRowCount`, NOT `time.length`.
  Sizing from the numeric grid was a DATA-LOSS bug found in the Group N review
  after the fix had been declared closed: a sidecar longer than `time` was
  truncated on the next row edit, and a text-only Origin book (`time: []` with
  a populated `text_columns`) lost its entire grid to one `insertRows`. Green
  on the whole suite, because nothing pinned sidecar length against row count.
  Four regression tests now do, insert and delete, including the `time: []`
  case.
- [x] `lib/worksheetTransforms.ts`'s `provenance()` — the sixth site, also
  found in the Group N review. Transpose/stack/unstack REPLACE the rows rather
  than permuting them, so no index mapping exists; the sidecars fail closed and
  are dropped. This also unshadowed `stackWorksheet`'s fresh
  `origin_text_columns: {Source}`, which a surviving stale `text_columns` beat
  in `lib/columnmeta.ts`'s `text_columns ?? origin_text_columns`.

#### The last three sites (Group P) — and why the enumeration kept being wrong

The claim "applied at EVERY row-slicing site" was false twice. Group P closed
the two the Group N review found, plus a NINTH the Group P audit found on its
own, and the reason the count kept moving is worth recording: each earlier pass
enumerated the sites it had *thought of* instead of searching for the shape.
Group P searched for the shape — every producer of a DataStruct whose row count
differs from its input's — and that is what turned up sites 7-9.

- [x] **`src/quantized/calc/corrections.py`'s xTrim** (`:122-131` masks rows,
  `:252` returns `metadata=dict(data.metadata)` unsliced). Import a CSV with one
  `label`-role column, so `metadata.text_columns` holds exactly one cell per row
  (`io/import_preview.py:453-458`); apply corrections with `xTrimMin` cutting the
  first 50 of 100 rows. The response has 50 rows and 100 text cells starting at
  `o0`, so row 0 shows `o0` beside old row 50's numbers — and
  `routes/_payload.py:131` -> `store/corrections.ts:183-201` writes it straight
  into `d.data` and thence the `.dwk`. Worse than the Extract/Split cases this
  bug started from, which only ever produced a derived copy. The code right
  beside it reasons explicitly about `excludedRows` shifting under an xTrim and
  says nothing about the sidecars.
- [x] **`frontend/src/lib/merge.ts:119-123`** — `metadata: { ...datasets[0].metadata,
  ... }`. Two harms: datasets 1..N's sidecars are silently DROPPED, and if
  dataset 0's sidecar is longer than its own row count (the ragged case) its
  trailing cells land on dataset 1's rows. Measured shape: A = `time:[10,20,30]`
  with `text_columns:{A:[a0..a5]}`, B = 3 numeric rows -> merge yields 6 rows
  with `A:[a0..a5]` unchanged, so B's rows display `a3,a4,a5`. Reached from
  `useApp.ts` importAppended + mergeSelected. FIXED by
  `lib/rowSidecars.concatRowSidecars`: column names are unioned in
  first-appearance order, each input contributes EXACTLY its own row count padded
  with blanks, and an all-blank column is dropped. This is the one place that
  must NOT trailing-trim — trimming one part would shift every following part.
  An input whose sidecar runs longer than its own rows has cells for rows the
  combined grid does not have; those are dropped rather than pushed onto the next
  input, the honest trade.
- [x] **Site 9, found by Group P's own audit, NOT by the reviews:
  `store/importDatasets.ts` + `useWorksheetView.ts`.** A still-pending Origin
  book's placeholder Dataset pairs the ~200-row min/max-DECIMATED preview
  (`_book_preview_payload` -> `book.preview.time/values`) with the FULL book's
  `metadata` (`_slim_metadata` strips only `origin_books`), so its text sidecars
  hold one cell per REAL row. `GridRow` then rendered `t.rows[r]` beside
  `values[r]` — and decimation keeps each bucket's extremum, so it is not even a
  prefix: row r's text belonged to whatever row the sampler picked. It also drove
  the grid's row count to the FULL length via
  `max(time.length, textRowCount)`, rendering thousands of rows with no numbers.
  Visible in the worksheet for as long as the fetch takes, and indefinitely when
  it fails (`installBookData`'s catch leaves `pending` set). `pendingGuard` in
  the SAME FILE already refused extract/copy citing this exact reasoning ("a row
  index computed against the preview doesn't correspond to any real row") — the
  render simply never got the same treatment. FIXED by suppressing text columns
  while `ds.pending`; nothing is lost, since `installBookData` swaps data and
  metadata together and the Inspector's provenance card (which never indexes by
  row) keeps showing them throughout.
- [x] **`calc/resample.py`** — DROPS them rather than slicing, because every
  output row is an interpolated point on a new grid: no output row IS an input
  row, so there is no mapping. The same reasoning already governed `cat_levels`
  there. New `drop_row_sidecars` makes the choice explicit and tested.
- [x] `src/quantized/row_sidecars.py` is the new Python mirror of
  `lib/rowSidecars.ts` — same module name, same key list, same trailing-trim and
  empty-column rules, kept in sync BY HAND like
  `datastruct.is_categorical`/`lib/categorical.isCategoricalChannel`.
- [x] Checked and NOT sites: `io/origin_project/preview.py`'s
  `_trim_trailing_padding`/`decimate_datastruct` (their metadata is discarded —
  the payload sends the full ds's), and `calc/map.py` (builds a 2-D `MapData`
  grid, where a per-row sidecar has no meaning). Both independently re-verified
  in the second review round. NOTE `preview.py` is no longer merely "not a site":
  it is now the SOURCE of site 9's fix, since it is the only place that can tell a
  padding trim (an aligned prefix) from a min/max sample.
- [x] **Site 10, CLOSED 2026-09-10.** The diagnosis was right: `textLabelsFor`
  pairs sidecar cell r with row r, and a lazily-loaded book's preview has
  decimated rows against a FULL-LENGTH sidecar
  (`io/origin_project/preview.py` leaves `metadata=ds.metadata` on both the trim
  and the sampled path). Measured wrong output, red-first: a 6-row book with
  levels `[0,0,1,1,2,2]` and text `["A0","A0","B1","B1","C2","C2"]`, sampled to
  rows `[1,2,4,5]`, returned `["A0","A0","B1"]` for levels `[0,1,2]` — every
  level covered and each internally consistent, so its own agreement check
  PASSED. Confident wrong category names, not a safe numeric fallback.
  **FIX: `textLabelsFor` skips a sidecar column whose length disagrees with the
  row count.** Suppress, never reindex (reindexing is impossible — the preview
  does not record which rows the sampler kept), and never DELETE.
  **TWO REJECTED ALTERNATIVES, both measured:**
  * *Threading a `sampled` flag into the pure layer* (what this entry originally
    prescribed): making the parameter required enumerated 27 errors across 13
    files — ~9 pure functions plus every transitive caller — and left a
    permanent hazard that a new caller passes `false` and silently restores the
    bug.
  * *Stripping the sidecar at the two producers* (built, and REVERTED in
    adversarial review): it destroyed data that legitimate NON-row-indexing
    readers need — the Inspector's Origin provenance card and
    `lib/projectSearchSidecars.ts`'s name search — and the loss PERSISTED,
    because `lib/workspaceSerialize.ts` then wrote the stripped metadata into
    the `.dwk`. It also gated on `book.preview_sampled`'s truthiness rather than
    the shared `rowsAreSampled` predicate, so an older backend's `undefined`
    FAILED OPEN and reopened the bug. Site 9 had already chosen the right shape
    and said so in its own header; the strip contradicted it.
  **KNOWN COST — as first written, and CORRECTED 2026-09-12 (Claude):** the
  paragraph here says a padding-TRIMMED preview's labels "also degrade to
  formatted numbers", on the argument that "no length test can tell a prefix
  from a sample". That is TRUE OF THE LABEL PATH and the two halves of this bug
  ended up on DIFFERENT guards, which is worth stating plainly because I first
  corrected this row the wrong way round:
    * the WORKSHEET text-column path (`worksheet/textColumns.ts`) gates on
      `lib/rowSidecars.rowsAreSampled`, which reads the backend's
      `preview_sampled` flag — so a TRIMMED preview's text columns DO show.
    * the LABEL path (`lib/barlayout.textLabelsFor`) gates on a pure LENGTH test
      (`rows.length !== by.length`) and takes a bare `DataStruct`, so it has no
      access to `pending` and therefore no access to the flag. A trimmed preview
      suppresses there exactly as the paragraph says.
  So the flag fixed one path and not the other, and the label path is the one
  this booked item is about. (My first edit here claimed both were fixed, having
  verified `rowSidecars.ts` and generalised to a module that does not use it.)
- [x] **Booked by site 10's fix, rescoped 2026-09-12:** recovering the LABEL
  path's text labels — for a sampled preview AND for a trimmed one, since that
  path cannot see the flag — needs the backend to send which rows the decimator
  kept. Cheaper than the original note assumed:
  `_decimate` ALREADY computes them (`idx = np.fromiter(sorted(keep), ...)`,
  `io/origin_project/preview.py`) and discards them, so nothing needs
  recomputing — the wire field is the whole backend cost, and only when sampled
  (unsampled, the map is the identity and pure waste). Then the guard can be
  exact instead of conservative for the label path. Still a wire/preview
  contract change, deliberately not invented inside the original fix.
  **Backend half landed 2026-09-12** (`preview_rows`, omitted when the rows
  already correspond). The frontend half is NOT a signature change: measured, 30
  non-test call sites reach `resolveCategoryLabels`, most holding only a
  `DataStruct`, so threading a `Dataset` through them is the blast radius this
  bug's four review rounds warn about. Carry the map in the PREVIEW's own
  metadata instead, where `textLabelsFor` already reads, and the change is ONE
  site.
  **Also measured, and a better option to weigh first:** `_slim_metadata` drops
  only `origin_books`, so every lazy book's inventory entry currently ships its
  FULL-LENGTH text sidecars beside a 200-row preview. Slicing those to the
  preview rows would make `rows.length === by.length` hold naturally — labels
  correct at all 30 sites with NO frontend change, and a SMALLER payload than
  today. CHECKED 2026-09-12 AND REJECTED, by reading the reader that made it a
  question: `components/Inspector/OriginProvenanceCard.tsx` renders that
  sidecar's CELLS (`ColumnStringsSection`) and counts its keys in the card
  header, so slicing on the wire would silently show a SUBSET of a provenance
  card whose entire job is reporting what the file contained, with nothing on
  screen saying it was narrowed. `projectSearchSidecars.ts` reads keys only and
  would have been fine; the card is what rules it out. The payload saving is real
  and deliberately forgone — the map is additive and lossless, a sliced sidecar
  is lossy for a reader that wants the whole thing.
  So the shape is the MAP, and what remains is getting it to `textLabelsFor`.
  NOT a one-liner, and the backend field is INERT until it is done: the map
  belongs to the preview while `textLabelsFor` takes a bare `DataStruct`, and
  both homes cost something — `metadata` round-trips it into the `.dwk` and adds
  another row-indexed-ish key to the family that already cost four review rounds,
  while an optional parameter spares all but one of `resolveCategoryLabels`'
  call sites — 11 invocations outside `lib/barlayout.ts`, 12 counting the one
  inside it, measured with `grep -o 'resolveCategoryLabels('` over non-test
  sources; the "29 of 30" an earlier draft of this note claimed was a count of
  textual references (imports and prose included), not of calls — but must be threaded
  through every path that labels a possibly-pending dataset (bar/box/violin/
  strip, Tabulate, Data Filter, plotdata). Decide it deliberately.
  `catTableLabels` needed no change — `cat_levels` is channel-keyed, not
  row-indexed. NOTE that is a narrow claim: an Origin `.opj` import carries text
  columns and NO `cat_levels`, so for the datasets this guard actually affects
  the fallback IS the numbers.
  `lib/projectSearchSidecars.ts` reads keys only and is fine.
  **SHIPPED — reconciled 2026-09-12.** Landed as the metadata option decided
  above: backend `e524d4ff` (`preview_rows`, omitted when the rows already
  correspond), frontend `8711dab5` (`lib/rowSidecars.ts`'s
  `PREVIEW_SOURCE_ROWS`/`asPreviewSourceRows`, read by
  `lib/barlayout.ts::textLabelsFor` via `meta[PREVIEW_SOURCE_ROWS]`), review
  fixes `3145fe33` (composed map on a row slice, duplicate-index rejection,
  identity map for a trimmed prefix, facet-picker fix); merged as #355
  (`fe40adb5`). `store/importDatasets.ts` writes the map onto the preview's
  metadata; `lib/rowSidecars.ts::composePreviewSourceRows`/`sliceRowSidecars`
  keep it correct across a row slice.
  **Residuals recorded, not further open work:** (1) a text column shorter
  than the book reads an out-of-range map entry as `undefined` -> blank per
  CELL, fail-closed one row at a time rather than disabling the whole map
  (`lib/barlayout.ts::textLabelsFor`'s unbounded-validator comment); (2)
  `mergeDatasets` (`lib/merge.ts` via `withoutRowSidecars`) and every
  worksheet reshape (`lib/worksheetTransforms.ts`'s `provenance()`) DROP the
  map outright rather than compose or carry it, deliberately — `stack`'s
  recoverable row mapping is booked but not done (see `rowSidecars.ts`'s
  `PREVIEW_SOURCE_ROWS` doc comment).

#### Second review round, on the fix itself — all fixed here

Ten more issues, two HIGH, and both HIGH ones were in the round-1 FIX rather than
in code it had missed:

- [x] `concatRowSidecars` sized parts by `time.length`, TRUNCATING an input's
  overflow cells — the very thing `store/cellEdit.ts` had ruled against one
  commit earlier, and its doc called that truncation "the honest trade" without
  mentioning the honest option. Parts are now sized by `sidecarRowCount` and the
  numeric rows padded to match, so nothing is dropped and part k's numbers and
  text land on the same output rows.
- [x] `mergeDatasets` spread dataset 0's metadata and relied on the rebuild to
  OVERWRITE it; `concatRowSidecars` omits a key no input contributes to, and an
  omitted key left dataset 0's sidecar standing. Now stripped first
  (`withoutRowSidecars`). Recorded precisely because it matters: with the span fix
  in place, a sabotage showed the strip is load-bearing ONLY for a corrupted
  sidecar — it does not fix the two headline reproductions, and the comment says
  so rather than taking credit for them.
- [x] Row EDITS on a pending book were unguarded, so `sidecarRowCount` reported
  the full book's span against the preview's numbers: one "insert row" padded the
  grid to the full length in NaN, persisted it, and `installBookData` then wiped
  it silently. `refusePendingEdit` (store/pendingEdit.ts) mirrors `pendingGuard`. Site 9's render fix
  had just removed the phantom rows that used to hint at this.
- [~] Site 9's condition went through THREE wrong versions before the right one,
  and the record of the wrong ones matters more than the fix:
  1. `ds.pending` alone — over-suppressed the RENDER: a text-only book (where the
     text columns ARE the grid) went completely blank while pending, permanently
     when the fetch failed.
  2. `pending.rows > data.time.length` — a row-count PROXY, and the claim
     justifying it was FALSE. `decimate_datastruct` does NOT return its input
     unchanged below 200 rows: `_trim_trailing_padding` runs FIRST, and that trim
     is corpus-attested (Book15 drops 19 of 180). So a trimmed preview is shorter
     than `pending.rows` while still being a strict PREFIX whose cells line up —
     and the proxy blanked ordinary books, which is the regression it replaced.
  3. Reusing the resulting `rowsAreSampled` for the row-EDIT guard as well. Those
     answer different questions: whether SIDECARS may be indexed (render) versus
     whether `d.data` is about to be THROWN AWAY by `installBookData` (edit, true
     for every pending dataset). That loosening re-opened a silent data-loss path
     — measured on the same corpus shape, `insertRows` materialized 19 trimmed
     rows as NaN, recorded undo, warned about nothing, and the resolve discarded
     all of it.
  NOW: the render reads `rowsAreSampled`, which reads the BACKEND's own
  `preview_sampled` (only the backend can distinguish a trim from a sample);
  the edit guard reads `pending != null` and covers cell writes as well as row
  edits. Both are sabotage-verified, and the wire flag's three plumbing hops are
  each pinned by a test — round 4 deleted each of them with the whole suite green.
- [x] The Python module diverged from the TS on three measured cases: a `None`
  cell (which a `.dwk` round trip really produces), a non-integer index, and a
  tuple-valued column (silently returned UNSLICED to a pure-API caller).
- [x] "name-for-name" and "cannot drift silently" were both false — nothing
  compared the two modules at all. The key list is now mechanically enforced by a
  test that parses the `.ts` file; cell semantics are pinned case-by-case.
- [x] Every `concatRowSidecars` branch was untested, including the all-blank
  prune whose deletion left the whole suite green while keeping site 8 open.
  Covered, plus the negative-index guard the Python side had never pinned.
- [x] A `useMemo` keyed on the whole `Dataset` re-materialized every text cell on
  any unrelated change (rename, tag, exclusion toggle); back to the two fields it
  reads.
- [x] `corrections.py`'s comment cited `excludedRows` reasoning that lives in the
  FRONTEND, not in that module.

Also booked, not a defect: `lib/worksheetTransforms.ts`'s `stackWorksheet` DOES
have a recoverable row mapping (output row `k` <- source row
`floor(k / selected.length)`), so its sidecars are dropped by CHOICE, not
impossibility. Carrying them means merging with the fresh `origin_text_columns:
{Source}` stack already writes. The comment there previously asserted
impossibility for all three reshapes; it now distinguishes the three cases.

#### Completion record

- PR/commit: the Group M commit + TWO Group N review rounds (all 2026-09-09).
- Automated tests: `lib/datasetsplit.test.ts` (the eight named above),
  `lib/rowSidecars.test.ts` (the index-list and row-span primitives),
  `store/cellEdit.test.ts` (row edits, including the four truncation
  regressions), `lib/worksheetTransforms.test.ts` (the reshape drop).
- Agent verification: fix + sabotage-verified tests, including the correction
  of TWO weak ones (the channel-indexed control was re-written a second time in
  the Group N round — `all_column_names` is a bare array, so the shape guard
  alone kept it green regardless of the allowlist).
- Owner verification: — (worth a look on a real Origin "Text & Numeric" sheet;
  the fix is shape-driven, not corpus-driven, so no specimen was needed.)

---

## BUG-008 — Split Dataset ignored an explicit categorical level table

**Priority:** P2 — nothing is destroyed (the source dataset is untouched and the
child rows that DO get minted are correct), but the primary failure mode is a
silent merge: three samples become one dataset with no warning, and the user's
next analysis runs on a pooled population they believe is one sample. The
secondary mode is cosmetic-looking but just as misleading — children named
`run.dat (0)` / `run.dat (1)` after raw float level codes.

**Reported:** 2026-09-09, by Claude, while auditing the categorical accessors
after the Group J propagation pass. Found by READING two modules that answer the
same question, not by any failing test.

### What happened

`lib/modeling.ts`'s `channelModelingType(dataset, channel)` is the sanctioned
accessor for "what does this column MEAN". It resolves in a deliberate order:

1. the user's `channelTypes` override,
2. an explicit `cat_levels` level table (its own comment: "a level table means
   'these are labeled categories', the strongest signal there is — stronger
   than the numeric-shape heuristic below, so it's checked first"),
3. and only then `inferModelingType`, the numeric-shape heuristic.

`lib/datasetsplit.ts`'s `isCategoricalColumn` skipped straight to (3). Since the
heuristic needs at least 12 finite rows (`MIN_SAMPLES`) before it will call
anything nominal, a realistic small categorical column read as CONTINUOUS and
went to gap-clustering.

Measured on a 3-sample / 6-row column (`cat_levels: {0: ["A123","B456","C789"]}`,
codes `[0,1,2,0,1,2]`):

| | before | after |
|---|---|---|
| `channelModelingType` | `nominal` | `nominal` |
| `isCategoricalColumn` | **`false`** | `true` |
| `splitColumn().groups` | **`[{label: "1", rows: 6}]`** | `[A123:2, B456:2, C789:2]` |

One group, labelled `"1"` — the *median of the level codes* standing in for a
sample name. At 12 rows, where the heuristic happens to agree, the grouping was
right but the labels were the raw codes (`"0"`/`"1"`/`"2"`).

### The same bug from a second angle, which settled the fix

`lib/byPartition.ts`'s `byColumnOptions` — which decides which columns are
OFFERED for splitting — already used the correct accessor:
`isCategorical(channelModelingType(active, c.index))`. So a column the UI
offered as categorical could be gap-clustered by the code that then split it.
Two code paths, two answers to the same question. That made the fix direction
unambiguous: adopt the accessor, don't add a second heuristic.

### The fix

- `isCategoricalColumn`, `splitColumn` and `pickDefaultSplitColumn` now take a
  `Dataset` rather than a bare `DataStruct`, and the categorical decision is
  `isCategorical(channelModelingType(ds, col))`. All three consumers already
  held a full `Dataset` (`SplitDatasetDialog`, `store/split.ts`, and
  `lib/datasetsplitDefault.ts`, whose only caller is that same dialog), so
  there is NO DataStruct-only fallback and no call site where the
  `channelTypes` override goes unhonoured. `lib/datasetsplit.ts` importing
  `lib/modeling.ts` is not a layering break — `channelModelingType` itself
  takes a `Dataset`.
- `groupByExactValue` gained an optional per-level name resolver; `splitColumn`
  builds it from `lib/barlayout.ts`'s `resolveCategoryLabelsOrNull` — the app's
  ONE category-label resolver, shared with the bar/box axis, Tabulate, Data
  Filter, the stat stage, facets and `lib/byPartition.ts`. Passing no resolver
  keeps numeric labels, which is CORRECT for a small-integer numeric column
  routed to exact-value grouping by the shape heuristic AND carrying no
  covering text sidecar either — "run 3" must not become "run C". That
  negative control is the load-bearing test.

  The qualifier matters and a round-2 finding put it there: naming is decided
  by whether the column HAS names, not by WHY it reads as categorical. A
  shape-heuristic column with a covering sidecar is named from it (measured:
  `run = [1,2,3,…]` with a generic `text_columns` sidecar labels its groups
  `["C","A","B"]`), because `byPartition`, Tabulate, Data Filter and the stat
  stage all label that same column from that same sidecar — a split that
  disagreed would be the very divergence BUG-008 was. The sidecar source is
  also not Origin-specific: `metadata.text_columns` is read first, so
  delimited and SQLite imports are in scope too.

  **The first cut got this wrong and the review round caught it (HIGH 1).** It
  resolved labels through `lib/categorical.ts`'s level table ALONE, which is
  the narrower of the resolver's two named sources — the exact mistake
  `lib/statschooser.ts`'s header records having already been made and fixed
  once. `channelModelingType` calls a column categorical for THREE reasons and
  only one carries a `cat_levels` table; an Origin `.opj` import is the second
  shape (numeric codes plus an `origin_text_columns` sidecar, no level table).
  Measured on that shape: split produced `["0","1","2"]` while
  `resolveCategoryLabels` on the same column produced
  `["Reference","Doped","Annealed"]` — so the child datasets were named
  `run.opj (0)` from a sidecar each child literally carries (BUG-006's slice
  made sure of it), and the "FIXED" claim was broader than the code. Adopting
  the shared resolver closed it and re-unified split with every other surface.
- The dialog's tolerance field is hidden for a level-table column, where it was
  previously offered (telling the user a categorical column was a continuous
  measurement), and preview rows key on the group VALUE rather than its label
  so a malformed table with duplicate level names still renders distinct rows.
- Two dialog defects the review round surfaced as newly reachable:
  - the over-cap warning told the user to "widen the tolerance" for a column
    whose tolerance field this very component hides (measured: a 60-level
    column renders both at once). It now points at Recode for a categorical
    column.
  - the tolerance was seeded once per OPEN, from whatever column was picked by
    default — now frequently the categorical one, whose field is hidden. So a
    tolerance derived from dimensionless level codes was silently presented as
    a distance in the next column's physical units (measured: a field column
    arrived pre-filled `1` T from codes `[0,1,2]` and previewed six one-row
    groups, where its own `autoTolerance` of ~1.8 previews one). The tolerance
    now follows the COLUMN, which is the quantity it describes.
- An EMPTY level name (`cat_levels: {0: ["", "B"]}`, which `isValidLevelList`
  and `sanitizeDataStruct` both accept, so a hand-edited `.dwk` reaches it) no
  longer produces a child dataset named `run.dat ()` — `||`, not `??`.

### Mechanism, not just a fix

The divergence was invisible to the whole suite — it took reading two modules
side by side. So `architecture.test.ts` now carries a **modeling-type accessor
chokepoint**: only `lib/modeling.ts` may reach `inferModelingType`. Every other
module has to go through `channelModelingType` and therefore honours the
override and the level table.

**The first version of this guard was inverted in all three directions**, which
the review round measured (HIGH 2) — a cautionary example of a ratchet that
looks like protection:

- it matched the CALL SPELLING (`/\binferModelingType\s*\(/`), so
  `import { inferModelingType as inferType }` followed by `inferType(...)` — a
  genuine raw-heuristic call, BUG-008 verbatim — left it GREEN;
- `\s*` matches a space, so a file whose only mention was prose like
  "inferModelingType (MIN_SAMPLES=12)" FAILED it. That text already exists in
  two test files; only `sources()` excluding tests was saving it;
- the allowlist was a SUFFIX match, so `components/probe/lib/modeling.ts` was
  allowlisted too.

It now strips line and block comments, flags the identifier anywhere in real
code (an import statement spells the original name even when aliased), and
compares the path exactly. All three evasions were re-measured against the new
version: alias caught, comment green, same-named module in another directory
caught. A second test asserts `lib/modeling.ts` still DEFINES the function, so
deleting or moving it cannot leave the guard vacuously green.

### Verification

- Repro measured before the fix and recorded above, not inferred.
- 22 behaviour tests: 14 in `lib/datasetsplit.test.ts` (grouping into 3,
  level-name labels, `isCategoricalColumn` itself, the numeric negative
  control, per-channel resolution, unresolvable-code fallback, the
  `channelTypes` override, byPartition agreement, default-column pick), 2 in
  `store/split.test.ts` (child names + level tables carried through) and 6 in
  `components/overlays/SplitDatasetDialog.test.tsx` (tolerance field hidden,
  preview shows level names, duplicate level names stay distinct groups,
  tolerance re-seeded on column change, over-cap advice not pointing at a
  hidden field, continuous positive control). The `lib/` set also covers the
  Origin-sidecar naming, a sidecar that disagrees with itself (the negative
  control for that half), an empty level name, and the `channelTypes` override
  in BOTH directions — a `"nominal"` override splits a wobbly setpoint column
  per distinct read (measured 20 groups), and a `"continuous"` override
  gap-clusters a level-table column back to the pre-fix symptom on purpose,
  because the override is checked BEFORE the level table. Plus the 2-test
  accessor chokepoint in `architecture.test.ts`.
- Both halves sabotage-verified independently: reverting the accessor fails 8 +
  2 + 3 tests; reverting only the label resolution fails 3 and leaves the
  numeric negative control green; reverting the preview's `key={g.value}` fails
  the duplicate-level-name test alone.
- One test was strengthened after sabotage showed it passing vacuously ("every
  child kept its level table" was trivially true of zero children when the
  split bailed), which is exactly the failure mode that sabotage exists to
  catch.
- **A doc-promise audit corrected a comment rather than the code.** The comment
  claimed the column's unit "is still applied to any code the table can't
  resolve". Measured against the shared resolver: FALSE. Once that resolver
  decides a column has names it fills uncovered codes with formatted numbers of
  its own, so an out-of-range code reads "5", not "5 K" — deliberately the same
  text a categorical axis tick shows. The unit appears only when the resolver
  declines for the whole column. The claim was narrowed to what the code does
  and both branches are now asserted.
- The one accepted cosmetic loss: duplicate level NAMES yield two identically
  named child datasets (measured). Nothing resolves datasets by name (checked),
  so this is discoverability only.
- Owner verification: — (shape-driven, no specimen needed; worth a look on a
  real Origin sheet with a text column imported as categorical.)

---

## BUG-009 — the pending-dataset contract is five ad-hoc guards, not a contract

**Priority:** P2 — the two data-CORRUPTING sites are guarded as of 2026-09-10, so
nothing is actively destroying data. What remains is structural, and the structure
is why this cost five review rounds.

### What happened

BUG-006's site 9 (a pending Origin book's `data` is a display projection that
`installBookData` replaces wholesale) took FIVE review rounds. Each round found two
HIGH defects; THREE of those were regressions introduced by the fix for an earlier
round's finding. Every round was fully green when its defects were found.

The cause was not carelessness. **Nothing noticed a MISSING guard.** The suite and
each reviewer could only see the guards that existed, so round 4 could extend the
guard to three sites and still miss the two that CORRUPT data rather than merely
lose an edit:

- `store/computedColumns.ts` `addFormula`/`updateFormula`/`removeFormula` and
  `store/recode.ts` wrote `formulas` onto a pending dataset. Measured: the formula
  SURVIVES the resolve while the preview's labels do not, so the next legitimate
  edit computes `baseCount = labels.length - formulas.length`, treats a REAL
  measured channel as the computed one, and overwrites its imported values with
  formula output under its own label. `applyCorrections` drops that channel outright.

### Done (2026-09-10)

- [x] All nine mutation sites route through ONE `store/pendingEdit.refusePendingEdit`
  — its own module, because four earlier rounds each added a COPY of the rule
  instead of a home, and three of those copies were wrong at some point.
- [x] A ratchet in `architecture.test.ts`. **Its first version enforced almost
  nothing and this tick was FALSE for a day** — it token-matched the FILE
  (`src.includes("refusePendingEdit")`), so deleting all four guard CALLS while
  leaving the imports kept 620 files / 9,792 tests green. The only thing standing
  between the data-corrupting fix and silent deletion was an eslint unused-import
  error, which a partial deletion or a reorder defeats. Now PER-UPDATER: each
  matched updater must have a guard in its own enclosing action. Sabotage-verified
  on the three cases the file-level version missed (all four calls deleted; a
  second unguarded action in an already-guarded module; a guard removed from one
  action while siblings keep theirs).
- [x] What the ratchet does NOT catch is enumerated inline rather than summarised
  as "a coarse net": a mutation via a `lib/` helper returning a whole Dataset
  (live instance named — `useApp.ts:1142`'s overlay path, benign today, and the
  detector reports NOTHING for that file), `{...d, ...patch}` with a precomputed
  patch (`corrections.ts`/`recalcDatasets.ts`'s real shape), `getState().datasets`,
  a write past the scan window, ROW-STATE keys, and anything outside `./store/`.
- [x] The exemption list's honesty test now checks the exempt module's stated
  REASON, not just that it still has an updater: deleting `reimport.ts`'s
  `pending: undefined` — the exact clause its exemption cites — previously left
  every test green.

### CLOSED (2026-09-10) — the ROW-STATE family (found round 6)

- [x] The row-state actions are guarded, and the ratchet can now see them. They no
  longer live in `useApp.ts`: row exclusion, the transient row `selection`, and the
  per-column filter moved to **`store/rowState.ts`** (`RowStateSlice`), because the
  `useApp.ts` size pin sat 2 lines above the file and the guard had to be funded by
  an extraction rather than an append.
  **SEVEN actions, not the five booked here** — this entry missed
  `excludeSelectedRows` and `keepOnlySelectedRows`, which are how a selection
  actually becomes exclusions (the worksheet TOOLBAR's Exclude / Keep-only buttons,
  `WorksheetToolbar.tsx` -> `useWorksheetView.ts`; the row CONTEXT menu is
  mask/unmask/copy-row). `keepOnlySelectedRows` was the worst of them: it takes the
  COMPLEMENT over `data.time.length`, i.e. over the PREVIEW's row count.
  **Five WRITERS are guarded**: `toggleRowExcluded`, `setRowsExcluded`,
  `setDatasetFilter`, `excludeSelectedRows`, `keepOnlySelectedRows` — each calling
  `refusePendingEdit` directly (a wrapper hid the call from the ratchet's
  guard-detection; sabotage caught that).
  **Two CLEARS are deliberately NOT guarded and must stay that way**:
  `clearRowExclusions` and `clearDatasetFilter`. Clearing destroys a preference
  rather than recording one, and refusing it would TRAP a user whose `.dwk` restored
  row state alongside `pending` (`lib/workspaceSerialize.ts` writes the three fields
  independently and `lib/workspaceDatasetParse.ts` restores them independently — a
  reimport is NOT the path, it clears `pending` in the same updater).
  `rowState.test.ts` pins BOTH directions, so adding a guard to either clear turns a
  test red on purpose: that is the design, not an oversight to fix.
  The ratchet's key list is now `data|metadata|cat_levels|formulas|excludedRows|filter`
  with per-ACTION exemptions, so a NEW row-state writer in a NEW slice is caught.

- [ ] **Booked while closing the above:** `lib/workspaceDatasetParse.ts`'s restore
  clamps `excludedRows` with `sanitizeExcluded(..., ds.data.time.length)` where
  `data` is the stored PREVIEW on a pending dataset — the same clamp-against-preview
  shape the guard fixes for `setRowsExcluded`, on the LOAD path, unguarded. Low harm
  today (`installBookData` clears the field on resolve anyway, so the clamp only
  truncates them earlier), but it carries its own design question — should a `.dwk`'s
  exclusions survive a pending load at all? — so it is not a drive-by fix.

  **ATTEMPTED AND REVERTED (2026-09-13, Group AF).** A fix was built, reviewed
  adversarially, and taken back out before it reached `main` — the branch that
  carried it never merged forward, so the code here is still the pre-attempt
  original above. Recorded honestly rather than silently dropped, per this
  document's own purpose.

  What was built: `lib/workspaceDatasetParse.ts`'s restore refused BOTH
  `excludedRows` and `filter` outright whenever the parsed dataset was `pending`
  — dropping both fields instead of clamping the first — and pushed a named
  notice into `parseWorkspace`'s `migrationWarnings`, on the reasoning that
  `pending` is set on a brand-new import with no row state
  (`store/importDatasets.ts:232`) and every row-state writer now refuses on
  `pending` (`store/rowState.ts`'s five `refusePendingEdit` call sites at lines
  138/151/197/212/228; `store/cellEdit.ts`; `store/derivedWorksheets.ts:94`
  throws; `store/split.ts:123` resolves the source first), so the `.dwk` round
  trip (`lib/workspaceSerialize.ts` writes `excludedRows` (line 214), `filter`
  (line 215) and `pending` (line 225) independently — see that last field's own
  comment, lines 217-224, for why it argued this could only be an autosave
  snapshot — and `workspaceDatasetParse.ts` restores all three independently)
  reads as the only path that can hand a live dataset `pending` together with
  row state.

  Why it was reverted — adversarial review found the fix was a net regression,
  not a hardening, for the case it mattered most:
  - `installBookData` (`lib/bookData.ts` lines 106-119) clears `excludedRows`/
    `filter` only in its **success** handler; on a failed fetch (a moved
    `.opj`, an expired upload token — `_bookErrors`, the BUG-009 message fix
    above) or a book the user simply never reopens, `pending` stays set
    **indefinitely**, and the old (clamp, don't refuse) behaviour kept the
    user's exclusions against the exact preview rows they struck out. Refusing
    at load deletes those exclusions on the very next autosave — permanently,
    for a document with no other route back to that state, since an explicit
    Save aborts rather than writes when a book can't be resolved
    (`store/workspaceIO.ts`'s `prepareWorkspaceState`, lines 63-91, abort block at
    69-80) and
    autosave is therefore that user's only persistence for a stuck book.
  - The `migrationWarnings` notice the fix relied on to make the loss loud is
    unreachable on every path that can actually carry `pending` into
    `loadWorkspace`: crash recovery (`lib/applyRecoveryChoice.ts`'s
    `applyRecoverAutosave`, line 29 calls `loadWorkspace` then line 36
    overwrites `status` with its own message), the silent startup autosave
    restore (`useWorkspaceAutosave.ts` line 422 calls `loadWorkspace`, then
    lines 427/434 overwrite `status` with one of two hand-built messages),
    Append Project (`store/workspaceIO.ts`'s `runAppendWorkspace`, line 468,
    which doesn't call `loadWorkspace` at all and writes its own `status`),
    and workbook-package import (`store/workbookTransfer.ts`'s
    `pasteWorkbookFromClipboard`, line 233 calls `lib/workbookTransfer.ts`'s
    `parseTransferPackage`, whose own internal `parseWorkspace` call — that
    module's line 300 — computes `migrationWarnings` that the store file
    then never reads off the parse result). Only a plain File ▸ Open reaches
    `store/useApp.ts`'s `loadWorkspace` (migration notice folded into `status`
    at line 1565) without a follow-up overwrite — so the one loud case was the
    one path least likely to be the one that actually happens. Booked as its
    own bug below (BUG-010) since it outlives this attempt.
  - `filter` is a column+value predicate, valid in both preview and source row
    space (the backend preview payload keeps the full label/unit roster —
    `routes/parsers.py`'s `_book_preview_payload`, lines 148-149 — only the
    row-indexed `time`/`values` are decimated), so refusing it for a row-SPACE
    reason was never justified by the same logic as `excludedRows`; whether
    `installBookData` should keep clearing it on arrival is the pre-existing,
    still-open `#50`/`#53` product decision, not something this fix should
    have settled by fiat.

  **Plan of record (not built):** keep the restored row state in PREVIEW space
  through the pending phase — i.e. restore it as today, unguarded — and make
  `lib/bookData.ts`'s `installBookData` COMPOSE it through the
  `lib/rowSidecars.PREVIEW_SOURCE_ROWS` map (Group T) into source space at the
  one moment both row spaces are known, falling back to today's drop only when
  no such map exists (a pre-`preview_sampled` backend, or a hand-edited file).
  Every reader stays as-is: `lib/rowstate.ts`'s `droppedRows` (lines 97-104)
  already reads `excludedRows`/`filter` against whatever `ds.data` currently
  is, so a value that is always in the same space as the `data` it travels
  with needs no reader change. This touches `lib/bookData.ts`, whose clearing
  behaviour is itself a deliberate #50/#53 fix, so it is a separate,
  owner-visible change — not attempted here either.

- [x] **Also booked:** `setDatasetFilter`/`clearDatasetFilter` record NO history,
  while `clearRowExclusions` does. So building a filter and pressing undo restores a
  snapshot from before the filter change and silently discards it. Pre-existing and
  untouched by the guard pass; worth its own fix.
  **SHIPPED — reconciled 2026-09-12.** Fixed by `0da3bf20` (#354, Group S,
  "the Data Filter belongs to undo"): `store/rowState.ts`'s `setDatasetFilter`
  calls `recordHistoryCoalesced("data filter", ...)` and `clearDatasetFilter`
  calls `recordHistory("clear data filter")`; `store/dataIntake.ts` calls
  `endHistoryRun()` to terminate a slider/typing run. Pinned in
  `store/rowState.test.ts`'s "Group S — a filter edit is undoable" and
  "Group S — clearing the filter" describes ("Ctrl+Z gives back the state
  from before the filter", "a whole EDITING RUN is one undo step, not one per
  event", "is its own undo step, and undoing it gives the filter back",
  "records NOTHING when there is no filter to clear", among others).

### STILL OPEN — the structural fix

- [ ] **Replace "refuse" with "resolve-then-apply."** The guard refuses; it does not
  defer. `ensureBookData` never clears `pending` on failure, so a permanently failed
  fetch (moved source, expired upload token) is a permanent lockout: every edit,
  extract, copy and save refused forever, while the status still says "in a moment".
  For a text-only book the render fix now SHOWS the cells, so the user sees an
  editable grid that can never be edited. `store/corrections.ts` already has the
  right shape (`await get().resolveDataset(id)` first). One `withResolved(id, fn)`
  wrapper would make the safe path the DEFAULT rather than something each new action
  must remember — which is the actual defect. Deliberately NOT attempted inside a PR
  that has already taken five review rounds.
### CLOSED (2026-09-10) — "in flight" vs "failed, will never arrive"

- [x] `lib/bookData.ts` records why the last fetch for a `pending` book failed
  (`lastBookError(id, source)`), and `store/pendingEdit.ts`'s
  `pendingStatusMessage` says what actually happened — `the last attempt to load
  its full data failed (<reason>) … relink or re-import the source` — instead of
  promising "try again in a moment" forever to a book that will never arrive.
  `installBookData` re-throws unchanged, so `resolveDataset`'s reject, the save
  command's abort and `ensureBookData`'s toast are untouched; success clears the
  record alongside `pending`.
  **ADVISORY ONLY, and that is pinned by test**: the retry is still kicked (a network
  blip does come back), the refusal is unchanged, and nothing becomes unreachable
  because a failure was recorded. So this closes the LIE, not the lockout — the
  lockout is the deferral box above, which is still open.

  **MODULE STATE, NOT A `Dataset` FIELD — and the first attempt got that wrong,
  which is the useful part of this entry.** Putting the reason on `Dataset` meant a
  failed fetch performed a store write where it had previously performed NONE, and
  two live mechanisms compare `datasets` by IDENTITY:
  `components/windows/WindowCanvas.tsx` and `components/Stage/useMultiPanelStage.ts`
  have effects whose deps include `datasets` (or the active `Dataset` object) and
  whose bodies call `ensureBookData` when `pending` is set — so each failure re-ran
  the effect, which re-fetched, which failed, which wrote again: an unbounded
  request storm on exactly the dead book being fixed. And
  `useWorkspaceAutosave.shouldAutosave` compares the same reference, so the write
  marked a clean project dirty and, once looping, reset the 800 ms autosave
  debounce faster than it could ever fire — starving autosave of real user edits.
  Both were found in adversarial review while CI was 14/14 green.
  A fetch outcome is transport state, like the in-flight promise beside it; keeping
  it in module scope makes "never serialized, never undone, never remapped, never
  re-rendered" true by construction instead of by four separate allowlists. The
  entry records WHICH source failed, because dataset ids repeat across a project
  load. Pinned by four tests that assert the array identity, each dataset's object
  identity, and `shouldAutosave` — the last of those asserted `projectDirty`
  first and was VACUOUS (its subscriber only registers inside a React effect, so
  the flag stays false either way); it survived the sabotage that reintroduced the
  write, and now asserts the gate directly.

- [x] **Review round 2 (no HIGHs; both round-1 HIGHs verified gone).** Fixed:
  `lastBookError` now compares `token` as well — an upload `BookSource` has no
  `path`, so without it the identity check degenerated to `bookId` alone for
  exactly the case this bug names, an expired upload token. Each of the four
  fields is now sabotage-verified individually (the first test varied two at
  once and could not tell which was compared). `installBookData`'s failure
  handler became the second argument to `.then` rather than a `.catch`, so a
  throw from the SUCCESS handler can no longer be recorded as a fetch failure.
  `lib/workbookTransfer`'s refusal no longer claims a book is dead for good —
  the record says only that the LAST attempt failed, and a two-second blip
  records one — and it now caps the reason through the shared `truncateReason`
  instead of interpolating an unbounded backend `detail`; both arms have tests,
  the failure arm having had none. The status text stopped advising "relink",
  which writes `Dataset.source` only and never clears `pending`, so it could
  not revive the book.

- [x] **A PROVEN test-order defect, and a ratchet for it.** `_bookErrors` is
  module state cleared only by a success, so a guard test's jsdom-rejecting
  fetch poisons later tests in the same file that share a dataset id.
  `cellEdit.test.ts` and `computedColumns.test.ts` shipped exactly that and
  passed only because the one test in each that asserts the message happened to
  run first: `--sequence.shuffle.tests --seed=1` failed both. `lib/bookData.ts`
  already documented the rule and the commit that wrote it applied it to two of
  the four files needing it — so `architecture.test.ts` now enforces it (a test
  file asserting the pending-guard message must CALL
  `resetBookTransportForTests()`). That check's own first version matched the
  IMPORT, so deleting the call left it green — the identical hole this bug's
  other ratchet already shipped and recorded once. Sabotage caught it both
  times; only the second time was it already written down.

- [x] **The wording now has ONE home.** The first version corrected one of five
  messages while claiming it had corrected all of them:
  `useWorksheetView.pendingGuard` (Extract / Copy rows), `useTabulate`,
  `useFitYByX` and `useStatsChooser` each carried their own hard-coded "try again
  in a moment", and `lib/workbookTransfer.buildTransferPackage` its own plural
  variant. All five now go through `pendingStatusMessage` (or, for the transfer
  package, name the first genuinely dead book). Their control flow is unchanged —
  each still writes to its own local status/error channel — so this unifies the
  wording only; unifying the GUARDS is the structural half still open above.

### The invariant, stated once (it never was)

A pending dataset's `data` is a **read-only display projection**. Read: allowed.
Render: allowed, and row-indexed sidecars may be shown only when the backend says
the preview is a prefix (`preview_sampled === false`). Edit / derive / extract /
save: resolve FIRST, then apply, and surface a genuine failure.

### Completion record

- PR/commit: the round-5 response on the Group P branch (2026-09-10).
- Owner verification: — (the resolve-then-apply refactor is a design call worth
  an owner's read before it is built).

---

## BUG-010 — `migrationWarnings` are unreachable on every load path except a plain File ▸ Open

**Priority:** P2 — no data is corrupted, but the ONE mechanism this repo has for
telling a user "something in your saved document was dropped or downgraded on
load" silently says nothing on three of the four ways a document can load. A
diagnostic that only fires on the least common path is worse than it looks: it
lets a future fix (like the reverted Group AF attempt above) believe it has
made a loss loud when it has not.

**State:** Fixed (commit pending merge), 2026-09-13 — see "Fix implemented" below; the workbook-package decision is recorded there. A same-day review round found one real coverage gap (File ▸ Open) plus several stale/inaccurate prose citations — see "Review round, 2026-09-13" near the end of this entry.

**Reported:** 2026-09-13, by Claude, during adversarial review of the Group AF
`.dwk` load-path attempt on the BUG-009-adjacent item above — that attempt's
loudness story depended on this channel and the review measured that it does
not reach the user on any path a real pending-dataset document is likely to
take.

**Investigated:** root cause confirmed by reading every caller, not inferred —
see Evidence below.

**Suggested implementation owner/model:** Unassigned.

**Related plan:** BUG-009 (the pending-dataset contract) above; the item this
was found while reviewing.

#### User-visible problem

`store/useApp.ts`'s `loadWorkspace` is the one place that folds a document's
`migrationWarnings` into the load status: it builds `migrationNotice` from
`migrationWarnings[0]` (line 1431) and appends it to the `"loaded workspace — N
datasets…"` status string (line 1565). That machinery exists today for
unrelated migration cases (e.g. a saved `FigureDocument` with an unsupported
version — `lib/workspace.ts`'s `parseEditableFigures`, line 183) and is exactly
what the reverted Group AF fix planned to reuse for "your saved row exclusions
were dropped because the book hadn't finished loading."

The problem: every OTHER entry point that can load a workspace either never
calls `loadWorkspace` at all, or calls it and then overwrites `status` one or
two statements later with its own message that never reads
`ws.migrationWarnings`. A warning pushed into that array is therefore visible
only when the user does a plain File ▸ Open — not on the two paths (crash
recovery, silent autosave restore) that are how a pending-dataset document is
actually most likely to come back, and not on Append Project or a workbook
package import either.

#### Root cause

Four call sites, each confirmed by reading the code:

- **`lib/applyRecoveryChoice.ts`'s `applyRecoverAutosave`** (the "Recover
  autosaved work" crash-recovery choice): line 29 calls
  `s().loadWorkspace(prompt.workspace)`, then line 36 calls
  `s().setStatus(msg)` with a hand-built `"recovered N datasets from
  autosave…"` string that never reads `prompt.workspace.migrationWarnings`.
  Whatever `loadWorkspace` just wrote to `status` is gone before the user sees
  it.
- **`frontend/src/useWorkspaceAutosave.ts`'s silent startup restore**: line 422
  calls `useApp.getState().loadWorkspace(restored)`, then lines 427/434 call
  `setStatus` with one of two hand-built strings
  (`"recovered … after an unexpected close"` / `"restored … from autosave"`),
  again never touching `restored.migrationWarnings`. This is the path that
  runs on every ordinary app start when an autosave generation exists — the
  most common way a `pending` dataset re-enters the live store.
- **`store/workspaceIO.ts`'s `runAppendWorkspace`** (Append Project): does not
  call `loadWorkspace` at all — it calls `mergeWorkspace` directly and, at line
  468, sets `status: msg` to its own `"appended N datasets (M renamed)…"`
  string. `ws.migrationWarnings` from the parsed `.dwk` is never read anywhere
  in this function.
- **`store/workbookTransfer.ts`'s `pasteWorkbookFromClipboard`**: line 233
  calls `lib/workbookTransfer.ts`'s `parseTransferPackage(text)` (that
  function, in turn, calls `parseWorkspace(...)` internally at its own line
  300) and stores the result in `parsed`, then reads only `parsed.pkg` fields
  (workbook/datasets/etc.); the sibling `parsed.migrationWarnings` the parse
  already computed is never read anywhere in the store file — confirmed by a
  whole-file search.

So of the four loaders that can carry a document's `migrationWarnings` into
the live store, three actively discard it and the fourth (plain File ▸ Open,
`store/useApp.ts`'s `loadWorkspace` itself) is the only one where it survives
to the status bar. (A later review round found File ▸ Open's own toast
coverage was itself incomplete — see the 2026-09-13 review paragraph near the
end of this entry.)

#### Fix checklist

- [x] Give `migrationWarnings` a delivery channel a caller cannot silently
  clobber by writing to `status` afterward — shipped as a shared toast
  helper (`notifyMigrationWarnings` in `store/toasts.ts`, mirroring the
  existing "recovered … — check your latest edits" toast pattern in
  `useWorkspaceAutosave.ts`) called explicitly at every loader, rather than a
  toast fired automatically from inside `loadWorkspace` itself — a
  `loadWorkspace`-internal toast would still miss Append Project and
  workbook-package import, which never call `loadWorkspace` at all, so the
  helper is called at every loader explicitly (File ▸ Open's own
  `replaceWorkspace`/`replaceWorkspaceSafely` included, after the review
  round) — and rather than a `status` string every caller must remember to
  fold into its own message.
- [x] Pin it at `applyRecoverAutosave` first — it is the site the Group AF
  attempt actually needed and the one whose overwrite is a single, easy-to-see
  statement (line 36).
- [x] Decide and implement the same fix shape for the silent autosave restore
  and `runAppendWorkspace`, or explicitly narrow the promise (e.g. document
  that `migrationWarnings` is File ▸ Open-only) if a store-wide channel is
  judged out of scope.
- [x] Decide whether `store/workbookTransfer.ts`'s `pasteWorkbookFromClipboard`
  should surface `parseTransferPackage`'s `migrationWarnings` at all — a
  workbook package is a narrower object than a full workspace, so this may be
  a deliberate non-goal rather than a gap; state it either way.
- [x] A regression test per fixed site: assert the notice actually reaches the
  user-visible surface (status/toast) after each of the four currently-silent
  loaders, not just that `migrationWarnings` was computed. (A fifth loader —
  File ▸ Open's own `replaceWorkspace`/`replaceWorkspaceSafely` — was found
  silent too in a later review round; see the dated paragraph near the end of
  this entry.)

#### Fix implemented

A delivery channel no caller's later `setStatus` can clobber: a toast
(`store/toasts.ts`), via one new shared helper —
`notifyMigrationWarnings(warnings)` in `store/toasts.ts` — so the
"first warning + (+N more) count" format (mirroring `useApp.ts`'s own
`migrationNotice` local) and the "one toast for N warnings, never one per
warning" rule live in exactly one place. `useApp.ts`'s existing status-line
fold for File ▸ Open is UNCHANGED — this is additive, not a reroute — and,
after the review round below, File ▸ Open is the ONE path that shows BOTH
the status line and the toast; every other load path shows the toast only
(their own `setStatus` overwrites whatever `loadWorkspace` folded).

Call sites, each now calling `notifyMigrationWarnings`:

1. `lib/applyRecoveryChoice.ts:38` (`applyRecoverAutosave`) — called with
   `prompt.workspace.migrationWarnings`, right after the `setStatus` that
   would otherwise be the only signal.
2. `useWorkspaceAutosave.ts:436` (unconditionally, after both the
   "unclean"/silent status branches) — called with
   `restored.migrationWarnings`.
3. `store/workspaceIO.ts:473` (`runAppendWorkspace`, end of function) —
   called with `ws.migrationWarnings`; this path had no status-line fold to
   begin with, so the toast is its only surface.
4. `store/workbookTransfer.ts:250` (`pasteWorkbookFromClipboard`, after a
   successful parse) — called with `parsed.migrationWarnings`. The field
   lives on the `ParseTransferResult` success variant (`lib/workbookTransfer
   .ts`'s `ParseTransferResult`, a sibling of `pkg` rather than a field ON
   it — a live session's own `buildTransferPackage` has no equivalent, since
   it can never itself hold a version-skipped figure, so there is no shared
   persisted shape to keep in sync, only a parse-time result to report).
   `WorkbookTransferPackage` itself is unchanged; no new field was added to
   it.
5. `lib/openWorkspaceReplace.ts` (File ▸ Open / Open without layout, both via
   `replaceWorkspace`/`replaceWorkspaceSafely`) — called right after each
   function's own `loadWorkspace(ws)` call, with `ws.migrationWarnings`.
   Added in a review round (below) after this site's own status-line fold
   was mistaken for full coverage — it survives untouched (nothing later in
   either function writes `status`), but a status line alone is easy to
   miss on a large load, and every OTHER loader here already gets a toast
   too.

**Workbook-package decision (item 4, explicit):** `migrationWarnings` CAN be
non-empty for a workbook-transfer package — confirmed structurally, not
assumed: `parseTransferPackage` wraps the incoming `editableFigures` array
in a synthetic `.dwk` document and hands it to the SAME `parseWorkspace`
sanitizer a real project open uses, so an unsupported `FigureDocument`
version inside a pasted package hits the identical version-skip branch a
`.dwk` would (pinned by
`lib/workbookTransfer.test.ts`'s "surfaces migrationWarnings from an
unsupported FigureDocument version inside the package (BUG-010)"). It is
surfaced on Paste. It is deliberately NOT surfaced on `duplicateWorkbook`:
that path's `parseTransferPackage` call always round-trips figures read
straight from THIS session's own live `state.editableFigures`, which by
construction cannot hold a version-skipped figure (any such figure was
already skipped, with its own warning, at the ORIGINAL load that put it
into live state) — a structural, not a policy, non-goal, pinned by
`store/workbookTransfer.test.ts`'s "duplicate's own round trip never
carries a migration warning (structural, not a live path)".

#### Reproduction

- [x] Starting state and sample data identified — a saved `.dwk`/autosave/
  workbook package containing a `FigureDocument` with `version` greater
  than `FIGURE_DOCUMENT_VERSION`.
- [x] Exact actions recorded — the four load/merge paths above.
- [x] Actual result recorded (pre-fix) — no toast, no dialog; the status
  line either never carried the notice (sites 3-4) or carried it for a
  fraction of a `set()` call before being overwritten (sites 1-2).
- [x] Expected result recorded — see "Fix implemented" above.
- [x] Reproduced by an agent — one regression test per site (see below),
  each sabotage-verified: removing that site's `notifyMigrationWarnings`
  call (or, for site 4, reverting the dropped-field propagation) makes that
  site's new test fail — sites 1-3 fail exactly their own test; the site-4
  field sabotage fails two tests in two files (the `lib/` parse test and the
  `store/` paste test), as the first review round noted.

#### Investigation

- [x] Likely owning components/modules identified — the files named above,
  plus `lib/openWorkspaceReplace.ts` once the review round below found its
  gap.
- [x] Root cause confirmed rather than inferred — read every caller of
  `loadWorkspace`, `appendWorkspace`, and `parseTransferPackage` before
  writing the fix; confirmed `useApp.ts`'s status-line fold is the ONLY
  existing consumer of `migrationWarnings` anywhere in the frontend.
- [x] Related workflows and persistence paths checked — `LoadedWorkspace
  .migrationWarnings`'s own doc ("Load-time compatibility notices. Never
  serialized back into a .dwk.") is respected; nothing here changes what
  gets saved, only what gets told to the user at load/merge time.
- [x] Existing plan overlap reconciled — none found; this is a new entry.

#### Implementation

- [x] Minimal safe behavior defined — one shared, side-effect-only helper
  (`notifyMigrationWarnings`), a no-op on an empty array, called
  additively at each site; `useApp.ts` itself is untouched (kept under its
  own store-size ratchet — the helper lives in `store/toasts.ts`, the
  module every call site already imports `toast` from, not a new sibling
  module).
- [x] Failure and ambiguous-data behavior defined — unchanged; this only
  adds a NOTICE of an already-correct skip/degrade, never new fallback
  logic of its own.
- [x] Data integrity and backward compatibility considered — no persisted
  shape changes; `ParseTransferResult.migrationWarnings` (the field that
  carries a workbook-package parse's notices — see "Fix implemented" item
  4 above) is transient, mirroring `LoadedWorkspace.migrationWarnings`'s own
  "never serialized back" contract; `WorkbookTransferPackage` itself gained
  no field.
- [x] UI wording/tooltips/accessibility included where relevant — reuses
  the existing toast component/store (`store/toasts.ts`) verbatim; the
  message text is the warning's own text (already user-facing English),
  plus the same "(+N more)" count `useApp.ts` already used.

#### Tests and acceptance

- [x] Regression test fails before the fix and passes afterward — one test
  per site, each independently sabotage-verified (see the commit body's
  sabotage table).
- [x] Relevant focused tests pass — `lib/applyRecoveryChoice.test.ts`,
  `useWorkspaceAutosave.test.ts`, `store/appendWorkbooks.test.ts`,
  `lib/workbookTransfer.test.ts`, `store/workbookTransfer.test.ts`,
  `architecture.test.ts` — 147 tests, all green. (The review round added
  `lib/openWorkspaceReplace.test.ts` and `store/toasts.test.ts` cases; see
  its own gate table below rather than this original count.)
- [x] Type-check/build/repository gates pass — `npx tsc -b --force`,
  `npx eslint src --max-warnings=0`, `npm run build` after `npm ci`,
  `uv run pytest -q tests/test_repo_integrity.py`. The full `npx vitest run`
  count recorded here at the original fix (10108/10109) and the count the
  commit body recorded (10116/10116) were BOTH stale — different snapshots
  of a moving suite, neither reproducible against this entry's own HEAD.
  Per agent_rules.md's "never estimate a number that will be recorded",
  this is not corrected in place; the review round below measured its own
  number fresh instead.
- [x] Agent verifies acceptance criteria — this entry.
- [ ] Owner verifies when required.

#### Completion record

- PR/commit: — (lands in the commit that adds this entry.)
- Automated tests: see "Tests and acceptance" above for the full file list;
  new tests are individually named in each file under a "(BUG-010)"
  suffix/comment.
- Agent verification: fix + sabotage-verified tests, this slice.
- Owner verification: —
- Notes: the `duplicateWorkbook` non-surfacing is a deliberate, structural
  non-goal (see "Workbook-package decision" above), not an oversight —
  pinned by its own test rather than left undocumented.


#### Evidence

Recounted at this entry's HEAD (a review round found the original cites had
drifted off by one or more lines — the fix's own inserted comments pushed
several of the statements they name a few lines further down — and one
symbol name, `parseWorkbookPackage`, was never a real export; the actual
function is `parseTransferPackage`):

- `frontend/src/store/useApp.ts:1431` (`migrationNotice` built),
  `frontend/src/store/useApp.ts:1565` (folded into `status` — the one path
  that worked pre-fix).
- `frontend/src/lib/applyRecoveryChoice.ts:29` (`loadWorkspace` call),
  `frontend/src/lib/applyRecoveryChoice.ts:36` (`setStatus` overwrite; cited
  line moved from the original finding's :34 once the fix's own
  `notifyMigrationWarnings` call and its preceding comment landed above it).
- `frontend/src/useWorkspaceAutosave.ts:422` (`loadWorkspace` call),
  `frontend/src/useWorkspaceAutosave.ts:427,434` (`setStatus` overwrites, one
  per branch; the second moved from :430 for the same reason as above).
- `frontend/src/store/workspaceIO.ts:448` (`runAppendWorkspace` definition),
  `frontend/src/store/workspaceIO.ts:468` (`status: msg` — unmoved by the
  fix, since its own `notifyMigrationWarnings` call lands AFTER this line).
- `frontend/src/lib/workbookTransfer.ts`'s `parseTransferPackage`: at the
  ORIGINAL finding, its internal `parseWorkspace(...)` call sat at line 288
  and the function read only `loaded.workbooks`/`loaded.datasets` off the
  result, never `loaded.migrationWarnings`. Both lines moved once the fix
  landed (the `parseWorkspace(...)` call is now at `:300`); the fix itself
  is what ADDED the previously-missing read, now `migrationWarnings: loaded
  .migrationWarnings` at `:323` — so, unlike the four cites above (which
  still describe standing gaps this fix closed elsewhere), this one now
  describes a gap the fix closed IN THIS SAME FILE, before the result ever
  reached `store/workbookTransfer.ts`'s `pasteWorkbookFromClipboard`
  (`:250`, see "Fix implemented" above).
- Agent verification: each call site read directly at the original finding;
  re-verified line-for-line against this entry's HEAD during the 2026-09-13
  review round below.
- Owner verification: — not required to confirm the gap (it is a static
  reachability fact), but the chosen delivery-channel shape is a product call.

#### Review round, 2026-09-13 (adversarial review of commit `762e00c1`)

The code fix was found correct and complete on every one of its four sites —
all sabotage-verified again, full suite green — but the review found the
PROSE around it inaccurate in several places, plus one real coverage gap:

1. **File ▸ Open never joined the toast channel.** `replaceWorkspace`/
   `replaceWorkspaceSafely` (`lib/openWorkspaceReplace.ts`) route every
   native/browser-picker open into `loadWorkspace`, whose own
   `migrationNotice` status-line fold survives there (nothing downstream
   overwrites `status`) — but no call to `notifyMigrationWarnings` existed
   on that path, so File ▸ Open was the one loader with a status line and
   no toast, contradicting the "that path now shows both" sentence this
   entry and the original commit body both made. Fixed: both functions now
   call `notifyMigrationWarnings(ws.migrationWarnings)` right after their
   own `loadWorkspace` call, the same "after the status fold" placement
   every other fixed site uses. Regression test:
   `lib/openWorkspaceReplace.test.ts`'s new "migrationWarnings join the
   toast channel (BUG-010 review F1)" describe block, asserting against the
   real `useToasts` store (not the mock the file already carries for its
   unrelated lock-registration assertions) — sabotage-verified (removing
   either call fails exactly its own test).
2. **Three sentences described a design that was never shipped.** The
   "Fix implemented"/"Implementation" sections above have been rewritten to
   say what actually landed: the `migrationWarnings` field for a workbook
   package lives on `ParseTransferResult`'s success variant (a sibling of
   `pkg`), the call site reads `parsed.migrationWarnings` (not
   `parsed.pkg.migrationWarnings`, and `WorkbookTransferPackage` gained no
   field), and the helper lives in `store/toasts.ts` (not a "sibling `lib/`
   module" — `useApp.ts`'s own store-size ratchet was never at stake since
   the helper was never a candidate for living inside `useApp.ts` itself).
3. **Every "Fix implemented" file:line citation was off by one, and one
   symbol name didn't exist.** `parseWorkbookPackage` is not a real export —
   the function is `parseTransferPackage`. The four call-site line numbers
   and several pre-fix "Evidence" citations have been recounted against
   this entry's HEAD (see "Fix implemented" and "Evidence" above for the
   corrected numbers and why each moved).
4. **The plan and the original commit body quoted two different, both
   stale, full-suite counts.** Measured fresh in this review round (see the
   gate table below) rather than repeated from either source.
5. **The `duplicateWorkbook` "pinned by its own test" claim couldn't
   actually fail.** The prior version of `store/workbookTransfer.test.ts`'s
   "duplicate's own round trip never carries a migration warning" test
   asserted the ABSENCE of a `notifyMigrationWarnings` call — true for every
   input, since `duplicateWorkbook` never calls that helper at all, so the
   assertion could not fail even if the structural claim behind it were
   false (confirmed: adding the call back left the suite green). The test
   now asserts the STRUCTURAL claim directly — `buildTransferPackage` +
   `parseTransferPackage` on a live workbook carrying a version-1
   `FigureDocument` yields `migrationWarnings === []` and a version rewritten
   to `FIGURE_DOCUMENT_VERSION` — and fails when that claim is sabotaged
   (verified: forcing the fixture's version to an unsupported value turns
   the assertion red).
6. **The toast on sites 1-2 is the ONLY surface, and used to self-dismiss in
   1.9 s.** On `applyRecoverAutosave` and the silent autosave restore, a
   later `setStatus` deliberately overwrites `loadWorkspace`'s status-line
   fold, so the toast is the one place "part of your saved document was
   dropped" is said at all — worth a longer look than the default `TOAST_TTL`
   gives. `notifyMigrationWarnings` (`store/toasts.ts`) now passes
   `{ ttlMs: TOAST_ACTION_TTL }` (6 s, not 1.9 s). `ToastKind` has no
   dedicated "warning" value (`"info" | "ok" | "danger"`); kept `"info"` —
   the same kind `useWorkspaceAutosave.ts`'s "Recovered … check your latest
   edits" toast already uses for an analogous "something was silently
   changed, go look" notice, since a migration warning is a successful load
   that dropped one degraded piece, not the outright failure `"danger"` is
   reserved for. Pinned by a new test in `store/toasts.test.ts`.
7. **The helper's own "one toast, never one per warning" and "(+N more)"
   rules had no direct test.** Every existing call-site test passed exactly
   one warning. `store/toasts.test.ts` now covers zero/one/many warnings
   directly against `notifyMigrationWarnings`.

Nits also addressed: the checklist's first fix-checklist box (previously
ticked against "a toast fired from inside `loadWorkspace` itself") reworded
to describe what shipped — a shared helper called explicitly at every
loader; a stray doubled blank line before `## New issue template` (merge
noise) removed.

Not addressed, and why: the ORIGINAL commit body (`762e00c1`) still carries a
stale bundle paragraph ahead of the orchestrator note that retracts it — a
past commit's message is frozen history; nothing a later commit does can
edit it, so this stays a known wrinkle in `git log` rather than something
"fixed" here.

**Gate (this review round, `frontend/`):**

| gate | result |
|---|---|
| `npx tsc -b --force` | exit 0 |
| `npx eslint src --max-warnings=0` | exit 0 |
| targeted vitest (`toasts.test.ts`, `openWorkspaceReplace.test.ts`, `workbookTransfer.test.ts` x2) | 74 passed, exit 0 |
| full `npx vitest run` | 636 files / 10424 tests (10422 passed, 2 expected-fail), 0 `FAIL` lines, exit 0 (720.6 s) — measured on the agent's pre-rebase tree (parent `384f2bc9`, lacking `48556a04`/`a99ebb6d`); the batch's final full run is recorded in the PR body |
| `npm run build` (eager JS) | 916,453 B vs 916,384 B at `HEAD~1` (`a99ebb6d`, this commit's real parent; the agent's report named `384f2bc9`, three commits back, which happens to measure the same 916,384 B) — +69 B, 3,947 B under the unmoved 920,400 B budget |
| `uv run pytest -q tests/test_repo_integrity.py` | 12 passed |

---

## BUG-011 — Pack Project can silently ship a lazy book's PREVIEW rows as the packed project's real data

**Priority:** P1 — this is the scientific-data-integrity bar this document's
priority key names explicitly ("P0: data loss or scientifically incorrect
result that can escape notice"; capped at P1 rather than P0 only because it
requires an in-progress lazy Origin import at the moment of packing, not the
common case). Pack Project is the mechanism for handing a portable, self-
contained project to someone else; if the payload it writes is a ~200-row
downsampled preview instead of the real book, the recipient has no way to
know their analysis is running on decimated data.

**State:** Fixed (commit pending merge), 2026-09-13.

**Reported:** 2026-09-13, by Claude, during adversarial review of the Group AF
`.dwk` load-path attempt above. Found by comparing `packProjectRun.ts`'s
serialization call against its two siblings that serialize a workspace for
export, not by a failing test.

**Investigated:** root cause confirmed by reading the code; not yet reproduced
end-to-end with a real pack run against a lazy book.

**Suggested implementation owner/model:** Unassigned.

**Related plan:** BUG-009 (the pending-dataset contract) above.

#### User-visible problem

`store/packProjectRun.ts`'s `serializeCurrentWorkspaceForPack` (lines 44-52) is
the content both the pack preview and the actual "Start pack" action send to
the backend's `pack_project`. It calls:

```ts
return serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
```

directly against the live `useApp` state `s`, with **no** call to
`resolvePendingDatasets()` anywhere in the function or the file (confirmed by
a whole-file search — the only `pending*` identifiers in `packProjectRun.ts`
are the unrelated `pendingTimer`/`pendingApply` poll-throttle variables). If
any dataset in the workspace is still `pending` (a lazy Origin book whose full
data hasn't been fetched yet — normal for a workbook the user hasn't opened),
`serializeWorkspace` writes that dataset's `d.data`, which **is the downsampled
preview** for as long as `pending` is set, into the packed payload — and writes
`pending` itself into it too, since nothing cleared it first.

This directly falsifies the comment `lib/workspaceSerialize.ts` carries about
its own `pending` field (lines 217-224): "an explicit 'Save workspace (.dwk)…'
resolves every pending dataset FIRST … so `d.pending` is never set in a real
exported .dwk — only autosave … can legitimately still have one." Pack Project
is a second explicit-export path that comment did not account for, and it does
not resolve first.

#### Root cause

- `store/workspaceIO.ts` line 73 (inside `prepareWorkspaceState`, the shared
  preface for Save and Save As) calls `await get().resolvePendingDatasets()`
  before serializing, and aborts the save with a status/toast if it fails.
- `store/workbookTransfer.ts` lines 189 and 254 (the two workbook-transfer
  export paths) likewise call `await get().resolvePendingDatasets()` before
  building their payload.
- `store/packProjectRun.ts`'s `serializeCurrentWorkspaceForPack` has no
  equivalent call. It is also **synchronous** (returns a `string`, not a
  `Promise`), which is itself evidence the resolve step was never wired in —
  `resolvePendingDatasets()` is async.

#### Fix checklist

- [x] `serializeCurrentWorkspaceForPack` now `await`s
  `useApp.getState().resolvePendingDatasets()` before `serializeWorkspace`,
  mirroring `workspaceIO.ts`'s `prepareWorkspaceState` (status line while it
  fetches included): `frontend/src/store/packProjectContent.ts:49-123`, resolve
  call at `:54`. It became `async` and now returns a `PackContent` result
  (`:28`) rather than a bare string, and BOTH callers were updated —
  `frontend/src/store/packProjectRun.ts:138` (the pack PREVIEW) and `:392`
  ("Start pack"). The store re-read after the `await` is deliberate and
  documented: `resolvePendingDatasets` replaces the dataset objects, so a
  snapshot taken before it would still be the preview-carrying one.
  (Line numbers current as of round 2, below — see that section's own
  recount; they move every time either function grows.)
- [x] Failure UX mirrors `workspaceIO.ts` lines 69-80: `refusePack`
  (`packProjectContent.ts:131-135`) sets the app status line, raises a
  `danger` toast, and puts the pack state machine into `failed` with a named
  `pending_unresolved` error — same sentence shape as the siblings
  (`workspaceIO.ts:75`, `store/workbookTransfer.ts:191`/`:262`; there is no
  shared helper to reuse, each spells it out inline). Both the preview
  (`packProjectRun.ts:144-147`) and Start-pack (`:399-402`) paths abort
  BEFORE any bridge call, so `NOTHING_MODIFIED_NOTE` holds literally.
  The message originally named only the operation and the underlying fetch
  error, not the book — review finding #5 pointed out that claim ("the
  siblings name the operation too") was only two-thirds true: two of the
  three sibling sites (`store/workbookTransfer.ts:191`/`:262`) DO name the
  workbook, only `workspaceIO.ts:75` doesn't. The round-2 fix below closes
  this for Pack Project in full — both the book's NAME and its RECORDED
  REASON now come from `lib/bookData.ts`'s `lastBookError`, exactly as
  `lib/workbookTransfer.ts:195-196` already does (round 1 only adopted the
  name half — see the round 2 section's finding #5).
- [x] `lib/workspaceSerialize.ts`'s `pending` comment corrected
  (`:217-257`, widened again in round 2 below): it now states that EVERY
  explicit export path resolves first and aborts on failure — Save/Save As,
  workbook Copy/Duplicate, and Pack Project — naming all three with
  file:line, and says outright that it previously named only the first and
  wrongly claimed autosave was the sole route. Autosave remains the one
  legitimate `pending` carrier.
- [x] Regression tests, `frontend/src/store/packProject.test.ts:734-903`
  (the original fix's 5 specs, all sabotage-verified — see the Completion
  record; round 2 recount below: this range moved from the round-1 review's
  own `:731-900` purely because a handful of lines were added ABOVE this
  block, in the shared test-hook imports, not inside it): the pack
  PREVIEW sends the FULL book with no `pending` field in the payload; a book
  that cannot be fetched refuses the preview by name with nothing sent to the
  bridge (`packPreview` mock asserted un-called) plus status + danger toast;
  the content reaching `pack_start` likewise carries the full book and no
  `pending`; "Start pack" resolves too, refusing with `pending_unresolved`
  (NOT `stale_preview`) for a book added after the preview whose source is
  gone, with `packStart` asserted un-called; and a cancel while the book
  fetch is in flight is not overwritten when that fetch fails late.

#### Evidence

- `frontend/src/store/packProjectRun.ts:44-52` (`serializeCurrentWorkspaceForPack`,
  no `resolvePendingDatasets` call; synchronous return type).
- `frontend/src/store/workspaceIO.ts:73` (`await get().resolvePendingDatasets()`
  inside `prepareWorkspaceState`, whose abort block is lines 69-80).
- `frontend/src/store/workbookTransfer.ts:189` and `:254` (the two sibling
  `await get().resolvePendingDatasets()` calls).
- `frontend/src/lib/workspaceSerialize.ts:217-224` (the comment this bug
  falsifies; now corrected in place at `:217-232`).
- Agent verification: read `packProjectRun.ts` in full, confirmed no
  `resolvePendingDatasets`/`pending` reference besides the unrelated poll
  timer names; compared against both sibling export paths that do call it.
  Not yet reproduced against a live backend pack run.
- Owner verification: — needed to confirm the severity call (P1 vs P2) and the
  chosen abort-vs-resolve UX before implementation.

#### Completion record

- PR/commit: the BUG-011 fix commit, 2026-09-13 (`fix(pack): Pack Project
  resolves pending datasets before serializing`).
- Automated tests: the 5 new specs in `frontend/src/store/packProject.test.ts`
  (file: 61 passing). Full frontend suite green: 634 files / 10,381 tests.
- Agent verification: every new spec sabotage-verified — removing the resolve
  call fails **5** specs, not the 4 originally reported here (correction,
  review round below): the four data/refusal specs PLUS "cancelling while
  the book fetch is in flight is not overwritten when that fetch fails
  late", which times out in `vi.waitFor` waiting for `phase === "scanning"`
  because no fetch is ever started once the resolve call itself is gone.
  Removing the preview abort fails only the preview-refusal spec; removing
  the Start-pack abort fails only the Start-pack refusal spec; removing the
  generation check added after the new `await` fails only the late-cancel
  spec. Source restored byte-identical after each round (`diff` clean).
- Structural note: the resolve step pushed `store/packProjectRun.ts` to 498
  lines against the 500-line `.ts` ceiling, so the cohesive workspace-CONTENT
  slice (`serializeCurrentWorkspaceForPack`, `refusePack`,
  `deriveProjectName`, `contentFingerprint`) was extracted to the new
  `store/packProjectContent.ts` — 424 and 97 lines respectively, no pin
  raised. It is reached only through the already-lazy `packProjectRun.ts`
  chunk, so the eager bundle is unchanged (916,182 B before and after,
  budget 920,400).
- Owner verification: still open — the severity call (P1 vs P2) and, now that
  the abort exists, whether "abort the whole pack" is the right product
  choice versus packing everything that IS resolvable and listing the dead
  books as blockers. The fix deliberately matches the sibling Save path
  rather than inventing a third behaviour.
- Not reproduced against a live backend pack run (the bridge is mocked, as it
  is for every spec in this file) — unchanged from the report.

#### Adversarial review round (2026-09-13)

An adversarial review of the fix commit above found 2 CONFIRMED code
findings (each with a failing probe), 3 doc findings, and 5 nits. This
follow-up commit closes:

- **Finding #1 (CONFIRMED):** `runStartPackProject`'s own book-resolve await
  had NO generation guard at all — the exact bug the pack PREVIEW path was
  already guarded against. A cancel/reset DURING "Start pack"'s resolve step
  was silently overwritten once the (now-stale) fetch settled: cancelling
  during a FAILING fetch flipped back to `failed` with a bogus danger toast
  after the user had already cancelled; during a SUCCEEDING fetch it could
  resurface as `stale_preview`. Closed by capturing `generation` (read only,
  never bumped — Start doesn't itself start or end an attempt) and
  `preview` before the await, then bailing if either changed
  (`store/packProjectRun.ts`'s `runStartPackProject`).
- **Nit 3 (folded into #1):** the phase guard alone could not stop a second
  "Pack Project" click during that same window (`phase` stays
  `awaiting_confirmation` until the resolve AND fingerprint checks both
  pass) — a pre-fix double click ran two concurrent attempts. Closed with an
  in-flight flag in `store/packProject.ts`, set before the lazy `import()`
  — deliberately NOT by moving `phase` to `packing` early, which would have
  rerouted Cancel through the backend `packCancel` call for a copy that was
  never actually started, with no poll loop yet running to resolve it.
- **Finding #2 (CONFIRMED):** `serializeCurrentWorkspaceForPack` re-read the
  store after `resolvePendingDatasets()` but never re-checked `pending` on
  it. `resolvePendingDatasets()` only awaits the books that were pending
  when IT was called, so a lazy import landing WHILE that `Promise.all` was
  still in flight was still serialized straight from its decimated preview
  rows plus a stray `pending` field — this bug's own payload, through a
  narrower window. Closed with a post-await re-check in
  `store/packProjectContent.ts` that refuses ("…a book was still loading")
  instead of serializing.
- **Finding #5 (naming the book):** the refusal named only the operation and
  the raw fetch error, never the book — the original Fix checklist's claim
  ("the siblings name the operation too") was only two-thirds true (two of
  the three sibling sites DO name the book). Closed: the `catch` in
  `serializeCurrentWorkspaceForPack` now looks up the failing book via
  `lib/bookData.ts`'s `lastBookError` (the same lookup
  `lib/workbookTransfer.ts:195-196` already uses) and includes its `.name`
  when a reason was actually recorded for it. (Round 2 finding #5, below:
  this only adopted the NAME half of that lookup — the reason quoted
  alongside it was still the raw thrown error, which could belong to a
  DIFFERENT book. Fixed in round 2, not here.)
- **Doc findings #3/#4:** the original sabotage table understated round 1
  (fails **5** specs, not 4 — corrected in the Completion record above,
  naming the fifth); two stale cross-references to `packProjectRun.ts` that
  should say `store/packProjectContent.ts` (`lib/workspaceSerialize.ts` and
  `store/packProject.ts`, the latter pre-dating this bug) are fixed.
- **Nit 1 (status):** the transient "fetching N books before packing…"
  status was never replaced on success; `serializeCurrentWorkspaceForPack`
  now sets a status once every requested book has actually arrived,
  mirroring the Save sibling's habit of always ending on a terminal status.
- **Nits 4/5:** the test line-range citation above corrected to `:731-894` —
  imperfectly: the review round below (finding 6) found the TRUE range at
  this commit was already `:731-900` (this commit's own 6-line addition to
  that block, missed) and, after round 2's own further additions, the
  Fix-checklist bullet above now cites the current `:734-903` (round 3 found
  this was still short by one — see that section below); the
  Active-queue Owner column set to "Claude (agent)"; the shadowing
  `type Set` alias in `packProjectContent.ts` renamed to `SetPack`.
- **Tests:** 4 new specs in `frontend/src/store/packProject.test.ts`, plus 2
  existing specs strengthened to actually assert the book name finding #5
  adds (their titles already claimed "by name" without checking it) — file
  now 65 passing (was 61). All new/strengthened assertions sabotage-verified
  (source restored byte-identical after each round — see the commit body's
  table).
- **Residual — NOT fixed here, and this claim was WRONG for two of its three
  sites** (out of scope: `store/workspaceIO.ts` and the other BUG-010 files
  are being edited concurrently for BUG-010): recorded here as the identical
  "re-read after resolve without re-checking `pending`" window that
  finding #2 closed for Pack Project still existing in `store/workspaceIO.ts`'s
  Save path (`:73-82`) AND in both `store/workbookTransfer.ts` export paths.
  **Round 2 correction:** the workbook-transfer half was false —
  both paths call `buildTransferPackage` (`lib/workbookTransfer.ts`) AFTER
  their own resolve await, and that function re-checks `pending` on the
  fresh state it receives and refuses if anything still is
  (`lib/workbookTransfer.ts:182-183`) — a re-check of its own, already
  closing this for workbook Copy/Duplicate. Only `store/workspaceIO.ts`'s
  Save/Save As path is genuinely still open. `lib/workspaceSerialize.ts`'s
  comment is narrowed accordingly in round 2, below.
- **Not attempted:** nit 2 ("Start pack's resolve can essentially never
  rescue a pack, only buy a better error code") and nit 6 (an unverifiable
  "pushed to 498 lines" claim in the Structural note above) needed no code
  change and are left as the review recorded them.
- **Bundle:** the nit-3 in-flight flag lives in `store/packProject.ts`,
  which is EAGER (unlike `packProjectRun.ts`/`packProjectContent.ts`, both
  reached only through the store's lazy `import()`), so it is the one part
  of this round's fix that could move the pin. Measured after `npm ci` and
  clearing `node_modules/.vite`: 916,182 B at this commit's parent ->
  916,197 B here, +15 B, 4,203 B under the unmoved 920,400 budget — nowhere
  near forcing a pin move either direction. **Round 2 correction:** the
  parent SHA this bullet named was an orphaned commit from a since-rewritten
  branch — reachable today only as `bc8f14fa`, two commits back — not this
  commit's real parent (`762e00c1`, per `git rev-parse <this commit>^`). The
  real parent measured 916,380 B, so the true delta was +4 B, not +15 B —
  see the round 2 section below for the full re-measurement.
- Owner verification: unchanged from the original fix — still open (the
  severity call and abort-vs-partial-pack choice).

#### Adversarial review round 2 (2026-09-13)

A second adversarial review of the round-1 review commit above (`384f2bc9`)
found one CONFIRMED code regression that round 1's own fix introduced (nit
3's in-flight flag had no escape hatch), one CONFIRMED code finding half-fixed
(finding #5 adopted only the book NAME, not its reason), one nit never
actually closed (N1's status line still lied), one FALSE residual claim
written into three places, and a set of stale file:line references — several
newly created by round 1's own edits. This follow-up commit closes:

- **`startInFlight` survives a fetch that never settles:** round 1's in-flight
  guard (nit 3, above) was cleared ONLY in `startPackProject`'s own `finally`
  — which never runs while the awaited `runStartPackProject(...)` call is
  still pending. `serializeCurrentWorkspaceForPack`'s book-resolve await has
  no timeout, so one hung `fetchBookData` pinned the guard true FOREVER: a
  reset, or a cancel, followed by a fresh preview could not recover Start
  pack for the rest of the session. Closed by clearing the flag directly and
  synchronously in both `resetPackProject` and `cancelPackProject`
  (`store/packProject.ts`), independent of whether the stuck fetch ever
  settles. A `resetStartInFlightForTests()` export mirrors
  `packProjectRun.ts`'s existing `resetGeneration`/`resetThrottle`/
  `resetPollSequencing` test-reset role, wired into this file's own
  `beforeEach`/`afterEach`.
- **The refusal's reason now stays paired with its own book:** round 1's
  finding #5 fix used `lastBookError` only to pick WHICH book to name, but
  still quoted the raw thrown `e` as the reason — so a still-pending dataset
  with a STALE recorded error (from an earlier attempt; a fetch failure never
  clears `pending`, and `lib/bookData.ts`'s `_bookErrors` is cleared only on
  success) could be named alongside a completely different book's error text,
  whenever it sorted earlier in `datasets` order than whichever book actually
  caused THIS rejection. Closed by taking the REASON from the same
  `lastBookError` lookup as the name, truncated via `truncateReason`, exactly
  mirroring `lib/workbookTransfer.ts:195-196` in full now, not half.
  `packProjectContent.ts` states inline that only the first failing book in
  `datasets` order is ever named, mirroring `lib/workbookTransfer.ts:184`'s
  own stated rule. The sibling refusal for "a book was still loading" (round
  1's finding #2 fix) is named too now (nit 5) — the datum was already
  sitting in that branch's own predicate.
- **N1 actually closed:** the status line no longer reads "…packing…" once
  the pack has actually left the in-flight state — the preview reaching
  `awaiting_confirmation` now sets a real "N dataset(s) ready — review the
  pack preview" status (nothing has been copied yet, so "packing" was never
  true there), and the Start path's poll loop reaching `completed` now sets
  a real outcome ("packed N dataset(s) to `<bundle_dir>`") via a new
  `notePackOutcome` export in `packProjectContent.ts` — kept there, not in
  `packProjectRun.ts`, so that module's own documented "never touches
  `useApp` directly" boundary holds. One spec per path, both sabotage-checked
  (deleting either `notePackOutcome` call fails its own spec, 0 others).
- **The FALSE residual claim, corrected:** round 1 recorded the "re-read
  after resolve without re-checking `pending`" window as still open on
  BOTH `store/workspaceIO.ts`'s Save path AND both `store/workbookTransfer.ts`
  export paths. The workbook half was wrong — both paths call
  `buildTransferPackage` (`lib/workbookTransfer.ts`) AFTER their own resolve
  await, and that function re-checks `pending` on the fresh state it
  receives and refuses if anything still is (`lib/workbookTransfer.ts:182-183`)
  — already closing this for workbook Copy/Duplicate. Narrowed in
  `lib/workspaceSerialize.ts`'s comment, this entry's own "Residual" bullet
  above, and the round-1 change-log row — only `store/workspaceIO.ts`'s
  Save/Save As path (`:73-82`) remains genuinely open. `store/workspaceIO.ts`,
  `store/workbookTransfer.ts`, `lib/workbookTransfer.ts`, and the other
  BUG-010 files were read-only for this fix — they are being edited
  concurrently for BUG-010.
- **Stale file:line references recounted:** every citation in this entry's
  Fix checklist above (`packProjectContent.ts`'s function/type/refusePack
  ranges, both callers in `packProjectRun.ts`, both abort blocks, the
  regression-test range) re-measured against this commit and corrected —
  several had drifted since round 1 added ~50 lines to `packProjectContent.ts`
  and ~24 to `packProjectRun.ts` without updating any of them. The regression
  spec range moved again, purely from lines added ABOVE it in this file's
  shared test hooks, not inside the block itself.
- **Nits fixed:** the nonexistent `packProjectContent.test` mention in
  `packProject.test.ts` (there is no such file; `packProjectContent.ts` is
  exercised only through this test file) rewritten; the spec titled "…is
  rejected by the phase guard…" renamed to name `startInFlight` as the actual
  mechanism (`phase` itself never moves during that window); the "N books
  loaded — packing…" status restored its count in the singular case
  (`"1 book loaded — packing…"`, not "book loaded — packing…").
- **Numbers re-measured against the REAL parent, `a99ebb6d`** (this commit's
  `HEAD~1` — the round-1 commit's own bundle bullet had named an orphaned SHA
  from a since-rewritten branch, reachable today only as `bc8f14fa`, not any
  ancestor of this work): scoped `packProject.test.ts` 70 passing (was 65, +5
  new specs); full `npx vitest run` 636 files / 10,433 passed + 2 expected
  fail (10,435), 0 `FAIL`; eager bundle 916,384 B (parent) -> 916,408 B (this
  commit), +24 B, 3,992 B under the unmoved 920,400 budget — nowhere near a
  pin move; `uv run pytest -q tests/test_repo_integrity.py` 12 passed
  (plans/ touched). **Round 3 correction:** rebase drift struck again after
  this — the work actually landed on top of `cccf70d1`
  (`git rev-parse 1aa8d4bd^` = `cccf70d1`, not `a99ebb6d`, which is merely an
  ancestor four commits back), so `916,384 B`/`916,408 B` above were real
  measurements of the WRONG tree. `cccf70d1` itself measures `916,453 B`
  (matching BUG-010's own entry/change-log row for that commit), so the
  correct pair is `916,453 B` (parent) -> `≈916,477 B` (this commit, the same
  `+24 B` delta) -> `≈3,923 B` headroom, not `3,992 B`. The `+24 B` delta and
  "nowhere near a pin move" conclusion are unaffected — see the round 3
  section below for the full account and this round's own (unrelated)
  numbers.
- **Not attempted:** round 1's own nit 2 ("Start pack's resolve can
  essentially never rescue a pack, only buy a better error code") and nit 6
  (the unverifiable "pushed to 498 lines" Structural-note claim) needed no
  code change in round 1 and still need none here — left as both rounds
  recorded them.
- Owner verification: unchanged — still open (the severity call and
  abort-vs-partial-pack choice).

#### Adversarial review round 3 (2026-09-13)

A third adversarial review of the round-2 fix commit (`1aa8d4bd`) found two
CONFIRMED code findings — one a genuinely NEW hole the round-2 fix itself
introduced, one a gap round 2's own doc-promise overclaimed — plus two doc
findings (a fifth recurrence of the wrong-parent-SHA mistake, and an
off-by-one spec-range citation) and six nits. This follow-up commit closes:

- **`startInFlight` is now attempt-scoped, not global (finding #1):** round
  2's fix cleared the guard synchronously from `resetPackProject`/
  `cancelPackProject`, closing "stuck forever" — but `startPackProject`'s own
  `finally` stayed UNCONDITIONAL, so a LATE-settling (not eternally hung)
  abandoned attempt's `finally` could clear a flag a NEWER attempt was
  currently holding through its own resolve window, reachable whenever a
  re-pending book resolves back to byte-identical content (a relink/re-fetch
  of an unchanged book — a real shape, not a contrived one). The reviewer
  drove this to two concurrent `packStart` calls. Closed with a `startEpoch`
  token in `store/packProject.ts`: every attempt captures the epoch when it
  takes the flag, `finally` only clears it if no reset/cancel/newer-start has
  bumped the epoch since, and `resetPackProject`/`cancelPackProject` (and the
  test-only `resetStartInFlightForTests`) bump it whenever they clear the
  flag. One probe reproduces the reviewer's exact repro (an abandoned attempt
  settling late while a newer one is mid-resolve): exactly one `packStart`
  call, the extra click rejected.
- **`failed`/`cancelled` terminals also end on a real outcome, universally,
  not only for the two paths round 2 happened to catch (finding #2):**
  round 2's `notePackOutcome` closed the stale "…packing…"/"…review the pack
  preview" transient only for `awaiting_confirmation` and `completed` — every
  OTHER way this store reaches `failed` or `cancelled` (a backend failure
  reported through polling, a cancel actioned before packing ever starts, a
  stale-preview or bridge-unavailable failure inside "Start pack" itself)
  left whichever status line was already standing uncorrected. Closed in
  full, not narrowed: two small choke-point helpers in
  `store/packProjectRun.ts` (`noteFailed`/`noteCancelled`) now sit behind
  EVERY `failed`/`cancelled` transition in that file, including `pollOnce`'s
  own poll-driven ones and `cancelPackProject`'s pre-packing direct branch
  (which never goes through polling at all). Three new specs: a poll-driven
  `failed` (asserts the actual error text, not a stale transient), a
  poll-driven `cancelled`, and cancelling before packing starts (the direct
  branch, no poll involved).
- **The recorded parent SHA, fifth recurrence — this time genuine rebase
  drift, not mis-naming:** round 2's own "measured against the real parent"
  correction was itself measured against `a99ebb6d`, an ancestor four commits
  back, not `1aa8d4bd`'s actual `HEAD~1` (`cccf70d1`) — the work was rebased
  onto more commits after being measured. Corrected in place above: the
  round-2 bundle bullet, and the change-log row below. This round's own
  numbers are measured the way `agent_rules.md`'s standing rule requires —
  `git rev-parse HEAD~1` printed AFTER committing, not before.
- **Spec-range off-by-one, same class round 2 was itself correcting:** the
  Fix-checklist bullet's `:734-902` was one line short of the block's actual
  close (`:903`) — recounted and corrected to `:734-903` in both places it
  appeared in this entry.
- **Nits:** `lib/bookData.ts`'s `truncateReason` docstring updated to name
  its new third consumer (`store/packProjectContent.ts`, added when BUG-011
  first landed but never folded into that comment); the stale "next describe
  block below" cross-reference in `packProject.test.ts` renamed to say which
  block; the two round-2 status specs (preview-ready, completed) now use a
  non-zero, non-one `summary.datasets` count each (2 and 1) so the assertions
  actually pin the "N dataset(s)" text and both the singular and plural
  branches, rather than passing on `toContain("review the pack preview")`
  alone against a manifest whose count was 0; one clarifying clause added to
  `packProjectContent.ts`'s refusal comment about the named book potentially
  being merely slow rather than the actual cause (nit 5) — narrowing that
  fully is left as an explicit owner call, not folded in here. **Not
  attempted:** the previous round's own ceiling-number nit (`wc -l` vs
  `split("\n").length` in a commit body, a historical citation with nothing
  live to fix) and the `pollOnce` ordering nit (`notePackOutcome` firing
  synchronously while the matching `phase`/`resultPath` `set` goes through
  the 200ms throttle) — cosmetic, unexercised by any spec, and out of scope
  for this round's four findings.
- **Numbers, measured against this commit's REAL parent** (`git rev-parse
  HEAD~1`, printed after committing) **= `26869ddb`** (an unrelated
  `fix(export)` commit — this round's own worktree branched directly from
  it, so no rebase drift is possible here): `packProject.test.ts` scoped run
  clean; full `npx vitest run` not re-run this round (the machine was
  contended) — the last verified full-suite count remains the reviewer's own
  measurement at `1aa8d4bd`, **636 files / 10,444 passed + 2 expected fail
  (10,446)**, 0 `FAIL`; `tsc -b --force`/`eslint --max-warnings=0` clean;
  `npm run build` clean after `rm -rf node_modules/.vite`, eager bundle
  **916,466 B at `26869ddb` (parent) -> 916,466 B here, +0 B** — neither file
  this round's fix actually changes is eager: `store/packProject.ts` (the
  F1 fix) turned out to already be reached only through the lazy
  `PackProjectPanel` chunk, not the entry script or modulepreload list (grep
  of `index.html` confirms `packProject-*.js` is absent from both), and
  `store/packProjectRun.ts`/`store/packProjectContent.ts` (the F2 fix) are
  the already-lazy chunk documented at the top of this file; the
  `lib/bookData.ts` docstring edit is comment-only and is stripped by
  minification regardless. Verified by rebuilding `26869ddb` itself in a
  throwaway `git worktree add` (never `cp -r` a worktree) and diffing the
  entry chunk byte-for-byte against this commit's build: `514,175 B` in both,
  same value. `uv run pytest -q tests/test_repo_integrity.py` — 12 passed
  (plans/ touched).
- Owner verification: unchanged — still open (the severity call and
  abort-vs-partial-pack choice); nit 5's "named book may be merely slow"
  narrowing is a new, separate open judgment call from this round.

#### Residual closed (2026-09-13): Save/Save As now closes finding #2's window too

Round 1's Residual bullet and round 2's correction of it left one real gap
open: `store/workspaceIO.ts`'s `prepareWorkspaceState` — the shared preface
for Save and Save As — re-read the store after its own
`await get().resolvePendingDatasets()` but never re-checked `pending` on
that re-read, the identical window finding #2 closed for Pack Project. It
was left open at the time because `store/workspaceIO.ts` and the other
BUG-010 files were being edited concurrently for that bug; BUG-010 has
since landed and been through its own review round, so this follow-up
commit closes it:

- **The fix, mirroring `packProjectContent.ts`'s own post-await re-check
  verbatim:** `prepareWorkspaceState` (`frontend/src/store/workspaceIO.ts`)
  re-checks `s.datasets` for a still-`pending` entry right after the
  `const s = get();` re-read (resolve call `:73`, re-check `:81-96`) and
  refuses the save — `"couldn't load full data for every book: \"<name>\" was
  still loading"`, same status + danger-toast shape as the sibling
  fetch-failure `catch` immediately above it — rather than letting a book
  that turned pending DURING the resolve await reach `serializeWorkspace`
  with its downsampled preview rows (and a stray `pending` field). Both Save
  and Save As share this one preface function, so one fix closes it for
  both entry points, exactly like Pack Project's preview/Start-pack pair
  shared `serializeCurrentWorkspaceForPack`.
- **`lib/workspaceSerialize.ts`'s `pending` comment updated to say so:** the
  comment previously narrowed itself, twice, to name `store/workspaceIO.ts`
  as the one export path still carrying this window. It now states the
  guarantee holds on every explicit export path — Save, Save As, workbook
  Copy/Duplicate, and Pack Project all resolve pending datasets first AND
  refuse rather than serialize a book that turns pending again during that
  resolve.
- **Regression test:** `frontend/src/store/workspaceIO.test.ts`'s new
  `describe("BUG-011 residual — a book that goes pending DURING the resolve
  await (Save/Save As)")` — same shape as `packProject.test.ts`'s sibling
  spec for finding #2: a lazy book's fetch is held open, a second lazy book
  is added to the store while the first is still in flight, then the first
  resolves. Asserts the save is refused by name (`"book2.opj" was still
  loading"`), the danger toast carries the same text, `saveBlob` (the
  browser-download fallback this path exercises) is never called, and the
  book that turned pending is still `pending` afterwards (a `currentProject`
  assertion that could not fail was removed in the review round).
  Sabotage-verified: removing the re-check fails exactly this one new spec
  (41 other specs in the file untouched), restored byte-identical after.
- Scope: `store/workspaceIO.ts` and `lib/workspaceSerialize.ts` were the only
  files this residual named as open; `store/workbookTransfer.ts` and
  `lib/workbookTransfer.ts` were already closed (round 2's correction) and
  are untouched here.
- **Bundle:** measured against `2920e34a`, which the agent named as the
  parent; the commit's real parent on the branch is `dafaa333` (the PR #359
  merge, whose tree is identical — the review round corrected the SHA; sixth
  recurrence of the ancestor-vs-parent citation) — it builds to
  916,466 B eager (rebuilt in a throwaway `git worktree add` with its own
  `npm ci`, never a `cp -r` of a worktree), this commit to 916,645 B, +179 B,
  3,755 B under the unmoved 920,400 B budget.
- Owner verification: unchanged from the original fix and every review round
  since — still open (the severity call and abort-vs-partial-pack choice,
  and nit 5's "named book may be merely slow" narrowing from round 3). This
  residual closure is a code-verifiable fix, not a resolution of either
  open owner call.

---

## ~~BUG-012 — a saved figure's x-axis break reaches export/reopen but never renders on screen~~ **FIXED 2026-09-14**

**Priority:** P2 — the document and the export were correct and agreed with
each other; only the live canvas disagreed with both. No data was lost or
altered, but a user who reopened their own saved figure saw a plot that
silently stopped matching what they exported, with no indication anything was
wrong — exactly the kind of screen/export mismatch the P4.2 matrix exists to
catch.

**State:** FIXED 2026-09-14. `Stage/useEffectiveComposition`'s durable
fallback now derives the paneled break from the document's canonical
`plot.axisBreaks.x` through `lib/facet.durableComposition`, which wraps the
SAME `breakCompositionFromBreaks` builder the live `breakAtGaps` gesture
constructs its arrangement with — one construction site, so a reopened figure
cannot panel differently from the one the user drew. See the Completion
record.

**Reported:** 2026-09-14, by the P4.2 canonical regression matrix
(`1593cdee`, `frontend/src/lib/regressionMatrix.test.ts`) — a design-time
finding from the matrix's structural comparison, not yet surfaced by a user
report.

**Investigated:** root cause confirmed by reading the composition/fallback
chain, not inferred — see Confirmed implementation evidence below.

**Suggested implementation owner/model:** Claude (agent) — fixed 2026-09-14.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P4.2 ("Canonical
plot/project regression matrix"), divergence D1.

#### User-visible problem

A user draws an x-axis break on a plot (the store's `breakAtGaps` action),
saves the workspace, and reopens it (or exports the figure without
reopening). The `FigureDocument` faithfully carries the break —
`plot.axisBreaks.x` round-trips through save/reopen, and an export of that
document draws the break — but the on-screen canvas, after a reopen, renders
the series as one continuous, unbroken line. The exported figure and the
reopened document both say "this plot has a break here"; the screen the user
is actually looking at does not show one.

#### Confirmed implementation evidence (as filed — the state BEFORE the fix)

- `frontend/src/lib/figureDocument.ts:44`, `:179-182`, `:295`, `:426` —
  `FigureDocument.plot.axisBreaks` (`{x, y, y2}`) is the canonical, persisted
  home for break ranges; `axisBreaks.x` round-trips through
  `createFigureDocument` and the parse/validate path (`axisBreaks()` at
  `:295`, consumed at `:426`) unchanged.
- `frontend/src/lib/figureSpec.ts:376` — `buildFigureSpecFromDocument` reads
  `document.plot.axisBreaks.x` into `extras.xBreaks`, and `:177` folds it into
  `overrides.x_breaks` on the wire `FigureSpec` — every export of a document
  with a break draws it.
- `frontend/src/store/useApp.ts:539`, `:1359-1390` — the ONLY code path that
  ever makes the CANVAS draw a break is the `breakAtGaps` store action, which
  builds a transient panel arrangement held in `AppState.composition`
  (`store/useApp.ts:371`) — a live-session render cache, not a field on
  `FigureDocument` and never persisted.
- `frontend/src/components/Stage/useEffectiveComposition.ts:33-41` — the ONE
  hook `PlotStage.tsx` (`:135`) and `MultiPanelStage.tsx` read for "what
  panels are actually showing." Its own header explains the fallback
  contract: when the transient `composition` is `null` — exactly the state
  right after a workspace reopen, since `composition` is never serialized —
  it falls back to `facetCompositionFromBinding(active, facetKey, xKey,
  yKeys)`, a DURABLE fallback keyed on `facetKey` only. There is no
  equivalent durable fallback keyed on `document.plot.axisBreaks.x`, so a
  reopened document with a break renders as an ordinary, unbroken single
  panel until the user re-applies `breakAtGaps` by hand.
- Test: `frontend/src/lib/regressionMatrix.test.ts:318`,
  `it("DIVERGENCE (BUG-012): a saved x-break reaches export and reopen; the
  screen has no field to render it from", ...)` — pins BOTH measured values
  (export `[[2, 3]]`, reopen `[[2, 3]]`, screen `[]`) and asserts they
  differ, plus the underlying reason: rebuilding the document from
  `figureDocumentToPlotView(figure)` — the canvas's ENTIRE input — yields
  `plot.axisBreaks.x: []`, so `PlotView` cannot carry the break at all.
  (Converted 2026-09-14 from a bare `it.fails`, which passed on any throw and
  so could have gone green for the wrong reason.) The surrounding matrix's
  own narrowed-equality table (`regressionMatrix.test.ts:108-110`,
  `DIVERGENT.break`, `legs: ["export", "reopen"]`) exists specifically to
  carve this field out of the main screen≡export/reopen assertions so the
  divergence stays visible rather than silently passing.

#### Why this priority

P2 as filed. The evidence supports keeping it there rather than raising to
P1/P0: nothing is corrupted (the document and export both hold the correct,
complete break data — `axisBreaks.x` is never lost, only unrendered), and the
mismatch has a workaround (re-apply `breakAtGaps` after every reopen).
Priority is capped below P1 because a break is a presentation aid, not a
value the analysis reads — but the fact that this happens on EVERY reopen of
EVERY document with a break, unconditionally and with no error or notice,
argues for keeping it toward the upper end of P2 rather than P3.

#### Reproduction checklist

- [x] Starting state and sample data identified — the `break` fixture in
  `frontend/src/lib/regressionMatrixFixtures.testkit.ts` (a `FigureDocument`
  with `plot.axisBreaks.x: [[2, 3]]`).
- [x] Exact actions recorded — reopen (`reopenProject`) or export
  (`projectExport`) a document carrying `plot.axisBreaks.x`, then compare
  against the live screen projection (`projectScreen`).
- [x] Actual result recorded — export and reopen both carry
  `xBreaks: [[2, 3]]`; the screen projection carries `xBreaks: []`.
- [x] Expected result recorded — the screen should render the same break the
  document persists and the export draws.
- [x] Reproduced by an agent —
  `frontend/src/lib/regressionMatrix.test.ts`'s
  `it("DIVERGENCE (BUG-012): a saved x-break reaches export and reopen; the
  screen has no field to render it from", ...)`.

#### Fix checklist

- [x] Give `useEffectiveComposition`'s durable fallback a break-aware branch
  (an `axisBreaks`-driven composition builder analogous to
  `facetCompositionFromBinding`), or otherwise make a reopened document
  re-derive the same panel arrangement `breakAtGaps` would have produced live.
  **Done:** `lib/facet.breakCompositionFromBreaks` is that builder and is the
  ONE construction site — `store/useApp.ts`'s `breakAtGaps` builds its live
  arrangement with it too (net-zero lines; that file sits on its size pin) —
  and `lib/facet.durableComposition` wraps it together with the facet fallback
  so the PRECEDENCE has a single definition as well. No new persisted field:
  the ranges are read from the canonical `plot.axisBreaks.x` the export path
  already uses.
- [x] Confirm `MultiPanelStage.tsx`'s panel-break render path can consume
  that fallback exactly as it consumes a freshly-applied `breakAtGaps`
  composition — no separate render branch. **Done** — it consumes the
  `Composition` prop, so one break-mode branch renders both; pinned at the DOM
  layer by `MultiPanelStage.test.tsx`'s "renders one uPlot per segment from
  the document alone, with no live gesture". One gate change was required: the
  mount predicate (now the shared `multiPanelShowing`, which
  `useLiveSnapshotPublish`'s `altModeShowing` also calls instead of restating
  it) treats a break arrangement as its own explicit intent, because an
  AUTHORED break has no `stackMode` toggle to restore the way the
  `breakAtGaps` gesture does.
- [x] Add a regression test at the DOM/render layer (not only the structural
  payload) that a workspace SAVE → RELOAD round-trip shows the break on
  screen, per this repo's "test at the layer the user experiences" discipline.
  **Done** — the DOM case above renders the real component through the real
  hook from a reopened-shaped store and asserts each panel's x SLICE, not just
  the panel count (the plain per-channel stack would also make two).
- [x] INVERT the divergence assertion in `regressionMatrix.test.ts` — it is
  now `it("BUG-012: a saved x-break reaches export, reopen AND the screen it
  is drawn on", ...)`, asserting `projectScreen(...).xBreaks` equals both
  other legs' `[[2, 3]]`. The screen leg MEASURES that value from the panel
  geometry the shared derivation produces (`screenXBreaks`), so the equality
  is still evidence about the product; the `PlotView`-cannot-carry-a-break
  pins are kept, because that is still true and is exactly why the fix reads
  the document instead.
- [x] Drop the `break` fixture's `DIVERGENT` narrowing — done; `break` now
  compares field-for-field like `plain`, and its committed golden gained
  `"xBreaks": [[2, 3]]` — the only golden that changed, every other one
  byte-identical after a full regeneration.

#### Acceptance criteria

- [x] A figure with a saved x-axis break renders the break on screen
  immediately after a workspace reopen, with no user action required.
- [x] `projectScreen(document, dataset).xBreaks` equals
  `projectExport(document, dataset).xBreaks` for the `break` fixture — the
  equality BUG-012's divergence test is inverted into.
- [x] The fix does not change `breakAtGaps`'s existing live-session
  behavior — applying a break interactively during the same session still
  works exactly as before: the action's own store tests are unchanged and
  green, the live `composition` still wins over both durable bindings (pinned
  by a test), and the shared builder keeps the action's "fewer than two panels
  is not a break" refusal.

#### Completion record

- Date: 2026-09-14
- PR/commit: `fix(stage): BUG-012 …` on `claude/repo-evaluation-l7y7k9`
  (parent `b749f804` — the cherry-pick's real parent on this branch; the
  originally-recorded `45f43070` was stale), followed by
  `fix(stage): BUG-012 review round …` (2026-09-15, the entry below).
- Bundle: eager JS 910,263 → 910,547 B against a 920,400 B budget, measured
  on this branch (`b749f804` → the BUG-012 commit). The commit message's own
  `919,781 → 920,078` pair was measured on the pre-cherry-pick `45f43070` and
  does not describe this branch.
- Code: `lib/facet.ts` (`breakCompositionFromBreaks`, `durableComposition`),
  `components/Stage/useEffectiveComposition.ts` (the durable fallback plus the
  shared `multiPanelShowing` mount predicate),
  `components/Stage/PlotStage.tsx` and
  `components/Stage/useLiveSnapshotPublish.ts` (both now ask that ONE
  predicate, and PlotStage threads the ONE composition instead of two panel
  arrays), `store/useApp.ts` (`breakAtGaps` builds through the shared builder,
  net-zero lines), `lib/regressionMatrixLegs.testkit.ts` (the screen leg
  measures its breaks off the rendered arrangement).
- Automated tests: `components/Stage/useEffectiveComposition.test.tsx` (new —
  fallback, drift guard against the live gesture, precedence, no-break
  document, the two-panel refusal, and the mount predicate),
  `components/Stage/MultiPanelStage.test.tsx` (new DOM case),
  `store/plotRecipes.test.ts` (new — a recipe's captured break ranges rebuild
  panels end to end), `lib/regressionMatrix.test.ts` (divergence inverted,
  narrowing dropped), plus the regenerated `break.json` golden.
- Agent verification: `tsc -b --force`, `eslint src --max-warnings=0`, and
  `vitest run src/lib src/store src/components/Stage src/architecture.test.ts`
  all green; every new test sabotage-verified (remove the break fallback → the
  hook, DOM and matrix tests all fail; make the live gesture's build drift
  from the shared builder → the drift guard fails, **and so do three
  `store/useApp.test.ts` cases** in the `useApp breakAtGaps (gap #21 last
  residual)` block — "auto-detects the gap, builds paneled segments, activates
  the dataset, and turns on stack mode", "honors row exclusion (guard #11) —
  an excluded row never enters a break panel" and "accepts an explicit breaks
  override instead of auto-detecting". The original record said "only the
  drift guard", which the 2026-09-15 review round re-measured as wrong (4
  failures, not 1); drop the break clause
  from the mount predicate → only the mount test fails; flip the facet/break
  precedence → only the precedence test fails).
- Owner verification: open — a real reopened figure on screen.
- Notes: PRECEDENCE, defined and tested: when a figure carries BOTH a facet
  binding and saved breaks, the facet grid wins — mirroring the export path,
  where `routes/export_figures.py` branches on `if req.facets:` before the
  flat renderer is reached and `calc/figure_facets.render_facets_figure`
  honors a narrow override subset that excludes `x_breaks`. Also worth
  recording: the live `breakAtGaps` gesture writes NO durable field of its own
  (it only sets the transient `composition`), so the break this fix restores
  is always an AUTHORED one — the Figure Builder's breaks panel or a plot
  recipe, the only writers of `plot.axisBreaks.x`. The report's narrative of a
  `breakAtGaps` gesture surviving save/reopen was therefore never reachable;
  everything else in it reproduced exactly.

#### Review round — 2026-09-15

An adversarial review of the fix commit confirmed the derivation and the
shared-builder claim but found four behaviour defects and one coverage hole
riding on top, all closed in `fix(stage): BUG-012 review round …`:

- **F2 — screen and export elided DIFFERENT x-ranges** whenever the authored
  break endpoints were not sample points. `lib/facet.breakPayloads` sized each
  panel from the segment's own data extent; the export
  (`calc/figure_break.render_breaks_impl`) sizes it from the BREAK BOUNDS
  (`bounds`: data min → `b0`, `b1` → next `b0`, … → data max) and sets its
  `width_ratios` from them. Measured on x = 0..5 with `axisBreaks.x =
  [[2.2, 2.8]]`: screen panels `[0, 2]` / `[3, 5]` (elides `(2, 3)`, widths
  2 : 2) vs export `[0, 2.2]` / `[2.8, 5]` (elides `(2.2, 2.8)`, widths
  2.2 : 2.2). `BreakPanel.xRange` is now `[max(segment lo, data min),
  min(segment hi, data max)]` — the same list, by construction. A **no-op for
  every `suggestBreaks` output** (`[finite[i], finite[i + 1]]`, both endpoints
  data points), so the live `breakAtGaps` gesture's panels are unchanged;
  pinned by `facet.test.ts`'s "is a NO-OP for suggestBreaks' own output".
- **F3 — the stack toggle could no longer switch an authored break off.**
  `setStackMode(false)` cleared `composition` and `facetKey`, but the durable
  fallback rebuilt the panels from `plot.axisBreaks.x` on the very next
  render, so the control was inert and silently so. It now also clears the
  FOCUSED document's `plot.axisBreaks.x` through the declared write chokepoint
  (`store/windowDocuments.clearFocusedXBreaks` →
  `withPlotWindowDocument`). A user action deleting a field; the persisted
  `.dwk` contract for `plot.axisBreaks` is untouched.
- **F4 — a stale break panelled a DIFFERENT dataset after a plain Library
  click.** `createPlotWindowDocument` inherited `previous.plot.axisBreaks`
  verbatim, while `datasetViewDefaults` nulls `facetKey` on a genuine switch
  precisely because a channel-indexed binding cannot carry across datasets.
  Measured: window on d1 with `[[2, 3]]`, `setActive("d3")` (unrelated, same
  x range) → the stage panelled d3 at d1's gap, no gesture, no toggle. The two
  genuine-dataset-switch rebind sites now pass `resetAxisBreaks`
  (`focusedRebindPatch`, gated on the same `s.activeId !== id` test its
  `viewPatch` uses, and `rebindWindow`'s background branch); re-activating the
  already-active dataset keeps the break, as `breakAtGaps`' own trailing
  `setActive` requires.
- **F5 — background windows still drew a reopened break as one line.**
  `BackgroundPlotWindow` built only the FACET half of the fallback and kept a
  local `stackMode &&` gate with no break clause, so a workspace reopened with
  several break figures showed the break in the focused window and BUG-012's
  original symptom in every other one. It now derives through the shared
  `durableComposition` and mounts through the shared `multiPanelShowing`.
- **F1 — the hook's channel wiring was unpinned.** Every BUG-012 test ran
  against a single-channel dataset with `xKey: null, yKeys: null`, so dropping
  either from the hook's `durableComposition` call was invisible (measured:
  both sabotages left the whole BUG-012 test set green). The fixture is now
  two-channel with `xKey: 0, yKeys: [1, 0]`.

Also closed in the same commit: direct unit coverage for both durable builders
and the F2 cases in `lib/facet.test.ts` (there was none — they were reached
only through the Stage hook, the DOM case and the matrix testkit); an
`architecture.test.ts`-style ratchet, kept in `lib/facet.test.ts`, that
`breakComposition(` is called from `lib/facet.ts` only (the "ONE construction
site" invariant was a convention — reintroducing a second identical builder
left 1236/1236 tests green); a facet+break assertion on the EXPORT leg, which
needed the matrix's export leg to model `routes/export_figures.py`'s
`if req.facets:` branch (the wire carries `x_breaks` for a faceted figure but
`calc/figure_facets` applies only `lim_keys=("x_lim",)`, so reading the field
raw claimed a break the renderer never draws); `breakAtGaps` computing
`analysisData(ds)` once instead of twice (via `breakCompositionFromData`); a
self-test for the now-unreachable `DIVERGENT`/`without()` narrowing machinery,
which is KEPT rather than deleted so the next divergence has one documented
place to be recorded; and the matrix header/describe-title drift about which
divergences are fixed.

**Residuals (measured, deliberately not fixed here):**

- **Row exclusion can drop the SCREEN break while the export keeps it.**
  `breakCompositionFromBreaks` refuses fewer than two surviving panels —
  `breakAtGaps`' own refusal, and the right screen behaviour — but
  `lib/figureSpec.ts:177` emits `overrides.x_breaks` whenever the document
  carries any, with no equivalent test. Measured: excluding every row above
  the break collapses the screen to an ordinary plot while an export of the
  same document still draws a broken axis. Pinned as behaviour (not as a
  divergence) by `facet.test.ts`'s "honors row exclusion (analysisData)". A
  real fix belongs on the export side (`figureSpec`/the renderer), not here.
- **⊞ "snapshot to new window" is a silent no-op for a reopened break
  figure.** `altModeShowing` is true for any break composition, so
  `publishLivePlotSnapshot(null)` runs and `snapshotToNewWindow()` returns
  without a toast. Identical to facet, per-channel stack, polar and stat —
  none is snapshottable, because the frozen-XY snapshot kind cannot represent
  a multi-panel canvas — so this is correct for what is on screen; it is only
  a NEW class of figure reaching it. A fix is a new snapshot kind, not a line.

---

## ~~BUG-013 — a waterfall view's offset never reaches the export wire~~ **FIXED 2026-09-14**

**Priority:** P2 — a whole view TYPE mis-exports (overlaid instead of
staggered curves), with a workaround (manually offset before export, or
accept the wrong figure) but no data loss.

**Reported:** 2026-09-14, by the P4.2 canonical regression matrix
(`1593cdee`, `frontend/src/lib/regressionMatrix.test.ts`) — a design-time
finding from the matrix's structural comparison, not yet surfaced by a user
report.

**Investigated:** root cause confirmed by reading the compose pipeline and
the `FigureSpec` wire contract, not inferred — see Confirmed implementation
evidence below.

**Suggested implementation owner/model:** Unassigned.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P4.2 ("Canonical
plot/project regression matrix"), divergence D2.

#### User-visible problem

A user turns on a waterfall view (`view.waterfall`, a positive offset
fraction), which visibly staggers every series vertically on screen so
overlapping curves become readable. Exporting that same view — to PDF/SVG,
or via Copy figure — produces a figure with every series drawn at its
ORIGINAL, un-offset position: the export looks like the waterfall was never
applied, even though the screen the user is looking at clearly shows it.

#### Confirmed implementation evidence

*As filed (2026-09-14, before the fix) — kept verbatim as the record of what
was measured. Every line-numbered claim below describes the PRE-FIX tree; see
the Completion record for what the code does now.*

- `frontend/src/lib/plotdata.ts:364` (`DisplayCompose.waterfall: number`) and
  `:377-382` (`composeDisplayPayload`) — the FIRST step of the canonical
  on-screen compose pipeline is `applyWaterfall(payload, o.waterfall)`
  (`:521`, "Vertically offset each series for a waterfall view"), so every
  on-screen render of a waterfall view is offset before anything else runs.
- `frontend/src/lib/api/figures.ts` — the `FigureSpec` interface (`:43` on,
  the wire contract every export/reopen path serializes to) has no
  `waterfall` field anywhere; a whole-file grep finds exactly one `waterfall`
  mention (`:117`), an unrelated comment about a still-unbuilt 2-D/
  heatmap/surface figure type.
- `frontend/src/lib/figureSpec.ts` (`buildFigureSpecForView`, lines 136-395 —
  the ONE function every export path routes through, per the module's own
  header) never reads or applies `st.waterfall` anywhere in its body —
  confirmed by grep, zero `waterfall` references in the file.
- Test: `frontend/src/lib/regressionMatrix.test.ts:347`,
  `it("DIVERGENCE (BUG-013): the canvas offsets a waterfall by 0.8125; the
  export wire has no waterfall field at all", ...)` — pins BOTH measured
  values (screen `0.8125`, export `0`) and asserts they differ, plus the
  wire-level reason: `buildFigureSpecFromDocument`'s spec has no key matching
  `/water|offset|stagger/i` and `spec.dataset.values[1][1]` is the raw,
  un-offset `2.25`. (Converted 2026-09-14 from a bare `it.fails`.)
  The matrix's own `DIVERGENT.waterfall` table entry
  (`regressionMatrix.test.ts:108-110`, `legs: ["export"]`) exempts ONLY the
  export leg — reopen restores the raw `view.waterfall` fraction from the
  document and the canvas re-applies it identically, so it is specifically
  the wire spec sent to export that never carries the offset.

#### Why this priority

P2 as filed. Matches the evidence: this is substantial friction (an entire
view type exports wrong) with a workaround (manual offset, or accepting the
wrong exported figure), not data loss or a scientifically incorrect stored
value — the document and the live data are both untouched, only the exported
RENDERING is wrong.

#### Reproduction checklist

- [x] Starting state and sample data identified — the `waterfall` fixture in
  `frontend/src/lib/regressionMatrixFixtures.testkit.ts`, a `FigureDocument`
  whose `view.waterfall` is a positive fraction.
- [x] Exact actions recorded — export the document (`projectExport`) and
  compare its `waterfallOffset` to the live screen projection
  (`projectScreen`).
- [x] Actual result recorded — the screen's `waterfallOffset` is `0.8125`
  (`regressionMatrix.test.ts:221-223`); the exported `FigureSpec` carries no
  waterfall field at all, so `projectExport(...).waterfallOffset` is `0`.
- [x] Expected result recorded — the exported figure should offset each
  series by the same fraction the canvas shows.
- [x] Reproduced by an agent —
  `frontend/src/lib/regressionMatrix.test.ts`'s
  `it("DIVERGENCE (BUG-013): the canvas offsets a waterfall by 0.8125; the
  export wire has no waterfall field at all", ...)`.

#### Fix checklist

- [x] Decide where the offset should be applied for export — a THIRD shape,
  chosen over both options as filed: the wire carries `waterfall_offsets`, a
  per-plotted-series shift in Y DATA UNITS (not the raw fraction), resolved
  client-side and simply ADDED to each series by the backend. Rationale, in
  full, in `frontend/src/lib/waterfallOffset.ts`'s header: a server-side
  `fraction × y-range` cannot reproduce the canvas' number, because the range
  the canvas measures includes hidden series (filtered out of `y_keys`),
  excluded/filter-dropped rows (`applyWaterfall` runs BEFORE
  `maskExcludedPayload`, while `pruneToLiveDataset` strips them from the wire
  `dataset`) and, for a decimated fetch, extremes the wire never sees — so
  option (B)-style re-derivation would have re-opened this very divergence the
  moment a user hid a series. Pre-applying the offset to `dataset.values`
  (option A as filed) was rejected for the opposite reason: it lies on the
  wire. The chosen shape keeps `dataset` truthful and declares the offset
  beside it.
- [x] Whichever shape is chosen, use the SAME offset formula `applyWaterfall`
  uses — enforced by CONSTRUCTION, not by duplication: the span/step scan moved
  out of `applyWaterfall` into `lib/waterfallOffset.waterfallStep`, which both
  the canvas and the wire builder call. Per-series indices are the UNFILTERED
  display positions `lib/figureSpec.ts` already derives for BUG-015's colours.
- [x] Confirm reopen continues to round-trip `view.waterfall` unchanged — the
  reopen leg is untouched and `screen ≡ reopen` still passes for the fixture.
- [x] INVERT the divergence assertion in `regressionMatrix.test.ts` — now
  `it("BUG-013: the export wire carries the canvas' 0.8125 waterfall offset")`,
  a single `toBeCloseTo` equality plus the two honesty pins (the offset rides
  its own field; `spec.dataset.values[1][1]` is still the raw `2.25`).
- [x] Drop the `waterfall` fixture's export-only `DIVERGENT` narrowing — the
  table now lists `break` only.

#### Acceptance criteria

- [x] Exporting a waterfall view produces a PDF/SVG with each series
  visibly offset by the same amount the on-screen canvas shows —
  `tests/test_export_vector_structure.py`'s
  `test_waterfall_offsets_shift_each_series_by_its_own_amount` measures each
  series line's position in the RENDERED axes (hit-map pixel box converted
  back to data units) and finds the requested shift; its sibling
  `..._widen_the_autoscaled_axis_to_fit_the_stagger` proves the axis range
  grows to fit the offsets, as the canvas autoscale does.
- [x] `projectExport(document, dataset).waterfallOffset` equals
  `projectScreen(document, dataset).waterfallOffset` for the `waterfall`
  fixture — the equality BUG-013's divergence test is inverted into.
- [x] The reopen leg is unaffected —
  `projectReopen(...).waterfallOffset` continues to equal the screen's.

#### Completion record

- PR/commit: fixed 2026-09-14 on `claude/repo-evaluation-l7y7k9`, one commit
  `fix(export): BUG-013 — carry the waterfall stagger to the export wire`
  (`50b30a04`, parent `ff45a200` — corrected 2026-09-16, review NIT 7: the
  originally recorded `ebefa693` is the pre-cherry-pick commit and is not in
  this branch's history). Nine files:
  `frontend/src/lib/waterfallOffset.ts` (new — `waterfallStep` +
  `waterfallWire`), `lib/plotdata.ts` (`applyWaterfall` now calls the shared
  step; 11 lines freed, so the `architecture.test.ts` pin ratchets 658 → 650),
  `lib/figureSpec.ts` (+3 lines: the spread that emits the field),
  `lib/api/figures.ts` + `lib/figureContract.ts` (the wire field and its
  `derived("plot.waterfall.verticalOffset")` classification — the `satisfies
  FieldContractMap<FigureSpec>` guard forces every new spec field to be
  classified), `src/quantized/calc/plotting.py` (`apply_waterfall_offsets`),
  `src/quantized/routes/export_figures.py` (`FigureRequest.waterfall_offsets`,
  applied in the shared `_figure_series` — so `/figure`, `/figure-hitmap` and
  the page-panel route in `routes/export_page.py` all honour it), plus the
  regenerated `frontend/api/openapi.json` / `lib/api/schema.d.ts`.
- Automated tests: `frontend/src/lib/waterfallOffset.test.ts` (new, 9 tests —
  step math, canvas/wire agreement column by column, the four refusals, and
  the DISPLAY-position rule for a hidden series);
  `lib/figureSpec.test.ts`'s `FigureSpec waterfall_offsets (BUG-013)` block
  (7 tests, every expected number derived by RUNNING `applyWaterfall`, never
  hardcoded); `lib/regressionMatrix.test.ts`'s inverted
  `BUG-013: the export wire carries the canvas' 0.8125 waterfall offset` plus
  the now-unnarrowed `waterfall > screen ≡ export`;
  `tests/test_calc_plotting.py`'s four `apply_waterfall_offsets` tests,
  including `test_apply_waterfall_offsets_matches_the_canvas_golden` — the
  CROSS-LANGUAGE pin, whose dataset/offsets/shifted values are the same
  literals `waterfallOffset.test.ts` pins from the real canvas implementation,
  compared at 1e-12; `tests/test_export_vector_structure.py`'s four new
  route-level structural tests.
- Agent verification: sabotage table (mutation → tests that turned red):
  (1) `waterfallWire` returns `{}` unconditionally → 7 red, incl.
  `figureSpec.test.ts > … > emits the canvas' offset per plotted series`,
  `… > a HIDDEN series keeps its stagger slot`,
  `regressionMatrix.test.ts > … > waterfall > screen ≡ export` and the
  inverted BUG-013 pin, and 3 in `waterfallOffset.test.ts`;
  (2) `apply_waterfall_offsets` returns its input unchanged → 4 red
  (`test_apply_waterfall_offsets_matches_the_canvas_golden`,
  `…_degrades_on_a_short_or_bad_offset_list`,
  `test_waterfall_offsets_shift_each_series_by_its_own_amount`,
  `…_widen_the_autoscaled_axis_to_fit_the_stagger`);
  (3) the route passes `None` instead of `req.waterfall_offsets` → the two
  `test_export_vector_structure.py` waterfall tests red, proving the thin
  adapter itself is covered and not just `calc/`.
  Gate: `ruff check src tests tools` clean; `mypy src` clean (295 files);
  `pytest` — 62 passed across
  `test_export_vector_structure/test_calc_plotting/test_openapi_snapshot/test_repo_integrity`,
  324 passed + 1 skipped across
  `test_api_export/test_api_export_page/test_calc_figure/test_calc_figure_page`;
  `tsc -b --force` and `eslint src --max-warnings=0` clean;
  `vitest run src/lib src/architecture.test.ts` — 5221 passed, 0 failed;
  `node scripts/freeze-regression-matrix.mjs --check` clean and no committed
  golden changed (they are the SCREEN projection, which this fix does not
  touch). Eager bundle measured on a `npm ci`-fresh build of each tree, on the
  BRANCH (corrected 2026-09-16, review NIT 7 — the figures first recorded here
  were measured against `ebefa693`, an ancestor this branch does not contain):
  **919,693 B** at `ff45a200` → **919,877 B** at `50b30a04`, a **+184 B**
  delta, 523 B inside the then-current 920,400 B budget. No budget move.
- Owner verification: pending.
- Notes: two DOCUMENTED residuals, both inherited rather than introduced. A
  `group_col` request omits the field (the backend synthesizes one series per
  level, which does not align 1:1 with `y_keys` — the same reason
  `series_styles` is documented as unapplied there; see BUG-016), and a
  `facets` request omits it (that branch renders from its own resolved panel
  payloads, per `FigureRequest.facets`' own contract). Omitting is the honest
  response: the renderer never receives an offset it would mis-apply. Both
  combinations already export unstyled today. Also: the matrix's screen leg
  measures the offset of the second DISPLAYED series while the export leg
  reads the second PLOTTED one; the two index spaces coincide for every
  fixture (none both hides a series and sets a waterfall), and the export leg
  says so in place.

#### Review round — 2026-09-16 (`fix(export): BUG-013 review round …`)

An adversarial review of `50b30a04` returned **2 CONFIRMED, 1 CONFIRMED-narrow
and 5 NITs**. All eight are addressed here; three of them changed behaviour.

- **CONFIRMED 1 — offsets were emitted for `stackMode`/`polarMode`/`statMode`,
  where the canvas staggers nothing.** A regression this fix introduced, not an
  inherited residual: `PlotStage` early-returns to `MultiPanelStage`/
  `PolarStage`/`StatStage` before the XY overlay exists, and
  `useMultiPanelStage` never calls `composeDisplayPayload` at all, so a user who
  left the waterfall slider up and switched to stacked panels got an export
  staggered in a way the screen never was. Reproduced on BOTH entry points
  (`stackMode` is a canonical binding, so it round-trips through a document):
  offsets `[0, 74.75, 149.5]` for all three modes from `buildFigureSpec`, and
  the same list from `buildFigureSpecFromDocument`. `waterfallWire` now asks the
  predicate the canvases ask — `seriesStyleCycle.overlayModesMatchTheCanvas`,
  the view-mode half of `overlayExportsSeriesStyles`, split out so each clause
  still has exactly one definition. It subsumes the old hand-rolled `groupKey`/
  `facets` refusals.
  **Deliberate narrowing, against the review's suggested one-liner:** the
  waterfall asks the MODE half only, not `displayListsAgree`. That clause exists
  because the dash/marker/colour CYCLE is keyed by positions the two sides derive
  independently; the waterfall's positions are the ones BUG-014 already resolves
  against the canvas' own channel list, so folding it in would have exported the
  two real series of an X-as-Y view OVERLAID — re-opening this very bug for a
  view whose stagger is otherwise reproduced exactly. See finding 3.
- **CONFIRMED 2 — the step was resolved from the full dataset; the canvas
  resolves it from the fetched payload.** Fixed by the review's option (a), the
  "by construction" one, because the plumbing turned out to be cheap:
  `usePlotPayload` ALREADY returns the raw pre-compose `payload`
  (`PlotPayloadResult.payload`), so the focused Stage's own publish effect
  (`Stage/useLiveSnapshotPublish`, which already no-ops in the alternate render
  modes and clears on unmount) now also publishes that payload's y-span through a
  module-scope seam in `lib/waterfallOffset.ts` — the same imperative-ref shape
  `lib/plotsnapshot.ts` uses for the display bundle, keyed by dataset id so
  `exportActive`'s documented refocus race cannot stagger one dataset by
  another's span. `buildStageFigureSpec` reads it at command time and threads it
  through both branches. The SPAN travels rather than the step, so a request
  whose `waterfall` fraction differs from the live view's still scales the
  canvas' measured range correctly.
  Measured, driving the real hook with `fetchPlot` mocked at the network
  boundary (20 000 rows, excursion in rows `[0,100)`, `xLim [5000,6000]`,
  `waterfall 0.25`): screen shift **0.25**, export offset **0.25** on BOTH the
  live-view fallback and the canonical-document path. Before: 0.25 vs 495.25.
  **Option (b) — filtering the wire's rows to `st.xLim` — was NOT shipped, on
  either path, because it would create two NEW divergences.** The canvas windows
  its payload only when `shouldRefetchWindow(xLim, baseDecimated)` holds
  (`lib/plotDecimate.ts:383`), i.e. only for a SERVER-DECIMATED base: (i) a
  dataset under `DECIMATE_MIN_POINTS` with axis limits set keeps drawing from the
  full payload, so a windowed wire would disagree with it; and (ii)
  `components/windows/BackgroundPlotWindow.tsx:164-188` does not pass `xLim` to
  `usePlotPayload` at ALL, so a background window — and the Figure Builder
  window-target preview built from its document — never windows, and a windowed
  wire would disagree there too. `components/windows/PanelCell.tsx` likewise
  passes no `xLim`. Option (a) has no such blind spot: every canvas that exists
  publishes the span it actually measured.
  The commit-body rationale that cited **decimation** as a reason to resolve
  client-side was inverted and has been corrected in
  `lib/waterfallOffset.ts`'s header: min/max bucket decimation PRESERVES each
  series' extremes by construction (`calc/decimate.py`), so that case was never a
  divergence; the windowed re-fetch is what trims, and it is what the seam fixes.
- **Finding 3 (narrow) — the `allowExplicitXAsY` one-slot shift: CLOSED by
  BUG-014, verified by probe, now pinned.** Probed against this branch's tip
  (`7dfcde07`) with `xKey:0, yKeys:[0,1,2], waterfall:0.25`: the canvas draws
  channels `[1,2]` at offsets `[0, 74.75]`, and the wire emits
  `[149.5, 0, 74.75]` for `y_keys [0,1,2]` — every channel the canvas draws now
  lands on the canvas' own offset, and only the extra X-as-Y curve (which the
  canvas never draws) sits on the parked slot past the end. `resolveDisplaySeries`
  resolving positions against the CANVAS list is what closed it. A new test pins
  the offset and the palette colour TOGETHER, since they are the same position
  and pinning one alone would let them drift apart again.
- **NIT 4 — module ceilings.** Both files named were at or one line under their
  limit. `lib/figureSpec.ts` **498 → 486** (architecture-test metric,
  `split("\n").length`, ceiling 500): the P3.3 cycle derivation and its rationale
  moved to `lib/figureSpecSeries.resolveSeriesCycle`, which now returns the
  `CycleView` the waterfall wire reuses — one object, asked twice.
  `routes/export_figures.py` **494 → 485** (`splitlines()`, ceiling 500): the two
  new field-doc strings live in `routes/export_figures_schema.py`, the sibling
  that exists for exactly this reason. Both are ≥ 14 lines under.
- **NIT 5 — the NaN guard.** `applyWaterfall` used `fraction <= 0` and
  `waterfallWire` used `!(fraction > 0)`, so a hand-built view with a NaN
  fraction made the canvas NaN every value column while the wire quietly omitted
  the field. Both now call `waterfallOffset.waterfallApplies`.
- **NIT 6 — the wire field's doc reached no generated artefact.**
  `waterfall_offsets` and `series_styles` are now documented with
  `Field(description=…)`, so `frontend/api/openapi.json` and `lib/api/schema.d.ts`
  carry the contract. `series_styles` mattered most: it is a loose
  `dict[str, Any]` whose keys — BUG-014's `legend` among them — can be described
  nowhere else. Regenerated with `tools/dump_openapi.py` + `npm run api:types`.
- **NIT 7 — the completion record's coordinates.** Corrected above: parent
  `ff45a200` (not the pre-cherry-pick `ebefa693`), and the bundle figures
  re-stated as measured on this branch.
- **NIT 8 — the commit trailer.** Unchanged: it is this session's prescribed
  attribution line, not an ad-hoc choice. Flagged for the owner rather than
  silently rewritten.

Sabotage table (mutation → tests that turned red):

| # | Mutation | Red |
|---|---|---|
| 1 | `waterfallWire` drops the mode predicate (keeps only `groupKey`) | 6 — `waterfallOffset.test.ts` "emits nothing for a grouped or faceted request" + "…for a stacked, polar or statistics view"; `figureSpec.test.ts` "is ABSENT for a faceted request" + the three "is ABSENT for a `<mode>` view" |
| 2 | `waterfallWire` ignores the published span | 3 — `waterfallOffset.test.ts` "uses the published span instead of re-measuring the DataStruct"; both `waterfallExportSpan.test.ts` parity cases |
| 3 | the publish effect measures `displayPayload` (post-waterfall) instead of `payload` | 3 — `useLiveSnapshotPublish.test.ts` "is measured BEFORE the waterfall is applied"; both parity cases |
| 4 | `waterfallApplies` becomes `!(fraction <= 0)` (NaN passes) | 2 — `waterfallOffset.test.ts` "refuses zero, negative and NaN fractions" + "so a NaN fraction leaves the canvas payload untouched AND the wire empty" |
| 5 | `readLiveWaterfallSpan` drops the dataset-id guard | 2 — `waterfallOffset.test.ts` "the seam hands back a span only for the dataset it was measured from"; `useLiveSnapshotPublish.test.ts` "is refused for a DIFFERENT dataset" |
| 6 | `resolveDisplaySeries` positions against the REQUEST's list, not the canvas' | 2 — `figureSpec.test.ts` "the X-as-Y branch staggers AND colours the canvas' channels by the CANVAS' slots" + the existing P3.3 colour sibling |
| 7 | `waterfall_offsets` loses its `Field(description=…)` | 1 — `tests/test_openapi_snapshot.py::test_committed_openapi_json_matches_live_schema` |

Gate (all foreground): `ruff check src tests tools` clean; `mypy src` clean
(296 files); `pytest -q` over
`test_openapi_snapshot/test_repo_integrity/test_export_vector_structure/test_calc_plotting/test_api_export`
— **188 passed, 1 skipped**; `tsc -b --force` and `eslint src --max-warnings=0`
clean; `vitest run src/lib src/components/Stage src/store src/architecture.test.ts`
— **7755 passed, 1 failed**, the single failure being
`store/plotRecipes.test.ts > keeps Stage, Figure Builder, reopen, export, and
clipboard on one canonical spec`, a BUG-014 leftover pre-existing on this
commit's parent and already fixed later on the branch by `950b3a9b`;
`freeze-regression-matrix.mjs --check` clean, no committed golden changed;
`check-bundle-size.mjs` OK. Eager bundle, both trees built after `npm ci`:
**910,528 B** at `7dfcde07` → **911,045 B** here, **+517 B**, 9,355 B inside the
920,400 B budget. No budget move.

---

## ~~BUG-014 — a renamed legend loses its unit on screen but keeps it on export~~ **FIXED 2026-09-15**

**Priority:** P3 — cosmetic only: the figure and its data are correct on
both legs, the legend wording simply disagrees between screen and export.

**Reported:** 2026-09-14, by the P4.2 canonical regression matrix
(`1593cdee`, `frontend/src/lib/regressionMatrix.test.ts`) — a design-time
finding from the matrix's structural comparison, not yet surfaced by a user
report.

**Investigated:** root cause confirmed by reading both the frontend label
builder and the backend's label formatting, not inferred — see Confirmed
implementation evidence below.

**Suggested implementation owner/model:** Claude (agent) — fixed 2026-09-15.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P4.2 ("Canonical
plot/project regression matrix"), divergence D3.

#### User-visible problem

A user renames a series' legend label — for example to "Loop 1" — on a
channel whose unit is "au". On screen, the legend shows exactly "Loop 1" and
nothing else: a rename fully replaces the displayed label, unit included.
Exporting the same figure shows "Loop 1 (au)" instead — the backend
re-appends the channel's unit to the rename, producing a label the user
never asked for and does not see on screen.

#### Confirmed implementation evidence

(As FILED, 2026-09-14, before the fix. The line numbers and the three code
shapes named below — `seriesLabels?.[i] ?? …`, the `dataset.labels[ch]`
rewrite, and the unconditional `f"{s.label} ({s.unit})"` — describe the code
the bug was found in; the Completion record names what replaced them. Kept
verbatim as the record of the finding.)

- `frontend/src/lib/uplotOpts.ts:694` (`seriesLabels?: (string |
  undefined)[]` on the opts builder's args) and `:907` — the on-screen
  legend label is built as `args.seriesLabels?.[i] ?? (s.unit ? `${s.label}
  (${s.unit})` : s.label)`. An explicit rename supplies a value at
  `seriesLabels[i]`, which REPLACES the whole label — unit included — via the
  `??` short-circuit; there is no code path that re-appends a unit onto a
  rename.
- `frontend/src/lib/figureSpec.ts:200-204` — the wire `dataset` sent to
  export only rewrites `data.labels[ch]` to the raw rename text
  (`st.seriesLabels[ch] ?? label`): this changes the CHANNEL LABEL the
  backend receives, not a fully-resolved legend string with a unit already
  decided.
- `src/quantized/routes/export_figures.py:234` and `:267` (inside
  `_figure_series`, part of `_resolve_figure`'s codepath) — every exported
  series name is unconditionally built as `f"{s.label} ({s.unit})" if
  s.unit else s.label`: the backend always re-appends the channel's OWN unit
  to whatever label string it receives, with no way to mark a label as
  "already complete, do not append a unit."
- Net effect: a rename lands on `dataset.labels[ch]` (becomes `s.label`
  server-side) and is then unit-appended a SECOND time by the backend,
  producing "Loop 1 (au)", while the screen shows exactly "Loop 1".
- Test: `frontend/src/lib/regressionMatrix.test.ts:368`,
  `it('DIVERGENCE (BUG-014): a renamed series reads "Loop 1" on screen and
  "Loop 1 (au)" in the export', ...)` — builds a document with
  `view.seriesLabels: { 0: "Loop 1" }` on a channel with unit "au"
  (`renamedFigure()`, `regressionMatrix.test.ts:447`) and pins BOTH measured
  strings (screen "Loop 1", export "Loop 1 (au)") plus the wire bytes behind
  them (`spec.dataset.labels[0] === "Loop 1"` AND `spec.dataset.units[0] ===
  "au"` — the two the backend re-joins), then asserts they differ.
  (Converted 2026-09-14 from a bare `it.fails`.)

#### Why this priority

P3 as filed. The evidence supports keeping it there: the plot itself is
correct on both legs (same data, same series, same colours), only the legend
STRING differs — a wording/polish mismatch, not a data or scientific
correctness issue, and not something that could plausibly be mistaken for a
different measurement.

#### Reproduction checklist

- [x] Starting state and sample data identified — a `FigureDocument` with
  `view.seriesLabels: { 0: "Loop 1" }` on a channel whose unit is "au",
  built by `renamedFigure()` (`regressionMatrix.test.ts:447-463`).
- [x] Exact actions recorded — rename series 0's legend label, then compare
  `projectScreen(...).series[0].label` to `projectExport(...).series[0]
  .label`.
- [x] Actual result recorded — screen: "Loop 1"; export: "Loop 1 (au)".
- [x] Expected result recorded — the exported legend label should match the
  renamed on-screen label exactly.
- [x] Reproduced by an agent —
  `frontend/src/lib/regressionMatrix.test.ts`'s
  `it('DIVERGENCE (BUG-014): a renamed series reads "Loop 1" on screen and
  "Loop 1 (au)" in the export', ...)`.

#### Fix checklist

- [x] Decide the contract: **the backend learns to distinguish "raw channel
  label, append the unit" from "user-supplied legend text, use verbatim."**
  The frontend does NOT send a fully-resolved string in `dataset.labels`: a
  rename is a presentation choice, not a data edit, so the wire `dataset`
  now carries the DATA's own labels and units (any data-table/CSV consumer
  of the same spec still sees the real column names) and the rename rides
  its own optional field, `series_styles[i].legend` — the EXISTING per-series
  presentation object, aligned 1:1 with `y_keys` exactly as
  `color`/`width`/`line`/`marker` already are. Additive and optional: a
  request with no rename is byte-identical to before.
- [x] Whichever shape is chosen, thread a rename through distinctly from an
  un-renamed channel label so the unit-appending format applies only to the
  latter. The composition moved into the pure layer as
  `calc.figure_labels.series_display_name(label, unit, legend)` — legend
  verbatim when present, `"label (unit)"` otherwise — and
  `routes/export_figures_labels.py` (a new route-layer sibling) reads the
  loose `legend` key off the wire and applies it to the series names AND to
  the auto-derived solo-axis titles, which `uplotOpts`' `soloLabel` also
  reads off the resolved legend.
- [x] Confirm an UN-renamed series (no `seriesLabels` entry) still gets its
  unit appended on export exactly as today — the common case must not
  regress. `tests/test_export_vector_structure.py`'s
  `test_an_unrenamed_series_still_gets_its_unit_appended` renders the real
  SVG and reads the legend group's `<text>` entries.
- [x] INVERT the divergence assertion in `regressionMatrix.test.ts` — the
  export-side "Loop 1 (au)" pin and the `.not.toBe` are gone, replaced by the
  screen-equals-export equality, and the test is renamed to drop the
  `DIVERGENCE` prefix. It is kept non-vacuous by pinning the wire's own bytes
  (`dataset.labels[0] === "Signal"`, `units[0] === "au"`,
  `series_styles[0].legend === "Loop 1"`) and asserting the screen's text
  differs from the `"label (unit)"` the backend would otherwise compose from
  them.

#### Acceptance criteria

- [x] A series renamed on screen exports with the identical legend text, no
  unit re-appended — measured in the rendered SVG, not only on the wire
  (`test_a_renamed_series_renders_its_legend_text_exactly`: the legend group
  reads `["Loop 1", "Series B (au)", "Series C (au)"]`). True on EVERY branch
  as of the review round: the flat/solo/y2 paths since 2026-09-15, the FACET
  panels since 2026-09-16 (they shipped `"Loop 1 (au)"` until then — see the
  review round below), the `group_col` branch by the documented substitution
  (the rename replaces the channel-label half of the per-level template).
  ONE residual, pinned rather than fixed: an EMPTY rename — see the review
  round's finding 4.
- [x] An un-renamed series continues to export with its unit appended
  exactly as before (no regression).
- [x] `projectExport(renamed, dataset).series[0].label` equals
  `projectScreen(renamed, dataset).series[0].label` — the equality
  BUG-014's divergence test is inverted into. The FACET leg of the same
  equality (`projectExport(...).facet` vs `projectScreen(...).facet`) is
  pinned alongside it as of the review round.

#### Completion record

- PR/commit: `fix(export): BUG-014 …` on `claude/repo-evaluation-l7y7k9`
  (parent `50b30a04`). The wire gains ONE optional field,
  `series_styles[i].legend`; `FigureRequest.series_styles` is a list of loose
  dicts by design ("a bad/unrecognized value in ANY of these keys degrades
  gracefully"), so `frontend/api/openapi.json` and
  `frontend/src/lib/api/schema.d.ts` are BYTE-IDENTICAL after regenerating
  them (`uv run python tools/dump_openapi.py`, `npm run api:types`) — the
  schema never enumerated those keys. No persisted contract changed either:
  a rename still lives in `view.seriesLabels`, `sanitizeExportSeriesStyles`
  deliberately does NOT restore a `legend` from a saved
  `publication.seriesStyles`, and no document version moved.
- Module-ceiling work this required: `frontend/src/lib/figureSpec.ts` was at
  499 of 500 lines, so the per-series half was extracted to
  `frontend/src/lib/figureSpecSeries.ts` (display/plotted/position
  resolution, the legend overlay, the `series_styles` assembly and
  `exportErrorSpans`) with its own `figureSpecSeries.test.ts`;
  `src/quantized/routes/export_figures.py` was at 499, so label resolution
  moved to `routes/export_figures_labels.py` and `_tick_fmt` moved beside
  its own `TickFormatSpec` in `routes/export_figures_schema.py`. No pin was
  raised and no comment shaved.
- Known limit: the `group_col` branch expands each channel into one series
  PER LEVEL, so a rename cannot name a finished series there. It replaces the
  channel-label half of `build_grouped_series`' `"{label} ({group}={level})"`
  template instead (new optional `y_legends` argument), which reproduces the
  pre-fix wire byte-for-byte — grouped export parity as a whole stays
  BUG-016. Facet panels ship FINISHED series strings that no per-series field
  on the request can reach, so their labels are resolved client-side —
  **originally from a request-local relabelled copy of the DataStruct, which
  re-created this very bug inside the facet branch** (`"Loop 1 (au)"`) and
  was corrected in the review round below.
- Automated tests: `tests/test_export_vector_structure.py` — five new
  structural tests reading the rendered SVG's legend group (rename verbatim;
  un-renamed unchanged; a renamed SOLO series' auto-derived axis title;
  a non-string `legend` degrading instead of 422ing; the grouped branch).
  `frontend/src/lib/figureSpecSeries.test.ts` — new file, 15 tests.
  `frontend/src/lib/figureSpec.test.ts` — the rename/blank-rename wire tests,
  the updated byte/deep-equal wire shape, and the publication-styles branches.
  `frontend/src/lib/regressionMatrix.test.ts` — the inverted BUG-014 test.
  `frontend/src/lib/exportParity.test.ts` and `exportFigureCommand.test.ts` —
  the two pre-existing "rename rewrites `dataset.labels`" pins, rewritten to
  the honest wire.
- Agent verification: sabotage table (each reverted in turn, then restored) —
  (a) `withSeriesLegends` returning `styles` unchanged → 11 failures across
  `figureSpecSeries.test.ts`, `figureSpec.test.ts`, `regressionMatrix.test.ts`,
  `exportParity.test.ts` and `exportFigureCommand.test.ts`; (b)
  `series_display_name` ignoring its `legend` argument → 2 backend failures
  (`test_a_renamed_series_renders_its_legend_text_exactly`,
  `test_a_renamed_solo_series_titles_its_axis_with_the_same_text`);
  (c) the grouped branch ignoring `y_legends` → 1 backend failure
  (`test_a_grouped_export_folds_the_rename_into_its_per_level_labels`);
  (d) `solo_axis_label` recomposing from the channel instead of the resolved
  name → 1 backend failure (the solo-axis test).
  Gate: `uv run ruff check src tests tools`; `uv run mypy src` (296 files);
  `uv run pytest -q tests/test_openapi_snapshot.py tests/test_repo_integrity.py
  tests/test_export_vector_structure.py tests/test_api_export.py
  tests/test_calc_figure.py`; `npx tsc -b --force`;
  `npx eslint src --max-warnings=0`;
  `npx vitest run src/lib src/architecture.test.ts`;
  `node scripts/freeze-regression-matrix.mjs --check` clean (the canonical
  payload is unchanged — the goldens are SCREEN projections and no fixture is
  renamed); `node scripts/check-bundle-size.mjs` green.
- Bundle (measured): parent `50b30a04` **919,877 B** eager -> **919,877 B**,
  a **+0 B** delta — the per-file eager byte list is identical entry for
  entry. The split did NOT grow the eager graph: `lib/figureSpecSeries.ts`
  lands in the same lazy `figureSpec` chunk its caller does (that chunk grew
  6.64 kB -> 7.34 kB). Both builds were run after `npm ci`, with vite's
  transform cache cleared, and `node scripts/check-bundle-size.mjs` reports
  898.3 kB eager of the 898.8 kB budget, unmoved.
  **Those two numbers are the ORIGINAL commit's pair (`bdf3b32a` on top of
  `50b30a04`).** What landed on `claude/repo-evaluation-l7y7k9` is a
  cherry-pick, `7dfcde07`, whose real parent is `3804e643`; re-measuring
  `3804e643..7dfcde07` will not reproduce them, and nothing was re-measured
  for the cherry-pick. The +0 B claim itself still holds structurally (no
  eager module gains an import, `figureSpecSeries.ts` is reached only from
  the already-lazy `figureSpec.ts`, and no ratchet pin moved).
- Owner verification: pending — rename a series' legend on screen, export the
  figure, and confirm the PDF's legend reads exactly what the on-screen
  legend reads. Worth doing on a FACETED view too (the review round's
  finding 2).
- Notes: —

#### Adversarial review round (2026-09-16)

An adversarial review of `7dfcde07` returned 2 CONFIRMED + 6 NITs; the
root-cause fix itself was measured correct on fourteen view configurations
and nothing was reverted. Closed by
`fix(export): close the BUG-014 review — facet panels honour a legend rename
verbatim on screen and export`, on top of `da00c042`:

- **Finding 1 (CONFIRMED) — the recorded frontend gate could not see the
  suite it broke.** The gate line above reads `npx vitest run src/lib
  src/architecture.test.ts`; that glob excludes `src/store` **structurally**,
  and `frontend/src/store/plotRecipes.test.ts` was RED at `7dfcde07`
  (`expected [ '2theta', 'Intensity', 'Ierr' ] to include 'Corrected
  intensity'` at `:996` — the spec still asserted the pre-fix wire, where a
  rename rewrote `dataset.labels`). So a green scoped gate was recorded on a
  tree whose `npm test` was red. It was repaired two commits later by
  `950b3a9b`, which re-points that spec at the honest wire and is strictly
  stronger (it pins the positive, the negative, and the whole style object
  including `legend`). Standing correction, now in `agent_rules.md`: any
  change to the export WIRE must include `src/store` in the vitest scope.
- **Finding 2 (CONFIRMED) — the FACET branch still exported the bug's exact
  string; fixed.** With `facetKey` bound and `seriesLabels: {1: "Loop 1"}` on
  a unit-`au` channel, facet EXPORT panels read `Loop 1 (au)` (the panel label
  was composed as `${relabelled} (${unit})` from a request-local relabelled
  DataStruct) while facet SCREEN panels read `Signal (au)` (the grid's
  `buildOpts` call passed no `seriesLabels` at all) — three different strings
  for one series. Pre-existing, not a regression, but the acceptance criteria
  above were ticked without a carve-out and nothing tested it. Both legs now
  apply ONE rule, `lib/figureSpecSeries.ts`'s new `seriesDisplayLabel(label,
  unit, legend)` (rename verbatim, else `"label (unit)"` — the same rule
  `uplotOpts.buildOpts` and `calc.figure_labels.series_display_name` apply):
  `lib/figureSpecFacets.ts` takes the channel-keyed renames and composes with
  it, the relabelled `facetData` copy in `lib/figureSpec.ts` is deleted, and
  `Stage/useMultiPanelStage.ts` passes the store's `seriesLabels` into the
  facet grid. `lib/facet.ts`'s `FacetPanel` now carries `channels` (the
  dataset channel behind each payload series) because the default
  (`yKeys === null`) channel list is resolved per row-slice and can differ
  panel to panel, so neither consumer can reconstruct it from the binding.
  Tests at both layers: `lib/figureSpecFacets.test.ts` (new file, 8 tests) and
  `Stage/MultiPanelStage.test.tsx`'s "a legend rename reaches every facet
  panel's legend, verbatim" (which reads the label real `buildOpts` put on the
  real uPlot options), plus a facet row in `regressionMatrix.test.ts`'s
  BUG-014 test asserting the two legs' facet projections are EQUAL.
- **Finding 3 (NIT) — `lib/spatialPageExport.ts` shipped decoded Origin
  captions as `dataset.labels`; fixed the same way.** Measured on the wire
  the builder produced: `_figure_series` resolved
  `['Decoded caption (au)', '_nolegend_ (au)']` before and
  `['Decoded caption', '_nolegend_']` after. **The `(au)` suffix disappearing
  IS the BUG-014 rule applied consistently** — a decoded caption is
  presentation, so the unit is not re-appended to it. The `_nolegend_`
  sentinel still suppresses by its leading `_` either way, and the wire
  `dataset` now keeps the workbook's own column names (which is what that
  function's `fallbackYLabel` already read).
- **Finding 4 (NIT) — RESIDUAL, pinned not fixed: an EMPTY rename.** `""` is
  honoured verbatim on the wire and by `series_display_name`, but matplotlib
  drops a zero-length label from the legend exactly as it drops a leading-`_`
  one, so the series loses its legend ROW on export while uPlot still draws a
  blank row with its swatch on screen. "Identical text on both legs"
  therefore degenerates to "blank row vs no row" for `""` alone. Pinned by
  `test_an_empty_rename_drops_the_series_from_the_rendered_legend`
  (measured: `['Series B (au)', 'Series C (au)']`). Deliberately NOT papered
  over with a `" "`: which leg should move is the owner's call, and a space
  would silently change what the user typed. (The pre-fix wire rendered
  `" (au)"` here, so this is a change from one divergence to another.)
- **Finding 5 (NIT) — stale `FigureRequest` field docs.** The
  `series_styles` description already gained `legend` in `da00c042`
  (BUG-013's own review round moved it to `export_figures_schema.py` as a
  `Field(description=...)`). Left to fix and fixed here: `group_col`'s
  comment claiming "`series_styles` is not applied in this path either" (its
  STYLE keys are not; its `legend` key IS), the same claim echoed inside
  `WATERFALL_OFFSETS_DOC`, and `FigureFacet`'s docstring, which pointed at
  `lib/figureSpec.ts` for a builder that now lives in `figureSpecFacets.ts`
  and said nothing about a panel label being FINISHED text. Comment/
  description-only; `frontend/api/openapi.json` and
  `frontend/src/lib/api/schema.d.ts` regenerated and committed (the two
  `Field(description=...)` strings do reach the generated artefacts).
- **Finding 6 (NIT) — a fixture assertion posing as a product one.**
  `test_a_renamed_series_renders_its_legend_text_exactly`'s last line rebuilt
  `_renamed_payload(...)` and asserted a property of the fixture helper. It
  now hoists the payload it actually POSTs, asserts the label AND unit on
  that object before the request, and adds `"Series A" not in svg` — so the
  test can only pass if the rename reached the renderer through the
  presentation field.
- **Finding 7 (NIT) — an untested behavioural claim, now pinned.**
  "`sanitizeExportSeriesStyles` deliberately does not restore a `legend`"
  appears in the code comment, the commit body and this entry, but the
  allowlist dropped it only incidentally. `publicationStyles.test.ts` now
  pins both halves (a legend beside a valid key is stripped; an entry whose
  only key is a legend becomes `null`).
- **Finding 8 (NIT) — record hygiene.** The bundle pair's parent is corrected
  above, and the duplicated empty `Agent verification` / `Owner verification`
  / `Notes` template rows are removed.
- Module ceilings this round: `Stage/useMultiPanelStage.ts` sat exactly on its
  791-line pin, so the facet render leg was extracted to the new
  `Stage/facetGridRender.ts` (`renderFacetGrid` + `resizeFacetGrid`); the pin
  ratchets DOWN to 787. `lib/figureSpec.ts` 483, `lib/figureSpecFacets.ts`
  104, `lib/figureSpecSeries.ts` 280, `lib/spatialPageExport.ts` 287,
  `routes/export_figures.py` 491, `routes/export_figures_schema.py` 126 —
  all under 500, none pinned, no pin raised.
- Agent verification (review round): sabotage table, each reverted with
  `git checkout --` and the worktree verified clean afterwards —

  | sabotage | failing tests |
  |---|---|
  | `figureSpecFacets.ts` composes ``` `${label} (${unit})` ``` again instead of `seriesDisplayLabel` | 5 — `figureSpecFacets.test.ts` ×4, `regressionMatrix.test.ts`'s BUG-014 facet row |
  | `facetGridRender.ts` passes `seriesLabels: undefined` to `buildOpts` | 1 — `MultiPanelStage.test.tsx` "a legend rename reaches every facet panel's legend, verbatim" |
  | `facet.ts` returns an EMPTY `FacetPanel.channels` | 11 — `figureSpecFacets.test.ts` ×6, `regressionMatrix.test.ts` ×3 (incl. the committed `facet` golden), `MultiPanelStage.test.tsx` ×2 |
  | `spatialPageExport.ts` builds no `legends` at all | 1 — `spatialPageExport.test.ts` "carries decoded partial legend entries as presentation…" |
  | `publicationStyles.ts` restores a string `legend` | 1 — `publicationStyles.test.ts` "deliberately does NOT restore a legend…" |
  | `series_display_name` uses `if legend:` (drops `""`) | 1 — `test_an_empty_rename_drops_the_series_from_the_rendered_legend` |
  | `series_display_name` ignores `legend` entirely | 3 — the renamed, renamed-solo-axis and empty-rename tests |

  Gate: `uv run ruff check src tests tools` (All checks passed);
  `uv run mypy src` (296 files, no issues);
  `uv run pytest -q` over `test_export_vector_structure.py`,
  `test_api_export*.py`, `test_api_report_export.py`,
  `test_io_report_export.py`, `test_repo_integrity.py`,
  `test_openapi_snapshot.py`, `test_calc_figure.py` → **298 passed, 1
  skipped**; `npx tsc -b --force` (exit 0);
  `npx eslint src --max-warnings=0` (exit 0);
  `npx vitest run src/lib src/store src/components/Stage
  src/architecture.test.ts` → **406 files, 7779 tests, 0 failed** (the
  `src/store` scope finding 1 says was missing, included deliberately);
  `node scripts/freeze-regression-matrix.mjs --check` → 1 test passed (the
  `facet` golden is unchanged — no fixture carries a rename).
- Bundle (measured, review round): parent `da00c042` **911,488 B** eager ->
  this commit **911,526 B**, **+38 B** (one new eagerly-reachable module
  boundary, `Stage/facetGridRender.ts`, split out of a file that was already
  eager; no new module enters the eager graph). `node
  scripts/check-bundle-size.mjs` reports 890.2 kB of the 898.8 kB budget, up
  from 890.1 kB — 8.7 kB of headroom, budget unmoved. Both builds ran in the
  same worktree with `node_modules/.vite` cleared, against a `node_modules`
  installed by `npm ci` from the same (unchanged) lockfile.

---

## ~~BUG-015 — hiding a series shifts later series' export palette colour, not the canvas'~~ **FIXED 2026-09-14**

**Priority:** P2 — a visible, wrong-looking export (recoloured series) with a
workaround (temporarily un-hide, export, re-hide, or manually recolour after
export), no data loss. Matches the same class of bug `SeriesCycle` was
already built to fix for the live Stage export — this is that fix not
reaching a saved document's export path.

**Scope correction (2026-09-15, review NIT 4):** "a saved document's export
path" UNDER-STATES it. `store/prefs.ts:105` defaults `autoSeriesStyles` to
`false`, and the positional correction was gated on that preference, so the
LIVE Stage export (Copy figure / Copy figure (vector) / Export figure…) was
equally broken for every user who never turned it on — which is the default.
Measured on the fix commit's own parent: Stage export, `hiddenChannels: [1]`,
cycle OFF → parent `#8fe08f`, fixed `#d9a3ff` (the screen's slot). The fix
covers that path too, at the same chokepoint and by the same mechanism (it
derives `positions` in `buildFigureSpecForView`, which BOTH entry points route
through), so no separate change was needed for it.

**Reported:** 2026-09-14, by the P4.2 canonical regression matrix
(`1593cdee`, `frontend/src/lib/regressionMatrix.test.ts`) — a design-time
finding from the matrix's structural comparison, not yet surfaced by a user
report.

**Investigated:** root cause confirmed by reading the canvas display-list
builder, the export channel filter, and `buildExportStyles`, not inferred —
see Confirmed implementation evidence below.

**Suggested implementation owner/model:** Claude (agent) — fixed 2026-09-14.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P4.2 ("Canonical
plot/project regression matrix"), divergence D4.

#### User-visible problem

A user hides the first of two plotted series (via the legend). On screen,
the second series keeps its ORIGINAL palette colour — hiding a series never
reflows the colours of the series still visible. Exporting the same figure
(PDF/SVG) recolours the second series as if it were now first in line: the
exported colour does not match what the user sees on screen. This is true of
BOTH export paths — a saved document's, and the live Stage export with the
`autoSeriesStyles` preference off, i.e. its default (see the scope
correction above).

#### Confirmed implementation evidence

(As FILED, 2026-09-14, before the fix. Line numbers and the two code shapes
called out below — `pos = cycle?.[i] ?? i` and the conditional `seriesCycle` —
describe the code the bug was found in; the Completion record names what
replaced them. Kept verbatim as the record of the finding.)

- `frontend/src/lib/uplotOpts.ts:1309` (`const show = !args.hidden?.[i];`)
  and the surrounding series builder (e.g. `:1329`) — a hidden series stays
  IN the canvas' display list at its ORIGINAL index with `show: false`;
  every later series' colour call (`seriesColor(i, style)`) still uses the
  untouched, original index `i`, so hiding never shifts anyone's colour on
  screen.
- `frontend/src/lib/figureSpec.ts:195` (`const plotted =
  displayChannels.filter((ch) => !st.hiddenChannels.includes(ch));`) — the
  export wire's channel list DROPS hidden channels entirely, so the second
  series shifts to index 0 in the filtered list sent to export.
- `frontend/src/lib/exportStyles.ts:25-40` (`buildExportStyles`) — colours
  each entry by `pos = cycle?.[i] ?? i` (`:40`), where `i` is the index into
  the ALREADY-FILTERED `plotted` array; with `cycle: null` (the common case
  for a saved document — see below), `pos` is simply the filtered position,
  so the remaining series is coloured as though it were first.
- `frontend/src/lib/figureSpec.ts:382` (`buildFigureSpecFromDocument`) never
  sets `extras.autoSeriesStyles`, so `buildFigureSpecForView`'s
  `seriesCycle` (`figureSpec.ts:253-262`, gated on `extras.autoSeriesStyles`)
  is `null` for every saved-document export — the positional correction
  `SeriesCycle` provides is opt-in only for the LIVE Stage export
  (`buildStageFigureSpec`) per `figureSpec.ts:226-249`'s own doc and
  `exportStyles.ts:31-38`'s comment, and never reaches a saved document's
  export path.
- Test: `frontend/src/lib/regressionMatrix.test.ts:390`,
  `it("DIVERGENCE (BUG-015): hiding a series leaves the next one on palette
  slot 1 on screen and slot 0 on export", ...)` — builds a document with
  `yKeys: [0, 1]`, `hiddenChannels: [0]` (`hiddenFigure()`,
  `regressionMatrix.test.ts:465`), asserts both legs draw exactly channel
  `[1]`, and pins BOTH measured colours — screen `TEST_SERIES_PALETTE[1]`
  (`#ffb37f`, the series' ORIGINAL position), export `TEST_SERIES_PALETTE[0]`
  (`#7fb3ff`, its FILTERED position) — then asserts they differ.
  (Converted 2026-09-14 from a bare `it.fails`.)

#### Why this priority

P2 as filed. Matches the evidence: substantial, visible friction (an
exported figure's series colours do not match the legend/screen the user
authored it against) with a workaround, not data loss — and the audit's own
framing that this is a recurrence of a class of bug already fixed once
elsewhere (`SeriesCycle` for the live Stage export) supports treating it as
more than cosmetic polish.

#### Reproduction checklist

- [x] Starting state and sample data identified — a `FigureDocument` with
  `yKeys: [0, 1]`, `hiddenChannels: [0]`, built by `hiddenFigure()`
  (`regressionMatrix.test.ts:465-480`).
- [x] Exact actions recorded — hide the first of two series, then compare
  `projectScreen(...).series[0].color` (the remaining, second series) to
  `projectExport(...).series[0].color`.
- [x] Actual result recorded — screen keeps the second series' original
  palette colour (its original position, 1); export recolours it as if it
  were the first series (filtered position 0).
- [x] Expected result recorded — the exported figure's series colours
  should match the screen's, hidden series or not.
- [x] Reproduced by an agent —
  `frontend/src/lib/regressionMatrix.test.ts`'s BUG-015 test (named
  `DIVERGENCE (BUG-015): …` when filed; inverted and renamed by the fix, see
  the Completion record).

#### Fix checklist

- [x] Give `buildFigureSpecFromDocument`'s export path the same positional
  correction `SeriesCycle`/`extras.autoSeriesStyles` already provides the
  live Stage export (`figureSpec.ts:253-262`), so `buildExportStyles`'s
  `pos` is computed from the UNFILTERED display index, not the filtered
  `plotted` index. Done at the shared chokepoint rather than on the document
  path: `buildFigureSpecForView` — which BOTH `buildStageFigureSpec` and
  `buildFigureSpecFromDocument` route through — now derives `positions`
  unconditionally, and `buildExportStyles` takes them as their own
  argument, separate from the cycle opt-in.
- [x] Confirm the fix does not also turn on the (opt-in) auto dash/marker
  CYCLE feature itself for saved documents — only the palette-POSITION
  correction, not `autoSeriesStyles`'s wider styling behaviour, should apply
  universally. `buildExportStyles`'s third argument is now the positions and
  its fourth a boolean `cycle`; the cycle gate (`overlayExportsSeriesStyles`
  + `extras.autoSeriesStyles`) is untouched, and
  `figureSpec.test.ts`'s pre-existing "a saved FigureDocument is independent
  of the preference" block still asserts `line: undefined` throughout.
- [x] Add a case with more than one hidden series (e.g. hiding series 0 of
  three) to confirm the fix generalizes past the two-series minimal repro —
  `figureSpec.test.ts`'s "generalizes past the two-series repro: hiding 0 AND
  1 leaves channel 2 on slot 2", plus the three-channel `hidden` matrix
  fixture.
- [x] INVERT the divergence assertion in `regressionMatrix.test.ts` — the two
  palette-slot pins and the `.not.toBe` are gone, replaced by the
  screen-equals-export equality (kept non-vacuous by pinning the screen
  slots and asserting they differ from the filtered ones), and the test is
  renamed to drop the `DIVERGENCE` prefix.

#### Acceptance criteria

- [x] Hiding a series on screen and exporting the figure produces the SAME
  palette colour for every remaining series as the screen shows.
- [x] `projectExport(hidden, dataset).series[i].color` equals
  `projectScreen(hidden, dataset).series[i].color` — the equality
  BUG-015's divergence test is inverted into; `hidden` is now a full member
  of the matrix, so `screen ≡ export` and `screen ≡ reopen` assert the whole
  canonical payload for it, not just the colours.
- [x] An export with NO hidden series is byte-identical to before the fix
  (no regression to the common, all-visible case) — with nothing hidden
  `plotted` IS the display list, so every position equals the old index;
  `figureSpec.test.ts`'s "with NOTHING hidden the wire is unchanged" pins it,
  and re-freezing the regression-matrix goldens wrote only the new
  `hidden.json`, leaving the other nine byte-identical.

#### Completion record

- PR/commit: `fix(export): BUG-015 …` on `claude/repo-evaluation-l7y7k9`
  (parent `e479f5da`). Product change is three lines of behaviour across
  `frontend/src/lib/exportStyles.ts` (new `positions` argument, taken always;
  `cycle` demoted to a boolean), `frontend/src/lib/figureSpec.ts` (`positions`
  derived unconditionally from `displayChannels`) and
  `frontend/src/lib/spatialPageExport.ts` (call-site update — that panel's
  `plotted` IS its canvas' list, so it passes `null` positions). No persisted
  contract changed: the positions are derived at export-build time from
  `yKeys`/`seriesOrder`/`hiddenChannels`, all of which a saved document
  already carries, so there is NO new document field and no schema bump.
- Automated tests: `frontend/src/lib/figureSpec.test.ts` — new block "hidden
  series keep their palette slot on the export wire (BUG-015)" (4 tests:
  slots 1 and 2 for a hidden 0 of three; hiding 0 AND 1; the dash/glyph half
  under the cycle; the nothing-hidden no-op).
  `frontend/src/lib/exportStyles.test.ts` — "OFF: the positions still hold —
  no dash is invented, and no palette skew either (BUG-015)" (rewritten from
  the test that used to assert the skew).
  `frontend/src/lib/regressionMatrix.test.ts` — "BUG-015: hiding a series
  leaves the survivors on palette slots 1 and 2 on BOTH screen and export"
  (the inverted divergence), "hidden — the hidden channel is drawn by nobody,
  and the survivors keep their slots", and the `hidden` fixture's own
  `screen ≡ export`, `screen ≡ reopen` and golden tests.
- Agent verification: sabotage table (each reverted in turn, then restored) —
  (a) `positions` back to the filtered index in `figureSpec.ts` → 6 failures
  including `regressionMatrix` `hidden > screen ≡ export`, the inverted
  BUG-015 test, all three new `figureSpec.test.ts` BUG-015 assertions and the
  pre-existing P3.3 "a HIDDEN channel does not renumber the survivors";
  (b) `seriesColor(pos[i], …)` back to `seriesColor(i, …)` in
  `exportStyles.ts` → 6 failures including both `exportStyles.test.ts`
  palette-parity tests; (c) the reopen leg's display position back to the
  filtered index → `hidden > screen ≡ reopen`.
  Gate: `uv run pytest -q tests/test_repo_integrity.py`;
  `npx tsc -b --force`; `npx eslint src --max-warnings=0`;
  `npx vitest run src/lib src/architecture.test.ts` (274 files, 5205 tests);
  `npx vitest run src/components/Stage src/components/workshops/figurebuilder
  src/components/workshops/figurepage` (73 files, 1236 tests);
  `node scripts/freeze-regression-matrix.mjs --check` clean;
  `node scripts/check-bundle-size.mjs` green.
- Bundle (measured 2026-09-15, review NIT 5 — the number the record was
  missing): parent `e479f5da` **919,781 B** eager -> this commit `ebefa693`
  **919,781 B**, a **+0 B** delta. Both built after `npm ci` in a scratch
  worktree, with vite's transform cache cleared between them; the two builds
  really are different trees (every content hash moved, and the LAZY
  `figureSpec` chunk grew 6.57 kB -> 6.60 kB) — the eager graph simply did not
  gain a byte, because `exportStyles.ts`'s added statement lives in a lazy
  chunk and no eager import was added.
- Owner verification: pending — export a figure with a series hidden and
  confirm the PDF's colours match the legend on screen. Worth doing from the
  LIVE Stage (Copy figure / Export figure…) as well as from a saved document:
  both were broken and both are fixed (see the scope correction above).
- Notes: the REOPEN leg of the regression matrix (`lib/regressionMatrixReopen
  .testkit.ts`) carried the same skew in its own projection and was corrected
  to the unfiltered display position; it is a testkit, not product code, but
  the `hidden` fixture's `screen ≡ reopen` is what now holds it there.
- Review follow-up (2026-09-15, NIT 1 — landed with the BUG-014 commit): as
  shipped on 2026-09-14 the positions were `displayChannels.indexOf(ch)`, i.e.
  slots in THIS REQUEST's display list, which is the canvas' list only while
  `seriesStyleCycle.displayListsAgree` holds. `buildFigureSpecFromDocument`
  passes `allowExplicitXAsY: true` unconditionally, so a channel used as both
  X and Y stays in the export's list while the canvas always drops it, and the
  two index spaces then differ — making the comment's "the canvas' own display
  list" false in exactly the case the surrounding block names as the
  exception. The positions are now resolved against the CANVAS list itself
  (`lib/figureSpecSeries.ts`'s `resolveDisplaySeries`), so the claim is true on
  every branch; a channel the canvas never draws is parked past the end of that
  list rather than stealing a drawn channel's slot. Two further nits from the
  same round landed with it: `indexOf` collapsed a duplicated `yKeys` channel
  onto one palette slot (the slots now come from a per-channel queue, so each
  occurrence gets its own, as `uplotOpts`' index-keyed `seriesColor` does), and
  `exportStyles.ts` regained its `?? i` guard for a short `positions` array.
  Pinned by `figureSpecSeries.test.ts`, by colour assertions beside
  `figureSpec.test.ts`'s x-as-y cycle test, and by a ragged-positions test in
  `exportStyles.test.ts`.

---

## BUG-016 — a grouped figure's per-series styling reaches the canvas but is dropped from the export

**Priority:** P2 — a visible, wrong-looking export (a figure the user styled
red/dashed/3px comes back default-coloured, solid and default-width) with a
workaround (un-group, style each level individually, or restyle after export),
no data loss. The same class as BUG-015: the exported figure does not match the
figure the user authored on screen.

**Reported:** 2026-09-14, by the adversarial review round of the P4.2 canonical
regression matrix — found while checking whether the matrix's GROUP-mode
style comparison was load-bearing. It was not: the matrix compared
`spec.series_styles`, a wire field the renderer provably never reads on this
branch, so the comparison passed while the exported curve was solid. A
design-time finding, not yet surfaced by a user report.

**Investigated:** root cause confirmed by reading the backend resolver's
`group_col` branch and the canvas' group-split style mapping, and by measuring
both paths — see Confirmed implementation evidence below.

**Suggested implementation owner/model:** Unassigned.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P4.2 ("Canonical
plot/project regression matrix"), divergence D5.

**Related:** FEATURE-001 (per-series styling ignored by FACETED plots). The two
are siblings but NOT the same entry, and the difference is the whole point:
facets ignore styling on BOTH paths, so screen and export agree and a user sees
their styling stop mattering immediately. Grouping honours styling on screen and
discards it only in the export, so the mismatch is invisible until the PDF comes
out. A fix for one does not fix the other — FEATURE-001 additionally has to
solve "different panels resolve different channel sets, so one style list cannot
serve the grid", which a grouped figure does not have (every level belongs to
ONE channel and shares that channel's one style).

#### User-visible problem

A user plots one Y channel split by a categorical column ("Batch"), styles that
channel red, dashed, 3 px, and sees the canvas draw three red dashed 3 px curves
— one per level — exactly as intended. Exporting the same figure to PDF/SVG
produces three curves in matplotlib's default colour cycle, all solid, all at
the default line width. Nothing warns that the styling was discarded.

#### Confirmed implementation evidence

- `src/quantized/routes/export_figures.py:81-85` — `FigureRequest.group_col`'s
  own doc states the choice outright: *"`series_styles` is not applied in this
  path either (it's 1:1-with-`y_keys`, which doesn't align with the synthetic
  per-level series) -- matplotlib's default color cycle takes over, exactly like
  the screen, which never assigns per-level colors either."* The parenthetical
  is right about COLOUR and wrong about everything else: the screen does not
  assign per-LEVEL colours, but it does give every level of a channel that
  channel's dash, width, marker, step and fill.
- `src/quantized/routes/export_figures.py:236-238` — the implementation. The
  `group_col` branch returns
  `_ResolvedFigure(grouped.x, g_series, x_label, y_label, None, [False] * len(g_series), "")`
  — the fifth positional field is `styles` (`_ResolvedFigure`, `:169-181`), so
  every per-series style is `None` for a grouped export. Measured directly
  against the resolver: a `FigureRequest` with
  `series_styles=[{color:'#ff0000', line:'dashed', width:3}]` resolves to
  `styles=None` when `group_col=1` is set and to the styles verbatim when it is
  not.
- `frontend/src/lib/figureSpec.ts:310` — `buildFigureSpecFromDocument` still
  PUTS the style on the wire: `group_col` is emitted from `extras.groupKey`,
  and `series_styles` (`:321`) is built unconditionally. So the wire carries a
  style the renderer will ignore, which is why a wire-level comparison cannot
  see this bug.
- `frontend/src/lib/figureSpec.ts:232-233` — the frontend already KNOWS about
  the backend's behaviour, but only narrowly: `overlayExportsSeriesStyles`
  refuses to auto-CYCLE styles for `group_col`/`facets` because those are
  *"documented as ignoring `series_styles` in `routes/export_figures.py`"*. The
  raw user-authored styles are still sent, and the mismatch is never surfaced.
- `frontend/src/lib/plotGroupSplit.ts:55-61` (`groupSplitChannelMap`) and
  `frontend/src/components/Stage/usePlotPayload.ts:226-230` (`styleList`) — the
  canvas side. The channel map repeats each fetched channel once per level, and
  `styleList` maps each DISPLAY position back through it to that channel's one
  `seriesStyles[ch]` entry, which `buildOpts` then applies to every level.
- Measured on the matrix's `group` fixture (channel 0 styled `width: 2,
  line: "dashed"`, levels ordered C/A/B): the canvas draws
  `Signal (Batch=C) (au)`, `Signal (Batch=A) (au)`, `Signal (Batch=B) (au)`,
  every one with `dash: [8, 4]` and `width: 2`; the wire carries
  `series_styles: [{color: …, width: 2, line: "dashed"}]` alongside
  `group_col: 6`; the backend resolves that to `styles=None`.
- Test: `frontend/src/lib/regressionMatrix.test.ts:415`,
  `it("DIVERGENCE (BUG-016): a grouped figure's per-series styling reaches the
  canvas but is dropped from the exported figure", ...)` — reads the three
  per-level strokes out of the real `buildOpts` options object
  (`screenDrawnStyles`, `regressionMatrixLegs.testkit.ts`), reads
  `group_col`/`series_styles` out of the real `FigureSpec`, takes the level
  count from the wire's own `cat_levels`, and pins the backend's contract as a
  named constant (`STYLE_DROPPED_BY_THE_GROUP_BRANCH = null`) before asserting
  the two differ. Structural, like the rest of the matrix — it does not render
  a PDF.
- `frontend/src/lib/regressionMatrix.testkit.ts` — `styleComparable("group")`
  is now `false` for exactly this reason, so the matrix's leg-to-leg comparison
  no longer reports agreement on a field one side ignores.

#### Why this priority

P2, matching BUG-015 rather than FEATURE-001's P3. The distinction is
screen/export AGREEMENT: FEATURE-001 is P3 because both paths ignore styling, so
nothing the user sees is contradicted by what they get. Here the canvas honours
the styling and the export silently does not, so the user's own reference — the
figure on screen — actively misleads them about what the PDF will contain.
Not P1: the data and the analysis are untouched, every level is still drawn and
still labelled, and the workaround (un-group and plot the levels as separate
channels) exists.

#### Reproduction checklist

- [x] Starting state and sample data identified — the `group` fixture in
  `frontend/src/lib/regressionMatrixFixtures.testkit.ts` (one Y channel,
  `groupKey: 6` over the categorical "Batch" column with explicit
  `level_order: [2, 0, 1]`, and `seriesStyles: { 0: { width: 2, line:
  "dashed" } }`).
- [x] Exact actions recorded — style a grouped channel, then compare the
  per-level strokes the canvas resolved (`screenDrawnStyles`) against what the
  backend's `group_col` branch will render.
- [x] Actual result recorded — canvas: three curves, each `dash: [8, 4]`,
  `width: 2`; export: three curves with `styles=None`, i.e. solid and
  default-width in matplotlib's default cycle.
- [x] Expected result recorded — the exported grouped figure should carry the
  channel's dash/width/marker/step/fill on every level, exactly as the canvas
  draws them.
- [x] Reproduced by an agent —
  `frontend/src/lib/regressionMatrix.test.ts`'s
  `it("DIVERGENCE (BUG-016): a grouped figure's per-series styling reaches the
  canvas but is dropped from the exported figure", ...)`.

#### Fix checklist

- [ ] Decide the contract for `series_styles` under `group_col`: expand the
  1:1-with-`y_keys` style list to the synthetic per-level series server-side
  (each level inheriting its source channel's style, which is exactly what the
  canvas does), rather than dropping it. `calc.plotting.build_grouped_series`
  already knows which channel each synthetic series came from.
- [ ] Keep COLOUR out of scope unless deliberately chosen: the canvas colours
  levels by display position and the backend by its own cycle, and making those
  agree is a separate decision from honouring dash/width/marker/step/fill.
  Whatever is decided, say so in `export_figures.py:81-85`'s doc, which is the
  contract this bug is measured against.
- [ ] Update `figureSpec.ts:232-233`'s `overlayExportsSeriesStyles` reasoning
  if `group_col` stops ignoring `series_styles` — the predicate currently cites
  the backend behaviour this fix would change.
- [ ] Add a backend test at the RENDERED layer (the
  `tests/test_export_vector_structure.py` family) that a grouped export's
  curves carry the requested dash/width — a wire-level assertion cannot see
  this bug, which is how it survived.
- [ ] INVERT the divergence assertion in `regressionMatrix.test.ts`'s
  `it("DIVERGENCE (BUG-016): a grouped figure's per-series styling reaches the
  canvas but is dropped from the exported figure", ...)` — drop the
  `STYLE_DROPPED_BY_THE_GROUP_BRANCH` constant and the `.not.toEqual`, and
  assert the exported per-level styles EQUAL the canvas'. The fix makes the
  current assertion RED; it is not an `it.fails` that would silently become an
  "unexpected pass".
- [ ] Set `styleComparable("group")` back to `true` in
  `regressionMatrix.testkit.ts` and regenerate `group.json`
  (`node frontend/scripts/freeze-regression-matrix.mjs`), so the matrix
  compares grouped styling leg-to-leg again once the two paths agree.

#### Acceptance criteria

- [ ] A grouped figure styled dashed/3 px on screen exports as dashed/3 px on
  every level.
- [ ] An UNGROUPED export is byte-identical to before the fix (no regression to
  the common, 1:1-with-`y_keys` case).
- [ ] A grouped export with NO per-series styles set is byte-identical to
  before the fix (the default-cycle rendering is unchanged when there is
  nothing to honour).
- [ ] The matrix's `group` fixture passes `screen ≡ export` with
  `styleComparable("group") === true`.

#### Completion record

- PR/commit: —
- Automated tests: —
- Agent verification: —
- Owner verification: —
- Notes: —

---

## BUG-017 — a dataset with a NaN or ±Infinity cell cannot be reopened after Save

**Priority:** P1 — data loss: the affected dataset's `.dwk` cannot be reopened
at all, and the failure takes the WHOLE workspace down with it (one bad
dataset refuses every dataset in the file). No workaround inside the app once
saved; only recovery is hand-editing the JSON or restoring an older save.

**Reported:** 2026-09-15, by the round-3 adversarial review of the P2.1
peak-table digest work (`b8cb5e16`) — found while measuring the digest's
`.dwk` round trip (`xrd_review3.md` NIT 4) as a durability side-check, not a
peak-table defect. Pre-existing and outside that commit's diff; recorded here
rather than against the peak-table entry.

**Investigated:** root cause confirmed by probe (below), not inferred.

**State:** **FIXED 2026-09-16.** See the Implementation, Tests and Completion
record sections; the two design rulings the original filing left open (what a
pre-fix `null` cell means, and whether a malformed entry should still take the
whole workspace down) are decided and recorded there, with one residual site
left open and named by file:line.

**Suggested implementation owner/model:** Claude (agent), 2026-09-16.

**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P2.1 (found via its
round-3 review; the peak-table fingerprint is a downstream SYMPTOM, not the
cause — see the `-0` half below).

#### User-visible problem

A dataset containing a `NaN` cell (reachable today by `insertRows`, whose
blank rows are minted as `Number.NaN` — see evidence) or a `±Infinity` cell
(reachable by any correction/formula that can produce one, e.g. a divide by
zero) is saved successfully, but the saved `.dwk` can never be opened again:
`parseWorkspaceDataset` throws `dataset N ("<name>") has an invalid data
structure` for THAT dataset, and `parseWorkspace` has no per-dataset recovery
— the exception propagates out of the whole load, so every OTHER dataset in
the same workspace file also fails to open. The user's only path back into
their project is hand-editing the saved JSON. Separately, a cell holding `-0`
silently becomes `0` on reopen — not a throw, but a silent value change and,
for a dataset with a durable peak table (`PRIMARY_SOFTWARE_AUDIT_PLAN` P2.1),
enough to flip `peakTableMatchesData` to false and discard an otherwise-valid
saved fit for no user-visible reason.

#### Confirmed implementation evidence

- `frontend/src/lib/workspaceSerialize.ts:198` — `serializeWorkspace`'s
  per-dataset map does `data: d.data` **inline**, with no replacer. The whole
  document is then handed to a single `JSON.stringify` elsewhere in the same
  function, and `JSON.stringify` turns `NaN`/`Infinity`/`-Infinity` into
  `null` and leaves `-0` indistinguishable from `0` (`JSON.stringify(-0)` is
  the string `"0"`) — neither is a bug in this file, but this is the one place
  a dataset's numeric payload crosses the JSON boundary with no NaN/±Infinity/
  -0 handling of its own.
- `frontend/src/lib/workspaceDatasetParse.ts:38-40` — `isNumberArray`:
  `Array.isArray(v) && v.every((x) => typeof x === "number")`. A `null` in the
  array (what a serialized NaN/±Infinity cell becomes) fails `typeof x ===
  "number"`, so any row or value column that held one is rejected.
- `frontend/src/lib/workspaceDatasetParse.ts:75-108` (`isDataStruct`,
  `parseWorkspaceDataset`) — `isDataStruct` calls `isNumberArray` on `time`
  and (transitively, per row) on `values`; when it returns false,
  `parseWorkspaceDataset` throws `` `dataset ${i} ("${String(dd.name ??
  "")}") has an invalid data structure` `` (`:107`). This is a per-dataset
  parse called from `parseWorkspace`'s `o.datasets.map(...)` with no
  try/catch around each entry, so the thrown error aborts the `.map` and the
  whole `parseWorkspace` call.
- `frontend/src/store/cellEdit.ts:129-131` (`insertRows`) —
  `` const blankRow = () => d.data.labels.map(() => Number.NaN); `` mints a
  `NaN` in every value column for each inserted blank row, and the same
  function pads `time` with `Number.NaN` too (`padRows(d.data.time, span,
  Number.NaN)`). So a plain "insert a row" followed by "save" is enough to
  reach the bug with no error-path or malformed-import involved.
- **Probe, run end to end against the real code** (`serializeWorkspace` ->
  `JSON.parse`/`JSON.stringify` -> `parseWorkspace`, a minimal one-dataset,
  one-column workspace, 2026-09-15):
  - a `NaN` cell: `parseWorkspace` **throws** exactly
    `dataset 0 ("scan.dat") has an invalid data structure`, and the workspace
    fails to load.
  - a `-0` cell: parses without error; the round-tripped value reads back as
    `0` (`Object.is(v, -0)` is false) — a silent, non-throwing change.
  These match `xrd_review3.md`'s independent measurement
  (`peakTableMatchesData` -> false for the `-0` case; the identical throw
  message for the `NaN` case) — same bug, found by two different probes.

#### Why this priority

P1, not P2: this is category "the project cannot be reopened", the same class
BUG-011 (Pack Project shipping preview rows) and the P0/P1 entries in this
file reserve for actual data loss, and it needs no rare input — inserting a
row is a normal, common action, and `insertRows`'s blank cells are `NaN` by
construction, not by user error. It differs from the peak-table digest's
`-0` half (recorded as fail-safe in `xrd_review3.md` NIT 4, and left there
rather than duplicated here): the NaN half is not fail-safe, it is a hard
failure that blocks reopening the file.

#### Reproduction checklist

- [x] Starting state and sample data identified — a one-dataset workspace,
  one value column, three rows.
- [x] Exact actions recorded — `insertRows` a blank row (or otherwise write a
  `NaN`/`±Infinity` cell), `serializeWorkspace`, round-trip through
  `JSON.parse(JSON.stringify(...))` (what a real Save/Open does via the file
  on disk), `parseWorkspace` the result.
- [x] Actual result recorded — `parseWorkspace` throws `dataset 0
  ("scan.dat") has an invalid data structure`; the entire workspace fails to
  open. Separately, a `-0` cell parses but reads back as `0`.
- [x] Expected result recorded — the workspace should reopen with the
  dataset's `NaN`/`±Infinity`/`-0` cells intact, exactly as saved.
- [x] Reproduced by an agent — probe above, run against the real
  `serializeWorkspace`/`parseWorkspace` (see Confirmed implementation
  evidence). Committed as a regression suite 2026-09-16:
  `frontend/src/lib/nonFiniteCells.test.ts` reproduces the probe's exact
  path, but mints the NaN through the app's own `insertRows` action rather
  than writing one by hand.

#### Investigation

- [x] Likely owning components/modules identified —
  `lib/workspaceSerialize.ts`, `lib/workspaceDatasetParse.ts`.
- [x] Root cause confirmed rather than inferred — the probe above, plus the
  cited `isNumberArray`/`JSON.stringify` behavior.
- [x] Related workflows and persistence paths checked (2026-09-16) — every
  site that JSON-encodes a `DataStruct`'s numeric cells was enumerated by
  grepping `JSON.stringify` across `frontend/src/lib` and `frontend/src/store`
  and reading each hit. Exactly three encode dataset cells:
  - `lib/workspaceSerialize.ts:281`'s `JSON.stringify(doc, null, 2)` — the
    `.dwk` Save/Save As path AND, through the same function, `lib/autosave.ts`
    (localStorage/IndexedDB generations) and
    `store/packProjectContent.ts`'s `serializeCurrentWorkspaceForPack`. ALL
    THREE are covered by this one fix; `contentFingerprint`'s
    `JSON.parse`→`JSON.stringify` re-encode (packProjectContent.ts:174)
    passes the sentinels through unchanged, and the round-trip test here
    deliberately includes that extra hop.
  - `lib/workbookTransfer.ts`'s `buildTransferPackage` — a SEPARATE
    `JSON.stringify(pkg)` over live `Dataset`s, with the identical hole:
    `parseTransferPackage` feeds the text back through `parseWorkspace`, so a
    blank inserted row's NaN made workbook Copy→Paste (and Duplicate) refuse
    the whole workbook with `"… has an invalid data structure"`. FIXED here
    too, with the same encoder.
  - **RESIDUAL, recorded not fixed:** `lib/figureDocument.ts:442`
    (`serializeFigureDocument`) freezes a `DataStruct` snapshot inside a
    figure document, which rides along in the same `.dwk` under
    `editableFigures`. It does NOT throw — `normalizeFrozenDataStruct`
    (`lib/figureDocument.ts:309-334`) already maps every `null` cell to `NaN`
    by an explicit, documented contract — but that normalization is lossy in
    the two ways this fix removes elsewhere: `+Infinity`/`-Infinity` both come
    back as `NaN` (sign and kind gone) and `-0` comes back as `+0`. Left
    alone deliberately: it is a fail-soft path with its own versioned
    document contract, so changing its wire is a separate, versioned decision
    rather than the same edit.
  - Checked and NOT affected (no DataStruct cells cross them):
    `lib/plotRecipe.ts:260`, `lib/plotspec.ts:792`,
    `lib/pageDocumentActions.ts:198`, `lib/panelwindow.ts:117`,
    `lib/dragaxis.ts:29`, `lib/template.ts:38` — all carry view/spec state or
    drag payloads, not measured data. `lib/clipboard.ts`/`lib/clipboardGrid.ts`
    write TSV text, not JSON.
  - `lib/originBookRoles.ts` (named speculatively in the original filing)
    holds no serializer at all — it only decides `errorRoles`; the pack-project
    export it was cited for goes through `serializeWorkspace`, above.
- [x] Existing plan overlap reconciled — this is the pre-existing bug
  `xrd_review3.md` NIT 4 named and deliberately did not fix as part of the
  P2.1 peak-table digest work; filed here instead of folded into that entry.

#### Implementation

- [x] Minimal safe behavior defined — an encoder/decoder PAIR in its own
  module, `frontend/src/lib/nonFiniteCells.ts`, applied symmetrically at the
  two ends of the `.dwk` boundary: `workspaceSerialize.ts`'s per-dataset map
  calls `encodeDataStruct` on `data` and `raw`, and
  `workspaceDatasetParse.ts` validates with `isWireCellArray` and decodes
  with `decodeDataStruct` before `sanitizeDataStruct` ever sees the arrays.
  A new module rather than either existing file (282 and 264 lines) so
  neither is bulked toward the 500-line ceiling, and so the ONE other site
  with the same hole (`lib/workbookTransfer.ts`) shares the same code.
  SENTINELS CHOSEN: `"NaN"`, `"Infinity"`, `"-Infinity"`, `"-0"` — exactly
  what `String(value)` produces for each, so the saved file is
  self-describing to a human reading the JSON, rather than the `"__NaN__"`
  spelling this box originally proposed. The collision argument is
  unchanged by the shorter spelling and is the one that matters: these
  strings only ever appear inside `time`/`values`, which are numeric by
  contract (text cells live in the `metadata` row sidecars,
  `lib/rowSidecars.ts` — never in `values`), so no legitimate cell can be
  mistaken for one.
- [x] Failure and ambiguous-data behavior defined — **RULING: a pre-fix
  `null` cell stays a REJECTION**, not a silent `NaN` or `0`. Reasons: (a)
  `null` is genuinely ambiguous — NaN, `+Infinity` and `-Infinity` all wrote
  the same `null`, so reading it as NaN would fabricate a specific value the
  file does not contain; (b) `null` is equally what truncated or
  hand-corrupted JSON looks like, and this box's own original text asked for
  it to stay "a real rejection for genuinely malformed data". The practical
  cost is bounded and one-way: a `.dwk` saved by a PRE-fix build with a
  non-finite cell remains unopenable (hand-editing the JSON is still the
  recovery, as before), while every file written from this commit on
  round-trips exactly. Recorded in the code at
  `lib/workspaceDatasetParse.ts`'s cell-check comment and pinned by the test
  "still REFUSES a pre-fix null cell rather than guessing which value it was".
- [x] Data integrity and backward compatibility considered — three
  directions, each pinned by a test:
  - **New code, old file:** a `.dwk` with no sentinels decodes by reference
    and parses exactly as before (test: "parses a pre-fix .dwk (plain
    numbers, no sentinels) exactly as before").
  - **New code, ordinary data:** `encodeCells`/`encodeDataStruct`/
    `encodeDatasetCells` return their INPUT object when nothing needs a
    sentinel, so the object graph `JSON.stringify` walks is literally the
    one it walked before — byte-identical output, no `WORKSPACE_VERSION`
    bump, no new field (tests: "returns the input array/struct/dataset by
    reference…" and "writes a finite dataset's payload with the exact bytes
    it had before").
  - **Old build, new file:** an old build cannot be changed, so what it DOES
    was measured and pinned instead — its `isNumberArray` (`typeof x ===
    "number"`) fails on a sentinel string, so `isDataStruct` fails and it
    throws its usual `dataset N ("name") has an invalid data structure`.
    That is the same clear refusal it already gave for such a dataset before
    this fix: loud, never a silently wrong number (test: "makes an OLD build
    refuse a sentinel-bearing .dwk loudly instead of corrupting it", which
    runs the pre-fix predicate verbatim against real new-serializer output).
  - No collision with `textColumns.ts`'s sidecar: that sidecar lives under
    `metadata`, which this encoding does not touch at all.
- [x] UI wording/tooltips/accessibility included where relevant — **RULING:
  a malformed dataset entry STILL takes the whole workspace down**; it does
  NOT degrade to a per-dataset skip-with-warning through BUG-010's
  `notifyMigrationWarnings` channel. Considered and rejected because the
  "safer" option is the more destructive one here: a skipped dataset is
  invisible in the Library, and the user's very next Save would write the
  workspace WITHOUT it — turning a fully recoverable file into a permanent
  loss. Refusing to open leaves the file on disk untouched and names the
  offending dataset. What this fix changes is that the throw is now
  unreachable for any file the app itself wrote: the ordinary
  NaN/±Infinity/-0 cells parse correctly, so the refusal is reserved for
  genuinely malformed structure. Recorded in
  `parseWorkspaceDataset`'s doc comment ("WHY A MALFORMED ENTRY STILL TAKES
  THE WHOLE WORKSPACE DOWN").

#### Tests and acceptance

- [x] Regression test fails before the fix and passes afterward — 17 specs in
  the new `frontend/src/lib/nonFiniteCells.test.ts`, each round trip run as
  `serializeWorkspace` → `JSON.stringify(JSON.parse(text))` → `parseWorkspace`
  (the extra re-encode hop is deliberate: it is what
  `packProjectContent.contentFingerprint` does to the same text). NaN,
  `+Infinity`, `-Infinity` and `-0` all recover exactly, `-0` asserted with
  `Object.is`.
- [x] A VERSIONED round-trip test — "parses a pre-fix .dwk (plain numbers, no
  sentinels) exactly as before" (an old document still loads unchanged) and
  "still REFUSES a pre-fix null cell rather than guessing which value it was"
  (the ruling recorded above, pinned so it cannot drift silently). Plus the
  reverse direction: "makes an OLD build refuse a sentinel-bearing .dwk
  loudly instead of corrupting it".
- [x] `insertRows`' blank rows specifically — the NaN reaches the test
  through `useApp.getState().insertRows("d1", 1, 1)`, i.e. the app's own
  action, never a hand-written NaN; and a second spec asserts the OTHER
  dataset in the same workspace loads too (the "whole workspace goes down"
  half of the bug).
- [x] Relevant focused tests pass — `npx vitest run src/lib src/store
  src/architecture.test.ts`: 358 files, 7,076 tests, 7,075 passed. The one
  failure is unrelated and load-induced:
  `src/lib/freezeRegressionMatrixCheck.test.ts` times out at its own 30 s
  budget when the whole scope runs in parallel (it spawns a NESTED `vitest`
  run via `scripts/freeze-regression-matrix.mjs`); run on its own on the same
  tree it passes in 19.6 s, and the script it drives imports only the
  regression-matrix testkits — none of the four files this commit touches.
- [x] Type-check/build/repository gates pass — `npx tsc -b --force` (exit 0),
  `npx eslint src --max-warnings=0` (exit 0), the scoped vitest above,
  `npm run build` after `rm -rf node_modules/.vite`, and
  `uv run pytest -q tests/test_repo_integrity.py`.
- [x] Agent verifies acceptance criteria — every sentinel round trip, the
  byte-identity pin, both compatibility directions, the autosave path, the
  workbook-transfer path and the peak-table fingerprint, each sabotage-
  verified (7 sabotages, table in the commit body).
- [ ] Owner verifies when required — a real Save/reopen of a project
  containing an inserted blank row, in the running app on Windows.

#### Completion record

- PR/commit: `fix(workspace): BUG-017 — round-trip NaN/±Infinity/-0 cells
  through every JSON boundary` (2026-09-16).
- Automated tests: `frontend/src/lib/nonFiniteCells.test.ts` — 17 specs
  (encoder/decoder contract; byte-identity for ordinary data; the
  `insertRows` NaN round trip and its whole-workspace half; ±Infinity; `-0`
  via `Object.is`; `raw`; pre-fix document compatibility both ways; two
  autosave specs; the workbook Copy/Paste package; the `peakDataFingerprint`
  survival check).
- Agent verification: 2026-09-16 — the original probe's two symptoms are
  both gone (the NaN case now reopens; the `-0` case now reads back
  `Object.is(v, -0) === true`), and every new spec was sabotage-verified by
  breaking the code it guards and restoring the source byte-identical.
- Owner verification: —
- Notes: one residual recorded and deliberately not fixed —
  `lib/figureDocument.ts:442`'s frozen figure snapshot is lossy for
  `±Infinity` (both become `NaN`) and `-0` (becomes `+0`) but never throws;
  see the Investigation section's third bullet for why it is a separate,
  versioned decision.

---

## FEATURE-001 — per-series styling does not apply to faceted plots (screen or export)

**Priority:** P3 — nothing is lost or corrupted, and screen and export AGREE
today (both ignore it). It is a missing capability, not a defect: a user who
styles a series and then facets sees their styling quietly stop mattering, with
no warning. P3 rather than P2 because the data and the analysis are untouched.

**Reported:** 2026-09-09, by Claude, while auditing PRIMARY_SOFTWARE_AUDIT_PLAN
P3.3's "contrast and non-color encodings" box. Filed AFTER a fix was built,
reviewed twice, and deliberately reverted — the reasons are the valuable part of
this entry.

#### What is actually true

- `calc/figure_facets.py`'s `draw_facet_grid` calls
  `_plot_kwargs(st.line_width, st.marker_size, None)` — a hardcoded `None`
  where the flat renderer passes the per-series style spec.
- `components/Stage/useMultiPanelStage.ts`'s facet branch passes NO
  `seriesStyles` to `buildOpts` either, unlike its sibling branches.
- So the export is CONSISTENT with the screen. This was originally reported as
  "faceted export silently drops styles", which framed a missing feature as an
  export regression.

#### Why the obvious fix is wrong (two rounds of review)

1. **`series_styles` cannot be forwarded.** It is indexed by `y_keys`, which
   `lib/figureSpec.ts` sends as `plotted` — hidden-channel-FILTERED and
   `seriesOrder`-REORDERED. Facet panels are built from the RAW `st.yKeys`,
   because the on-screen grid honours neither. An existing passing test
   (`figureSpec.test.ts`, "does not throw for an all-hidden FACETED view")
   already demonstrates the divergence: `y_keys` comes back `[]` while `facets`
   still carries every series. Forwarding would draw a chosen dash on the WRONG
   curve.
2. **A separate facet-indexed list is ALSO insufficient.** Building one from
   `st.yKeys ?? defaultDenseChannels(...)` fails whenever `yKeys` is null,
   because `lib/plotdata.ts`'s `buildColumns` re-runs the `defaultDenseChannels`
   DENSITY heuristic on each ROW-SLICED panel. Measured on a QD-shaped fixture
   (M_DC finite only on level-0 rows, M_AC only on level-1 rows): panel 0
   resolved `[level, M_DC]`, panel 1 resolved `[level, M_AC]`. The panels differ
   from the whole-dataset list AND FROM EACH OTHER.
3. **Therefore `draw_facet_grid`'s "every panel shares one series order"
   assumption is false**, and no single style list can serve the grid.

#### What a real fix has to decide first

- **Should every panel show the same channel set?** Comparing like with like is
  the point of small multiples, so pinning one channel list for the whole grid
  is defensible — and would make one style list valid. But it changes what the
  screen renders (panels would show empty series), so it is a product decision,
  not an implementation detail to settle silently.
- Otherwise the wire needs per-PANEL styles, or a channel index per facet
  series so styles can be matched by channel rather than position.
- Either way the fix must land on the SCREEN and the EXPORT together, or it
  breaks the parity invariant `lib/figureSpecFacets.ts` documents ("renders the
  SAME faceted grid Stage shows").

#### Reproduction

- [x] Confirmed by reading both renderers (`figure_facets.py`,
  `useMultiPanelStage.ts`).
- [x] The per-panel channel divergence measured directly with a throwaway probe
  over the real `facetPayloads`, not inferred.
- [ ] Confirmed visually on owner data.

#### Implementation

- [ ] Product decision: one channel set per grid, or per-panel styles.
- [ ] Screen and export together.
- [ ] A fixture where panels WOULD resolve different channels, so whichever rule
  is chosen is pinned against the case that broke the first two attempts.

#### Completion record

_(empty — open. The reverted attempt is commit-logged; `docs/testing.md` kept
the monkeypatch lesson it produced.)_

---

## BUG-007 — RESOLVED, AND IT WAS A MISDIAGNOSIS: a `void`-ed async call in a test, not module-init order

**Priority:** was P2 — **CLOSED the same day, fixed, and kept in the register
because the misdiagnosis is the lesson.** There is no module-init-order problem.
A sibling test fired an async store action without awaiting it, so its assertion
was vacuous and its `set()` landed during a LATER test; one extra `await
import()` shifted that leak by a microtask tick and exposed it. I filed the
symptom as an exotic bundler/ordering hazard and withheld a real ~1 kB bundle
reduction for it. A review found the real cause in one pass.

**Reported:** 2026-09-09, by Claude, while paying for BUG-006's fix out of the
bundle budget rather than raising the pin a second time.

**Investigated:** bisected to a single line; root cause NOT established.

#### Reproduction (exact, one line)

In `store/split.ts`, replace the static

```ts
import { splitColumn, sliceDataStruct, tooManyGroups } from "../lib/datasetsplit";
```

with the equivalent dynamic import inside the already-`async`
`splitDatasetByColumn`:

```ts
const { splitColumn, sliceDataStruct, tooManyGroups } = await import("../lib/datasetsplit");
```

Then `npx vitest run src/store/selectionInvariant.test.ts` fails:

```
× restoreFromTrash yields the tree selection only when the restore IS an activation
  AssertionError: expected 'ds-<generated>-3' to be 'd1'
```

`restoreFromTrash("dataset:d1")` restores a dataset carrying a FRESHLY MINTED
id instead of `d1`. Revert that one line and it passes; every other file in the
same working tree is unchanged either way. It fails when the file is run ALONE,
so it is not a cross-file ordering artifact of the parallel runner.

#### The actual cause (found by review, 2026-09-09)

`store/selectionInvariant.test.ts` had:

```ts
it("splitDatasetByColumn (context-menu split acts on any row, selected or not)", () => {
  void useApp.getState().splitDatasetByColumn("d1", 0);   // <- never awaited
  expect(invariantHolds()).toBe(true);
});
```

`splitDatasetByColumn` awaits `resolveDataset` on its first line, so at the
moment of the assertion **nothing has happened yet** — the assertion could not
fail. The action's `set()` then resolved during whichever test happened to be
running next. With a STATIC import the timing put it somewhere harmless; adding
one `await import()` moved it into the `restoreFromTrash` test, which then saw a
dataset it did not expect and reported a generated id.

Fixed by making the test `async` and awaiting the call — which repairs the
vacuous assertion and the leak together. The lazy import then lands with nothing
else changed, and the reduction was collected (see
`frontend/scripts/check-bundle-size.mjs`'s history block: 913,869 measured,
1,001 bytes off what the commit would otherwise have needed).

#### The lesson, which is why this entry stays

A `void`-ed promise in a synchronous test is two bugs wearing one coat: an
assertion that cannot fail, and cross-test state leakage whose landing point
depends on unrelated microtask timing. When an innocuous change "breaks" a
distant test, suspect an un-awaited async call before suspecting the bundler.
And a withheld optimization deserves re-examination before it is paid for with a
budget raise — this one was blocked by a phantom, and the raise it justified was
unnecessary.

#### Why it looked odd at the time

`restoreFromTrash` ALREADY uses exactly this pattern — it `await import()`s
`store/trashRestore.ts` (see `store/trash.ts`'s header, which documents the
deferral as a deliberate bundle win). So a dynamic import in a store slice is
established practice here; adding a SECOND one in a sibling slice is what
changes behaviour, which is the part that makes no obvious sense.

Candidate mechanisms, none confirmed:
- Two module instances of something (`store/useApp.ts`'s id counters live at
  module scope), so `nextDatasetId` is not the counter the test's expectation
  was built against.
- The restore's workbook self-heal (`trashRestore.ts`'s
  `deriveWorkbooks([restored], s.folders, nextWorkbookId)`) taking a different
  branch, cascading into a new dataset id.
- A test-setup assumption about which modules are already evaluated.

#### What is blocked by it

A measured **720-byte** eager-bundle reduction — `lib/datasetsplit.ts` (~3.5 kB
of pure splitting/slicing math) leaving the eager graph entirely, since
`store/split.ts` is its only eager consumer and every other importer already
sits behind a lazy panel. Measured 913,869 with the change vs 914,894 without:
bigger than BOTH of today's pin raises combined, so collecting it would put the
ratchet tighter than it has been all session. Full rationale in
`frontend/scripts/check-bundle-size.mjs`'s history block.

#### Investigation checklist

- [x] Bisected to the single import line.
- [x] Confirmed it fails with the file run alone (not a parallel-run artifact).
- [x] Root cause established — NEITHER of the guesses. An un-awaited async
  store action in a sibling test (`void ...splitDatasetByColumn(...)`).
- [x] The TEST was wrong, on both counts: vacuous assertion and leaked `set()`.
  The store's restore behaviour was never at fault.
- [x] Reduction collected and the pin LOWERED to 913,893 — 696 bytes tighter
  than the day started, repaying both of today's raises.

#### Completion record

- PR/commit: the Group M review-round commit (2026-09-09).
- Automated tests: `store/selectionInvariant.test.ts`'s
  "splitDatasetByColumn (context-menu split acts on any row, selected or not)"
  is now `async`/awaited; the whole file and `store/split.test.ts` pass with the
  lazy import in place.
- Agent verification: cause reproduced, fix verified, reduction collected.
- Owner verification: not required — test-only correctness plus a measured
  bundle reduction.

---

## UX-003 — a failed lazy chunk load unmounts the React root: 17 `lazy()` sites, no error boundary

**Priority:** P3 — recoverable by reloading the page, and it needs a chunk
fetch to fail (offline right after a deploy, or a stale cached `index.html`
referencing a since-rotated hash); but when it does happen the whole app
goes blank with no message at all
**State:** Open
**Reported:** 2026-09-15 by agent (adversarial review of the `b749f804` bundle diet)
**Investigated:** measured, not fixed — see below
**Suggested implementation owner/model:** Unassigned
**Related plan:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P4.1 (the lazy-seam
diet), `plans/BUNDLE_HEADROOM.md` slice 2

#### User-visible problem

Every code-split panel in the app is reached through React's
`lazy()` + `<Suspense>`. If the chunk behind one cannot be fetched, the lazy
component's promise rejects, and React propagates that rejection up looking
for an error boundary. There is none: measured 2026-09-15,
`grep -rln "componentDidCatch|getDerivedStateFromError|ErrorBoundary" frontend/src`
returns **0 files**, against **17** `= lazy(` sites in nine modules
(`main.tsx`, `App.tsx`, `AppOverlays.tsx`, `components/Library/Library.tsx`,
`components/Library/FigureRow.tsx`, `components/Stage/Stage.tsx`,
`components/Stage/PlotStage.tsx`, `components/windows/WindowCanvas.tsx`,
`components/windows/DocumentWindow.tsx`).

So the failure mode is: the user clicks something that opens a lazy panel,
the fetch fails, and **the entire React root unmounts** — a blank window,
no toast, no status line, no console error the user would ever see. The
project state is not lost on disk, but everything unsaved in memory is, and
the only recovery is a page reload. React additionally caches the rejected
payload for that `lazy()` component, so even if the root survived, the next
gesture would not retry.

This is a whole CLASS, not one panel. It is filed now because the
2026-09-14 bundle diet's commit body claimed "chunk-load failures are
reported, never silent" and "a failed load is never cached, so the next
gesture retries" without qualification. Both are true of the three seams
that go through `commands/fileCommands.ts`'s `runLazy` or
`store/workbookTransfer.ts`'s own `fail()`; **neither is true of any
`lazy()`-shaped seam**, including that commit's own
`components/Library/OriginSavedPreviewWindow.tsx`. The claims were narrowed
in both plans on 2026-09-15; the missing boundary itself was deliberately
NOT added in that review round, because a root error boundary is a design
decision about what the app shows and offers when a subtree dies, not a
one-line patch to slip into a bundle-diet follow-up.

#### Reproduction

- [x] Starting state and sample data identified — any project; the Library
  figure row's saved-Origin preview ("▣") is the cheapest lazy trigger
- [x] Exact actions recorded — make the chunk unfetchable (DevTools offline,
  or delete the built chunk from `src/quantized/web/assets/`), then click a
  control whose panel is `lazy()`
- [x] Actual result recorded — measured in a scratch spec at `b749f804`
  (`vi.mock` of the lazy module throwing, then clicking "▣" on a
  `saved_preview` row): root HTML length after the click **0**, row present
  **false**, toasts **0**, `console.error` lines **0**
- [ ] Expected result recorded — owner call: the decision below
- [x] Reproduced by an agent

#### Investigation

- [x] Likely owning components/modules identified — the nine modules listed
  above; a fix belongs at/near `src/main.tsx`'s root render and each
  `<Suspense>` boundary, not in any individual panel
- [x] Root cause confirmed rather than inferred — measured, both halves
  (0 boundaries, 17 sites) counted by grep on 2026-09-15
- [ ] Related workflows and persistence paths checked — in particular
  whether autosave (`useWorkspaceAutosave`) has already written before a
  root unmount, i.e. how much is actually lost
- [ ] Existing plan overlap reconciled — P4.1 will keep ADDING `lazy()`
  seams for bundle headroom, so this grows with every future slice

#### Implementation

- [ ] Minimal safe behavior defined — owner call between: (a) one root
  boundary that shows a "something went wrong, reload" panel; (b) a boundary
  per `<Suspense>` so only the failing panel dies and the rest of the app
  keeps working; (c) (b) plus a Retry that remounts with a fresh `lazy()`,
  which is the only way to defeat React's cached rejection
- [ ] Failure and ambiguous-data behavior defined — a boundary must not
  swallow non-chunk errors into a generic message that hides a real bug
- [ ] Data integrity and backward compatibility considered — whether the
  boundary should force an autosave before showing its fallback
- [ ] UI wording/tooltips/accessibility included where relevant

#### Tests and acceptance

- [ ] Regression test fails before the fix and passes afterward — a spec
  that makes one `lazy()` chunk reject and asserts the root is still mounted
- [ ] Relevant focused tests pass
- [ ] Type-check/build/repository gates pass
- [ ] Agent verifies acceptance criteria
- [ ] Owner verifies when required

#### Completion record

- PR/commit: —
- Automated tests: —
- Agent verification: —
- Owner verification: —
- Notes: filed by the 2026-09-15 review round of `b749f804`; that round
  narrowed the two over-broad claims in the plans and left the boundary
  itself to this item.

---


## New issue template

Copy this section for each new report. Assign the next stable ID (`BUG-###`, `UX-###`, `PERF-###`, or `FEATURE-###`). Never renumber an existing item.

### ID — concise title

**Priority:** P0/P1/P2/P3 — reason  
**State:** Open / In progress / Blocked on owner / Verified complete  
**Reported:** YYYY-MM-DD by owner/agent  
**Investigated:** —  
**Suggested implementation owner/model:** —  
**Related plan:** —

#### User-visible problem

Describe what the user did, what happened, and why it matters. Include filenames/data types when relevant, but do not add private data to the repository.

#### Reproduction

- [ ] Starting state and sample data identified
- [ ] Exact actions recorded
- [ ] Actual result recorded
- [ ] Expected result recorded
- [ ] Reproduced by an agent or explicitly marked owner-only

#### Investigation

- [ ] Likely owning components/modules identified
- [ ] Root cause confirmed rather than inferred
- [ ] Related workflows and persistence paths checked
- [ ] Existing plan overlap reconciled

#### Implementation

- [ ] Minimal safe behavior defined
- [ ] Failure and ambiguous-data behavior defined
- [ ] Data integrity and backward compatibility considered
- [ ] UI wording/tooltips/accessibility included where relevant

#### Tests and acceptance

- [ ] Regression test fails before the fix and passes afterward
- [ ] Relevant focused tests pass
- [ ] Type-check/build/repository gates pass
- [ ] Agent verifies acceptance criteria
- [ ] Owner verifies when required

#### Completion record

- PR/commit: —
- Automated tests: —
- Agent verification: —
- Owner verification: —
- Notes: —

---

## Change log

| Date | Author | Change | Evidence/status |
|---|---|---|---|
| 2026-09-08 | ChatGPT-Sol | Created living tracker; added BUG-001 and UX-001 from owner screenshots and code inspection | Both open |
| 2026-09-09 | Claude | BUG-001: parser-declared roles in `io/ncnr.py` + the missing `metadata.error_roles` reader; corrected one investigation line that measurement disproved | BUG-001 partially implemented, still open pending render/round-trip and owner checks |
| 2026-09-09 | Claude | Added BUG-003 (Data Filter: a stale kind-mismatched predicate survives a column type change invisibly) from the Data Filter categorical-wiring slice | Display-masking half implemented + sabotage-verified; row-filtering half open pending owner call |
| 2026-09-09 | Claude | Verified Tabulate/Stat Stage `is_categorical` wiring (PRIMARY_SOFTWARE_AUDIT_PLAN); added BUG-004 (Stat Stage: a stale groupCol/facetCol survives a column type change) and fixed it fully (display + computation, self-contained hook) | BUG-004 fixed + sabotage-verified; Tabulate confirmed self-healing (no analogous bug), also sabotage-verified |
| 2026-09-13 | Claude | Recorded the Group AF outcome on BUG-009's load-path item (`.dwk` load refusing `excludedRows`/`filter` on a pending dataset): built, adversarially reviewed, reverted before reaching `main`; wrote the net-regression finding and the unbuilt plan of record into the item honestly. Added BUG-010 (`migrationWarnings` unreachable on recovery/append/workbook-import loaders) and BUG-011 (Pack Project serializes a pending dataset's preview rows, unlike Save/Save As and workbook transfer) from the same review | Both new entries are design-time findings, code-read and cited by file:line, not yet fixed; BUG-009's item stays `[ ]` open, code unchanged from pre-attempt |
| 2026-09-13 | Claude | BUG-011 fixed: both Pack Project serialization entry points (the preview and "Start pack") now `await resolvePendingDatasets()` before `serializeWorkspace` and abort with a named `pending_unresolved` error + status + danger toast when a book can't be fetched, mirroring `workspaceIO.ts`'s Save path. The workspace-content slice moved to the new `store/packProjectContent.ts` so the 500-line `.ts` ceiling was met by extraction, not a pin raise; `lib/workspaceSerialize.ts`'s `pending` comment corrected to name all three explicit export paths | All four Fix-checklist boxes ticked with file:line evidence; 5 new specs, each sabotage-verified (4 sabotage rounds, source restored byte-identical); full frontend suite 634 files / 10,381 tests green; eager bundle unchanged at 916,182 B (budget 920,400). Owner call on abort-vs-partial-pack left open in the entry |
| 2026-09-13 | Claude | Added and fixed BUG-010 (`migrationWarnings` reached the user on a plain File ▸ Open only — autosave recovery, silent autosave restore, Append workspace, and workbook Paste all folded or dropped the notice): one shared `notifyMigrationWarnings` toast helper (`store/toasts.ts`) called from all four sites; `duplicateWorkbook` deliberately excluded (structural non-goal, pinned by test) | BUG-010 fixed + sabotage-verified (one regression test per site); `uv run pytest -q tests/test_repo_integrity.py` passed |
| 2026-09-13 | Claude | Adversarial review round on the BUG-011 fix (commit `1b7ec2cf`): closed both CONFIRMED code findings — "Start pack"'s own book-resolve await had no generation guard (a cancel/reset during it was silently overwritten, and a second click ran a second concurrent attempt), and a book that turned pending DURING the resolve await was still serialized from its preview rows. Also named the failing book in the refusal (finding #5), corrected two stale cross-references and an understated sabotage count, added a status on the resolve step's success path, and renamed a shadowing `type Set` alias. Recorded `workspaceIO.ts`'s narrower window as a residual rather than fixing it (those files are being edited concurrently for BUG-010) — but WRONGLY recorded the same residual against `workbookTransfer.ts` too, which the round 2 review below found already closed | 4 new specs + 2 existing specs strengthened (65 passing, was 61), every new/strengthened assertion sabotage-verified byte-identical after restore; `tsc -b --force`/`eslint --max-warnings=0`/scoped vitest/`npm run build` all clean; `uv run pytest -q tests/test_repo_integrity.py` 12 passed; eager bundle reported as +15 B against an orphaned parent SHA — round 2 re-measured against the real parent (`762e00c1`) and found +4 B |
| 2026-09-13 | Claude | Adversarial review round on the BUG-010 fix (commit `762e00c1`): closed the one real coverage gap — File ▸ Open / Open without layout (`lib/openWorkspaceReplace.ts`'s `replaceWorkspace`/`replaceWorkspaceSafely`) never called `notifyMigrationWarnings`, so it was the one load path with a status-line fold but no toast, contradicting the entry's own "shows both" claim. Also: gave the helper a longer, non-clobberable TTL (`TOAST_ACTION_TTL`) since it is the ONLY surface on two sites; added direct unit tests for the helper's "one toast, never one per warning"/"(+N more)" rules; replaced `duplicateWorkbook`'s un-failable "pinned by its own test" assertion with a structural one against a live-state round trip; corrected three stale design sentences, four off-by-one file:line citations, and one non-existent symbol name (`parseWorkbookPackage` -> `parseTransferPackage`) in the plan entry; removed a stray doubled blank line before `## New issue template` | 3 new specs (`lib/openWorkspaceReplace.test.ts` x3) + 4 new specs (`store/toasts.test.ts` x4) + 1 test strengthened (`store/workbookTransfer.test.ts`), every one sabotage-verified, source restored byte-identical; `tsc -b --force`/`eslint --max-warnings=0`/full vitest (636 files, 10422 passed + 2 expected-fail, 0 FAIL)/`npm run build` all clean; `uv run pytest -q tests/test_repo_integrity.py` 12 passed; eager bundle +69 B (916,384 B at the `a99ebb6d` parent -> 916,453 B here), 3,947 B under the unmoved 920,400 B budget |
| 2026-09-13 | Claude | Second adversarial review round on the BUG-011 fix: closed a regression the FIRST review round introduced (`startInFlight` had no escape hatch — a `fetchBookData` that never settles pinned Start pack rejected forever, recoverable neither by Cancel nor Reset), finished finding #5 (the refusal's reason now comes from the SAME `lastBookError` lookup as the name it's paired with, not the raw thrown error, so a stale reason can no longer be quoted against the wrong book), and closed nit N1 for real (a real terminal status on both the preview-ready and pack-completed paths, not another in-flight claim). Corrected the FALSE "still open on `workbookTransfer.ts` too" residual (already closed there via `buildTransferPackage`'s own re-check) in three places, and recounted every stale file:line citation this entry carried, several created by the first review round's own edits | 5 new specs (packProject.test.ts 70 passing, was 65), every new assertion sabotage-verified byte-identical after restore (see the commit body's table); `tsc -b --force`/`eslint --max-warnings=0` clean; full `npx vitest run` 636 files / 10,433 passed + 2 expected fail, 0 `FAIL`; `npm run build` clean, eager bundle 916,384 B (real parent `a99ebb6d`) -> 916,408 B here, +24 B, 3,992 B under budget; `uv run pytest -q tests/test_repo_integrity.py` 12 passed |
| 2026-09-13 | Claude | Third adversarial review round on the BUG-011 fix: closed a NEW hole round 2's own fix introduced (`startInFlight` was cleared by an unconditional `finally`, so a late-settling abandoned attempt could clear a flag a NEWER attempt owned — closed with an attempt-scoped `startEpoch` token), and widened round 2's `notePackOutcome` terminal-status fix from two named paths (`awaiting_confirmation`, `completed`) to EVERY `failed`/`cancelled` transition in `packProjectRun.ts` via two choke-point helpers, so the entry's own "closed" claim is now actually true rather than narrowed. Corrected a FIFTH recurrence of the wrong-parent-SHA mistake (genuine rebase drift this time — round 2 measured against an ancestor four commits back, not its real `HEAD~1`) and an off-by-one spec-range citation (`:734-902` -> `:734-903`); fixed a stale cross-reference nit, a `truncateReason` docstring missing its third consumer, and pinned the "N dataset(s)" count in two existing specs that previously passed against a manifest whose count was always 0 | 4 new specs (1 attempt-scoping probe for finding #1, 3 terminal-status specs for finding #2 — poll-driven `failed`, poll-driven `cancelled`, and `cancelled`'s own pre-packing branch), every new assertion sabotage-verified byte-identical after restore; `tsc -b --force`/`eslint --max-warnings=0` clean; scoped vitest (`src/store` + `workspaceSerialize.test.ts` + `architecture.test.ts`) 1754 passed, 0 `FAIL` (full suite not re-run this round — machine contended; last verified full-suite count is the reviewer's own 636 files / 10,444 passed + 2 expected fail at `1aa8d4bd`); `npm run build` clean after `rm -rf node_modules/.vite`, eager bundle 916,466 B at the real parent `26869ddb` -> 916,466 B here, +0 B (neither touched file is eager: `store/packProject.ts` is reached only through the lazy `PackProjectPanel` chunk, and the `packProjectRun.ts`/`packProjectContent.ts` chunk was already lazy); `uv run pytest -q tests/test_repo_integrity.py` 12 passed |
| 2026-09-13 | Claude | Closed BUG-011's last recorded residual: `store/workspaceIO.ts`'s `prepareWorkspaceState` (the shared preface for Save and Save As) now re-checks `pending` on the store it re-reads after `resolvePendingDatasets()`, mirroring `packProjectContent.ts`'s own finding #2 fix, and refuses the save by name rather than serializing a book that turns pending during that await. `lib/workspaceSerialize.ts`'s `pending` comment updated to say the guarantee now holds on every explicit export path (Save, Save As, workbook transfer, Pack Project) | 1 new spec (`workspaceIO.test.ts`), sabotage-verified (removing the re-check fails exactly this spec, 41 others in the file untouched), source restored byte-identical; `tsc -b --force`/`eslint --max-warnings=0` clean; scoped vitest (`workspaceIO.test.ts` + `src/store` + `architecture.test.ts`; the row first cited a `workspaceSerialize.test.ts` that does not exist) 1755 passed, 0 `FAIL`; `npm run build` clean after `rm -rf node_modules/.vite`, eager bundle 916,466 B at the real parent `dafaa333` (the agent cited `2920e34a`, an ancestor with the identical tree) -> 916,645 B here, +179 B, 3,755 B under the unmoved 920,400 B budget; `uv run pytest -q tests/test_repo_integrity.py` 12 passed |
| 2026-09-14 | Claude (agent) | Filed BUG-012..BUG-015, one per divergence documented as an `it.fails` by the P4.2 canonical regression matrix (commit `1593cdee`, `frontend/src/lib/regressionMatrix.test.ts`): D1 a saved x-axis break reaches export/reopen but never renders on screen after reopen (P2); D2 a waterfall view's offset never reaches the export wire (P2); D3 a legend rename loses its unit on screen but keeps it on export (P3); D4 hiding a series shifts later series' export palette colour but not the canvas' (P2). Each entry cites the underlying code by file:line (re-verified against the code, not copied from the test's own comments) and names its reproducing `it.fails` test; none is fixed here — plans-only, tests-only slice, no source touched | Design-time findings, code-read and file:line-cited; reproducing tests are the pre-existing `it.fails` block in `regressionMatrix.test.ts` (not new); `uv run pytest -q tests/test_repo_integrity.py` run to confirm the plan edit alone does not break repository-integrity checks |
| 2026-09-14 | Claude (agent) | Filed BUG-016 (P2): a grouped figure's per-series styling reaches the canvas — `plotGroupSplit.ts`'s channel map gives every level its source channel's style and `buildOpts` applies it — but `routes/export_figures.py`'s `group_col` branch (`:81-85` documents the choice, `:236-238` returns `_ResolvedFigure(..., None, ...)`) drops `series_styles` outright, so the exported curves are solid, default-width and default-coloured. Found by the 2026-09-14 adversarial review round of the P4.2 regression matrix, which showed the matrix's own GROUP style comparison was reading a wire field the renderer never consults. Same round: renamed BUG-012..BUG-015's reproducing tests (the five bare `it.fails` pins became explicit `DIVERGENCE (BUG-01x)` tests asserting BOTH concrete values and their difference) and updated each entry's fix checklist to say the fix INVERTS the assertion rather than flipping an `it.fails`. Not fixed here — tests/fixtures/plans only, no product code touched | Design-time finding, code-read and file:line-cited, and measured on both paths (canvas: three levels at `dash: [8, 4]`, `width: 2`; resolver: `styles=None` under `group_col`). Reproducing test: `regressionMatrix.test.ts`'s `DIVERGENCE (BUG-016)` (new this round). `uv run pytest -q tests/test_repo_integrity.py`; `npx tsc -b --force`; `npx eslint src --max-warnings=0`; `npx vitest run src/lib/regressionMatrix.test.ts src/lib/figureSpec.a8.test.ts src/architecture.test.ts` |
| 2026-09-15 | Claude (agent) | Filed UX-003 (P3) from the adversarial review of `b749f804` (the four-lazy-seam bundle diet): that commit claimed "chunk-load failures are reported, never silent" and "a failed load is never cached, so the next gesture retries" without qualification, but neither holds for a `lazy()`-shaped seam — measured 2026-09-15, `frontend/src` has **0** files matching `componentDidCatch\|getDerivedStateFromError\|ErrorBoundary` against **17** `= lazy(` sites in nine modules, so a failed chunk unmounts the React root with no toast, no status and no console error. Narrowed the claim in `PRIMARY_SOFTWARE_AUDIT_PLAN.md` P4.1 and `BUNDLE_HEADROOM.md` slice 2 rather than adding a boundary, which is its own design decision. Same round: `lib/clipboard.ts` gained `copyTextAsync` so workbook Copy starts its clipboard write inside the click's own task (the chunk `await` was spending the user activation), and every `runLazy(...).then(f).catch(...)` became the two-argument `.then(f, onLoadFailure)` so a loaded handler's throw is no longer swallowed with the load's | Design-time finding for UX-003, code-read and measured by grep; the two code fixes ship with it and are sabotage-verified. `uv run pytest -q tests/test_repo_integrity.py`; `npx tsc -b --force`; `npx eslint src --max-warnings=0`; scoped vitest; `node scripts/check-bundle-size.mjs` |
| 2026-09-15 | Claude (agent) | Filed BUG-017 (P1): a dataset with a NaN or ±Infinity cell cannot be reopened after Save — `workspaceSerialize.ts:198`'s `data: d.data` has no NaN/±Infinity replacer, `JSON.stringify` turns them into `null`, and `workspaceDatasetParse.ts:38-40`'s `isNumberArray` rejects `null`, so `parseWorkspaceDataset` throws and takes the WHOLE workspace load down with it (not just the one dataset); `cellEdit.ts:129-131`'s `insertRows` mints `Number.NaN` for every blank inserted row, so it is reachable by a plain, common edit. `-0` separately round-trips silently to `0` (fail-safe only where a peak-table fingerprint is watching it). Found closing the round-3 review of the P2.1 peak-table digest (`xrd_review3.md` NIT 4) as a pre-existing bug outside that commit's diff; not fixed here — plans-only. Verified by a probe against the real `serializeWorkspace`/`parseWorkspace` before filing (run in a scratch, uncommitted `*.test.ts`, then removed) | Probe result: NaN case throws exactly `dataset 0 ("scan.dat") has an invalid data structure`; `-0` case reads back as `0` (`Object.is` false). `uv run pytest -q tests/test_repo_integrity.py` run to confirm the plan/bugs-doc edit alone does not break repository-integrity checks; no product code touched, no regression test committed yet (see the entry's Tests and acceptance) |
| 2026-09-16 | Claude (agent) | **BUG-017 fixed** (P1, data loss): a dataset holding a `NaN`, `±Infinity` or `-0` cell now survives every JSON boundary the app puts it through. New `frontend/src/lib/nonFiniteCells.ts` owns ONE encoder/decoder pair — a value `JSON.stringify` cannot represent is written as the string `String(value)` gives for it (`"NaN"`, `"Infinity"`, `"-Infinity"`, `"-0"`) and read straight back — applied symmetrically by `lib/workspaceSerialize.ts` (`data` and `raw`) and `lib/workspaceDatasetParse.ts` (`isWireCellArray` + `decodeDataStruct` before `sanitizeDataStruct`). Its own module so neither of those files (282/264 lines) is bulked toward the 500-line ceiling. The same hole existed separately in `lib/workbookTransfer.ts`'s `buildTransferPackage` (its own `JSON.stringify(pkg)`, re-parsed through `parseWorkspace`, so workbook Copy/Paste and Duplicate refused the whole workbook) and is fixed with the same helper; `lib/autosave.ts` and `store/packProjectContent.ts` share `serializeWorkspace` and are covered by the one change. NO schema bump and NO output change for ordinary data: the encoders return their INPUT object when nothing needs a sentinel, so the graph `JSON.stringify` walks is literally the pre-fix one. Two rulings recorded in the code and the entry: a pre-fix `null` cell stays a REJECTION (it meant NaN, +Infinity OR -Infinity — reading it as NaN would fabricate a value the file does not contain), and a malformed entry still refuses the WHOLE workspace rather than skipping one dataset with a warning (a skipped dataset is invisible and the next Save would delete it permanently; refusing leaves the file intact — and the throw is now unreachable for any file the app itself wrote). One residual recorded, not fixed: `lib/figureDocument.ts:442`'s frozen figure snapshot never throws but is lossy for `±Infinity` (both become `NaN`) and `-0` | 17 new specs (`frontend/src/lib/nonFiniteCells.test.ts`), the NaN minted through the app's own `insertRows`; every one sabotage-verified across 7 sabotages (encoder NaN/±Inf branches → 9 fail; encoder `-0` branch → 5; decoder → 8; cell check reverted to number-only → 10; byte-identity by-reference return → 1; `workbookTransfer` call site → 1; cell check widened to accept `null` → 2), source restored byte-identical. `npx tsc -b --force` exit 0; `npx eslint src --max-warnings=0` exit 0; `npx vitest run src/lib src/store src/architecture.test.ts` 358 files / 7,076 tests, 7,075 passed — the single failure, `freezeRegressionMatrixCheck.test.ts`, is an unrelated 30 s timeout under full-scope parallelism (it spawns a NESTED vitest run) and passes in 19.6 s alone on the same tree. `npm run build` after `rm -rf node_modules/.vite`: eager bundle 910,971 B at the real parent `56bb3599` → 911,835 B here, **+864 B**, 8,565 B under the unmoved 920,400 B budget. `uv run pytest -q tests/test_repo_integrity.py` 12 passed |
