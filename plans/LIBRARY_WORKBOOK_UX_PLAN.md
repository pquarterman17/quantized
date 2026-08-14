# Library, Workbook, and Quick Plot UX Plan

**Status:** Active — milestone 1 implementation begun (PR A1 launched)
**Created:** 2026-08-12  
**Updated:** 2026-08-14 — owner decisions complete through L0.57 and
spot-verified in the Claude session (L0.2, L0.45, L0.54, L0.57 re-confirmed
directly); technical boundary audit adversarially verified against the code
(all claims exact); PR A1 SHIPPED (`914042e`)
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

This plan was written before implementation. The owner asked agents to ask
questions rather than guess about workbook semantics or consequential UI
behavior. The consequential interview completed on 2026-08-14; confirmed
decisions are now the implementation contract. Routine reversible details
remain agent decisions under L0.41.

### Product design charter

Quantized should combine the strongest everyday workflows from OriginPro and
JMP rather than imitate either application wholesale. Proven, useful features
may be adopted when they fit Quantized's architecture and scientific-safety
rules. Where Origin or JMP creates friction, Quantized should deliberately
improve the workflow rather than preserve the pain point for familiarity.

Agents should make routine, reversible, low-risk UX choices using established
desktop conventions and record them in this plan. Ask the owner only when a
decision is architectural, scientifically ambiguous, destructive, expensive
to reverse, or represents a meaningful conflict between Origin/JMP patterns.
Do not consume the owner's attention confirming every ordinary menu item.

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
- [x] **L0.15 Tile-browser placement (confirmed 2026-08-13):** tile mode uses
  the main Library workspace. It temporarily replaces the Stage content while
  the Library tree remains available for navigation; one clear action returns
  to the unchanged active plot. Do not shrink the plot to accommodate tiles or
  use a covering drawer as the primary interaction.
- [x] **L0.16 Workbook child order (confirmed 2026-08-13):** use a stable,
  predictable order: worksheets first in source order, then editable figures,
  analyses/derived results, and notes. Recovered Origin figures appear with
  editable figures but retain a visible fidelity/status indicator.
- [x] **L0.17 Workbook overview (confirmed 2026-08-13):** the workbook's tile
  presentation is its overview; do not add a second overview screen. A single
  click or **Browse Workbook** opens its children as tiles, while double-click
  retains the remembered-child behavior from L0.6.
- [x] **L0.18 Plot thumbnails (confirmed 2026-08-13):** editable plot tiles
  show a thumbnail of the actual figure, consistent with the current browser
  tiles. Generate the thumbnail from canonical figure state, refresh it after
  a saved figure change, and cache it so browsing does not rerender every plot.
  Recovered/reference-only Origin figures must retain their fidelity indicator
  alongside the image.
- [x] **L0.19 Worksheet previews (confirmed 2026-08-13):** worksheet tiles use
  a compact data preview—not an inferred plot—with the first few useful rows
  and columns, dimensions, and concise column-role indicators. The preview must
  not imply a scientific mapping that the owner has not configured.
- [x] **L0.20 Analysis/result previews (confirmed 2026-08-13):** analysis and
  derived-result tiles show a meaningful preview when the result naturally has
  one, such as a fitted curve or result table, plus the analysis name, source
  worksheet, and status. Results without a natural visual use a concise summary
  rather than a manufactured thumbnail.
- [x] **L0.21 Analysis ownership (confirmed 2026-08-13):** analyses and derived
  results remain direct workbook children so the Library tree stays shallow.
  Each preserves and displays its source worksheet relationship; activating a
  source link selects that worksheet. Multi-source analyses retain links to all
  contributing worksheets.
- [x] **L0.22 Plain-language commands (confirmed 2026-08-13):** use concise,
  familiar menu names. In particular, the visible destructive command is
  **Delete**, not **Move to Trash**. The implementation may still place the
  workbook in recoverable Trash and apply the project's existing safeguards;
  safety does not require awkward command wording.
- [x] **L0.23 Workbook copy/paste (confirmed 2026-08-13):** provide **Copy**,
  **Paste**, and **Duplicate** for whole workbooks. Copy/paste must work between
  two simultaneously open Quantized instances/projects, not merely within one
  in-memory store. Paste is offered on a destination folder and on Library
  background/root. Duplicate is the fast same-project operation.
- [x] **L0.24 Independent paste semantics (confirmed 2026-08-13):** pasting
  creates a self-contained independent workbook, including worksheets,
  editable figures, analyses and derived results, notes, metadata,
  workbook-scoped templates, and rewritten internal relationships. Preserve
  the original file path as provenance. If it is unavailable, **Reimport**
  reports **Source unavailable** and offers **Relink Source...** rather than
  failing silently or depending on the source project.
- [x] **L0.25 Cross-view interaction continuity (confirmed 2026-08-13):**
  switching among Tree, Tiles, and Details preserves the selected workbook or
  child, active plot, search query, and navigable/scroll target. Single-click
  selects; double-click opens; Enter opens; arrow keys navigate; Escape leaves
  the Library workspace and returns to the unchanged active plot.
- [x] **L0.26 Search results (confirmed 2026-08-13):** search spans the project
  and presents a flat Details-style result list. Every match shows its full
  `Folder / Workbook / Child` breadcrumb. Opening a result uses its normal
  behavior; **Show in Library** clears the search and reveals the item in its
  hierarchy.
- [x] **L0.27 Quick Figure Builder placement (confirmed 2026-08-13):** open the
  builder as a main-workspace surface, temporarily replacing Library tiles,
  rather than in a cramped modal. It provides room for column-role mapping,
  live preview, and initial settings. **Create Figure**, **Cancel**, and Escape
  return appropriately without disturbing the previously active plot.
- [x] **L0.28 Progressive disclosure (confirmed 2026-08-13):** the builder's
  initial surface shows column roles, detected series, plot type, style preset,
  axis scales, legend, and error-bar interpretation. Less-common controls live
  under **More Settings** because the created figure remains fully editable in
  the canonical editor.
- [x] **L0.29 Column-role assignment (confirmed 2026-08-13):** support both
  drag-and-drop into X, Y, X/Y error, label, and grouping zones and an explicit
  click/right-click **Assign Role** menu. Both paths modify the same mapping;
  the menu provides precision and keyboard access for dense worksheets.
- [x] **L0.30 Ambiguous-mapping prompt (confirmed 2026-08-13):** show a compact
  inline, non-modal sentence describing the interpretation and uncertainty,
  for example, “Detected 3 XY series; column F may be symmetric Y error.”
  Highlight the uncertain column and offer **Use Mapping** and **Edit Mapping**.
  High-confidence mappings skip the prompt entirely.
- [x] **L0.31 Explicit template saving (confirmed 2026-08-13):** **Create
  Figure** never saves, overwrites, or changes a Quick Plot template
  automatically. A separate **Save as Quick Plot Template...** action requests
  a name and scope, defaulting to the confirmed **data type and schema** scope.
- [x] **L0.32 Embedded data snapshots (confirmed 2026-08-13):** importing a
  normal dataset embeds a snapshot in the Quantized project while retaining
  its source link and provenance. The original file is never modified. Record
  source path, import time, observed modification time, and a checksum where
  practical. Source changes produce a quiet status indicator; Quantized never
  refreshes the project copy automatically. **Reimport** is an explicit user
  action. Large 2D payloads may later need a managed external-storage option,
  but that exception must not weaken the safe ordinary-data default.
