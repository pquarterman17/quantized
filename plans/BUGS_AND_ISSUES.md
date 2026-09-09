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
- [ ] Ensure bound error columns do not appear as independent curves or ordinary legend entries by default.
- [x] Preserve all imported numeric columns in the worksheet; do not alter raw values.
- [ ] Keep every role overridable through the import/error-column UI.
- [ ] Handle files that omit uncertainty, omit resolution, or contain additional value columns without shifting indices incorrectly.
- [ ] Ensure reimport, workspace save/reopen, duplication, and plot-window rebinding preserve the intended roles.
- [ ] Verify that user-customized channel visibility is not overwritten after the initial default is established.

### Automated-test checklist

- [x] Backend parser test asserts the semantic hints/roles emitted for `tests/fixtures/ncnr_j395.refl`.
- [x] Backend tests cover missing and reordered optional columns if the format permits them.
- [x] Frontend import test asserts the canonical Y- and X-error bindings stored on the dataset.
- [ ] Default-channel test asserts only the measured series is selected initially.
- [ ] Rendering/payload test asserts uncertainty and resolution are absent as standalone series.
- [ ] Overlay test asserts Y uncertainty and X resolution produce vertical and horizontal spans respectively.
- [ ] Log-axis regression test confirms valid uncertainty rendering without changing the underlying data.
- [ ] Relevant backend, frontend, type-check, and production-build gates pass.

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
  X error at all; `store/importDatasets.ts::parserErrorRoles` is that missing
  reader. `io/ncnr.py`'s `import_ncnr_dat` has the same latent problem for its
  own `dQ` column and is deliberately NOT changed here — out of scope for this
  item, and it needs its own fixture evidence.

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
