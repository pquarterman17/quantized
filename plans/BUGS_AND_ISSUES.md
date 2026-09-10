# Quantized living bugs and usability issues

**Status:** Active working checklist  
**Created:** 2026-09-08  
**Updated:** 2026-09-09  
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
| BUG-001 | P0 | NCNR `.refl` import/plot | Uncertainty and resolution are plotted as ordinary Y curves | Unassigned | Owner screenshot, 2026-09-08 |
| UX-001 | P1 | Origin project Library | Large worksheet cards are difficult to interpret and consume too much space | Unassigned | Owner screenshot, 2026-09-08 |
| BUG-002 | P2 | Desktop bridge write consent | A hard-linked alias of a declared raw source defeats the never-overwrite-your-own-source check | Unassigned | Reproduced by strict `xfail`, 2026-09-09 |
| UX-002 | P3 | Workbook copy/paste | Cross-workbook lineage (`versionOf`, external `derivedFrom`) is dropped silently — the count is computed but never shown | Unassigned | Found in review, pinned by test, 2026-09-09 |
| BUG-003 | P2 | Data Filter workbench | A filter predicate survives a column's type change with a stale `kind`, applied everywhere but invisible/uneditable in the panel that wrote it | Unassigned | Design-time finding, sabotage-verified, 2026-09-09 |
| BUG-004 | P3 | Stat Stage workbench | A picked "group by" column survives a `channelTypes` override that de-categorizes it, stranding a stale index the picker no longer offers (facet is deliberately NOT affected — see the entry) | Unassigned | Design-time finding, fixed + sabotage-verified, 2026-09-09 |
| BUG-005 | P2 | Corrections / Resample | A categorical channel is transformed like numeric data — its level codes become fractional and its level table is (correctly) discarded, so the column silently degrades to meaningless numbers | Unassigned | Found in the Group J propagation audit, strip pinned by test, 2026-09-09 |
| BUG-006 | P2 | Row slices, row edits, merge, corrections, pending previews | A row slice carried the `text_columns` sidecar through UNSLICED, so an extracted subset's text cells no longer lined up with its rows | Claude | **9 of 10 code sites fixed; site 9 took FOUR attempts** (2026-09-10). `lib/barlayout.ts` still open (see entry). Declared closed three times before it was, and FOUR review rounds each found defects in the previous round's fix — twice HIGH every round, with a fully green suite every time. The suite has caught essentially none of it; adversarial review, per-branch sabotage and measuring claims have caught all of it. Treat any "closed" here as unproven until a shape-search and a sabotage back it |
| BUG-007 | P2 | Test hygiene | A `void`-ed async store action in a test made its assertion vacuous AND leaked `set()` into a later test — misdiagnosed by me as a module-init-order hazard | Claude | **FIXED** 2026-09-09; reduction collected, pin lowered |
| BUG-008 | P2 | Split Dataset | An explicit `cat_levels` level table was invisible to Split, so a few-row categorical column MERGED all its samples into one child dataset (and, at row counts where the shape heuristic agreed, named the children after raw float codes) | Claude | **FIXED** 2026-09-10 after ONE review round that found 2 HIGH — the first cut fixed only the `cat_levels` shape and its chokepoint ratchet was evadable by an aliased import. 22 behaviour tests + a 2-test ratchet, every fix sabotage-verified |
| BUG-009 | P2 | Pending-dataset contract | Five ad-hoc guards rather than one contract; two data-CORRUPTING sites found in review round 5 and now guarded, but "refuse" should be "resolve-then-apply" and a failed fetch is a permanent lockout | Unassigned | Found across five review rounds, 2026-09-10; corrupting sites fixed + ratcheted, structural fix open |
| FEATURE-001 | P3 | Faceted plots | Per-series styling (dash/width/colour/marker) is ignored by faceted plots on BOTH screen and export; panels can also resolve different channel sets, so one style list cannot serve the grid | Unassigned | Measured 2026-09-09; a fix was built, reviewed, and reverted — see the entry |

---

## BUG-001 — NCNR `.refl` uncertainty roles are plotted incorrectly

**Priority:** P0 — scientifically misleading default visualization  
**State:** Open  
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
- [ ] Keep every role overridable through the import/error-column UI. (Generic coverage pre-exists in `ErrorRolesCard.test.tsx`; not re-verified against an NCNR `.refl` specifically in this pass.)
- [x] Handle files that omit uncertainty, omit resolution, or contain additional value columns without shifting indices incorrectly.
- [x] Ensure workspace save/reopen and duplication preserve the intended roles. Reimport and plot-window rebinding still NOT independently verified — see Completion record.
- [ ] Verify that user-customized channel visibility is not overwritten after the initial default is established. (Not exercised this pass.)

### Automated-test checklist

