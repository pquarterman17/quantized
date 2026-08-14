# Library, Workbook, and Quick Plot UX Plan

**Status:** Discovery active; no implementation authorized yet  
**Created:** 2026-08-12  
**Updated:** 2026-08-13 — LQ.1 confirmed as recommended (recorded as L0.14);
plan committed and registered in the plan tree (parent pointer + BACKLOG
dashboard row)  
**Plan author:** ChatGPT-Sol (not Claude)  
**Repository:** `C:\Users\patri\git\quantized`  
**Parent:** `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md`  

> The former OneDrive checkout must not be used. It was removed because sync
> conflicts interfered with Git. This plan and all implementation work belong
> in `C:\Users\patri\git\quantized`.

## Purpose

Make the loaded-file experience suitable for using Quantized as the owner's
default plotting and analysis application. The Library should support both a
visual tile browser and an Origin-like expandable hierarchy without creating
two incompatible organizational systems. It must remain fast for the core
workflow: import an arbitrary scientific file, understand its structure,
produce a correct editable plot, and continue working without code.

This plan is intentionally written before implementation. The owner asked
agents to ask questions rather than guess about workbook semantics or UI
behavior. Confirmed decisions are recorded separately from recommendations and
open questions so a later agent does not accidentally treat a proposal as an
approved requirement.

## Audited baseline (read-only, 2026-08-12)

The current application already provides useful infrastructure:

- `components/Library/Library.tsx` renders an existing folder tree or a flat
  filtered list and owns import drop, search, selection reveal, and Library
  sections.
- `components/Library/useLibraryTree.ts` creates a shared flattened view model
  for folders, datasets, and recovered Origin figures.
- Folder expansion is workspace state, while panel width is a persisted user
  preference.
- Dataset and folder rows already support selection, context menus, drag/drop,
  reordering, and moving between folders.
- The Library is resizable from 160 to 420 px and defaults to 210 px. This is
  appropriate for a tree but too narrow for a useful tile browser unless tile
  mode can temporarily occupy a wider surface.
- Imported Origin projects reconstruct much of
  `project folder -> Origin folder -> workbook -> sheet`, but a workbook is
  not a universal first-class application object. Multi-sheet Origin books use
  a folder as a workbook surrogate; single-sheet books are flattened directly
  into their containing folder.
- Figures, editable figures, pages, reports, Origin fidelity, book families,
  and smart folders are exposed through separate Library sections rather than
  consistently appearing as children of a workbook.

### Consequence

A view-mode control over today's items is a contained frontend change. A true
universal `folder -> workbook -> worksheet/figure/analysis/note` hierarchy is
a larger data-model and workspace-migration effort. Do not disguise the latter
as a CSS-only tree redesign.

## Confirmed owner decisions

- [x] **L0.1 Primary hierarchy:** folder -> workbook -> workbook children.
- [x] **L0.2 Default workbook boundary:** one imported source file becomes one
  workbook. Importing three ordinary CSV files creates three workbooks.
- [x] **L0.3 Multi-sheet source:** all sheets from one source file remain
  children of that file's workbook.
- [x] **L0.4 Future combination:** the import flow may later offer an explicit
  way to combine selected related files into one workbook; this is not the
  default.
- [x] **L0.5 Expand gesture:** the disclosure arrow expands or collapses a
  workbook without opening its content.
- [x] **L0.6 Open gesture:** double-clicking a workbook opens its most recently
  used child. A new workbook opens its first worksheet.
- [x] **L0.7 Quick Plot:** the workbook context menu includes **Quick Plot**.
  It creates a new editable internal plot and must not replace an already
  customized plot.
- [x] **L0.8 Known data only:** Quick Plot is disabled for unknown datasets.
  Quantized must not silently make a plausible but scientifically unsupported
  generic plot.
- [x] **L0.9 Unknown-data escape hatch:** an unknown dataset offers
  **Configure Quick Plot...**, opening a focused Quick Figure Builder.
