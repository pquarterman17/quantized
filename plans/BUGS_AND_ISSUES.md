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
**State:** Open  
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

- [ ] Inventory every row/card type that can appear beneath an imported Origin folder and workbook.
- [ ] Document what each existing icon and badge means and which actions are duplicated elsewhere.
- [ ] Determine why the reported worksheets render as large cards while Graph2/Graph8/Graph9 render as compact rows.
- [ ] Check whether the current Tree/Tiles/Details preference already provides a compact alternative for these exact nodes.
- [ ] Reconcile this item against unfinished work in `LIBRARY_WORKBOOK_UX_PLAN.md`; do not create a second competing hierarchy model.
- [ ] Test hierarchy comprehension with a project containing several books, sheets, and saved graphs with similar names.

### Interaction checklist

- [ ] Make the node type explicit: Folder, Workbook, Worksheet/Data, or Graph/Figure.
- [ ] Use compact worksheet rows by default in Tree view.
- [ ] Allow an optional inline thumbnail expansion without changing selection or opening a plot.
- [ ] Keep richer thumbnails in Tiles view.
- [ ] Show the complete name through resizing and a short hover tooltip when truncation is unavoidable.
- [ ] Give icon-only actions one-sentence tooltips and accessible names.
- [ ] Make the primary row click behavior consistent and discoverable.
- [ ] Put secondary actions in a consistent right-click/overflow menu; avoid a permanent strip of unexplained icons.
- [ ] Clearly distinguish selection from the item currently open in a plot or worksheet.
- [ ] Preserve keyboard navigation, multiselect, drag/drop, and context-menu behavior.
- [ ] Ensure large projects remain performant when thumbnails are collapsed.
- [ ] Do not lose Origin book/sheet provenance or saved-graph relationships when simplifying the presentation.

### Suggested compact row contents

- Disclosure arrow where the node has children
- Type icon plus plain-language tooltip
- Fullest practical worksheet/graph name
- Concise secondary text such as `322 rows · 3 columns`
- Small state badges only when meaningful, for example `Origin` or `missing source`
- One visually clear overflow/actions button
- Optional thumbnail disclosure, not an always-expanded card

### Acceptance criteria

- [ ] A new user can identify folders, workbooks, worksheets, and saved graphs without trial-and-error clicking.
- [ ] At least six worksheet rows are comfortably visible in a typical-height Library without scrolling past large previews.
- [ ] A user can reveal a plot thumbnail when desired without opening or replacing the active plot.
- [ ] Names and action meanings are recoverable even when the Library is narrow.
- [ ] Tree, Tiles, and Details views retain consistent selection and activation behavior.
- [ ] The reported Origin project remains navigable with no missing or duplicated nodes.
- [ ] Owner verifies the revised workflow on the reported project.

### Completion record

- PR/commit: —
- Automated tests: —
- Agent verification: —
- Owner verification: —
- Notes: —

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