- [x] Backend parser test asserts the semantic hints/roles emitted for `tests/fixtures/ncnr_j395.refl`.
- [x] Backend tests cover missing and reordered optional columns if the format permits them.
- [x] Frontend import test asserts the canonical Y- and X-error bindings stored on the dataset.
- [x] Default-channel test asserts only the measured series is selected initially.
- [x] Rendering/payload test asserts uncertainty and resolution are absent as standalone series.
- [x] Overlay test asserts Y uncertainty and X resolution produce vertical and horizontal spans respectively.
- [x] Log-axis regression test confirms valid uncertainty rendering without changing the underlying data.
- [ ] Relevant backend, frontend, type-check, and production-build gates pass. (Targeted gates pass -- see Completion record; full frontend suite/`npm run build` intentionally deferred to the requester.)

### Acceptance criteria

- [ ] A freshly imported recognized `.refl` file opens with only its measured reflectivity/intensity curve selected.
- [ ] Vertical bars represent the intensity uncertainty.
- [ ] Horizontal bars represent Q resolution when provided.
- [ ] Neither uncertainty column appears as a normal legend series unless the user explicitly chooses to plot it.
- [ ] The worksheet still exposes every original column and value.
- [ ] Ambiguous/unrecognized layouts are not silently given confident but unsupported bindings.
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
- Agent verification: partial — the parser emits the roles and the store now
  stores them. NOT yet verified: that the rendered plot actually draws
  horizontal whiskers from an X binding on this dataset, reimport/save/reopen
  round-tripping of the declared roles, or the "user-customized visibility is
  not overwritten" criterion. Those remain open below.
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
    exercised this pass; still open.
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
- [ ] Document what each existing icon and badge means and which actions are duplicated elsewhere. — done only for the worksheet row's own icons (relocated, not re-audited tree-wide); a full icon/badge audit across every row kind is still open.
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
- [ ] Clearly distinguish selection from the item currently open in a plot or worksheet. — pre-existing `.active`/`.selected` styling carried over as-is; not newly addressed by this pass.
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
- [ ] At least six worksheet rows are comfortably visible in a typical-height Library without scrolling past large previews. — very likely true (a compact row is one ~20-24px line vs. the prior ~90-110px card) but not visually confirmed against a rendered viewport — no screenshot taken this pass.
- [x] A user can reveal a plot thumbnail when desired without opening or replacing the active plot. — test-verified: `selectedIds`/`activeId` unchanged after toggling the preview.
- [ ] Names and action meanings are recoverable even when the Library is narrow. — the tooltip/ellipsis mechanism is preserved, not re-tested at a narrow panel width.
- [x] Tree, Tiles, and Details views retain consistent selection and activation behavior. — Tiles/Details untouched; Tree's selection/activation logic is unchanged (only the worksheet row's markup changed), and `LibraryTree.test.tsx` passes unmodified.
- [ ] The reported Origin project remains navigable with no missing or duplicated nodes. — not tested against the owner's actual reported project (not available here).
- [ ] Owner verifies the revised workflow on the reported project. — pending; required before this item can be marked complete.

### Completion record

- PR/commit: committed locally in this worktree (not pushed, no PR opened per task instructions).
- Automated tests: `frontend/src/components/Library/DatasetRowCompact.test.tsx` (new, 7 cases — compact-row shape, glyph, meta text, opt-in preview mount/unmount, no-selection-change, localStorage persistence, flat-mode regression guard) and `frontend/src/lib/libraryPreviewPrefs.test.ts` (new, 3 cases) all pass and were individually sabotage-verified (broke the code path each covers, confirmed the test failed, restored). Full existing suite green (see Agent verification) — `DatasetRow.test.tsx` and `LibraryTree.test.tsx` pass with ZERO changes to their assertions.
- Agent verification: worksheet Tree rows are now a single compact line (glyph + name + `N pts · Mch` + opt-in preview toggle), matching `FigureRow`'s existing compact shape; the sparkline no longer mounts unconditionally; expanding/collapsing it never touches `selectedIds`/`activeId`; all pre-existing keyboard/drag/context-menu/roving-focus behavior is unchanged (same tests, same assertions, all passing). `tsc --noEmit`, `eslint src`, and the full `vitest run` suite are clean; `npm run build` + the bundle-size ratchet are clean (see gate numbers in the implementation session's own report).
- Owner verification: pending — required for this item (visual review of the reported Origin project, real-viewport row-count check, narrow-panel truncation check).
- Notes: scope was deliberately narrow — only `DatasetRow.tsx`'s `treeMode` (Tree) branch changed; the flat/search-list and Smart Folders card, Tiles, Details, and `LIBRARY_WORKBOOK_UX_PLAN.md`'s hierarchy model are all untouched. A full tree-wide icon/badge audit and the "distinguish selection from the item open in a plot" item remain open — out of this pass's scope, not forgotten. The eager-bundle ratchet (`frontend/scripts/check-bundle-size.mjs`) needed a raise — 910,748 → 912,503 bytes (+1,755, budget raised to measured + 1,024 = 913,527) — after a measured `React.lazy()` split of the preview toggle came back WORSE (fragmented Sparkline's own shared chunks) and was reverted, and deduplicating the two row layouts' shared JSX/logic recovered 415 of the original 1,146-byte overage; the dated history entry in that file has the full measurement trail.

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
- [ ] Agent verifies acceptance criteria — the fix and its regression tests
  are agent-verified; a manual click-through was not performed this slice.
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