- [x] **L0.33 Transactional multi-source reimport (confirmed 2026-08-13):**
  **Reimport All** validates and stages every selected source before changing
  the combined workbook. If a required source fails, leave the workbook
  unchanged and report each problem. **Reimport Available Sources** is a
  separate explicit action for an intentional partial update.
- [x] **L0.34 Combined-workbook naming (confirmed 2026-08-13):** prompt for the
  workbook name and suggest a shared filename prefix when one is clear. Each
  imported worksheet retains its source filename as its default display name.
  Resolve duplicate worksheet names with visible collision suffixes; never
  overwrite an existing child silently.
- [x] **L0.35 Workbook ordering (confirmed 2026-08-13):** preserve manual order
  within folders and append new imports at the end. Offer temporary view-only
  sorts by Name, Import Time, Modified Time, and Data Type. Returning to
  **Manual Order** restores the saved arrangement; viewing a sort never rewrites
  it.
- [x] **L0.36 Workbook context menu (reconciled 2026-08-13):** use concise
  commands in sensible groups: **Open**, **Browse**, **Quick Plot** or
  **Configure Quick Plot**, **Quick Plot With...**, **Reimport**, **Copy**,
  **Paste** where the target permits it, **Duplicate**, **Rename**, **Move**,
  **Reveal Source**, **Properties**, and **Delete**. Keep destructive and
  uncommon actions separated near the bottom; disable unavailable commands
  with a short reason rather than removing them unpredictably.
- [x] **L0.37 Quick Plot With sequencing (confirmed 2026-08-13):** ship
  **Quick Plot With...** with named-template persistence, not in the initial
  Quick Plot slice. Before reusable templates exist the chooser has no useful
  content; afterward it is the explicit override for the normal matched
  default.
- [x] **L0.38 Worksheet context menu (confirmed 2026-08-13):** use **Open**,
  **Quick Plot** or **Configure Quick Plot**, **Add to Figure...**, **Copy**,
  **Duplicate**, **Rename**, **Reimport**, **Reveal Source**, **Properties**,
  and **Delete**, grouped by frequency and destructiveness. Apply the
  known-data Quick Plot availability rules from L0.8-L0.10.
- [x] **L0.39 Editable-plot context menu (confirmed 2026-08-13):** use **Open**,
  **Copy Figure**, **Export**, **Add to Figure Page...**, **Duplicate**,
  **Rename**, **Save as Template...**, **Show Data Sources**, **Properties**,
  and **Delete**. Keep **Copy Figure** visibly distinct from Library-item
  duplication or transfer.
- [x] **L0.40 Analysis/result context menu (confirmed 2026-08-13):** use
  **Open**, **Rerun**, **Edit Parameters...**, **Open Result Table**,
  **Export Results...**, **Duplicate**, **Rename**, **Show Data Sources**,
  **Properties**, and **Delete**. Mark stale results visibly but never rerun
  them automatically.
- [x] **L0.41 Interview and product standard (confirmed 2026-08-13):** pursue
  the best of OriginPro and JMP, copy sound features when they fit, and improve
  known pain points rather than reproducing them. Agents may decide simple,
  reversible details from good desktop conventions; reserve owner questions
  for large-scale decisions, scientific ambiguity, destructive behavior,
  expensive-to-reverse architecture, and material Origin/JMP conflicts.
- [x] **L0.42 Project folders versus filesystem (confirmed 2026-08-13):**
  Quantized's folder/workbook hierarchy is independent project organization,
  not a continuously mirrored filesystem. Importing a disk folder may reproduce
  its structure initially, but later source moves, offline network drives, or
  disk reorganization do not rearrange or break the project snapshot. Preserve
  connection through source provenance, **Reveal Source**, **Relink Source...**,
  and explicit reimport.
- [x] **L0.43 Linked calculated columns (confirmed 2026-08-13):** combine JMP's
  formula-column convenience with Quantized's non-destructive data model.
  Calculated columns appear beside imported columns but are visibly marked as
  derived and store their formula and dependencies. They recalculate after an
  intentional source edit or reimport. Imported raw columns remain untouched;
  materialization/export creates a corrected or derived copy.
- [x] **L0.44 Cross-workbook result placement (provisionally confirmed
  2026-08-13):** a figure or analysis with sources from several workbooks lives
  directly in their nearest shared project folder instead of pretending one
  workbook owns it. Single-workbook results remain workbook children. Preserve
  links to every source and allow manual relocation. Revisit after the owner
  exercises this structure in real projects; the owner agreed tentatively.
- [x] **L0.45 Dependency-safe deletion (confirmed 2026-08-13):** **Delete**
  moves a workbook to Trash. Dependent figures and analyses remain functional
  while it is recoverable and show a quiet **Source in Trash** status.
  Permanent removal invokes a dependency review offering restoration, deletion
  of affected dependents, or freezing/materializing their current outputs.
  Never break a dependency silently.
- [x] **L0.46 Bulk-import organization (confirmed 2026-08-13):** import a
  selected batch into the currently selected project folder by default. The
  import wizard may suggest **Create Folder for This Import** using an obvious
  shared filename prefix or date, but never creates or reorganizes folders
  without confirmation.
- [x] **L0.47 Single-writer project locking (confirmed 2026-08-13):** if the
  same project is already open for editing, another Quantized instance opens
  it read-only and offers **Open as Copy**. **Take Over Editing** is deliberate
  and only proceeds after verifying that the first instance is closed or its
  lock is stale. Never permit silent concurrent writes to one project.
- [x] **L0.48 Real folders plus virtual Collections (confirmed 2026-08-13):**
  every workbook has one real project-folder location. **Collections** are
  saved searches or metadata-driven virtual views; the same workbook may
  appear in several Collections without duplication or relocation. Keep this
  ownership distinction visible in Properties and **Show in Library**.
- [x] **L0.49 Collection scope (confirmed 2026-08-13):** Collections are
  project-local for the initial Library architecture. A later cross-project
  global catalog may index project metadata for discovery, but it must remain
  read-only until the user explicitly opens a project and must not expand the
  first Library redesign into a database-management system.
- [x] **L0.50 Derived worksheets (confirmed 2026-08-13):** a correction or
  transformation producing a revised full table creates a linked derived
  worksheet inside the same workbook. It visibly identifies its source and
  correction pipeline, recalculates only through intentional pipeline/source
  changes, and remains distinct from imported raw worksheets. **Freeze Copy**
  creates an explicit permanent snapshot when required.
- [x] **L0.51 Separate combined worksheet (confirmed 2026-08-13):** separating
  a worksheet creates a new workbook containing it and moves exclusively
  dependent figures, analyses, derived sheets, and notes with it. Items that
  depend on several worksheets remain at the original/common folder level and
  retain rewritten source links. Preview the affected-item plan before commit.
- [x] **L0.52 Reuse the existing document-window model (confirmed 2026-08-13):**
  do not add another persistent document-tab system. Quantized already has
  Plot/Map/Worksheet Stage tabs, movable document windows, and a minimized
  window strip. Library actions open or focus those canonical windows; improve
  the strip with clear names, item-type icons, and source-workbook context.
  Closing a window never deletes its Library item.
- [x] **L0.53 Session restoration (confirmed 2026-08-14):** reopening a project
  restores open windows, window layout, active item, workbook expansion,
  Library view, selection, and the remembered workbook child. Restore heavy
  worksheets and figures lazily so startup remains responsive. Provide
  **Safe Open Without Layout** when a saved workspace is corrupt, incompatible,
  or too expensive to restore normally.