- [x] **L0.10 Ambiguity:** a compact mapping confirmation appears only when
  Quantized is uncertain. It must show the detected interpretation and offer
  both confirmation and mapping edit.
- [x] **L0.11 Multi-sheet default:** Quick Plot acts on the most recently active
  worksheet, or the first plottable worksheet in a new workbook. It does not
  automatically plot every worksheet.
- [x] **L0.12 Editor continuity:** the Quick Figure Builder is a streamlined
  entry into the same editable-plot system, not a second incompatible figure
  editor.
- [x] **L0.13 Raw-data safety:** creating a figure or saving its mapping does
  not mutate the raw worksheet.
- [x] **L0.14 Template matching (was LQ.1, confirmed 2026-08-13):** Quick Plot
  templates match by recognized data type plus compatible column-schema
  signature, never file extension alone. The normal reusable scope is **this
  data type and schema**; **this workbook only** covers one-off mappings; a
  mismatch disables Quick Plot and offers **Configure Quick Plot...**, never
  a generic fallback plot.

## Template-matching contract (CONFIRMED 2026-08-13 — see L0.14)

Do not match a reusable Quick Plot template by file extension alone. `.dat`,
`.csv`, and `.txt` routinely carry unrelated scientific structures.

Recommended order:

1. An explicit parser/data-type profile establishes that the dataset is known.
2. A column-schema signature verifies compatibility using normalized headers,
   explicit roles, units, grouping, error-role structure, and relevant parser
   metadata.
3. An explicitly saved owner template may add a recognized schema variant.
4. A mismatch disables Quick Plot and offers **Configure Quick Plot...**; it
   never falls through to a generic automatic plot.

Recommended scopes for a saved template:

- **This workbook** for a one-off mapping.
- **This recognized data type and schema** as the normal reusable default.
- A future named template that the owner chooses manually at import or from
  **Quick Plot With...**.

- [x] **OWNER DECISION LQ.1:** CONFIRMED as recommended, 2026-08-13
  (recorded as L0.14 above).

## Required column-role inference

Quick Plot must reason about series groups, not assume one fixed column order.
At minimum, the design must account for:

- [ ] `X, Y, X, Y, X, Y`: independent XY series.
- [ ] `X, Y1, Y2, Y3`: several Y series sharing one X.
- [ ] `X, Y, Yerr`: symmetric Y error.
- [ ] `X, Y, Yerr+, Yerr-`: asymmetric Y error.
- [ ] `X, Xerr, Y, Yerr`: uncertainties on both axes.
- [ ] Repeated combinations of the structures above.
- [ ] Multiple independent X channels in one worksheet.
- [ ] Preserved acquisition order and non-monotonic X data.
- [ ] Explicit column designations override inferred adjacency.
- [ ] Header, unit, parser metadata, and adjacency evidence contribute to a
  confidence result; adjacency alone is insufficient.
- [ ] The user can override every inferred role before creating the figure.

Unknown and ambiguous are different states:

- **Known + high confidence:** Quick Plot may create the editable figure
  immediately.
- **Known + ambiguous mapping:** show the compact confirmation.
- **Unknown data type/schema:** disable Quick Plot and offer configuration.

## Quick Figure Builder concept

The focused window should reuse the canonical plot document and editor logic.
It is a fast mapping and initial-style surface, not an export-only builder.

- [ ] **Left — data roles:** worksheet columns can be assigned by drag/drop or
  menus to X, Y, X error, Y error, label, and grouping roles.
- [ ] **Center — live preview:** every accepted mapping/style change is visible
  before creation; Cancel produces no figure or data change.
- [ ] **Right — concise setup:** detected series, plot type, color preset,
  lines/markers, axes, legend, and error-bar settings.
- [ ] **Ambiguity display:** uncertain assignments are visibly highlighted and
  explained in one sentence.