#### Why the current drop is CONSERVATIVE — not simply correct

Both functions discard `cat_levels`. That is now **explicit and documented in
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
- [ ] Stop dropping the table on paths that do not change the codes (an
  identity/x-only correction, a resample onto a coincident grid). Cheaper than
  the channel mask and independently valuable; needs a "did the codes survive"
  predicate rather than a per-transform allowlist, so that a new transform is
  conservative by default.
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
- [ ] Reproduced by a test — deliberately not added yet: a passing test would
  lock in the wrong behavior, and a failing one belongs with the fix.
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
- [ ] ~~Every caller covered~~ — SIX of eight, see "STILL OPEN" below. This box
  was ticked twice on an enumeration that was never verified against a search;
  the two misses were found by review, not by the suite. The fix is in one
  shared helper, and
  `rowstate`/`facet`/`datasetsplit`/`selectionInvariant` suites all pass. Two
  pre-existing assertions changed from `toBe` to `toEqual` on `metadata`: it is
  no longer carried by REFERENCE (its sidecars must be sliced), and those tests
  had been pinning that aliasing rather than any contract. Content is unchanged
  for a dataset carrying no row-indexed sidecar.
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
- [x] **Site 10, CLOSED 2026-09-10 — and NOT where this entry expected.** The
  diagnosis was right: `barlayout.ts`'s `textLabelsFor` indexes a row-indexed
  sidecar against `columnOf(data, channel)` and takes a bare `DataStruct`, so it
  structurally cannot apply site 9's condition. Measured wrong output, red-first:
  a 6-row book with levels `[0,0,1,1,2,2]` and text
  `["A0","A0","B1","B1","C2","C2"]`, sampled to rows `[1,2,4,5]`, returned
  `["A0","A0","B1"]` for levels `[0,1,2]` — every level covered and each
  internally consistent, so its own agreement check PASSED. Confident wrong
  category names on a bar chart, not a safe numeric fallback. (Other
  misalignments do disagree with themselves and fall back, which is why it reads
  as intermittent.)
  **The prescribed fix — thread a "these rows are a sample" flag into the pure
  layer — was built, measured and abandoned.** Making the parameter required
  enumerated 27 errors across 13 files: ~9 pure functions each needing the flag
  plus every transitive caller, and a permanent hazard that any new caller passes
  `false` and silently restores the bug.
  **Fixed at the two PRODUCERS instead, as one invariant: A SAMPLED PREVIEW NEVER
  CARRIES A ROW-INDEXED SIDECAR.** `store/importDatasets.ts` (import) and
  `lib/workspaceDatasetParse.ts` (`.dwk` restore) are the only two places a
  dataset gains `pending`; each now runs the FULL book's metadata through the
  existing `withoutRowSidecars` when `rowsAreSampled(pending)`. Two lines instead
  of twenty signatures, and it protects every consumer that indexes such a
  sidecar rather than only the label path. Nothing is lost: `installBookData`
  restores the full metadata when the fetch lands.
  Only when SAMPLED — a padding-trimmed preview is a genuine PREFIX whose cells
  line up, so its labels are correct and are kept. That is also why a row-count
  proxy cannot stand in for the predicate: a trimmed preview is *also* shorter
  than its sidecar. Both directions are sabotage-pinned (stop stripping; strip
  unconditionally; and a length-proxy variant).
  `catTableLabels` needed no change — `cat_levels` is channel-keyed, not
  row-indexed, so decimation cannot disturb it, and it takes precedence anyway.
  Site 9's `worksheetTextColumns` suppression stays as belt-and-braces.
  `barlayout.test.ts` also pins the pre-fix wrong answer, so a future change that
  lets an unsliced sidecar back through is recognised rather than puzzled over.
  `lib/projectSearchSidecars.ts` reads keys only and is fine.

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

- [ ] **Also booked:** `setDatasetFilter`/`clearDatasetFilter` record NO history,
  while `clearRowExclusions` does. So building a filter and pressing undo restores a
  snapshot from before the filter change and silently discards it. Pre-existing and
  untouched by the guard pass; worth its own fix.

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
- [ ] Distinguish "in flight" from "failed, will never arrive", so the message stops
  promising a retry that cannot succeed.

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