- [x] **L0.54 Managed storage for large data (confirmed 2026-08-14):** ordinary
  datasets remain embedded snapshots. Very large 2D payloads may use a
  Quantized-managed sidecar beside the project after a clear warning rather
  than silently inflating the project file. **Pack Project...** creates a
  portable self-contained copy. If the sidecar is missing or its network drive
  is offline, open the project with available metadata/thumbnails and offer
  **Relink Data...**; do not treat temporary unavailability as deletion.
- [x] **L0.55 Reimport propagation (confirmed 2026-08-14):** preview affected
  dependencies before an intentional reimport and apply the accepted change as
  one transaction. Replace the embedded raw snapshot, recalculate linked
  formula columns and derived worksheets, and update linked plots while
  preserving manual styling and manual axis limits; autoscaled axes recalculate.
  Mark fits and analyses stale instead of rerunning automatically. Frozen
  outputs remain unchanged. Undo the entire reimport/propagation as one action
  during the current session.
- [x] **L0.56 Batch metadata and Collection building (confirmed 2026-08-14):**
  Details view supports selectable metadata columns, multi-select project
  metadata editing, tags, and drag-to-group/filter. Batch edits never rewrite
  raw source files or imported headers, show the affected-item count, and are
  undoable during the current session. A configured filter can be saved as a
  virtual Collection.
- [x] **L0.57 Release order (confirmed 2026-08-14):** deliver three milestones
  as small stacked PRs: **(1) Library foundation** — first-class workbooks and
  migration, Tree/Tiles/Details, Library workspace, search, thumbnails, core
  menus, navigation, and session restoration; **(2) Fast plotting and
  transfer** — known-data Quick Plot, Quick Figure Builder, template matching,
  and cross-instance workbook copy/paste; **(3) Advanced data organization** —
  combined/split workbooks, linked formulas and derived worksheets, batch
  metadata/Collections, dependency-aware reimport/deletion, and managed
  large-data sidecars.

### Derived-data integrity requirements

- [ ] Store a dependency graph and reject cycles between calculated columns,
  derived worksheets, and analyses with a clear explanation.
- [ ] Mark stale/error states without replacing the last valid output.
- [ ] Preview the effect of deleting or moving a dependency before committing.
- [ ] Preserve formulas, pipeline parameters, units, exclusions, and provenance
  through project save/load and workbook copy/paste.
- [ ] Keep recalculation deterministic and auditable; never hide an automatic
  correction inside display-only plot state.

### Required large-Library engineering safeguards

- [ ] Virtualize long Tree, Details, search-result, and tile collections so DOM
  size remains bounded with thousands of items.
- [ ] Generate plot/result thumbnails lazily, prioritize visible tiles, cache
  them by canonical item revision, and cancel obsolete off-screen work.
- [ ] Render immediate placeholders and metadata so opening the Library does
  not wait for thumbnails.
- [ ] Keep folder counts and selection operations indexed; avoid rescanning all
  workbook payloads on every render or keystroke.
- [ ] Preserve keyboard navigation and **Show in Library** across virtualization
  boundaries.
- [ ] Add scale fixtures covering deep folders, wide folders, large search
  result sets, stale thumbnails, and rapid view switching.

### Cross-session workbook transfer requirements

- [ ] Transfer worksheets/data, editable figures, analyses/derived results,
  notes, metadata, templates scoped to that workbook, and internal links as one
  coherent bundle.
- [ ] Generate fresh destination IDs and rewrite internal references so the
  pasted workbook cannot mutate or collide with its source.
- [ ] Preserve provenance and original source-path metadata without requiring
  the source project to remain open.
- [ ] Support Windows and macOS desktop instances. Use a versioned portable
  transfer format rather than assuming two processes share Zustand state.
- [ ] Avoid placing an unbounded scientific payload directly on the system
  clipboard. A robust implementation may use a small clipboard descriptor plus
  a guarded temporary transfer package for large workbooks, with expiry and
  cleanup safeguards.
- [ ] If the transfer package is unavailable or incompatible, explain the
  failure and leave the destination unchanged.
- [ ] Preserve normal text/file clipboard behavior; Quantized-specific Paste is
  enabled only when a compatible workbook payload is present.
- [ ] Add cross-process contract tests for ID remapping, internal links,
  version compatibility, missing transfer packages, and cleanup.

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
- [x] **L1.5 Wide tile surface design:** produced thorough mockups and confirmed
  the main-workspace Library in L0.15. Implementation remains in PR E; do not
  squeeze production tiles into the default 210 px sidebar.
- [x] **L1.6 Search-results design:** confirmed flat Details-style results with
  full breadcrumbs and **Show in Library** in L0.26. Implementation remains
  open.
- [x] **L1.7 Heterogeneous-child design:** confirmed ordering, preview, open,
  source, and context-menu behavior in L0.16-L0.21 and L0.38-L0.40.
  Implementation remains open.

## Implementation sequence

The owner confirmed the milestone order on 2026-08-14. Each step remains a
reviewable stacked PR with targeted unit tests, typecheck, lint, production
build, and focused interaction coverage where appropriate.

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
4b. [ ] **PR D2 — project-wide search results surface.** Implement the
    confirmed L0.26 behavior over the Details renderer: flat result list with
    full `Folder / Workbook / Child` breadcrumbs, normal open behavior, and
    **Show in Library** reveal. (Booked 2026-08-14 — L0.26 previously had no
    owning slice.)
5. [ ] **PR E — tile-browser shell after mockup approval.** Implement the
   approved wide-surface behavior and interaction parity.
5b. [ ] **PR E2 — session restoration and safe open.** Persist Library view,
    selection, remembered workbook children, and workspace placement alongside
    the existing window layout; restore heavy children lazily and add
    **Safe Open Without Layout**.
6. [ ] **PR F — known-data Quick Plot contract.** Add explicit availability,
   disabled explanations, data-profile/schema matching, and focused tests for
   supported column permutations.
7. [ ] **PR G — Quick Figure Builder mapping slice.** Reuse the canonical
   editable-figure path; ship live preview, mapping, Cancel, and editable
   creation before advanced template management.
8. [ ] **PR H — template persistence and scopes.** Save named mappings/styles
   with explicit scope and safe mismatch behavior.
9. [ ] **PR I — cross-instance workbook transfer.** Implement the versioned,
   bounded Copy/Paste package, fresh-ID rewrite, provenance, and failure-safe
   cleanup contract from L0.23-L0.24.
9b. [ ] **PR I2 — single-writer project locking.** Implement L0.47:
    second-instance read-only open, **Open as Copy**, and guarded stale-lock
    **Take Over Editing**. Requires the same platform-boundary answer as PR I
    (backend `io/` + thin route on the served modes; define the two-browser-
    tabs-one-backend story explicitly). (Booked 2026-08-14 — L0.47 previously
    had no owning slice.)
10. [ ] **PR J — combined and split workbooks.** Implement explicit combine,
    transactional multi-source reimport, collision-safe naming, and dependency-
    aware separation from L0.32-L0.34 and L0.51.
11. [ ] **PR K — calculated columns and derived worksheets.** Add the acyclic
    dependency graph, visible formula/derived state, deterministic recalculation,
    and **Freeze Copy** from L0.43 and L0.50.