- [ ] **Actions:** **Create Editable Figure**, **Save Quick Plot Template...**,
  and **Cancel**.
- [ ] **After creation:** open the result as a normal editable internal plot
  with the regular Stage/property/context-menu tools.
- [ ] **No forked state:** saving and reopening must use the same canonical
  editable figure contract as other internal plot creation.

## Tile/tree/details view modes

Concept A is the selected direction: an Origin-like mixed child hierarchy
under each workbook. The application should eventually allow changing the
Library presentation without changing organization or duplicating objects.

- [ ] **L1.1 Shared item identity:** tile, tree, and details renderers consume
  one canonical hierarchy and use the same IDs.
- [ ] **L1.2 View selector:** provide Tiles / Tree / Details controls and
  remember the user's choice in preferences.
- [ ] **L1.3 State continuity:** switching views preserves selection, active
  workbook/child, expansion where applicable, search, and keyboard focus.
- [ ] **L1.4 Interaction parity:** open, Quick Plot, rename, move, reveal,
  context menu, and drag/drop mean the same thing in every view.
- [ ] **L1.5 Wide tile surface:** produce thorough mockups before deciding
  whether tile mode expands the Library, opens a wide Library browser over the
  Stage, or becomes a temporary main-workspace view. Do not squeeze production
  tiles into the default 210 px sidebar.
- [ ] **L1.6 Search results:** decide whether search temporarily uses a flat
  results view while retaining folder/workbook breadcrumbs.
- [ ] **L1.7 Heterogeneous children:** define icons, ordering, and behavior for
  worksheets, editable plots, analyses, notes, pages, and imported/recovered
  figures.

## Proposed implementation sequence (not yet authorized)

Each step should be a reviewable PR with targeted unit tests, typecheck, lint,
production build, and focused interaction coverage where appropriate.

1. [ ] **PR A — canonical hierarchy specification and workspace migration.**
   Introduce a first-class workbook identity without breaking existing `.dwk`
   projects or Origin provenance. Provide deterministic migration for current
   folder/dataset structures.
2. [ ] **PR B — shared Library hierarchy view model.** Extend today's
   `useLibraryTree` boundary to represent workbooks and heterogeneous children
   without importing renderer concerns into the store.
3. [ ] **PR C — Origin-like tree renderer.** Implement the approved disclosure,
   double-click, remembered-child, selection, keyboard, and context-menu
   behavior.
4. [ ] **PR D — view preference and details renderer.** Add persisted view mode
   and prove state continuity between tree and details.
5. [ ] **PR E — tile-browser shell after mockup approval.** Implement the
   approved wide-surface behavior and interaction parity.
6. [ ] **PR F — known-data Quick Plot contract.** Add explicit availability,
   disabled explanations, data-profile/schema matching, and focused tests for
   supported column permutations.
7. [ ] **PR G — Quick Figure Builder mapping slice.** Reuse the canonical
   editable-figure path; ship live preview, mapping, Cancel, and editable
   creation before advanced template management.
8. [ ] **PR H — template persistence and scopes.** Save named mappings/styles
   with explicit scope and safe mismatch behavior.

## Acceptance scenarios

- [ ] Import three CSV files together: one folder may contain three distinct
  workbooks, each retaining its own source provenance.
- [ ] Expand a workbook without changing the current plot.
- [ ] Double-click a new workbook: its first worksheet opens.
- [ ] Return after opening another child: double-click reopens the remembered
  child.
- [ ] Right-click a recognized XYXYXY workbook and Quick Plot: three correctly
  paired editable series are created.
- [ ] Right-click a recognized shared-X worksheet with Y error columns: errors
  attach to the correct series.
- [ ] Right-click an unknown CSV: Quick Plot is disabled with a short reason;
  Configure Quick Plot remains available.
- [ ] Cancel the Quick Figure Builder: no plot, worksheet mutation, or template
  is left behind.