12. [ ] **PR L — Details metadata and Collections.** Add column selection,
    batch project-metadata edits, grouping/filtering, session undo, and
    project-local saved Collections from L0.48-L0.49 and L0.56.
13. [ ] **PR M — dependency-aware reimport and deletion.** Add previews,
    transactional propagation, stale analysis state, Trash dependency review,
    and freeze/materialize recovery from L0.45 and L0.55.
14. [ ] **PR N — managed large-data sidecars.** Add threshold policy,
    explicit externalization, missing/offline recovery, **Relink Data...**, and
    portable **Pack Project...** from L0.54.

## Agent and model routing

### Budget policy

Use the least expensive model that can safely own the decision boundary—not
the least expensive model that can merely produce compiling code.

- **GPT-5.6 Terra (low/medium)** or **Claude Haiku, current generation**:
  mechanical React extraction, isolated component wiring, CSS, straightforward
  tests, documentation cleanup, and fixture expansion after a stronger model
  has fixed the contract. Do not give these models schema migration,
  scientific inference, dependency rewriting, or destructive storage logic.
- **GPT-5.6 Terra high**: bounded frontend features with a settled UX contract,
  such as a renderer, view preference, context menu, or focused builder panel.
- **Claude Sonnet 5**: default implementation model for persistence, Zustand
  integration, migrations whose rules are already specified, reference
  rewriting, backend adapters, defensive parsing, and CI/reliability work.
- **GPT-5.6 Sol high**: use selectively for interaction architecture, complex
  cross-surface usability, mockups, workflow audits, and final visual/behavioral
  acceptance. Preserve scarce ChatGPT tokens by handing settled component work
  to Terra.
- **Claude Opus 5**: reserve for genuinely high-risk contracts—workspace schema
  and adversarial migration review, cross-process transfer, dependency graphs,
  transactional reimport/deletion, and sidecar durability/recovery. Where
  practical, let Sonnet implement a bounded design and spend Opus on the design
  proof or adversarial review rather than every line of code.

Every PR still needs a human/agent review pass by a model suited to its risk.
Passing tests is not sufficient for migration, deletion, transfer, or storage
work; those require negative cases and failure-atomicity review.

**Orchestrator note (Claude, 2026-08-14):** where this plan says "Claude
Opus 5" for contract design or adversarial review, the owner's orchestrating
Claude session (Fable 5, the tier above Opus) executes that role inline —
it designs the contract, delegates implementation to Sonnet worktree agents,
and adversarially reviews before merge. No separate Opus hop is spawned.

### Ownership matrix

| Slice | Primary owner | Recommended implementation model | Review/escalation | Reason |
|---|---|---|---|---|
| A1 workbook schema + legacy migration | Claude | Claude Sonnet 5 after a bounded Claude Opus 5 contract review | Opus 5 adversarial migration review; ChatGPT-Sol checks owner semantics | Versioned identity and deterministic v1-v3 migration are expensive to repair after shipping. |
| A2 workspace/store persistence | Claude | Claude Sonnet 5 | Sonnet reliability review; Opus only if migration rules change | Broad persistence plumbing, but mechanically bounded once A1 is fixed. |
| A3 import-to-workbook assignment | Claude | Claude Sonnet 5 | ChatGPT-Sol usability/Origin-hierarchy review | Import provenance and Origin grouping need reliability; visible hierarchy needs UX review. |
| A4 append/merge integrity | Claude | Claude Sonnet 5 high | Claude Opus 5 adversarial reference review | ID/folder/workbook rewrites can silently corrupt appended projects. |
| B canonical hierarchy view model | Claude (owner decision 2026-08-14: implementation flipped to Claude) | Claude Sonnet 5 from ChatGPT-Sol's reviewed IA contract | ChatGPT-Sol reviews the item-kind/field shape (the IA decision) before implementation and the result after | Pure discriminated-union TS + tests is Claude-cheap work; ChatGPT's scarce tokens concentrate on the IA shape review, E, and G. Resolves the plan's internal contradiction with token rule 1. |
| C Origin-like tree renderer | Claude, from ChatGPT-Sol's UX contract | Claude Sonnet 5; Haiku only for isolated tests/CSS | ChatGPT-Sol keyboard/mouse review | Settled UI behavior is routine once the interaction contract is fixed. |
| D Details view + preference | Claude, from ChatGPT-Sol's UX contract | Claude Sonnet 5 | ChatGPT-Sol usability review | Standard desktop UI and persistence can be implemented cheaply from the written spec. |
| E tile Library workspace | ChatGPT-Sol | GPT-5.6 Terra high for bounded components; Sol high for integration | GPT-5.6 Sol high for visual acceptance; Sonnet for persistence defects | Spatial interaction and responsive usability are where ChatGPT effort has the highest return. |
| E2 restoration + safe open | Claude | Claude Sonnet 5 | Opus 5 only for corrupt-state/failure recovery review; Sol checks visible recovery | Existing window persistence makes implementation bounded, but startup recovery must be reliable. |
| F known-data Quick Plot contract | Claude + ChatGPT-Sol | Claude Sonnet 5 for inference/guards; Terra high for menus | Opus 5 only if scientific inference expands; Sol checks failure UX | Scientific correctness must fail closed; UI itself is straightforward. |
| G Quick Figure Builder | ChatGPT-Sol | GPT-5.6 Terra high | GPT-5.6 Sol high workflow/visual review; Sonnet reviews canonical-state writes | High-value GUI workflow with a settled underlying figure contract. |
| H template persistence/scopes | Claude | Claude Sonnet 5 | ChatGPT-Sol reviews discoverability and wording | Persistence and schema matching dominate; UI is small. |
| I cross-instance Copy/Paste | Claude | Claude Opus 5 | Sonnet 5 for fixture/test expansion; Sol reviews user recovery | Cross-process, temporary-package, cleanup, and compatibility failures justify Opus. |
| J combine/split workbooks | Claude | Claude Sonnet 5 high | Opus 5 dependency/reference review; Sol previews UX | Mostly deterministic transformations, with high-risk reference edges. |
| K formulas + derived worksheets | Claude | Claude Opus 5 for dependency contract; Sonnet 5 for bounded slices | Opus 5 final cycle/staleness review; Sol checks worksheet cues | Acyclic dependencies and reproducible recalculation are core data integrity. |
| L Details metadata + Collections | Claude, from ChatGPT-Sol's UX contract | Claude Sonnet 5; Haiku for isolated fixtures only | ChatGPT-Sol usability review | JMP-like UX needs Sol review, but the settled table/query implementation can use abundant Claude capacity. |
| M reimport + dependency-aware deletion | Claude | Claude Opus 5 | Separate Opus/Sonnet adversarial review; Sol checks warnings and recovery | Destructive, transactional, multi-object behavior merits the expensive model. |
| N managed large-data sidecars | Claude | Claude Opus 5 for storage contract; Sonnet 5 for implementation slices | Opus durability/recovery review; Sol checks offline UX | Filesystem durability, portability, cleanup, and offline recovery are high stakes. |

### Token-conscious handoff rules