- [ ] Switch Tree -> Tiles -> Details: selection and active content remain
  stable, with no duplicated Library objects.
- [ ] Save/reopen a migrated legacy workspace: workbook membership and source
  provenance remain intact.

## Open questions — ask one at a time

- [x] ~~Confirm the recommended template matching/scoping contract (LQ.1).~~
  CONFIRMED as recommended, 2026-08-13 (see L0.14).
- [ ] Decide the wide tile-browser placement using thorough mockups.
- [ ] Decide the default ordering of heterogeneous workbook children.
- [ ] Decide whether a workbook overview is a distinct view or only the tile
  presentation of its children.
- [ ] Decide how manually combining files into one workbook handles source
  provenance, reimport, and naming.
- [ ] Decide how analysis results attach to a workbook versus a worksheet.
- [ ] Decide whether **Quick Plot With...** ships with the first Quick Plot
  slice or follows template persistence.

## Owner interview pause point

**Paused:** 2026-08-12 — owner ended the session for bedtime. Do not begin
implementation from the recommendations above and do not infer answers to the
remaining UX questions. Resume the interview one question at a time.

**Resumed:** 2026-08-13 — LQ.1 asked first as booked and CONFIRMED as
recommended (now L0.14). Interview continues below.

### Ask this first next session

- [x] ~~**LQ.1:** Should the recommended Quick Plot template contract be
  marked confirmed?~~ CONFIRMED as recommended, 2026-08-13 (see L0.14).

### Ask next

- [ ] Workbook child structure and ordering (needs no prep work), or the
  tile-browser placement question once the thorough mockups L1.5 requires
  exist — producing those mockups is agent prep work, not implementation.

### Continue asking about these areas

- [ ] Tile-browser placement and transition: sidebar expansion, main-workspace
  browser, or another owner-approved interaction; use more thorough mockups.
- [ ] Workbook child structure and ordering: worksheets, editable plots,
  analyses, notes, pages, and recovered/imported figures.
- [ ] Selection, double-click, keyboard navigation, breadcrumbs, search, and
  view-switch continuity across Tiles / Tree / Details.
- [ ] Workbook context-menu contents beyond Quick Plot, including actions that
  apply to one worksheet versus the whole workbook.
- [ ] Quick Figure Builder layout, docking/window behavior, role assignment,
  preview, error handling, and template-saving flow.
- [ ] Recognition confidence and the exact compact confirmation shown for
  ambiguous XY/error/grouping permutations.
- [ ] Combining several source files into one workbook, including naming,
  provenance, reimport, missing files, and later separation.
- [ ] How derived datasets, fits, analyses, and corrected copies attach to a
  workbook without modifying or obscuring raw data.
- [ ] Scale and organization behavior for projects containing many folders,
  workbooks, worksheets, and figures.

## Change log

- **2026-08-12 — ChatGPT-Sol:** Created the plan from the owner interview and
  a read-only audit of the current Library, folder tree, preference storage,
  and Origin-folder reconstruction. Recorded the file-as-workbook rule,
  remembered-child open behavior, known-data-only Quick Plot, ambiguity
  confirmation, multi-sheet default, required column-role permutations, and
  the focused Quick Figure Builder direction. No application code changed.
- **2026-08-12 — ChatGPT-Sol:** Added the owner-interview pause point, the
  exact next question, and a bounded list of Library/workbook UX areas that
  still require owner input. Session intentionally stopped before
  implementation.
- **2026-08-13 — Claude:** Resumed the interview at the booked point: LQ.1
  answered by the owner — template contract CONFIRMED as recommended,
  recorded as L0.14. Committed the plan (it had been left untracked) and
  registered it in the plan tree: parent paragraph in
  `PRIMARY_SOFTWARE_AUDIT_PLAN.md`, plans-dashboard row + owner-actions row
  in `BACKLOG.md`. No implementation authorized yet.