1. ChatGPT-Sol owns UX decisions, mockups, interaction acceptance, and only the
   cross-surface frontend implementation where its strengths materially
   matter—primarily E and G (B's implementation flipped to Claude,
   owner decision 2026-08-14; Sol reviews B's IA contract). It should not
   spend scarce tokens on repetitive serializers, standard tables/trees,
   fixtures, or CSS once a contract is written; Claude Sonnet implements
   B/C/D/L from the detailed handoff.
2. Claude owns persistence, backend/filesystem work, migration reliability,
   dependency integrity, and CI hardening. The owner has substantially more
   Claude capacity, so default ambiguous reliability work to Claude Sonnet 5.
3. Use Opus only at the red boundaries A1/A4/I/K/M/N or when Sonnet uncovers an
   architectural ambiguity. Do not use Opus for ordinary components, menu
   wiring, snapshots, or happy-path tests.
4. A cheap model may extend tests only after the authoritative model has
   defined invariants and negative cases. It must not invent migration or
   scientific behavior from incomplete context.
5. For mixed slices, split the PR rather than asking one expensive model to do
   everything: Claude lands the contract/store boundary and most settled UI;
   Terra is optional for a tightly bounded GUI component; ChatGPT-Sol performs
   the integrated usability review or owns the high-leverage E/G workflow.

### Recommended execution split by milestone

- **Milestone 1 — Library foundation:** Claude leads A1-A4, B, C-D, and E2
  using mostly Sonnet 5; the orchestrating Claude session (Fable) is the
  design/review escalation for A1/A4. ChatGPT-Sol owns E, reviews B's IA
  contract, and reviews A3/C-D for hierarchy and interaction fidelity.
- **Milestone 2 — Fast plotting and transfer:** Claude leads F's fail-closed
  inference, H persistence, and I cross-process transfer. ChatGPT-Sol owns G
  and the end-to-end Quick Plot usability pass. Use Opus only for I; Sonnet is
  sufficient for F/H after their contracts are fixed.
- **Milestone 3 — Advanced organization:** Claude leads J-N. Sonnet handles J/L
  and bounded K/N implementation; Opus defines/reviews K/M/N and the risky
  reference edge in J. ChatGPT-Sol supplies previews, warning/recovery wording,
  and final workflow acceptance rather than bulk implementation.

### Kickoff order (confirmed routing, 2026-08-14)

1. **Claude first — A1.** Use a short Claude Opus 5 contract review, then
   Claude Sonnet 5 implementation. Stop after the pure schema/migration slice
   is tested; do not fold A2-A4 into one oversized PR.
2. **B next — ChatGPT-Sol reviews the IA contract, Claude implements.**
   Sol signs off the item-kind/field shape derived from the reviewed A1
   contract; Claude Sonnet then implements the canonical hierarchy view model
   plus pure tests. B must not reach into workspace persistence or import
   mutation owned by Claude's A2-A4 slices.
3. **Claude in parallel — A2-A4.** These primarily touch workspace/store,
   import planning, and append/merge boundaries, while B stays in the Library
   view-model files. Rebase B onto A4 before the renderer stack begins.
4. **Claude C-D, ChatGPT-Sol E.** Claude wires the settled tree/details views;
   ChatGPT-Sol reviews them and owns the main-workspace tile experience.

This parallel point is intentionally after A1: starting B before the workbook
identity contract exists would encode another temporary surrogate and waste
tokens on rework.

### Per-slice pickup briefs

#### B — canonical hierarchy view model

- **Goal:** produce one pure ordered hierarchy consumed identically by Tree,
  Tiles, Details, search reveal, keyboard navigation, and drag/drop.
- **Inputs:** folders, workbooks, worksheet datasets, workbook/folder figures,
  analyses, notes/pages, expansion state, and manual order.
- **Output:** discriminated item rows/nodes with stable IDs, parent IDs, depth,
  item kind, display metadata, source/fidelity status, and available actions.
- **Do not:** put JSX, context-menu labels, thumbnails, or Zustand writes in the
  pure builder; do not infer ownership from display names.
- **Tests:** mixed child ordering, cross-workbook folder results, collapsed
  subtrees, identical names, broken references, stable IDs, and deterministic
  output after legacy migration.

#### C — Origin-like tree renderer

- **Goal:** render the approved folder/workbook/child structure in the narrow
  Library without changing the active plot on disclosure.
- **Mouse/keyboard:** disclosure toggles only; single-click selects;
  double-click/Enter opens; arrows traverse/expand/collapse; context menu and
  drag targets share the canonical action registry.
- **State:** remember last opened child per workbook; closing a document window
  never deletes the Library item.
- **Do not:** embed Quick Plot inference in row components or recreate per-kind
  selection stores.
- **Tests:** mouse versus disclosure separation, remembered child, focus after
  removal/move, keyboard traversal, disabled action explanations, and Origin
  multi-sheet ordering.

#### D — Details view and persisted preference

- **Goal:** add Tree/Tiles/Details selection and a sortable Details renderer
  over the same hierarchy.
- **Persistence:** user view mode is a preference; project/session state records
  the active Library surface needed for restoration. Temporary sort never
  rewrites manual order.
- **Columns:** begin with Name, Type, Folder/Workbook, dimensions, data type,
  source status, modified/import time, and tags; column selection expands in L.
- **Tests:** view switching preserves selection/search/focus, manual order
  returns intact, preference round-trip, and narrow-width fallback.

#### E — tile Library workspace

- **Goal:** use the confirmed main-workspace Library, leaving tree navigation
  visible and returning to the unchanged active plot with one action/Escape.
- **Previews:** cached figure thumbnails by canonical revision; compact table
  previews for worksheets; natural result preview or concise summary for
  analyses. Render placeholders immediately and generate only visible previews.
- **Do not:** squeeze tiles into the 210 px sidebar, eagerly render every figure,
  or create a second workbook-overview route.
- **Tests/QA:** responsive layouts, light/dark themes, thumbnail invalidation,
  rapid switching cancellation, missing sources, keyboard open, and visual
  comparison with the approved ChatGPT-Sol mockup.

#### E2 — session restoration and Safe Open

- **Goal:** extend existing `.dwk` window/layout restoration to Library mode,
  selected item, expanded workbook state, remembered child, and workspace
  placement without duplicating the current window contract.
- **Recovery:** invalid/heavy layout can open through **Safe Open Without
  Layout** while preserving scientific/library content.
- **Do not:** deserialize working transient editors, stale drag state, pending
  context menus, or partial inline edits.
- **Tests:** normal round-trip, missing/deleted selected child, unsupported
  layout version, oversized window coordinates, lazy heavy child, and safe-open
  preservation of datasets/workbooks.

#### F — known-data Quick Plot contract

- **Goal:** separate availability from rendering. A recognized parser/data
  profile plus compatible schema signature may Quick Plot; unknown data cannot.
- **Inference:** cover XYXY, shared-X multiple-Y, symmetric/asymmetric Y error,
  X error, repeated groups, multiple X, and non-monotonic acquisition order.
  Explicit roles outrank headers/units/metadata; adjacency alone is insufficient.
- **UX contract:** high confidence runs; ambiguity shows the confirmed inline
  prompt; unknown disables Quick Plot and offers **Configure Quick Plot...**.
- **Tests:** positive/negative schemas, reordered columns, misleading headers,
  unrelated `.dat` formats, error-role conflicts, and fail-closed behavior.

#### G — Quick Figure Builder

- **Goal:** build a focused main-workspace mapping surface that creates the same
  canonical editable figure used everywhere else.
- **Layout:** role assignment left, live canonical preview center, essentials
  right; **More Settings** holds uncommon controls. Support drag/drop and
  **Assign Role** menus over one mapping state.
- **Transaction:** Cancel/Escape leaves no plot, template, or worksheet change;
  **Create Figure** opens a normal editable plot; template saving is separate.
- **Do not:** fork another figure state model or route through export-only
  Figure Builder state.
- **Tests/QA:** cancel, ambiguous mapping edit, keyboard assignment, error bars,
  live preview, canonical reopen, and visual usability at common desktop sizes.

#### H — template persistence and matching

- **Goal:** store versioned named Quick Plot templates with explicit workbook or
  data-type+schema scope and compatibility checks.
- **Behavior:** creation never auto-saves; mismatch disables automatic apply;
  **Quick Plot With...** appears only when named templates exist.
- **Do not:** key by extension alone, overwrite a template silently, or apply a
  newly learned template to already customized figures.
- **Tests:** rename/delete, schema evolution, precedence, corrupt template,
  scoped match/non-match, and project/workbook copy behavior.

#### I — cross-instance workbook Copy/Paste

- **Goal:** copy a self-contained versioned workbook bundle across Quantized
  processes/projects while preserving normal OS clipboard behavior.
- **Payload:** workbook, worksheets, figures, analyses/results, notes, metadata,
  workbook templates, provenance, and rewritten internal links. Generate fresh
  destination IDs.
- **Scale:** small clipboard descriptor plus guarded temporary package for large
  content; bounded lifetime and cleanup; no unbounded raw clipboard payload.
- **Tests:** two-process round-trip, ID collisions, missing/expired package,
  incompatible version, partial write, cleanup, offline source, and destination
  atomicity.

#### J — combine and split workbooks

- **Goal:** explicit reversible structural operations with a preview of moved
  children/dependencies and no source-file mutation.
- **Combine:** prompt name, suggest common prefix, preserve per-worksheet source,
  suffix collisions, and support transactional Reimport All.
- **Split:** new workbook receives selected worksheet and exclusive dependents;
  multi-source items remain at the common folder with rewritten links.
- **Tests:** multiple sources, missing source, name collisions, exclusive versus
  shared dependency, undo, and save/reopen.

#### K — calculated columns and derived worksheets

- **Goal:** formalize existing formula columns and new linked derived worksheets
  on one acyclic, auditable dependency contract.
- **Behavior:** visible derived status, stored expression/parameters/units,
  deterministic recalculation, stale/error state retaining last valid result,
  and explicit **Freeze Copy**.
- **Do not:** rewrite imported raw columns, hide corrections in plot state, or
  permit cycles/implicit evaluation order.
- **Tests:** cycle rejection, dependency rename/delete/reimport, failure retains
  last result, unit/provenance round-trip, frozen independence, and copy/paste.

#### L — Details metadata and Collections

- **Goal:** add JMP-like column selection, batch project-metadata editing,
  drag-to-group/filter, tags, and project-local saved Collections.
- **Ownership:** folders are real; Collections never duplicate/move workbooks.
  **Show in Library** reveals the real location.
- **Safety:** show affected count, edit project metadata only, and support one
  session undo. Never rewrite imported headers or source files.
- **Tests/QA:** multi-select, mixed values, Collection membership updates,
  rename/move/delete, large virtualized lists, and keyboard batch editing.

#### M — transactional reimport and dependency-aware deletion

- **Goal:** present an impact plan, then atomically update raw snapshot, linked
  data, plots, analysis staleness, and Trash dependencies.
- **Reimport:** preserve manual plot styles/limits, recalc auto limits, leave
  frozen outputs unchanged, and record one session undo.
- **Delete:** recoverable Trash keeps dependents working with status; permanent
  deletion requires restore/delete-dependent/freeze-materialize resolution.
- **Tests:** injected failure at every stage, missing source, partial multi-source
  refresh, manual versus auto axes, Trash restore, permanent-delete cancel, and
  exact rollback.

#### N — managed large-data sidecars

- **Goal:** keep ordinary projects embedded while safely externalizing very
  large 2D payloads through an explicit, versioned managed store.
- **Durability:** atomic writes, checksums, relative/relocatable references,
  network-offline distinction, relink, cleanup limits, and **Pack Project...**.
- **Do not:** silently externalize, interpret unavailable as deleted, or leave a
  project pointing at a half-written sidecar.
- **Tests:** crash/failure injection, checksum mismatch, move project+sidecar,
  offline network return, missing sidecar, pack/unpack, stale cleanup, and large
  payload performance.

### PR A technical boundary audit (ChatGPT-Sol, 2026-08-14)

Current facts that an implementer must preserve:

- `.dwk` is version 3. `WorkspaceState`, `LoadedWorkspace`, and the serialized
  document contain flat `datasets[]`, `folders[]`, selection/expansion, figures,
  pages, windows, tools, and other saved structures—but no workbook entity.
- `Dataset.folderId` currently makes every dataset a direct folder child. A
  dataset already represents a worksheet-like table and carries formulas,
  error roles, source path, import time, corrections, fit state, and row state.
- Existing calculated columns and window-layout restoration are real shipped
  features. PR A extends their ownership/persistence; it must not replace them.
- Origin multi-sheet books are reconstructed by `originSheetGroups` and
  `planOriginFolders`. The latter currently creates a folder surrogate for a
  multi-sheet workbook; single-sheet books remain direct folder datasets.
- `workspace.ts` is grandfathered at its architecture ratchet (633 lines in the
  pin, 632 physical lines observed). New migration/sanitization logic belongs in
  a focused module rather than increasing that pin.
- `importDatasets.ts` is already 415 lines and owns Origin expansion plus folder
  planning. Workbook assignment should be extracted behind a pure import plan,
  not added as another large inline branch.
- `workspaceMerge.ts` currently appends only datasets and deliberately drops
  incoming folder membership and all workspace-level structures. Adding
  `Dataset.workbookId` without updating this boundary would create dangling
  references; append behavior must be explicit and tested.

Recommended PR A decomposition:

1. [x] ~~**PR A1 — pure workbook model and legacy migration.**~~ (2026-08-14)
   Shipped `8a6d0e6`/`c1adf97`/`914042e` — see `## Completed`.
2. [ ] **PR A2 — workspace/store persistence.** Thread `workbooks[]` through
   `WorkspaceState`, `LoadedWorkspace`, serialization/parsing, `loadWorkspace`,
   history/reset, autosave, and architecture tests. Preserve all v1-v3 inputs.
3. [ ] **PR A3 — import assignment.** Make one source file create one workbook;
   assign all sheets/books according to the confirmed file boundary; convert
   Origin multi-sheet surrogate folders without leaving duplicate
   `Folder -> Book folder -> Workbook` nesting. Also owns the L0.46
   bulk-import behavior: import into the selected folder by default, with the
   optional **Create Folder for This Import** suggestion that never creates
   folders without confirmation. (L0.46 booked here 2026-08-14 — previously
   had no owning slice.)
4. [ ] **PR A4 — append/merge reference integrity.** Define collision-free
   workbook/folder transfer and rewrite dataset/workbook/internal references,
   or explicitly land appended workbooks at root with warnings. Never retain a
   dangling `workbookId`.

PR A acceptance gates:

- [ ] A v1, v2, or v3 workspace opens with deterministic workbook membership
  and saves as v4 without losing dataset IDs or scientific state.
- [ ] Reopening the same legacy document derives the same logical workbook
  grouping; unrelated Origin imports containing identically named books never
  merge.
- [ ] A multi-sheet Origin book becomes one workbook with ordered worksheets,
  while a single-sheet source still has a visible workbook container.
- [ ] Broken/hand-edited workbook references degrade safely with a migration
  warning and no data loss.
- [ ] Serialize/parse, autosave restore, explicit open, append, and reset paths
  all have focused tests.
- [ ] Existing v1-v3 fixtures remain green; architecture ratchets do not rise.

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

## Owner decisions

- [x] ~~Confirm the recommended template matching/scoping contract (LQ.1).~~
  CONFIRMED as recommended, 2026-08-13 (see L0.14).
- [x] ~~Decide the wide tile-browser placement using thorough mockups.~~
  Confirmed **Library workspace** on 2026-08-13 (L0.15).
- [x] ~~Decide the default ordering of heterogeneous workbook children.~~
  Confirmed stable type order on 2026-08-13 (L0.16).
- [x] ~~Decide whether a workbook overview is a distinct view or only the tile
  presentation of its children.~~ The tile presentation is the overview
  (L0.17).
- [x] ~~Decide how manually combining files into one workbook handles source
  provenance, reimport, and naming.~~ Confirmed in L0.32-L0.34.
- [x] ~~Decide how analysis results attach to a workbook versus a worksheet.~~
  Keep them as workbook children with explicit source relationships (L0.21).
- [x] ~~Decide whether **Quick Plot With...** ships with the first Quick Plot
  slice or follows template persistence.~~ Ship it with template persistence
  (L0.37).

## Owner interview history

**Paused:** 2026-08-12 — owner ended the session for bedtime. Do not begin
implementation from the recommendations above and do not infer answers to the
remaining UX questions. Resume the interview one question at a time.

**Resumed:** 2026-08-13 — LQ.1 asked first as booked and CONFIRMED as
recommended (now L0.14). Interview continues below.

**Paused again:** 2026-08-13 — owner was ready for bed after confirming L0.14
through L0.52. Approximately five consequential questions remain; routine,
reversible details should be decided by agents under L0.41 rather than sent
back to the owner. No Library implementation is authorized by this pause.

### Ask this first on the next resumption

- [x] **Session restoration:** confirm or revise the recommendation to restore
  open windows, layout, active item, workbook expansion, Library view, and
  selection when reopening a project; load heavy content lazily and provide
  **Safe Open Without Layout**. Confirmed 2026-08-14 as L0.53.

### Remaining consequential interview areas (approximately four after that)

- [x] ~~Large 2D data storage, project portability, and when an embedded snapshot
  may become a managed external payload.~~ Confirmed managed sidecar plus
  portable packing and relinking as L0.54.
- [x] ~~Source-change/reimport propagation across linked plots, calculated
  columns, derived worksheets, analyses, and frozen outputs.~~ Confirmed as
  the transactional dependency-preview model in L0.55.
- [x] ~~Large-scale multi-select, batch metadata editing, and Collection-building
  behavior where JMP and Origin conventions materially differ.~~ Confirmed
  project-metadata-only batch editing and save-to-Collection as L0.56.
- [x] ~~Final implementation priority split.~~ Three milestones confirmed on
  2026-08-14 as L0.57. A final visual acceptance pass remains an implementation
  gate, not an unresolved product question.

### Initial resume question (complete)

- [x] ~~**LQ.1:** Should the recommended Quick Plot template contract be
  marked confirmed?~~ CONFIRMED as recommended, 2026-08-13 (see L0.14).

### Interview completion

- [x] Consequential owner interview completed 2026-08-14 through L0.57.

### Interview-area reconciliation

- [x] ~~Tile-browser placement and transition.~~ Confirmed in L0.15.
- [x] ~~Workbook child structure and ordering.~~ Confirmed in L0.16-L0.21.
- [x] ~~Selection, double-click, keyboard navigation, breadcrumbs, search, and
  view-switch continuity across Tiles / Tree / Details.~~ Confirmed in
  L0.25-L0.26.
- [x] ~~Workbook and child context-menu contents.~~ Confirmed in L0.36 and
  L0.38-L0.40.
- [x] ~~Finalize copy/paste independence and source/reimport semantics for a
  workbook pasted into another project.~~ Confirmed independent deep copy with
  provenance and explicit source relinking (L0.24).
- [x] ~~Quick Figure Builder layout, role assignment, preview, error handling,
  and template-saving flow.~~ Confirmed in L0.27-L0.31.
- [x] ~~Recognition confidence and compact ambiguous-mapping confirmation.~~
  Confirmed in L0.8-L0.10 and L0.30.
- [x] ~~Combining and separating source files/workbooks.~~ Confirmed in
  L0.32-L0.34 and L0.51.
- [x] ~~Derived datasets, fits, analyses, and corrected copies.~~ Confirmed in
  L0.21, L0.43, L0.50, and L0.55.
- [x] ~~Scale and organization behavior.~~ Confirmed in L0.46-L0.49,
  L0.54, and L0.56; engineering safeguards remain unchecked until built.
- [ ] Revisit L0.44 after real cross-workbook work to confirm that folder-level
  results remain understandable and do not create Origin-like clutter.

## Completed

- ~~**PR A1 — pure workbook model and legacy migration**~~ (2026-08-14) —
  `lib/workbooks.ts` (383 lines, pure): `WorkbookNode`, `deriveWorkbooks`
  (stem-scoped Origin grouping identical to `originSheetGroups`' partition,
  `(path, importedAt)` import-event grouping with singleton fallback when
  `importedAt` is absent, `planOriginFolders` surrogate-folder detection with
  four exact-match conditions), `sanitizeWorkbooks`, `reconcileWorkbookRefs`
  (repairs dangling refs without rewriting valid memberships).
  `Dataset.workbookId` added; funded by extracting the Reductions wire types
  to `lib/reductionTypes.ts` (types.ts pin lowered 1090 → 1053, never
  raised). 27 focused tests incl. a partition-agreement test against
  `originSheetGroups` and a red-proven adversarial-review fix (occupancy for
  surrogate detection is judged against the FULL document, not the repair
  subset — a tenant-occupied folder is never offered for conversion). Gate:
  6,502 frontend tests, lint 0 errors, build + bundle budget green. NOT yet
  serialized/wired — `.dwk` stays v3 until PR A2. Commits `8a6d0e6`,
  `c1adf97`, `914042e`.

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
- **2026-08-13 — ChatGPT-Sol:** Presented three detailed placement mockups.
  Owner confirmed the recommended **Library workspace**: tiles temporarily
  occupy the Stage while tree navigation remains visible and the active plot
  remains unchanged for one-click return. Recorded as L0.15.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed stable workbook-child order:
  source-order worksheets, editable/recovered figures, analyses and derived
  results, then notes. Recorded as L0.16.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed that workbook tiles are the
  overview rather than a separate screen, and requested real plot thumbnails
  like the current browser tiles. Recorded as L0.17-L0.18.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed compact table previews for
  worksheet tiles, with dimensions and column-role indicators rather than an
  automatically inferred plot. Recorded as L0.19.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed natural previews for analyses
  and derived results, with concise summaries when no meaningful visual exists.
  Recorded as L0.20.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed that analyses remain direct
  workbook children while preserving navigable links to their source
  worksheet(s). Recorded as L0.21.
- **2026-08-13 — ChatGPT-Sol:** Owner requested simpler menu language
  (**Delete**, not **Move to Trash**) and whole-workbook Copy/Paste between
  simultaneously open Quantized projects, in addition to Duplicate. Recorded
  as L0.22-L0.23 with a bounded cross-process transfer contract.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed independent deep-copy paste
  semantics, preserved source provenance, and an explicit **Relink Source...**
  recovery path. Recorded as L0.24.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed selection, active-plot, search,
  scroll-target, mouse, keyboard, and Escape continuity across Tree, Tiles, and
  Details. Recorded as L0.25; search result presentation remains to decide.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed project-wide flat search
  results with full breadcrumbs and **Show in Library** reveal behavior.
  Recorded as L0.26.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed the Quick Figure Builder as a
  full main-workspace surface rather than a small modal. Recorded as L0.27.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed an essentials-first Quick
  Figure Builder with less-common controls under **More Settings**. Recorded
  as L0.28.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed drag/drop plus explicit
  click/right-click role assignment in the Quick Figure Builder. Recorded as
  L0.29.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed a compact inline ambiguity
  message with highlighted evidence and **Use Mapping** / **Edit Mapping**,
  skipped for high-confidence mappings. Recorded as L0.30.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed that figure creation never
  changes templates automatically; template saving is a separate named and
  scoped action. Recorded as L0.31.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed embedded project snapshots with
  retained source provenance and explicit reimport, never automatic source
  refresh. Recorded as L0.32.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed all-or-nothing multi-source
  **Reimport All**, with partial refresh available only through an explicit
  **Reimport Available Sources** action. Recorded as L0.33.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed prompted combined-workbook
  naming, shared-prefix suggestions, preserved source filenames, and
  collision-safe worksheet names. Recorded as L0.34.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed persistent manual workbook
  order with temporary view-only sorts. Reconciled the previously approved
  plain-language workbook context menu, including cross-session transfer
  commands, as L0.35-L0.36.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed that **Quick Plot With...**
  ships with named-template persistence rather than the first Quick Plot
  slice. Recorded as L0.37.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed the worksheet right-click
  menu, including Quick Plot/configuration, figure addition, data-item
  operations, source operations, properties, and Delete. Recorded as L0.38.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed the editable-plot tile menu,
  including image copy, export, Figure Page composition, template saving,
  provenance, properties, and Delete. Recorded as L0.39.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed the analysis/result menu and
  clarified the product north star: combine the best of OriginPro and JMP,
  improve their pain points, and ask owner questions only for consequential or
  conflicting decisions. Recorded as L0.40-L0.41 and added to the plan charter.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed independent project folders
  rather than a live filesystem mirror, with explicit source reveal, relink,
  and reimport behavior. Recorded as L0.42.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed visible linked formula columns
  with stored dependencies and intentional recalculation, while imported raw
  columns remain immutable. Recorded as L0.43.
- **2026-08-13 — ChatGPT-Sol:** Owner provisionally accepted folder-level
  placement for cross-workbook results, with single-workbook results remaining
  under their workbook. Recorded as L0.44 with an explicit real-use revisit.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed dependency-aware Trash and
  permanent deletion, including review and freeze/materialize recovery paths.
  Recorded as L0.45.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed current-folder bulk imports
  with an optional suggested batch folder that is never created without
  confirmation. Recorded as L0.46. Added routine virtualization, lazy-preview,
  indexing, and scale-test requirements without requiring owner decisions.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed single-writer project locking,
  read-only second-instance behavior, **Open as Copy**, and guarded stale-lock
  takeover. Recorded as L0.47.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed one real folder location per
  workbook plus non-owning JMP-like dynamic Collections. Recorded as L0.48.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed project-local Collections and
  deferred cross-project discovery to a later read-only metadata catalog.
  Recorded as L0.49.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed linked derived worksheets for
  full-table corrections, with explicit **Freeze Copy** snapshots. Recorded as
  L0.50; added routine dependency-integrity requirements.
- **2026-08-13 — ChatGPT-Sol:** Owner confirmed safe extraction of a worksheet
  from a combined workbook, including movement of exclusive dependents and
  preservation of cross-source items. Recorded as L0.51.
- **2026-08-13 — ChatGPT-Sol:** After inspecting the current Stage and MDI
  window architecture, owner confirmed reusing it rather than adding a third
  persistent document-tab layer. Recorded as L0.52.
- **2026-08-13 — ChatGPT-Sol:** Paused the resumed owner interview for bedtime.
  Saved the unanswered session-restoration recommendation and approximately
  four further consequential decision areas. Routine UX details remain agent
  decisions under L0.41. No implementation started.
- **2026-08-14 — ChatGPT-Sol:** Resumed the interview and confirmed full project
  session restoration with lazy heavy-content loading and **Safe Open Without
  Layout** recovery. Recorded as L0.53.
- **2026-08-14 — ChatGPT-Sol:** Owner confirmed managed sidecar storage for very
  large 2D payloads, with explicit warning, portable **Pack Project...**, and
  graceful **Relink Data...** recovery. Recorded as L0.54.
- **2026-08-14 — ChatGPT-Sol:** Owner confirmed transactional reimport with a
  dependency preview, linked-data recalculation, safe plot refresh, stale
  analyses, unchanged frozen outputs, and one session undo. Recorded as L0.55.
- **2026-08-14 — ChatGPT-Sol:** Owner confirmed selectable Details metadata,
  project-only batch editing, grouping/filtering, session undo, and
  save-to-Collection. Recorded as L0.56.
- **2026-08-14 — ChatGPT-Sol:** Owner confirmed the three-milestone release
  order. Closed the consequential interview through L0.57, reconciled stale
  question checkboxes, and expanded the implementation queue through PR N.
  The only owner revisit is L0.44 after real cross-workbook use.
- **2026-08-14 — ChatGPT-Sol:** Added budget-conscious agent/model routing and
  per-slice pickup briefs. ChatGPT-Sol owns GUI architecture and usability;
  Claude Sonnet 5 implements most settled frontend and is the reliability/
  persistence default; ChatGPT implementation is concentrated on the tile
  workspace and Quick Figure Builder; Claude Opus 5 is reserved for schema,
  cross-process, dependency, destructive-transaction, and sidecar boundaries.
- **2026-08-14 — Claude (Fable):** Adversarial pre-acceptance review of this
  plan revision. (1) Verified every claim in the PR A technical boundary audit
  against the code — all exact (`workspace.ts` 632/633 pin, v1-v3 parse,
  `store/importDatasets.ts` 415 lines, `workspaceMerge.ts` folder-drop
  semantics, `originSheetGroups`/`planOriginFolders`). (2) Owner spot-verified
  the recorded confirmations directly in the Claude session: L0.2, L0.45,
  L0.54, L0.57 all confirmed as recorded. (3) Owner flipped slice B's
  implementation to Claude (Sol reviews the IA contract) — matrix, token rule
  1, kickoff order, and milestone 1 split updated. (4) Booked the three
  confirmed decisions that had no owning slice: L0.26 → new PR D2, L0.46 →
  PR A3, L0.47 → new PR I2 (with a platform-boundary caveat shared with
  PR I: browser/pywebview/Tauri modes need an explicit story for filesystem
  clipboard packages and locks). (5) Recorded the orchestrator mapping:
  Opus-designated contract/review roles execute inline in the owner's Fable
  session. (6) Launched PR A1: Fable-designed contract, Sonnet worktree
  implementation, adversarial review before merge.
