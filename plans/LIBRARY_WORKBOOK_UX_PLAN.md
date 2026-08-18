# Library, Workbook, and Quick Plot UX Plan

**Status:** Active — milestone 1; PRs A–F and G1–G4 merged; G5's automated
hardening (including the canonical-state review) is complete — only the
release-candidate human visual acceptance pass remains
**Created:** 2026-08-12  
**Updated:** 2026-08-17 — Claude completed the G5 canonical-state review,
correcting an independent reviewer's merge-blocking overclaim flag on the
prior lifecycle-proof slice's `[x]`; see the PR G / G5 entries and the
change-log for the full record
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

- [x] Store a dependency graph and reject cycles between calculated columns,
  derived worksheets, and analyses with a clear explanation. (PR K slices
  1-2: `lib/recalc.ts`'s `wouldCreateCycle`, wired into addFormula/
  updateFormula, applyCorrections' bgRef, and createDerivedWorksheet.)
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

- [x] **L1.1 Shared item identity:** tile, tree, and details renderers consume
  one canonical hierarchy and use the same IDs.
- [x] **L1.2 View selector:** provide Tiles / Tree / Details controls and
  remember the user's choice in preferences.
  - [x] PR D supplies persisted Tree / Details choice and keeps Tiles visible
    but disabled with an explanatory tooltip; PR E owns enabling Tiles only
    after its approved wide Library workspace exists.
  - [x] PR E-a enables Tiles, persists it through the same preference, and
    routes it to the wide main workspace rather than the 210 px sidebar.
- [ ] **L1.3 State continuity:** switching views preserves selection, active
  workbook/child, expansion where applicable, search, and keyboard focus.
  - [x] PR D proves continuity between Tree and Details, including disclosure
    of a focused Details child's ancestors when returning to Tree. Tiles
    continuity remains a PR E acceptance gate.
  - [x] PR E-a preserves canonical selection and active plot, uses the still-
    mounted Tree as tile navigation, and returns through Escape/**Back to
    plot** with a canonical reveal target and focus retry. Thumbnail/rapid-
    switching cancellation remains E-c.
- [ ] **L1.4 Interaction parity:** open, Quick Plot, rename, move, reveal,
  context menu, and drag/drop mean the same thing in every view.
  - [ ] Booking (2026-08-15 retrospective audit): artifact-row context menus
    and registry Delete actions (the "later PR (L0.39/L0.40)" promised at
    the consume-only Delete sites in LibraryTree.tsx/LibraryDetails.tsx)
    have no owning slice — assign at the next kickoff (candidates: D2 while
    it touches Details rows, or E's shared-action pass). Until assigned,
    those sites correctly consume the keystroke and do nothing.
- [x] **L1.5 Wide tile surface design:** produced thorough mockups and confirmed
  the main-workspace Library in L0.15. Implementation remains in PR E; do not
  squeeze production tiles into the default 210 px sidebar.
- [x] **L1.6 Search-results design:** confirmed flat Details-style results with
  full breadcrumbs and **Show in Library** in L0.26. Shipped by PR D2
  (2026-08-16, PR #144, merge `565bf08`).
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
2. [x] ~~**PR B — shared Library hierarchy view model.**~~ Added a pure,
   renderer-independent hierarchy over folders, workbooks, worksheets, and
   heterogeneous artifacts without importing renderer concerns into the
   store. Tree/Details/Tiles wiring remains PR C-D/E.
3. [x] ~~**PR C — Origin-like tree renderer.**~~ Shipped 2026-08-15 (PR #139,
   merge `d35b1e7`) after three review rounds — disclosure/double-click/
   remembered-child/selection/keyboard/context-menu behavior over the PR B
   hierarchy, `useLibraryTree` retired, L0.46 import targeting + batch
   folder offer, and the full L0.25 select/open contract for every node
   kind. Workbook Delete shipped DISABLED with a stable reason pending
   PR M's dependency-aware Trash (owner-reviewer boundary; see Completed).
4. [x] ~~**PR D — view preference and details renderer.**~~ Shipped 2026-08-15
   (PR #140, merge `a8bb751`; ChatGPT-Sol implemented, Claude/Fable blocking
   review cleared in one fix round — P1 Details Delete-leak closed via the
   shared `requestDatasetRemoval` path with five real-hook regressions, P2
   flat-when-sorted, P3s booked/fixed; full gate + Playwright 39/39
   independently verified at merge): persisted Tree /
   Details preference; visible disabled Tiles handoff to PR E; sortable Details
   projection over the canonical hierarchy; Name, Type, Folder/Workbook,
   dimensions, data type, source, import/modified time, and tags; compact
   narrow-panel fallback; and selection/search/focus continuity tests.
   Temporary sorting never mutates canonical manual order. This does **not**
   claim global L1.4 interaction parity: Details context menus, rename/move,
   and drag/drop still need the shared-action follow-through in their owning
   slices, and Tiles remains PR E.
4a. [x] ~~**PR D follow-up — Details roving keyboard traversal.**~~ Shipped
    2026-08-15 (PR #141, merge `f6a345b`) (Claude/Fable, 2026-08-15): roving tabindex
    (exactly one sequential tab stop in the table — last-focused row, else
    current item, else first; the scroll wrapper is OUT of the Tab order per
    the PR #141 review's P1), Up/Down through the CURRENT sorted order with
    clamping, Home/End, Enter keeps canonical open, handled nav keys
    preventDefault so the global prev/next-dataset navigation never fires
    from inside the table — including non-row targets within the table area
    (belt). Focus survives re-sort (the moved <tr> keeps focus) and removal
    (nearest-survivor recovery). Left/Right deliberately bubble untouched;
    `detailsNavIndex` is a tiny flat helper, not a libraryTreeNav reuse.
    Coverage: 3 pure-arithmetic tests, 8 component tests with the real
    useGlobalShortcuts hook (incl. a harness-validity control and a
    deliberately single-arrow leak regression — a down-then-up pair is
    vacuous because the global navigator wraps), and 1 real-browser @core
    Playwright journey (details-keyboard.spec.ts) proving the actual browser
    tab sequence jsdom cannot.
4b. [x] ~~**PR D2 — project-wide search results surface.**~~ Shipped
    2026-08-16 (PR #144, merge `565bf08`; one ChatGPT-Sol review round —
    Show-in-Library clipping — verified-then-fixed): the confirmed L0.26 behavior over the Details
    renderer — flat result list spanning EVERY hierarchy node kind with full
    `Folder / Workbook / Child` breadcrumbs, normal per-kind open, and a
    per-row **Show in Library** that clears the query and reveals the item
    (the reveal signal generalized to any `kind:id` node key). (Booked
    2026-08-14 — L0.26 previously had no owning slice.)
5. [ ] **PR E — tile-browser workspace (stacked sub-slices).** Implement the
   approved wide-surface behavior and interaction parity.
   - [x] ~~**E-a — shell + canonical browsing (ChatGPT-Sol, 2026-08-15)**~~ —
     SHIPPED 2026-08-16 (PR #145, merge `b18471a`, owner-directed merge after
     the Claude review + the owner-decision commit `c6df54a`). **Merged with
     three review findings OPEN by owner choice** — now tracked follow-ups on
     main for Sol's fix round (see change log 2026-08-16): focused-tile
     Delete leak (P1 — the tile must own Delete like Tree/Details rows),
     workspace Escape stealing the keystroke from the command palette /
     context menus (P2), pending-worksheet tiles showing 0 × 0 (P2). Tiles
     replaces Stage only; the Tree remains mounted; the active plot is not
     mutated. Folder/workbook tiles browse their canonical children; child
     selection uses `selectLibraryNode`, double-click/Enter uses
     `openLibraryNode`, arrows use one roving entry point, breadcrumbs navigate
     without rewriting hierarchy state, and Escape works even while focus is
     still in the sidebar. **Owner decision (Paige, 2026-08-16, from the
     Claude review's decision item): a STAGE-TARGET open from a tile
     (worksheet activation, Origin figure, editable-figure window, or a
     workbook resolving to one via L0.6) also returns to the plot — the open
     must be visible, never hidden behind the workspace; overlay opens
     (pages/reports/publication figures) keep the workspace open. Implemented
     by Claude directly on this branch (`opensInStage` in libraryOpen.ts +
     `openFromTile`), the "changed-plot" counterpart of L0.25's
     "Escape returns to the UNCHANGED active plot".** Worksheet tiles show the first three row-major data
     rows and up to four real columns plus correct dimensions—never an inferred
     plot. The workspace is lazy-loaded as its own ~5.8 kB chunk.
     - [x] ~~**E-a1 — merged-review hardening (ChatGPT-Sol, 2026-08-16)**~~ —
       SHIPPED 2026-08-16 (PR #146, merge `98ea821`; Claude review satisfied
       + merge owner-directed). All three post-#145 findings closed and
       verified against the real chokepoints (cmdkOpen store field, .qzk-ctx
       menu root, real ContextMenu in tests). The Claude review round added
       three red-proven pieces on the same branch (`5507693`): nearest-
       survivor focus recovery after deleting the focused tile (the Tree/
       Details row contract, now on tiles), the Escape editing exemption
       aligned with useGlobalShortcuts' isEditing (SELECT + isContentEditable),
       and the tiles E2E journey updated to the new listitem/dimensionsOf
       contract (the branch had broken it invisibly — GitHub CI does not run
       Playwright).
       A focused tile now owns Delete/Backspace through the canonical confirmed
       removal path; command palette, context menu, and active text editing own
       Escape before the workspace; pending worksheets show their true
       inventory dimensions with an **On demand** placeholder. This also closes
       the review's inexpensive P3s: preview cells use the shared scientific-
       number formatter and the linear roving surface exposes honest
       list/listitem semantics instead of an invalid ARIA grid. Focused
       regressions cover all three blocking findings.
   - [ ] **E-b — shared actions and heterogeneous preview polish:** give tiles
     the same context-menu/action registry as Tree/Details (including honest
     disabled reasons), complete per-kind summaries/source links, and close
     the booked L1.4 artifact-context-menu gap. Do not implement Quick Plot
     inference here; PR F owns that scientific contract.
     - [x] **E-b1 — canonical container/data actions (ChatGPT-Sol,
       2026-08-16):** merged as PR #147 (`f3ddc28`) after Claude review found
       and fixed three red-proven defects on the branch (`5616759`): menu
       right-click no longer collapses the enclosing multi-selection (tree
       `selectForMenu` parity — bulk actions reachable, Delete-key contract
       consistent), `onStageOpen` is a close-only `stageReturn` (no
       `activateFromLibrary` re-open detouring Origin books to the worksheet
       tab; panels/merge/plot-together also stage-return), and the folder
       menu states the whole-subtree dataset count (`subtreeCount` hoisted to
       `lib/foldertree.ts`). Mouse right-click and Context Menu/Shift+F10 on
       folder, workbook, and worksheet tiles reuse the existing Tree builders
       and registries; modal fallbacks provide Rename/Add tag where no inline
       row editor exists. Workbook **Browse** is enabled only where the Tile
       workspace supplies a browse target. Every node kind has a compact,
       factual kind/source summary. E-b remains open for E-b2's shared artifact
       lifecycle menus (the L1.4 gap); Quick Plot remains exclusively PR F.
     - [x] **E-b2 — shared artifact lifecycle actions (ChatGPT-Sol,
       2026-08-16):** merged as PR #148 (`c07b136`) after Claude review
       verified the recovery wording against real Undo boundaries and closed
       the booked Delete-keystroke debt on the branch (`279bed5`, see change
       log). One registry/builder supplies Open, Rename,
       Duplicate, Show source, Properties, and Delete to artifact tiles, Tree
       artifact rows, and Details rows. Editable-figure deletion names affected
       page panels; page/editable deletion preserves the established session
       Undo promise; publication/report deletion warns that no in-app recovery
       exists. Unsupported operations remain visible with reasons: recovered
       Origin artifacts are source-managed, reports cannot yet be duplicated,
       and unified artifact Properties is deferred. This closes the booked
       L1.4 artifact-context-menu gap without pulling Quick Plot forward from F.
   - [ ] **E-c — canonical thumbnails + scale safeguards:** actual editable/
     recovered figure thumbnails, natural analysis previews, revision-keyed
     cache, visible-only lazy generation, placeholders, cancellation, and
     large-Library fixtures/virtualization boundary. Claude should review cache
     invalidation and cancellation reliability before merge.
     **OWNER SPLIT (Paige, 2026-08-16):** three stacked slices —
     - [x] **E-c1 (Claude): thumbnail/cache infrastructure.** Merged as PR
       #149 (`07ce588`) after one Sol review round (dependency-aware
       fingerprints — see the two 2026-08-16 E-c1 change-log entries).
       Canonical
       thumbnail generation + invalidation contract, lazy visible-only
       loading, cache ownership, failure placeholders. Address the eager
       bundle budget FIRST (0.2 kB headroom at booking): an extraction pass
       per the ratchet's own rule (never raise the pin — split/defer to
       re-open the slack band), not a budget raise.
       *Implemented 2026-08-16 on `claude/quantized-origin-jmp-gaps-vbtfnm`,
       pending PR. Bundle pass recovered ~88 kB (903.1 → 814.9 kB eager; pin
       lowered 924,977 → 874,461 per the ratchet) by lazy-loading three
       runtime-conditional subtrees: Inspector (App.tsx, same-class fallback),
       StatStage + MultiPanelStage (PlotStage.tsx, MapStage precedent), and
       BackgroundPlotWindow (WindowCanvas.tsx, drags the alt-modes/stat
       cluster). Infrastructure: `lib/thumbnailCache.ts` (revision tagging by
       entity object identity via WeakMap, bounded 300-entry LRU with
       stale-revision drop, one-generator-per-kind registry with loud double-
       registration), `useThumbnail` hook (visible-only via
       IntersectionObserver with degrade-to-eager, AbortController
       cancellation on unmount/scroll-out, keyed-outcome staleness guard —
       the useCard provenance pattern), failure → error state, unsupported →
       honest static placeholder. One REFERENCE generator (page → panel-grid
       SVG data-URL, pure and jsdom-testable) proves the pipe end-to-end;
       E-c2 owns real preview visuals and the generator set.*
     - [x] **E-c2 (ChatGPT-Sol): tile preview UX.** Merged as PR #150
       (`a77d5e4`, owner-directed) after one Claude review round — three
       red-proven fixes on the branch (live-figure page panels, canonical
       Origin channel selection with book-matched dataset binding, typed
       `figureDeps`/`datasetDeps` request slices — see the 2026-08-16
       E-c2 change-log entries). Useful plot/table/
       analysis/page/report previews; loading/empty/error appearance; visual
       hierarchy, sizing, hover behavior, readability.
       *Implementation started 2026-08-16 on
       `sol/library-ec2-preview-ux`, after PR #149's dependency-aware cache
       fix merged. The bounded preview vocabulary uses lightweight canonical
       SVG generation rather than mounting the full plot engine per tile:
       editable/publication/recovered-Origin figures render real source or
       frozen data, pages compose their referenced figures panel-by-panel,
       and reports summarize their first natural content blocks. Tiles share
       clear loading, unavailable-source, unsupported, and error treatments,
       kind badges, restrained hover emphasis, and reduced-motion behavior.
       E-c3 virtualization remains explicitly outside this slice.*
     - [x] **E-c3 (Claude): large-Library safeguards.** Merged as PR #151
       (`4055699`, owner-directed after a max-effort critical review round
       fixed 8 findings — see the 2026-08-17 change-log entry). **E-c is
       now COMPLETE**: E-c1 cache → E-c2 previews → E-c3 scale.
       Virtualization +
       large-library fixtures; preserve selection, keyboard navigation, and
       "Show in Library"; performance and regression testing.
       *Implemented 2026-08-16 on `claude/quantized-origin-jmp-gaps-vbtfnm`,
       pending PR. Windowed tile rendering above 80 items (below: DOM
       byte-identical — every prior workspace test passes unchanged),
       delegating the clamped row-window math to lib/gridwindow's
       unit-tested `computeAxisWindow` (the worksheet viewport's helper).
       Keyboard navigation moved to MODEL-index + ensureVisible +
       guarded rAF focus retry (never steals focus the user moved
       elsewhere); every rendered window carries exactly one tabbable
       tile; entering any container (null root included) lands on the
       current selection and resets stale scroll; jsdom-deterministic
       measurement fallbacks are the unit-test contract, real geometry is
       covered by a 400-item Playwright journey (bounded DOM, live window
       movement, cross-boundary arrow nav, Escape/reveal). 11 scale tests
       — 4 proven red by force-disabling virtualization; uniform-row
       approximation documented in the hook header. TilePreview extracted
       from LibraryWorkspace (workshop pattern) to stay under the
       component ceiling.*
5b. [x] **PR E2 — session restoration and safe open.** Merged as PR #152
    (`dc2cb76`, owner-directed; parallel-delegation slice — Sonnet worktree
    agent implemented to Claude's scope/contracts, then a 5-finding Claude
    review round and two Sol review rounds, all red-proven — see the
    2026-08-17 change-log entries). Persist Library view,
    selection, remembered workbook children, and workspace placement alongside
    the existing window layout; restore heavy children lazily and add
    **Safe Open Without Layout**.
    *Three additive `.dwk` fields (no version bump): `librarySelection`
    (7-kind union — deliberately NO worksheet kind; worksheet selection IS
    `selectedIds`, L0.25), `workbookLastChild`, `expandedWorkbookIds` —
    sanitized degrade-never-throw with per-kind live-id validation, and the
    L0.25 selection exclusivity enforced at parse AND restore (a restored
    tree selection wins outright; no `[active]` synthesis). Safe open ships
    as a second command via `loadWorkspace`'s `skipLayout` option (layout
    dropped, everything else restores; the session's toolWindowLayout
    survives untouched); both open commands now confirm on
    `hasWorkspaceContent` — every user-owned collection loadWorkspace
    resets, techniqueViewMemory included — not `datasets.length`. All
    restored window geometry viewport-clamps on restore (maximized
    included).*
6. [x] **PR F — known-data Quick Plot contract.** Merged as PR #153
   (`2966c69`, owner-directed; the parallel slice to E2 — Sonnet worktree
   agent implemented to Claude's scope/contracts, then a 9-finding Claude
   review round (4 red-proven) and two Sol review rounds — see the
   2026-08-17 change-log entries). Add explicit availability,
   disabled explanations, data-profile/schema matching, and focused tests for
   supported column permutations.
   *Fail-closed by construction: a closed allowlist of line-plot
   techniques (`generic` is the never-guess bucket → "Configure Quick
   Plot…" reason), with the canonical `is2DMap` data-shape signal checked
   BEFORE the technique tag (an `xrd.rsm`-tagged map can never quick-plot
   as a line figure) and a finite x/y-pair probe (all-NaN axes fail
   closed). Strict L0.11 workbook resolution: a remembered-but-unrecognized
   worksheet disables with THAT sheet's reason, never silent substitution.
   Creation is structurally never-replace (fresh id through the canonical
   `createFigureDocument` → `editableFigures` → `openEditableFigure` path,
   seeded with the same view composition as normal plotting), one history
   entry per gesture, deduped names, and stage-return fires only when a
   plot actually happened.*
7. [ ] **PR G — Quick Figure Builder mapping slice.** Reuse the canonical
   editable-figure path; ship live preview, mapping, Cancel, and editable
   creation before advanced template management.
   - [x] **G1 — focused shell and transaction (ChatGPT-Sol):** Merged as PR
     #154 (`32f6660`) after the orchestrated review round fixed one P1
     red-first — `loadWorkspace` lacked the transient
     `quickFigureBuilderDatasetId` reset line every sibling transient field
     carries, pinning the builder over a freshly opened project (fix
     `04e1eae`) — see the 2026-08-17 G-stack change-log entry. Enable
     worksheet/workbook **Configure Quick Plot…**, open a lazy main-workspace
     surface over the unchanged Tree/Tiles/Stage context, hold only a transient
     source worksheet ID, and make Cancel/Escape a zero-mutation exit. Unknown
     data is deliberately accepted here; a vanished source fails closed.
     **Review ruling (2026-08-17):** "Configure Quick Plot…" is
     ALWAYS enabled when a worksheet exists, even when Quick Plot itself would
     succeed — a deliberate widening of the L0.9 escape-hatch framing, since
     the builder is the manual plotting path (Origin's Plot Setup analogue,
     always reachable), while Quick Plot remains the recognized-data
     shortcut. This supersedes the F-era always-disabled stub contract, whose
     test was replaced in this PR.
   - [x] **G2 — mapping draft and role assignment (ChatGPT-Sol):** Merged as
     PR #155 (`dd9bc1f`) after the review round fixed two P2s red-first (fix
     `16b02a0`): x-axis error bindings now clear whenever the X assignment
     changes (the `target: -1` axis sentinel had made them invisible to the
     dependent-binding cleanup — stale "± for column A" would have rendered
     as the new X's error), and error bindings dedupe last-write-wins per
     (target, axis, side) (the render layer's `.find()` silently drew the
     first duplicate). One local
     mapping state; X/Y/error/ignore roles through drag/drop and native
     keyboard-accessible role menus. Error roles explicitly name axis, target,
     and symmetric/asymmetric side; role changes remain exclusive and remove
     invalid dependent bindings.
   - [x] **G3 — live canonical preview (ChatGPT-Sol):** Merged as PR #156
     (`fc48d8e`); review found no P1/P2 — the slice is a genuinely thin
     adapter over the canonical payload builders (half asymmetric pairs and
     NaN handling inherited from the shared library, probe-confirmed; the
     shared `GraphPreview` ResizeObserver guard proven load-bearing by a
     negative-control revert). Render-level regression pins for the G2 fixes
     landed with `a2a9460`. Every valid draft
     change feeds the existing Graph Builder/Stage `PlotPayload`, `ErrorSpan`,
     and preview renderer contracts. Line, scatter, and line+symbol update
     live; alternate X, selected Y, and complete symmetric/asymmetric error
     pairs render from the draft without creating a parallel figure model.
   - [x] **G4 — create editable figure:** Merged as PR #157 (`f3d2e81`) —
     see the 2026-08-17 G4 change-log entry for the orchestrated
     scout/implement/review rounds. Commit once through the canonical
     FigureDocument lifecycle and open the result as an ordinary editable plot.
     The Create button runs the canonical quickPlotDataset-
     shaped commit sequence (pure `quickFigureCommit` converter + a
     `createQuickFigureFromMapping` sibling store slice, ONE undo, name
     dedupe); the seeded view is an explicit-whitelist overlay on
     `defaultPlotView()` (mapping's `xKey`/`yKeys` only — no
     `datasetViewDefaults`/`techniqueViewMemory` blending, since the mapping
     IS the user-confirmed replacement for that inference); and
     `usePlotPayload` now honors a document's own rich (X or asymmetric)
     error bindings as authoritative over `Dataset.errorRoles`, activated
     only when `hasRichErrorBindings` finds something the legacy `errKeys`
     projection cannot express, closing the gap where a builder-edited error
     binding rendered in the preview but silently dropped in the real figure
     window.
   - [x] **G5 — ambiguity and end-to-end hardening:** compact uncertainty
     explanation, real-browser keyboard/cancel/error-bar coverage, reopen proof,
     and visual acceptance at common desktop sizes. Explicit requirement (G2
     review, 2026-08-17): surface half-complete asymmetric error pairs (a `+`
     binding with no `-`, or vice versa) as visible incompleteness in the
     builder UI -- the render layer (`lib/errorRoles.ts`'s `asymmetricPair`)
     already excludes half pairs from the plot, so the builder must SAY so
     rather than staying silent about a binding the user made that never
     renders. Open semantic question (G4 review round, 2026-08-17, FIX 2): the
     builder's mapping UI can explicitly assign a `Dataset.channelRoles`
     (Label/Ignore) channel to Y, which the render layer (`effectiveChannels`)
     silently drops even from an explicit list -- today mitigated with a
     visible builder hint (never change the channel's role behind the user's
     back). **Resolved 2026-08-17:** mapping remains available so the conflict
     is understandable, but Create is blocked until the user explicitly clears
     the worksheet role; the builder never mutates source roles implicitly.
     - [x] **2026-08-17 — ChatGPT-Sol (delegated implementation), PR #158
       (merged `7bb0c76` after the review round below):** the
       builder now identifies half-complete asymmetric pairs by affected
       columns and blocks creation with a concise reason; explicitly mapped
       Label/Ignore Y columns likewise block creation without mutating the
       worksheet role. Disabled reasons are programmatically associated with
       Create; long scientific names wrap without crushing role controls; and
       warning presentation remains compact at constrained sizes. Focused
       unit/component coverage covers correction, cancel/no-mutation, and
       readiness. A real Library-to-builder Chromium journey now proves
       Cancel/Escape safety, native role assignment, half-pair blocking,
       complete asymmetric creation, and exactly one rich-error document; a
       900×700 long-label journey pins reachability and horizontal containment.
       Remaining Claude-owned G5 work is save/close/reopen/project-reload proof
       and the canonical-state review. Final human visual acceptance remains a
       release-candidate task rather than an automated claim.
     - [x] **2026-08-17 — PR #158 review round (independent reviewer,
       probe-confirmed):** Sol's handoff above omitted that the button's
       readiness checks (role-filtered Y, incomplete asymmetric pairs) were
       gating the Create BUTTON only -- the store action
       (`createQuickFigureFromMapping`) still gated on `mappingReady` alone,
       so calling it directly with either probe shape (a lone `+`/`-` error
       binding, or a role-filtered-only Y mapping) succeeded and created a
       figure whose content silently vanished at render, a parallel-readiness
       drift of exactly the kind this codebase's lessons-learned bans.
       Closed: `canCreateQuickFigure` (`lib/quickFigureMapping.ts`) is now the
       ONE predicate both the button and the store action gate on, so they
       cannot drift apart again; the role-filtered notice copy was also
       aligned to "blocked" framing (it previously read as G4-era
       allow-and-drop), and the joint-condition case (both a role-filtered Y
       and an incomplete pair at once) now reports both notices via
       `aria-describedby`/title instead of only the higher-priority one.
     - [x] **2026-08-17 — Claude, the lifecycle proof (save/close/reopen/
       project-reload, closing the remaining Claude-owned G5 work):** Phase 0
       probed the three riskiest seams BEFORE building the journey and found
       all three already correct, with evidence: (P0-a) the `.dwk` round trip
       of a figure-scoped asymmetric pair + an X-error binding — both through
       `editableFigures` and the window-attached document path
       (`windowDocumentPersistence.ts`) — because `sanitizeFigureDocument`'s
       `errorBindings()` reads `bindings.errors` straight off the persisted
       JSON and never reconstructs from `plot.view`/legacy `errKeys`; (P0-b)
       a normal property edit (a per-series style / axis label, the same
       fields `updateFigureDocumentFromPlotView` folds in) survives Save,
       window close, and reopen from Editable Figures, because that function
       deliberately preserves every non-symmetric-Y binding while only
       replacing the legacy projection it can actually edit; (P0-c) Undo/Redo
       stays coherent across create → edit → save → close → reopen, because
       `recordHistory`'s allowlisted snapshot already carries both
       `editableFigures` and `plotWindows` together, so no step in the chain
       can detach an edit from its document or resurrect a closed window.
       Since nothing was broken, the probes became permanent regression pins
       (`frontend/src/lib/workspace.test.ts`,
       `frontend/src/store/quickFigureLifecycle.test.ts`) rather than fixes.
       The real-browser proof (`frontend/e2e/specs/quick-figure-lifecycle.spec.ts`)
       drives the owner's full checklist as ONE Chromium journey: builds a
       Quick Figure through the real Library → Configure Quick Plot flow
       (alternate X, 2 Y series, a complete asymmetric Y pair, an X-error
       binding, line+symbol style); edits the Y-axis label through the
       Inspector; saves and closes via the window's own title-bar controls;
       reopens from the Editable Figures Library section; saves the complete
       project through the real File ▸ "Save workspace (.dwk)…" menu (a real
       browser download) and reloads it through the real File ▸ "Open
       workspace (.dwk)…" native file picker (a real `filechooser` event,
       confirmed through the actual "Replace the current workspace?"
       dialog) — the realest driveable path, not a store-only shortcut; then
       reopens the figure again post-reload and asserts the X/Y mapping,
       mark + line-symbol `seriesStyles`, the axis-label edit, and both rich
       error bindings all survived byte-exact, with a final real-keyboard
       (Ctrl+Z / Ctrl+Shift+Z) Undo/Redo spot-check that leaves exactly one
       window bound to the document throughout. (Two spec-authoring bugs
       caught and fixed red-first along the way, not app bugs: the Quick
       Figure Builder's "Plot style" `<select>` is a wrapping `<label>` whose
       real-Chromium accessible name folds in the current option text, so an
       exact `getByLabel` match hung — fixed with a class-scoped locator; and
       the Library TREE row's L0.25 single-click-selects/double-click-opens
       convention means a single `.click()` on "Editable figures" only
       selected the row — fixed with `.dblclick()`, matching
       figure-document-roundtrip.spec.ts's existing precedent.) Gate: 478/478 vitest files,
       7,061/7,061 tests; tsc (app + e2e) and eslint clean; build 826.1 kB
       eager (27.9 kB under budget); full local Playwright 54/54 passed.
       **Correction (independent reviewer, 2026-08-17, merge-blocking):**
       this bullet marked G5 `[x]` claiming everything but the
       release-candidate human visual acceptance was done, but the plan's
       own G ownership-matrix row ("Sonnet reviews canonical-state writes")
       and the sentence originally written below this one both named a
       second Claude-owned handoff item — a review of the canonical
       figure-document write paths — that this slice silently never
       performed. See the dedicated review bullet immediately below, which
       performs it and corrects the record.
     - [x] **2026-08-17 — Claude, the canonical-state review (closing the
       gap the correction above documents):** authority documents:
       `lib/figureContract.ts` (the field-ownership census) and the plan's
       L0.12/L0.13 contracts (editor continuity into the SAME canonical
       system; creating/saving a figure never mutates raw worksheet data).
       Enumerated every code path that writes canonical `FigureDocument`
       state (grepped `editableFigures`/`withPlotWindowDocument`/
       `createFigureDocument` for anything the known list missed — none
       found) and reviewed each against never-replace, live/frozen
       invariants, rich-error round-trip integrity, name/id uniqueness,
       history coherence, and degrade-never-throw on malformed input:
         - `lib/figureDocument.ts` (`createFigureDocument`,
           `updateFigureDocumentFromPlotView`, `sanitizeFigureDocument`,
           `figureDocumentToPlotView`) — CLEAN. Pure and immutable (every
           path returns a fresh object; grepped the whole `frontend/src`
           tree for a direct `document.bindings.* =` / `document.plot.* =`
           field assignment — none exists outside a local, freshly cloned
           value). `createFigureDocument` throws on an inconsistent
           live/frozen combination; `sanitizeFigureDocument` rejects the
           whole document only on a bad envelope/identity/data-mode/frozen
           snapshot, degrading every other malformed optional field to a
           safe default. `updateFigureDocumentFromPlotView` preserves every
           non-symmetric-Y (X-axis, asymmetric) error binding while only
           replacing the legacy `errKeys` projection it can actually edit —
           no lossy round trip (the exact contract G4's fix established,
           reconfirmed here).
         - `store/windowDocuments.ts` (`withPlotWindowDocument`,
           `createPlotWindowDocument`, `syncPlotWindow`,
           `withWindowDocumentErrors`, `pruneWindowDatasetRefs`) — CLEAN.
           `withPlotWindowDocument` is the one documented chokepoint
           (`structuredClone`s on every call) every other write path routes
           through; `pruneWindowDatasetRefs` nulls a removed dataset's
           binding in BOTH the canonical document and the legacy facade
           together, never one without the other.
         - `store/quickPlotAction.ts` / `store/quickFigureCreate.ts` —
           CLEAN. Structurally identical shape: fail-closed gate
           (`quickPlotAvailability` / the shared `canCreateQuickFigure`
           predicate), fresh id, `dedupeWindowTitle`-deduped name, APPEND
           to `editableFigures` (never an existing-by-datasetId lookup+
           overwrite), one `recordHistory` for the whole gesture (riding on
           `createWindow`'s).
         - `store/figureLifecycle.ts` (`saveFigure`/`saveFigureAs`/
           `openEditableFigure`/`renameEditableFigure`/
           `duplicateEditableFigure`/`deleteEditableFigure`/
           `applyFigurePublicationEdit`'s three targets) — CLEAN.
           `saveFigure`'s overwrite-by-id only ever replaces the SAME
           document being re-saved, never a different figure; the
           `new-editable` Apply branch always appends fresh; one
           `recordHistory` per user gesture throughout; no direct field
           mutation (same grep as above).
         - Window-close path (`store/windows.ts`'s `closeWindow`,
           `components/windows/figureLifecycleUi.ts`'s
           `closeFigureWindow`/`cancelPublicationPreview`) — CLEAN and
           deliberate: a window never saved as a figure closes plainly
           (undoable, per GUI_INTERACTION #17's confirm-exemption); a SAVED
           figure with unsaved drift, and an untracked Publication Preview
           draft, both get an explicit discard confirm first. Matches
           documented intent — not silently lossy.
         - Reimport/dataset-replacement path (`lib/reimport.ts`,
           `store/reimport.ts`, `lib/figureDocumentReimport.ts`) — CLEAN
           for the channel-indexed fields that reach the interactive
           renderer: `reimportColumnsChanged` fires on ANY column-count
           change (grow OR shrink — it only compares counts, not
           direction), and `resetFigureDocumentForReshape` clears
           `xKey`/`yKeys`/`y2Keys`/`errors` plus every channel-indexed
           `plot.view` field to the safe null/empty sentinel for BOTH the
           saved `editableFigures` entry and every bound open `plotWindows`
           document. **Probed** (new permanent regression pin,
           `frontend/src/store/quickFigureReimport.test.ts`): built a rich
           mapping (alternate X, one Y, a complete asymmetric Y pair, an
           X-error binding on channels 2/3/4) into a figure through the
           real G4/G5 creation path (`createQuickFigureFromMapping`), mocked
           a reimport of its dataset down from 5 columns to 1 (the exact
           columns the rich bindings target vanish entirely, not merely
           renumber), and confirmed: the saved document's and the open
           window's canonical bindings both reset to
           null/null/`[]` (no dangling reference to the vanished columns),
           and `figureDocumentToPlotView` on the reset document neither
           throws nor still names them (`errKeys: {}`). Passed on the first
           run — found already correct, not a fix. **Real finding, out of
           G5 scope, booked under PR M** (with a pointer at that item):
           `resetFigureDocumentForReshape` deliberately leaves
           `bindings.groupKey`/`facetKey` untouched on reimport; `groupKey`
           reaches the backend as `FigureSpec.group_col` and a stale index
           raises a raw `ValueError` from `calc/plotting.py` at
           export/preview time instead of a clear explanation (not a crash
           or silent mis-bind, and unreachable via the Quick Figure Builder
           itself — only via the separate Figure Builder workshop's
           Grouping panel) — L0.55's territory, not G5's.
         - `store/history.ts` undo/redo restore of `editableFigures`/
           `plotWindows` — CLEAN. Structural sharing (old snapshots keep
           array/object references from the live state at record time) is
           safe here specifically BECAUSE every document write path above
           was confirmed to construct new objects rather than ever mutating
           one in place — a restored snapshot's document references can be
           shared with what was live at snapshot time without risk, since
           no later edit can reach through and corrupt them. Separately
           probed `restorePatch`'s dangling-dataset-binding guard
           (`history.test.ts:130`) against a document-backed window (the
           existing test's `PlotWindow` fixture omits `.document`, so it
           only exercises the legacy facade field): every real mutation
           that changes a window's dataset binding routes through
           `syncPlotWindow`/`withPlotWindowDocument`, which keep the facade
           `datasetId` and the canonical `document.bindings.datasetId`
           synchronized together, so no reachable sequence left them
           disagreeing in a recorded snapshot — the guard's facade-only
           patch never diverges from the canonical document in practice.
           No fix needed; noted here rather than left unrecorded.
       Gate: `frontend && npx tsc --noEmit` clean; `npx eslint` (touched
       files) clean; full `npx vitest run` 479/479 files, 7,062/7,062 tests
       (one new pin over the prior 478/7,061); `npm run build` 826.1 kB
       eager (27.9 kB under budget, unchanged — no app code touched). No
       Playwright changes needed (no app code changed — this bullet is
       review + one new permanent test file:
       `frontend/src/store/quickFigureReimport.test.ts`). G5's remaining
       line is unchanged: the release-candidate human visual acceptance
       pass noted above.
8. [~] **PR H — template persistence and scopes.** Save named mappings/styles
   with explicit scope and safe mismatch behavior. Implemented-pending-review
   (2026-08-17): `lib/quickPlotTemplates.ts` (H1 object + sanitizer, H4
   `resolveTemplate`), `store/quickPlotTemplates.ts` (H3 CRUD +
   apply-delegation), the `.dwk` `quickPlotTemplates` field
   (`lib/workspace.ts`'s four-site additive pattern) and its `HistorySnapshot`
   inclusion (`store/history.ts`, same commit as the slice — the savedRois-
   incident gate), the Quick Figure Builder's **Save Quick Plot Template…**
   action, and the **Quick Plot With…** chooser
   (`components/overlays/QuickPlotWithDialog.tsx`) wired onto the worksheet
   and workbook context menus + the ⌘K palette, hidden until ≥1 template
   exists (L0.37). Rulings recorded here:
   - **Lean template object, two scopes.** Scope is exactly `{kind:"workbook",
     workbookId}` or `{kind:"schema"}` (L0.31's confirmed default) — no
     third/global/named-import scope yet.
   - **Refusal-with-report, never partial apply.** `resolveTemplate` re-keys
     every mapped channel (X, each Y, each error binding endpoint) by its
     saved LABEL, exactly like `techniqueViewMemory`'s re-key idiom, but
     UNLIKE that function's partial tolerance: any single unresolved channel
     refuses the WHOLE apply, naming every unmatched field — a silently
     partial figure is a worse failure than an honest
     "Configure Quick Plot..." refusal. Cross-technique is never bridged,
     workbook-scoped templates gate to their own workbook, and a same-label-
     different-unit column (e.g. "B" in Oe vs. Tesla) is treated as
     unresolved too. The captured `signature` (H1) plays a deliberately
     BOUNDED role in matching — it is not a second independent matcher: the
     saved LABEL re-key above is the real matcher (which channel is which),
     and `signature` only feeds the per-channel UNIT check at the label's
     resolved index (same-label-different-unit refusal, just above).
   - **History inclusion is not optional.** `quickPlotTemplates` landed in
     `HistorySnapshot`/`snapshotOf` in the SAME commit as the store slice —
     see `store/history.ts`'s own savedRois-incident warning this guards
     against.
   - **Never auto-save, never silently overwrite.** Only the builder's
     explicit **Save Quick Plot Template…** action creates a template;
     saving under a name already in use dedupes it (`dedupeWindowTitle`
     idiom: "Name", "Name (2)", ...) rather than replacing the existing
     entry. `applyQuickPlotTemplate` never touches `quickPlotTemplates`
     itself — it only resolves + delegates to the canonical
     `createQuickFigureFromMapping` (G4), so apply carries the SAME
     one-undo-per-gesture guarantee as Quick Plot/the builder's own Create.
   - **What stays open under P1.3:** the full recipe-field vocabulary (only
     mapping/style/technique/signature are captured here, not axis
     limits/legend/decor), a global or exportable/cross-project scope, and
     reverse-mapping an existing editable FigureDocument back into a
     template (the editable-figure context menu's **Save as Template…**
     ships as an honest disabled stub pointing at the builder, per H5c —
     `components/Library/artifactContextActions.ts`).
   - **Review round (2026-08-18) — the orphan bug, fixed:** a workbook-scoped
     template must never become permanently invisible/unmanageable. DANGLING
     (the owning workbook no longer exists in the doc) is sanitized out at
     `.dwk` LOAD time (`lib/workspace.ts`'s `parseWorkspace`, the E2
     `librarySelection`/`parseWorkbookLastChild` aliveness pattern) —
     `lib/quickPlotTemplates.ts`'s `pruneDanglingWorkbookScopeTemplates`.
     MEMBERLESS-but-ALIVE (the workbook exists but currently has zero
     worksheet children — reachable via ordinary `removeDatasets`) is
     deliberately NOT pruned — a workbook can regain members — and stays
     reachable through the manage surface: the workbook menu's **Quick Plot
     With…** is visible whenever the workbook owns ANY workbook-scoped
     template, even with no worksheet child, opening the chooser in a
     workbook-only mode (`store/quickPlotWithDialog.ts`'s `workbookId`) that
     lists those templates disabled with "workbook has no worksheets" and
     keeps inline rename/delete fully functional (L0.36: disabled with
     reason, never hidden). Pruning on an actual workbook DELETE is booked
     under PR M, not here — see that item's entry above.
9. [ ] **PR I — cross-instance workbook transfer.** Implement the versioned,
   bounded Copy/Paste package, fresh-ID rewrite, provenance, and failure-safe
   cleanup contract from L0.23-L0.24.
9b. [ ] **PR I2 — single-writer project locking.** Implement L0.47:
    second-instance read-only open, **Open as Copy**, and guarded stale-lock
    **Take Over Editing**. Requires the same platform-boundary answer as PR I
    (backend `io/` + thin route on the served modes; define the two-browser-
    tabs-one-backend story explicitly). (Booked 2026-08-14 — L0.47 previously
    had no owning slice.)
10. [~] **PR J — combined and split workbooks.** Implement explicit combine,
    transactional multi-source reimport, collision-safe naming, and dependency-
    aware separation from L0.32-L0.34 and L0.51.
    - [x] **slice 1 — combine/separate against the frozen dependency contract
      (Claude, worktree agent, sprint Day-2):** implemented pending review, on
      `claude/j-combine-split`. Store-only (no UI) — mirrors PR K slice 1's
      scoping precedent (see that item's log). **Combine** (L0.32-L0.34):
      `lib/workbookCombine.ts`'s pure `resolveCombineTargets` (expands a
      selected whole workbook to every live member + individually-picked
      worksheets, de-duplicated), `suggestCombinedWorkbookName` (longest
      shared basename prefix, undefined below a 3-char floor — "when one is
      clear"), and `dedupeWorksheetNames` (the `dedupeWindowTitle` "Name",
      "Name (2)", … idiom, scoped to the incoming batch only — two unrelated
      workbooks may legitimately share a worksheet name elsewhere);
      `store/workbookCombine.ts`'s `combineWorkbooks(selection, name)` mints
      ONE new workbook (`nextWorkbookId`) and reassigns the resolved
      worksheets' `workbookId` (+ deduped display name) in one `set()`/one
      `recordHistory`. Source path/importedAt provenance rides the dataset
      object untouched — no reimport machinery is invoked (L0.33 stays PR
      M's). Source workbooks are DELIBERATELY never deleted (even fully
      drained) — the plan's documented memberless-but-alive state, so a
      workbook-scoped Quick Plot template never dangles and PR M's
      delete/prune contract is never triggered by this PR. Refuses (zero
      mutation) on an empty selection or blank name. **Separate** (L0.51):
      `lib/workbookSeparate.ts`'s `closeExclusiveDependents` — a fixpoint
      closure over the SAME bgRef/derivedFrom edges `lib/recalc.ts`'s
      `buildEdges` folds (re-derived rather than imported, since
      `downstreamOf` answers "reachable" not "exclusively dependent" — a
      dataset with an EXTRA dependency outside the moving set never joins,
      pinned by a two-upstream-fields test) — and `computeSeparatePlan`,
      which builds the affected-item preview by calling
      `lib/libraryHierarchy.ts`'s `buildLibraryHierarchy` TWICE (current
      state, and a hypothetical post-separate state) and diffing each
      figure/page/report/derived-worksheet's placement: **the key finding
      this slice turned up is that no explicit "rewrite a source link" step
      exists anywhere in this codebase** — every artifact kind (origin/
      editable/publication figure, page, report) resolves its Library
      placement FRESH from its source dataset(s)' CURRENT `workbookId` on
      every hierarchy build (already true before this PR; FigureDocument/
      FigureDoc/ReportEntry are all single-`datasetId`-only, so only Origin
      figure families and multi-panel Pages can even span >1 worksheet), so
      the ENTIRE commit mutation is "mint one workbook, reassign
      `workbookId` on the moving dataset ids" — nothing else to touch, and
      nothing that can drift out of sync with a stored link, because there
      is no stored link. Preview/commit are two store actions
      (`store/workbookSeparate.ts`): `previewSeparateWorksheets` computes and
      opens a `SeparatePlan` (new `separatePreview` state field — transient,
      added to `architecture.test.ts`'s HISTORY_EXCLUDED, mirroring
      `splitDialogTargetId`); `commitSeparateWorksheets` REFUSES with zero
      mutation unless a preview is open (preview-before-commit is a hard
      gate, not just a UI convention) and re-validates every previewed
      moving id is still live before applying (fails closed on a
      preview/commit race, e.g. the worksheet got removed by something else
      meanwhile) — one `recordHistory`/one `set()` on success. Both slices
      composed into `useApp.ts` exactly like `workbookActions.ts` (2 import
      lines + 2 extends-union words + 2 spread lines + one `loadWorkspace`
      reset line for `separatePreview`; the 2818 pin is untouched, still
      well under it). P1.4's `cat_levels` merge contract was checked and
      found N/A: combine never merges worksheet ROW data into one sheet
      (`lib/merge.ts`'s `mergeDatasets` is the feature that does that,
      untouched here) — L0.34 keeps every combined worksheet a separate
      child by design. Red-first throughout; every pin (collision
      suffixing, the exclusive-vs-shared dependency split, the
      preview-before-commit/staleness gate) mutation-tested by temporarily
      breaking it and confirming the test catches it. Gates green: `tsc
      --noEmit` clean, `eslint --max-warnings=0` clean on touched files,
      full `vitest run` 495/495 files, 7338/7338 tests, `npm run build`
      845.2 kB eager (8.8 kB under the 854.0 kB budget). **Deferred to a
      later slice** (booked here, not silently dropped): the actual dialog
      UI (name-prompt/prefix-suggestion for Combine, the affected-item
      preview list for Separate) and Library context-menu wiring —
      `store/workbookCombine.ts`/`store/workbookSeparate.ts` expose a
      complete, independently-tested action contract for that UI to call
      directly, same "NO UI, slice 2's job" scoping PR K slice 1 used;
      L0.33's transactional multi-source reimport (PR M's machinery, per
      this PR's brief); PR I's cross-instance transfer; Lane D2's
      dependency-graph WRITES (this slice only READS `downstreamOf`-adjacent
      structure via `closeExclusiveDependents`, never persists a graph).
      **Slice-2 caveat (booked from the adversarial review, 2026-08-18):**
      `previewSeparateWorksheets` mints `nextWorkbookId()` once per preview
      OPEN — fine for today's static, open-once-per-gesture preview, but a
      live-updating preview (re-running as the user tweaks the separate
      selection) must NOT re-mint on every recompute/keystroke; mint once at
      commit instead, or memoize the id across recomputes of the same open
      preview. Booked as a slice-2 constraint, not built here.
    - **Review round (2026-08-18, adversarial verdict SOUND-WITH-FIXES) —
      P1/P2 fixed, same commit as slice 1's plan-doc entry:** P1 (probe-
      proven): `combineWorkbooks`/`commitSeparateWorksheets` reassigned
      `Dataset.workbookId` but left `folderId` untouched, breaking the
      `lib/workbooks.ts:52-54`/`moveWorkbookToFolder` invariant ("folder
      placement is owned by the WORKBOOK") and split-braining Folder view
      (`lib/foldertree.ts`'s `folderDatasets`, read by `Library.tsx`/
      `SmartFoldersSection.tsx`/`datasetRowMenu.ts`) against the workbook
      tree. Fixed: combine's new workbook lands at the Library root, so
      every moved worksheet's `folderId` is set to `undefined` UNCONDITIONALLY
      (mirroring `moveWorkbookToFolder`'s own `folderId ?? undefined`);
      separate's moving datasets (seed + closure-swept dependents, which can
      carry a DIFFERENT drifted `folderId` than the seed) are all re-homed to
      `SeparatePlan.newWorkbookFolderId` (the source workbook's folder).
      Red-first: a dataset moved from a foldered workbook no longer
      disappears from `folderDatasets(oldFolder)` (combine) and a
      closure-swept dependent with a drifted `folderId` gets re-homed to
      match the seed's new placement (separate) — both quoted red in the
      session transcript, both mutation-tested by reverting the fix. P2
      (should-fix): `closeExclusiveDependents`'s bgRef live-edge predicate
      (`d.bgRef && d.corrections && d.raw`) had no test isolating each half —
      the sole negative case dropped BOTH `corrections` and `raw` at once, so
      a mutated predicate missing just `&& d.raw` (or just `&& d.corrections`)
      still passed all 14 prior tests. Added two isolated cases; each was
      proven red under its matching single-field mutation, then the
      predicate was restored. P3 (booked): `previewSeparateWorksheets`'s
      `nextWorkbookId()`-per-open caveat above.
11. [x] **PR K — calculated columns and derived worksheets.** Add the acyclic
    dependency graph, visible formula/derived state, deterministic recalculation,
    and **Freeze Copy** from L0.43 and L0.50.
    - [x] **slice 1 — dependency foundation (Claude, worktree agent):**
      implemented pending review, on `claude/k-dependency-foundation`. K1
      static `referencedColumns` (reuses compileFormula's own parse, one new
      `onRef` hook — no second parser); K2 schema (`ComputedColumn.deps`,
      `Dataset.derivedFrom`, `Dataset.formulaErrors`, all additive .dwk,
      no version bump — `formulas[].deps` rides the existing per-entry
      passthrough, `derivedFrom`/`formulaErrors` got their own
      `lib/workspaceComputedColumns.ts` serialize/parse helpers); K3
      widened `lib/recalc.ts` graph (ds:/col:/sheet:/fit: vocabulary) —
      THE RULING: the graph is derived fresh from `Dataset.bgRef` /
      `.fitSpec` / `.derivedFrom` / `ComputedColumn.deps` on every query,
      never itself persisted (documented in the module header) —
      `downstreamOf` reimplemented on top of it, same public shape, all
      prior tests green; K4 write-time cycle rejection
      (`wouldCreateCycle`, pure + exported) wired into `addFormula`/
      `updateFormula` (new `store/computedColumns.ts` slice — also funded
      useApp.ts headroom by extracting addFormula/removeFormula out of the
      pinned file) and `applyCorrections`' bgRef (`store/corrections.ts`) —
      the constructible-today A↔B bgRef cycle is now REFUSED at write time
      (red-first pin in `store/recalc.test.ts`), zero mutation, clear
      status explanation naming the cycle path; K5 invariants pinned by
      test — (a) synchronous same-dataset formula freshness unchanged,
      (b) a failing formula now carries a visible `Dataset.formulaErrors`
      entry alongside its NaN column (previously silent), (c) a derived
      worksheet (`derivedFrom` set) is stale-marked but never synchronously
      recomputed — `downstreamOf`'s generalization gives this for free, no
      `touchDataset` logic change needed, (d) a ds→sheet→fit chain settles
      in topological order inside one `recalcNow` (also free, from the
      existing two-phase corrections-then-fits order once `staleFits` is
      populated by the same widened graph walk), (e) one `recordHistory`
      per gesture pinned. `updateFormula` — an authoring action the
      contract names but that didn't exist before this slice — is new
      (edit an existing computed column's name/expr/unit in place). NO UI:
      no derived-worksheet creation surface, no Freeze Copy, no visible
      error-state marking in the worksheet grid — those + the `derivedFrom`
      setter's own cycle-check wiring are slice 2. Unblocks: PR M's
      dependency-aware Trash/reimport preview (booked pointer at line
      ~537/2353) can now query `downstreamOf`/`wouldCreateCycle` for
      derived worksheets, not just bgRef chains; PR J's dependency-aware
      workbook separation (L0.51) has the same generalized graph to query.
    - [x] **slice 2 — derived worksheets + Freeze Copy, happy path (Claude,
      worktree agent):** on `claude/k-derived-worksheets`, rebased onto
      main after slice 1 merged (PR #172) plus H's Quick Plot templates
      and P1.4's categorical contract. The `derivedFrom` setter is
      `store/derivedWorksheets.ts`'s `createDerivedWorksheet(sourceId,
      params, pipelineLabel?)`: runs `params` (the SAME `CorrectionParams`
      shape `applyCorrections` already uses — no new pipeline DSL) against
      the source's CURRENT raw/data via the existing corrections API, and
      commits the result as a brand-new dataset (`get().addDataset`, the
      MAIN_PLAN #9 single entry point) carrying `derivedFrom` + the SAME
      workbook/folder as its source — wired through `wouldCreateCycle`
      first (K4), refusing with zero mutation; the source itself is never
      mutated. The REAL EXECUTOR (replacing slice 1's honest no-op):
      `recomputeDerivedSheet` re-runs a derived sheet's own `.corrections`
      (its re-runnable pipeline recipe) against its source's LATEST raw/
      data, called ONLY from `useApp.ts`'s `recalcNow` — never
      synchronously from `touchDataset` — keeping slice 1's invariant (c)
      intact (pinned red-first: temporarily reverting the `recalcNow`
      branch to the old no-op fails 3 tests in `store/recalc.test.ts`,
      restoring passes all). **Freeze Copy** (`freezeCopy(id)`) severs the
      link entirely: a plain dataset with no `derivedFrom`/`corrections`/
      `raw`, `data.metadata.frozenFrom` recording source id/pipeline/
      timestamp, one `addDataset`-supplied history entry. Visible marking:
      a derived-worksheet badge (new `DerivedWorksheetMark.tsx`, the
      `RecomputedMark.tsx` pattern — `DatasetRow.tsx` sits at the 400-line
      ceiling) in the Library row, a source+pipeline banner with an inline
      **Freeze Copy** button in the Worksheet pane, and a K5b formula-error
      header badge threaded `WorksheetPane → GridViewport → GridHeader`.
      Both actions get dataset-row context-menu entries (new
      `lib/derivedWorksheetActions.ts`, spliced into
      `datasetRowMenu.ts` — kept out of `lib/contextActions.ts`, which
      sits exactly at the general 500-line ceiling with zero headroom).
      OUT of scope (per the dispatch): M's reimport/delete propagation,
      J's separation, user-settable level ordering, any UI beyond grid/
      Library marking + the create/freeze actions and their menu entries.
12. [~] **PR L — Details metadata and Collections.** Add column selection,
    batch project-metadata edits, grouping/filtering, session undo, and
    project-local saved Collections from L0.48-L0.49 and L0.56. **Slice 1
    (sprint Day-2, `claude/l-metadata-collections`):** selectable Details
    columns, batch project-metadata edit, and basic Collections landed.
    Selectable columns — `lib/libraryDetailsColumns.ts` (bounded 10-column
    set; Name stays mandatory, the original seven default ON, three new
    project-metadata columns — sample/notes/group — default OFF and
    discoverable via the new `LibraryDetailsColumnsMenu.tsx` picker; the
    picker is session-local state on `LibraryDetails.tsx`, not yet
    `.dwk`-persisted). Batch edit — `store/datasetMeta.ts`'s new
    `batchEditDatasetMetadata(ids, patch)`: notes/group/add-tags/remove-tags
    applied to the whole selection as ONE `recordHistory` call (pinned by
    `datasetMeta.test.ts`'s "is undoable as exactly ONE entry" +
    "NEVER rewrites the imported raw data/header" boundary tests); wired to
    a new "Edit metadata (N)…" control in the Details toolbar (shows the
    affected count in the dialog title and the confirmation toast) and to
    `MultiSelectBar`'s existing Tag button (previously N `recordHistory`
    calls for a tag-the-selection gesture — a live L0.56 violation the new
    action also fixes, pinned by a new "exactly ONE entry" test there).
    Tags — already first-class project metadata from PR A2
    (`addDatasetTag`/`removeDatasetTag`, shown in Details, searchable via
    the existing `tag:` grammar); no new work needed, confirmed by test.
    Collections — new `lib/collections.ts` (`Collection` type,
    `collectionMembers` derived over the canonical `LibraryHierarchy` via
    the SAME shared query grammar Smart Folders/search already use, never a
    stored id list) + `store/collections.ts` (CRUD slice: add/rename/
    re-query/delete, each one undoable `recordHistory` call) +
    `components/Library/CollectionsSection.tsx` (a cross-cutting section
    beside Smart Folders; a member row reveals its ONE real location via
    "Show in Library" rather than opening a second place for it — L0.48's
    ownership distinction) + a "⊙ Save this filter as a Collection…" button
    beside the existing ☆ smart-folder one. Persists in `.dwk` additively
    (`lib/workspace.ts`'s `collections?` field, sanitized by
    `sanitizeCollections`; absent on an older doc loads as `[]`) — kept
    project-local per L0.49 (no cross-project index exists to add one to).
    Deferred to a later slice (booked, not built): `.dwk`-persisting the
    Details column selection itself; drag-to-group/filter interactions
    beyond the basic filter/save-as-Collection UI; cross-project catalogs
    (banned outright by L0.49); grouping polish. File ownership: Details-
    view metadata UI, tags, Collections store/persistence only — workbook
    combine/split (Lane E-J), derived worksheets/computedColumns
    (Lane D2), and the Import Wizard (Lane C) untouched.
13. [ ] **PR M — dependency-aware reimport and deletion.** Add previews,
    transactional propagation, stale analysis state, Trash dependency review,
    and freeze/materialize recovery from L0.45 and L0.55. **Booked finding
    (G5 canonical-state review, 2026-08-17):** a shape-changing reimport
    resets a FigureDocument's `bindings.xKey/yKeys/y2Keys/errors` (and every
    channel-indexed `plot.view` field) to the safe null/empty sentinel, but
    deliberately leaves `bindings.groupKey`/`facetKey` untouched
    (`lib/figureDocumentReimport.ts`, tested at
    `lib/figureDocumentReimport.test.ts:77-84`). `facetKey` is inert today
    (no renderer reads it yet). `groupKey` DOES reach the backend as
    `FigureSpec.group_col` (`lib/figureSpec.ts:200`) for Publication
    Preview/export, and `calc/plotting.py`'s `build_grouped_series` raises
    `ValueError(f"group_col {group_col!r} is out of range")` for a stale
    index — so a Figure-Builder-grouped figure whose grouping column is
    removed or shifted by reimport surfaces a raw backend error at
    export/preview time instead of a clear "grouping column no longer
    exists" message, rather than crashing or silently mis-grouping. Not
    reachable via the Quick Figure Builder (the G-series create paths never
    set `groupKey`) — only via the separate Figure Builder workshop's
    Grouping panel. Squarely L0.55's "update linked plots" contract; belongs
    here, not in G5. **Booked finding (PR H review round, 2026-08-18):**
    pruning a workbook-scoped Quick Plot template when its owning workbook is
    actually DELETED belongs here (this PR's workbook-delete machinery), not
    to PR H — H only handles the load-time-dangling case (a `.dwk` whose
    scoped template already names no live workbook, sanitized out on parse)
    and the memberless-but-alive case (kept reachable via the manage
    surface); see `lib/quickPlotTemplates.ts`'s
    `pruneDanglingWorkbookScopeTemplates` doc.
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
| B canonical hierarchy view model | ChatGPT-Sol (owner decision 2026-08-14 FIRST flipped implementation to Claude; owner superseded it the same day by having Sol implement B in a parallel worktree while Claude ran A3-A4 — both decisions kept on record) | GPT-5.6 Terra for the bounded pure TypeScript slice | Claude (Fable) adversarial review + fixes at merge (PR #138) | Implemented in an isolated worktree so Claude could continue the reliability-heavy import/merge foundation concurrently. |
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
   matter—primarily B, E, and G (B's ownership was flipped to Claude by owner
   decision on 2026-08-14 and superseded the same day — Sol implemented it in
   a parallel worktree; the flip-and-supersede stays on record). It should not
   spend scarce tokens on repetitive serializers, standard tables/trees,
   fixtures, or CSS once a contract is written; Claude Sonnet implements
   C/D/L from the detailed handoff.
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

- **Milestone 1 — Library foundation:** Claude leads A1-A4, C-D, and E2
  using mostly Sonnet 5; the orchestrating Claude session (Fable) is the
  design/review escalation for A1/A4. ChatGPT-Sol owns B and E, and reviews
  A3/C-D for hierarchy and interaction fidelity.
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
2. ~~**B next — ChatGPT-Sol reviews the IA contract, Claude implements.**~~
   Superseded by owner the same day it was decided: Sol implemented B itself
   in an isolated worktree (PR #138) while Claude ran A2-A4; Fable performed
   the adversarial review + two red-proven fixes at merge. B does not reach
   into workspace persistence, rendering, or import mutation owned by
   A2-A4/C-E.
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
2. [x] ~~**PR A2 — workspace/store persistence.**~~ (2026-08-14) Shipped
   `e41308d`/`64af36c` — see `## Completed`.
3. [x] ~~**PR A3 — import assignment.**~~ (2026-08-14) Shipped `152c3d8` —
   see `## Completed`. L0.46 was NOT part of this ship — it requires a
   folder-selection concept that does not exist pre-renderer; re-booked into
   PR C (below).
4. [x] ~~**PR A4 — append/merge reference integrity.**~~ (2026-08-14) Shipped
   `aa789bc` — see `## Completed`.

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

- **2026-08-17 — Claude, PR H implementation checkpoint (pending review):**
  Quick Plot template persistence, scopes, and matching. `lib/quickPlotTemplates.ts`
  (H1 template object + `sanitizeQuickPlotTemplates`; H4 pure `resolveTemplate`
  — technique equality, scope gating, per-channel label re-key with
  refusal-with-named-fields on ANY unresolved channel, never a partial
  apply); `store/quickPlotTemplates.ts` (H3 save/rename/delete/apply, apply
  delegates to the canonical `createQuickFigureFromMapping` — never a second
  create path); `.dwk` `quickPlotTemplates` field via `lib/workspace.ts`'s
  four-site additive pattern (module pin raised 592 → 600 with written
  justification — the minimal unavoidable cost of the pattern, no extractable
  block available to fund it) and `HistorySnapshot` inclusion in the SAME
  commit as the slice; builder **Save Quick Plot Template…** action
  (name+scope prompt, gated on `canCreateQuickFigure`); **Quick Plot With…**
  chooser (`components/overlays/QuickPlotWithDialog.tsx`, lazy-loaded) wired
  onto the worksheet/workbook context menus + the ⌘K palette, hidden until
  ≥1 template exists; editable-figure **Save as Template…** honest disabled
  stub (`artifactContextActions.ts`). See item H above for the full ruling
  record. Gate: 647 targeted tests + full suite 482 files/7,128 tests green,
  tsc/eslint clean, build + bundle budget green (832.5 kB eager, 21.4 kB
  under budget).
- **2026-08-15 — ChatGPT-Sol, PR E-a implementation checkpoint (pending
  review):** Added the main-workspace Tile browser from the approved L0.15
  mockup without creating another Library model. `App.tsx` owns the renderer
  transition; `LibraryWorkspace.tsx` consumes `useLibraryHierarchyModel` plus
  the shared select/open dispatchers; the sidebar remains an Origin-like Tree.
  Added persisted Tiles preference, responsive design-token styling, honest
  row-major worksheet previews, breadcrumbs, roving keyboard navigation, and
  Escape/**Back to plot** continuity. A real-browser red/green pass caught and
  fixed two integration defects before review: Escape initially only worked
  when focus was inside the tile surface, and the worksheet preview initially
  transposed the row-major DataStruct matrix. Gate at checkpoint: 27 focused
  Vitest tests; TypeScript and targeted ESLint clean; production build 902.2
  kB eager (1.1 kB under budget); Playwright Tile journey 3/3 at 100/125/200%.
  Explicitly deferred to E-b/E-c: shared context menus/actions, true figure/
  analysis thumbnails, revision caching, cancellation, and virtualization.

- ~~**PR D2 — project-wide search results surface**~~ (2026-08-16, PR #144,
  merge `565bf08`; stacked on the diraculator-audit branch per the owner, both
  merged in order on the owner's instruction) — search now spans the
  project (L0.26): `lib/librarySearch.ts` extends the smart-folder grammar to
  every hierarchy node kind (worksheets keep name/tag/format; other kinds are
  a name-only surface, so `tag:`/`format:` terms honestly exclude them), and
  an active query renders LibraryDetails AS the flat results surface in
  either view mode — full breadcrumbs, flat indent, per-row **Show in
  Library**, "No matches" state; the unfiltered legacy sections no longer
  resurface during search. Open stays canonical (`openLibraryNode`);
  selection routes through the new shared `selectLibraryNode` (L0.25
  contract). `revealTarget` generalized to any `kind:id` node key (bare
  dataset ids still work): the reveal effect walks the hierarchy's parent
  chain (plus the legacy folderId path for workbook-less worksheets),
  selects per kind, and retry-scrolls across the lazy renderer swap.
  Coverage: matcher unit suite, 6 results-surface component tests (open/
  select/reveal/Enter-on-button/empty/roving-over-results), 3 Library
  integration tests (artifact reveal end-to-end, kind:id reveal, project-
  wide matching), rewritten PR C sections-in-search test to the D2 contract,
  and a real-browser @core journey (library-search.spec.ts) at all three
  zoom scales. Gate: tsc clean, lint 0 errors, vitest 6,818, bundle 2.0 kB
  under budget, Playwright 45/45. One Sol review round pre-merge
  (verified-then-fixed, `af3dbac`): the Show-in-Library action clipped
  outside its cell at the default 210px panel — root cause one layer deeper
  than reported (table-layout:fixed sizes columns from the header row, and
  the actions th carried no class, so the 1% td width never applied); fixed
  with a real column width per container size + compact ⌖ glyph variant at
  narrow widths (accessible name on the button), and a RED-PROVEN
  real-browser containment assertion at 210px/420px panels across the zoom
  matrix. Final gate: vitest 6,820, Playwright 45/45.

- ~~**PR D — view preference and details renderer**~~ (2026-08-15, PR #140,
  merge `a8bb751`; ChatGPT-Sol implemented, Claude/Fable reviewed) — persisted
  Tree/Details preference (localStorage, fails safe), sortable Details
  projection over the canonical hierarchy (sort works on a projected copy —
  never rewrites manual order), narrow-panel container-query fallback,
  Tiles visible-but-disabled pending PR E, selection/search/focus continuity
  across the renderer swap incl. ancestor re-disclosure returning to Tree.
  One blocking review round: P1 Details rows leaked Delete/Backspace to the
  global selection-based handler (fixed via the shared
  `lib/datasetRemoval.ts` path with five real-hook regressions), P2
  flat-when-sorted indentation, P3 "Unresolved" Source labeling; roving
  keyboard traversal explicitly booked as follow-up 4a (shipped separately
  via PR #141). Gate at merge: 6,743 vitest, lint 0 errors, tsc clean,
  bundle 3.4 kB under budget, Playwright 39/39.
- ~~**PR C — Origin-like tree renderer**~~ (2026-08-15, PR #139, merge
  `d35b1e7`) — the Library tree now renders folder → workbook → children
  over PR B's hierarchy; `useLibraryTree` retired (two-view-models debt
  closed). L0.5/L0.6 workbook semantics, registry context menu with
  disabled-with-reason placeholders, roving keyboard focus, L0.46 import
  targeting + never-without-a-click batch folder offer, first workbook
  mutations (rename/move; Delete see below). Three ChatGPT-Sol review
  rounds, every finding verified-then-fixed (Claude/Fable):
  **R1** — Delete-key misfire (selection chokepoints made mutually
  exclusive), trash-restore workbookId self-heal, worksheet→folder drag
  retired for workbook→folder drag, keyboard-hijack guard, Origin fan-out
  folder-offer guard (fileCount, not dataset count). Plus a finding the
  gate missed: the E2E suite was 1/39 on the branch (freshly created
  workbooks rendered collapsed, hiding the just-imported sheet — owner
  decision: collapsed-by-default stays, import-created workbooks start
  expanded and activation discloses; `workbookDisclosurePatch` in
  libraryPanel.ts) + kind-specific artifact hover titles restored.
  **R2** — anchor-identity-first keyboard guard (ArtifactRow/FigureRow
  anchors are buttons) AND `useGlobalShortcuts`' single-key branch now
  honors `defaultPrevented` (arrows double-fired dataset nav for every
  row); `folderDeletePatch` (store/folderDelete.ts) makes folder deletion
  atomic across folders/workbooks/datasets/expansion/selection; full
  L0.25 select/open/caret contract for all seven node kinds (tree-mode
  only; flat/search keeps item-15 plot-intent clicks per L0.26),
  `librarySelection` widened to artifact kinds, `.selected` style added
  (workbook's class previously had no CSS rule). **R3** — workbook Delete
  disabled UNCONDITIONALLY until PR M (grouping loss = the dependency;
  `workbookDeleteBlockers` returns the stable reason, action fails closed
  byte-identically); focused-worksheet Delete targets the FOCUSED row via
  the shared `lib/datasetRemoval.ts` helper (also used by the global
  fallback — confirmRemove/toast/Trash/one-Undo can't drift). Ratchet
  tolls paid downward throughout (useApp 2818 → 2798, windows 749 → 745).
  Gate at merge: 6,729 vitest, lint 0 errors, tsc clean, 897.4 kB
  (5.9 kB under budget), Playwright 39/39 across chromium-100/125/200 —
  process note: E2E is now part of the working gate; one earlier "green"
  E2E ran against a stale bundle after a masked tsc failure (strict
  chaining now used). Deferrals booked: single-worksheet move → PR J;
  one-at-a-time restore regrouping + workbook-aware Trash → PR M;
  artifact context menus → L0.39/L0.40 owner.
- ~~**PR A3 — import assignment**~~ (2026-08-14) — every import now creates
  its workbook at import time, correct BY CONSTRUCTION: `planOriginImport`
  (evolved `planOriginFolders`) resolves Project-Explorer folder placement
  only and delegates the workbook layer to `deriveWorkbooks` — the exact
  function a reload uses — so import-time creation and load-time derivation
  cannot drift (the consistency gate asserts partition + placement equality
  after stripping and re-deriving). Multi-sheet books get NO surrogate
  folder any more (sheets sit in their path folder; one workbook per book,
  single-sheet included); the single-file branch derives its one workbook
  the same way, covering path, upload, and single-book-Origin (the primary
  DataStruct carries `origin_book`) cases. Legacy conversion:
  `applyWorkbookMigration` (workbooks.ts) wraps the parse-time
  derivation and now APPLIES A1's `convertedFolderIds` — the surrogate
  folder is dropped, its occupants re-homed to its parent — with a test
  asserting a converted v3 doc equals a fresh A3 import structurally;
  workspace.ts net-shrank (pin 609 → 592). Interim visual note: until PR C
  renders workbooks, multi-sheet Origin sheets show flat in their path
  folder. Seam fix (orchestrator): the `useApp.test.ts` Project-Explorer
  mirror test updated + strengthened to assert the workbook layer.
  Deferrals: L0.46 → PR C; `importFilesAppended`'s merged dataset stays
  workbook-less (self-heal proven by test). Gate: 6,547 tests combined
  with A4, lint 0 errors, build + bundle green. Commits
  `c0b26f8`/`0560b55`/`1537154`/`0a942c2` + seam `152c3d8`.
- ~~**PR A4 — append/merge reference integrity**~~ (2026-08-14) — real
  workbook transfer through Append Project, superseding A2's blanket strip:
  every incoming workbook referenced by ≥1 appended dataset transfers under
  an unconditionally FRESH id (freshness guaranteed against an explicit
  `currentWorkbookIds` set, never assumed from the generator), lands at the
  Library root (`folderId` cleared; `order` undefined — verified `byOrder`
  sinks it after keyed siblings, giving L0.35 append-at-end for free) with
  name/source/importedAt/originBook preserved; dataset `workbookId` remapped
  through the old→new table; unresolvable refs cleared + counted
  (`droppedWorkbookRefs` narrowed to that case); memberless incoming
  workbooks dropped; store append threads `workbooks` + root-placement
  status note; undo restores the pre-append list via HistorySnapshot. Ran
  parallel with A3 under a strict file partition (prep commit `796f12f`
  supplied the shared `store/workbookIds.ts` generator). Gate: 6,527 tests,
  lint 0 errors, build + bundle green; adversarial review found no defects.
  Commit `aa789bc`.
- ~~**PR B — shared Library hierarchy view model**~~ (2026-08-14,
  ChatGPT-Sol) — added `lib/libraryHierarchy.ts`, the single pure structural
  model intended for Tree, Tiles, Details, search reveal, keyboard navigation,
  and drag/drop. It emits discriminated nodes for folders, workbooks,
  worksheets, recovered Origin figures, editable figures, legacy publication
  figures, multi-panel pages, and reports. Canonical keys include the item kind
  (`workbook:id`, `worksheet:id`, etc.) so equal raw IDs cannot collide.
  Placement follows the confirmed ownership rules: worksheet sources stay
  beneath one workbook; cross-workbook artifacts move to the nearest shared
  folder (or root); unresolved Origin figures may use a surviving import
  sibling for placement without falsely claiming it as a source. The model
  records missing references, degrades broken folder/workbook links safely,
  breaks corrupt folder cycles, preserves manual/source order, and provides a
  canonical-key expansion flattener. Ten focused tests cover ordering, stable
  identity/depth, shared-folder and root placement, exact Origin source-book
  selection, unresolved fallback, dangling refs/cycles, input immutability,
  and collapsed subtrees. Targeted tests, ESLint, typecheck, architecture
  ratchet, production build, and bundle budget pass. No renderer/store/import
  mutation is included; PR C-D/E consume this model after rebase onto A4.
  **Adversarial review at merge (Claude/Fable, PR #138): two CONFIRMED
  findings, both red-proven and fixed** — (1) ordering reimplemented instead
  of reusing `lib/order.byOrder`, so unkeyed items interleaved by array index
  rather than sinking after keyed siblings, breaking A4's append-at-end
  invariant and diverging from today's foldertree ordering (fixed:
  `compareDraft` now composes section → `byOrder` → insertion sequence);
  (2) origin-figures shared section 1 with workbooks, so a folder-placed
  cross-workbook figure interleaved with the folder's workbooks (fixed:
  artifact sections shifted to 2-6, disjoint from workbooks). Interim
  standing debt, accepted: `useLibraryTree` still drives the live UI — TWO
  view models coexist until PR C replaces the old one; C's contract must
  include that replacement so the duplication window closes.
- ~~**PR A2 — workspace/store persistence**~~ (2026-08-14) — `.dwk` bumped to
  v4 (accepts v1–v4): `workbooks[]` + per-dataset `workbookId` serialize; ONE
  parse path for every version (sanitize → `reconcileWorkbookRefs` with a
  deterministic collision-guarded `wbm-N` counter) so legacy docs derive and
  v4 docs repair through identical code. Store: `AppState.workbooks` with the
  explicit `loadWorkspace` reset line (partial-`set()` leak guarded by test),
  clearAll via the same path, `workbooks` in `HistorySnapshot`. Append/merge
  strips incoming `workbookId` (counted, `droppedWorkbookRefs`) pending A4's
  real transfer. Autosave verified flowing through the shared serializer.
  Ratchet tolls paid: `lib/workspaceOrigin.ts` extraction (workspace.ts pin
  633 → 609) + `store/datasetMeta.ts` extraction (useApp.ts pin 2868 → 2835),
  all four extracted actions keep their `recordHistory` calls. v1
  group-string docs deliberately derive root-placed workbooks (pinned by
  test; A3 owns placement polish). Gate: 6,515 tests, lint 0 errors, build +
  bundle green; adversarial review found no defects. Commits `e41308d`,
  `64af36c`.
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

- **2026-08-16 — Claude (Fable):** PR #146 (E-a1 hardening) reviewed and
  merged (`98ea821`) under the owner's overnight handle-everything directive.
  Sol's three fixes verified genuine; the review round contributed focus
  recovery on tile deletion, the SELECT/isContentEditable Escape exemption,
  and the repaired tiles E2E journey (see the E-a1 row). With this, every
  finding from the PR #145 review is closed; E-b (shared tile actions +
  L1.4) and E-c (thumbnails/caching/virtualization) are the remaining E
  slices.
- **2026-08-16 — Claude (Fable):** PR #145 (E-a) merged on the owner's
  instruction (`b18471a`) with CI green on `c6df54a`. The owner chose to
  merge with the three Claude-review findings still open; they are now LIVE
  ON MAIN and are the first order of business for the E-a fix round (or
  E-b's opening commits): **(1) P1** focused-tile Delete falls through to
  the selection-based global fallback and deletes an unrelated dataset
  (red-proven; recoverable via Trash/undo, which bounds the severity);
  **(2) P2** the workspace's document-level Escape closes the workspace
  under an open command palette or context menu; **(3) P2** pending
  (on-demand) worksheet tiles render "0 rows × 0 columns". Repro shapes are
  in the PR #145 review comment. The stage-target-open owner decision
  shipped inside the same merge (`c6df54a`).
- **2026-08-16 — Claude (Fable):** Owner decision recorded and implemented on
  `sol/library-e-wide-shell` (PR #145): stage-target opens from a tile return
  to the plot (see the E-a row). Implementation: `opensInStage` beside the
  canonical open dispatcher (workbooks resolve their L0.6 remembered child),
  `openFromTile` in LibraryWorkspace, 5 new unit tests (stage vs overlay vs
  browse), and an extended real-browser tiles journey proving the opened
  sheet is active with the Stage restored. Sol's three review-round findings
  (focused-tile Delete leak P1, Escape stolen from overlays P2, pending-dims
  P2) remain open for the fix round — deliberately not absorbed here.
- **2026-08-16 — Claude (Fable):** PRs #143 (diraculator audit) and #144
  (D2) merged in stack order on the owner's instruction (`ebe06c3`,
  `565bf08`; #144's base retargeted to main after #143 landed). Both had one
  ChatGPT-Sol review round each, verified-then-fixed and CI-green before the
  merge. D2's plan rows updated from pending-review to shipped.
- **2026-08-15 — Claude (Fable):** PR D2 implemented on
  `claude/library-d2-search`, stacked on the diraculator-audit branch per the
  owner ("stack it as a PR, we'll deal with the merge of both later") — PR
  open, unmerged. Ticked row 4b and L1.6; wrote the Completed entry. The
  L1.4 booking (artifact context menus / registry Delete) remains unassigned
  — D2 deliberately did NOT absorb it (results rows reuse the same
  consume-only Delete contract as Details rows). Next per the confirmed
  order: PR E awaits its mockup approval; PR A is still the top unticked row.
- **2026-08-15 — Claude (Fable):** Hardening slice SHIPPED (PR #142 merged
  `51df7cc`, owner-directed after a high-effort self-review round found and
  fixed 8 further defects in the slice itself — including undo/redo as a
  SEVENTH L0.25 selection-invariant writer, an arrow-consume that broke the
  worksheet filter <select>s, and two ineffective span fixes replaced with
  the real focusGuard pattern). Awaiting: `plans/diraculator-audit_plan.md`
  and a diraculator PR the owner referenced — neither exists in the repo,
  any branch, Drive, or mail yet; a watch is armed. Owner directive on
  record: work the audit plan critically when it appears, make the
  diraculator PR CI-ready, do NOT merge it.
- **2026-08-15 — Claude (Fable):** PR #141 merged (`f6a345b`, owner-directed
  after Sol's follow-up review cleared; both outdated threads resolved).
  Keyboard/selection hardening slice opened as the follow-on
  (claude/keyboard-selection-hardening): retrospective-audit fixes — the
  architecture guard now parses AppState's own fields (127 newly-visible
  fields classified; `expandedFolders` joined HistorySnapshot so an undone
  folder delete restores expanded), six L0.25 selection-invariant violators
  closed (addDataset/loadWorkspace/duplicateDataset/splitDatasetByColumn/
  window-focus family/trash-restore edge) with a per-writer invariant suite,
  seven pre-existing Delete/arrow-leak surfaces fixed (ErrorRolesCard +
  SmartFolders focusGuard adoption, PreviewOverlay hitboxes, Map ROI bars,
  WorksheetPane boundary, SlotGrid empty slots, recents-span click-focus),
  and Sol's #141 follow-on: Details sort headers rove (component tab surface
  is now exactly two stops).

- **2026-08-15 — Claude (Fable):** PR D shipped (PR #140 merged `a8bb751`,
  owner-directed un-draft + merge after the fix round cleared my blocking
  review; all three threads resolved). Firmed row 4's entry from
  pending-review to shipped. Next per the confirmed order: PR D2 (search
  results surface) and the newly booked 4a (Details roving keyboard
  traversal) are both unblocked; E (tiles) waits on its mockup approval.
- **2026-08-15 — Claude (Fable):** PR C shipped (PR #139 merged `d35b1e7`,
  owner-directed merge after all 11 review threads resolved). Ticked row 3
  of the implementation sequence and wrote the Completed entry covering the
  three review rounds. Next per the confirmed order: PR D (view preference +
  details renderer) / D2 (search results surface). PR M inherits two booked
  obligations from C: the workbook-aware Trash package that lifts
  `workbookDeleteBlockers`, and one-at-a-time restore regrouping.
- **2026-08-14 — Claude (Fable):** Adversarial review of PR #138 (slice B)
  before merge. Verified the rebase claim (branch sits on main's tip), every
  consumed API (`figureLayerFamily`, `figureLabel`, `FigureDoc`/`PageDocument`/
  `ReportEntry` fields), and the placement rules against L0.16/L0.21/L0.44.
  Two confirmed findings fixed with red-proven tests (byOrder parity;
  workbook/artifact section separation — see the Completed B entry). Amended
  this PR's plan edits to PRESERVE the B ownership decision history (the
  original flip-to-Claude and its same-day supersession are both on record)
  rather than rewriting it. Full gate re-run before merge.
- **2026-08-14 — ChatGPT-Sol:** Confirmed Claude's A1/A2 work on `main`, then
  started B in the isolated `sol/library-hierarchy-b` worktree while Claude
  continued A3/A4. Reconciled the routing table to reflect that parallel split
  and implemented the pure hierarchy described in `## Completed`. No current
  Library renderer was rewired, keeping the branch independent of Claude's
  import/merge work and leaving visible UI changes to C-D/E.
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
- **2026-08-15 — ChatGPT-Sol:** Implemented PR D's bounded Tree / Details
  slice for Claude review. Added a persisted cross-project view preference,
  a sortable metadata table over the same canonical hierarchy used by Tree,
  compact sidebar behavior, and renderer-switch continuity for selection,
  search, ancestor disclosure, and real DOM focus. Kept Tiles visible but
  disabled because its approved wide workspace belongs to PR E. Explicitly
  left L1.4 open: this slice selects and opens Details rows, but does not
  pretend native-browser right-click, rename/move, or drag/drop are parity.
  Verification on the implementation branch: 24 focused tests plus the full
  frontend suite (6,743 tests / 452 files after review fixes), targeted
  ESLint, TypeScript typecheck, and production build/bundle guard all pass;
  Details remains a lazy 5.54 kB chunk and eager output remains 3.4 kB under
  budget.
- **2026-08-15 — ChatGPT-Sol, PR #140 review fixes:** Addressed Claude's
  blocking Details review. Delete/Backspace is now owned by the focused row:
  worksheets use the shared confirmed-removal path (including enclosing
  multi-selection), while every non-worksheet consumes the key so the global
  active-dataset fallback cannot delete unrelated data. Column-sorted Details
  rows render flat instead of retaining misleading hierarchy indentation, and
  unresolved Origin figures say **Unresolved** in Source. Added five real
  global-shortcut regressions plus sort/source coverage. Explicitly booked
  roving Details arrow navigation as PR D follow-up 4a. Verification: 76
  targeted tests, full 6,743-test frontend suite, ESLint, typecheck, and build
  all pass; eager output is 3.4 kB under budget.
- **2026-08-16 — ChatGPT-Sol, E-a1 hardening implementation:** Reconciled the
  owner-directed PR #145 merge and implemented its three still-open Claude
  review findings on `sol/library-ea-hardening`: focused-tile deletion, Escape
  ownership for overlays/editing, and true pending-book dimensions. Included
  shared numeric formatting and valid linear-list semantics because both were
  bounded review findings in the same surface. Added focused regression
  coverage; PR and Claude review remain pending.
- **2026-08-16 — ChatGPT-Sol, E-b1 implementation:** Started the stacked
  action-parity slice after Claude merged PR #146. Folder/workbook/worksheet
  tiles now adapt to the canonical Tree menu builders rather than defining a
  second command set, with both pointer and keyboard menu gestures. Added
  per-kind factual summaries and activated Workbook Browse only in the Tile
  workspace. Artifact lifecycle menus remain the explicit E-b2 boundary so
  their rename/duplicate/delete dependency policies can be centralized rather
  than copied from four flat sections.
- **2026-08-16 — Claude review of PR #147 (E-b1), three fixes pushed to the
  branch:** (1) `openTileMenu` selected the tile unconditionally, collapsing
  any enclosing multi-selection before the menu built — the bulk actions
  (Remove N selected, merge, panels, plot-together) were unreachable from
  Tiles and the menu disagreed with the tile Delete key's enclosing-selection
  rule; it now mirrors the tree's `selectForMenu` (an already-selected tile
  keeps the selection). (2) The worksheet menu's `onStageOpen` was wired to
  the full `openFromTile` re-open, so "Plot (make active)" / "Plot in new
  window" re-dispatched `activateFromLibrary` after their own plot-intent
  open — detouring Origin-book datasets (default `originBookClickOpens:
  "worksheet"`) onto the worksheet tab; the hook is now close-only
  (`stageReturn`), and the multi-select stage actions (panels, merge,
  plot-together) also stage-return per the PR #145 owner decision. (3) The
  folder tile menu passed direct hierarchy-child count where the tree passes
  the whole-subtree DATASET count — the destructive "Delete folder + N
  dataset(s)" confirm stated wrong numbers whenever the folder held
  workbooks; `subtreeCount` is hoisted to `lib/foldertree.ts` and shared.
  All three were proven red first; four regression tests added.
- **2026-08-16 — ChatGPT-Sol, E-b2 implementation:** Added one artifact
  lifecycle registry consumed by Tiles, Tree artifact rows (including recovered
  Origin graphs), and Details. Supported rename/duplicate/delete paths reuse
  the canonical store actions and their existing Undo boundaries; destructive
  confirmations distinguish recoverable editable/page artifacts from
  non-recoverable publication/report artifacts and name page panels affected by
  editable-figure deletion. Unsupported actions stay discoverable with honest
  disabled reasons. Focused tests cover pointer and keyboard menu access; PR
  and Claude review remain pending.
- **2026-08-16 — Claude review of PR #148 (E-b2), one gap closed on the
  branch:** The registry, wiring, and wording all verified clean — delete
  confirms match the real Undo boundaries (editable/page record history;
  publication/report removals don't), `source.datasetIds` is live-only so
  reveal gating is sound, the origin-figure Open gate matches
  `applyOriginFigure`'s own `datasetId` guard, and the delegated Tree/Details
  handlers cannot double-fire on rows that own their menus. One booked debt
  came due: all three surfaces still swallowed Delete/Backspace on focused
  artifact rows ("until a registry action defines one" — this PR is that
  registry). Added `deleteArtifactConfirmed` (registry-lookup by id,
  mirroring `removeDatasetConfirmed`, honoring the action's `enabled` gate so
  a keystroke never confirm-then-no-ops on a recovered Origin figure) and
  wired the Delete key in Tree, Details, and Tiles. Four probes proven red
  first, plus a green probe pinning the page-panel dependency message.
  NOTE: the eager bundle is 903.1 / 903.3 kB — E-c (thumbnails) will need an
  owner decision on raising the budget.
- **2026-08-16 — Claude, E-c1 implementation (owner split, first slice):**
  Resolved the bundle-headroom note above WITHOUT raising the pin: an
  extraction pass (Inspector, StatStage/MultiPanelStage, BackgroundPlotWindow
  — all runtime-conditional, per the 2026-08-02 MapStage precedent) recovered
  ~88 kB and the ratchet's slack rule LOWERED the budget to 874,461 B,
  leaving a fresh 40 kB band for E-c2/E-c3. Landed the canonical thumbnail
  infrastructure: revision-keyed cache (entity object identity = revision, so
  every store mutation invalidates implicitly), bounded LRU, per-kind
  generator registry, visible-only generation with abort-on-unmount and a
  keyed staleness guard, error/unsupported placeholder states, and a pure
  reference generator (page panel-grid SVG) proving generation → cache →
  tile end-to-end. E-c2 (Sol) owns the real preview visuals; E-c3 (Claude)
  owns virtualization. PR pending.
- **2026-08-16 — Claude, E-c1 round 2 (Sol review response):** Sol's blocking
  finding was correct — object identity of the PRIMARY entity is not a
  complete thumbnail revision, because previews are transitively live (a
  page renders referenced figures; a live figure renders its source
  dataset). Reworked the contract red-first per the review: cache keys are
  now dependency FINGERPRINTS (`lib/thumbnailRequest.resolveThumbnailRequest`
  composes the entity revision with the ordered revisions of referenced
  figures and live source datasets, missing references as stable sentinels),
  and the generator receives the SAME resolved request the fingerprint was
  formed from, so key and render cannot disagree. Sol's three requested
  probes proven red then green (figure-edit regenerates page thumbnails;
  dataset replacement regenerates live-figure thumbnails; a late old-
  fingerprint result neither renders nor poisons the new entry). The
  "scroll-out cancellation" doc overclaim is narrowed to the truth: abort on
  unmount and fingerprint change; visibility is sticky by design and the LRU
  owns retention. NEW DISCIPLINE (also in CLAUDE.md): pre-PR adversarial
  self-review — its first run on this very diff caught a CI-red weak-wait in
  my new test, an empty-string-figureId deps-cursor desync (now a shared
  predicate + pin test), and two O(store)-per-tile resolve inefficiencies
  (WeakMap-memoized by-id maps; generator-less kinds skip resolution).
- **2026-08-16 — ChatGPT-Sol, E-c2 implementation checkpoint:** Started the
  visible preview layer on `sol/library-ec2-preview-ux` after verifying PR
  #149's repaired request contract. Added dependency-keyed, lightweight SVG
  previews for editable/publication/recovered-Origin figures, multi-panel
  pages, and reports; retained the existing compact worksheet table. Added a
  common loading/error/missing-source visual language, artifact-kind badges,
  restrained hover treatment, and reduced-motion support. The full plotting
  engine is deliberately not mounted inside tiles; E-c3 virtualization and
  large-Library fixtures remain Claude's next slice after review/merge.
- **2026-08-16 — Claude review of PR #150 (E-c2), three red-proven fixes
  pushed to the branch:** (1) the page generator's dataset filter probed the
  OPTIONAL `pending` field (`"pending" in dep`) — false for every normally-
  loaded dataset — so live-figure panels silently degraded to gray boxes;
  (2) Origin-figure previews used the first-columns default instead of the
  figure's decoded curves — now routed through the canonical
  `figureChannelSelection` (the same mapping the real apply action uses),
  against the node's OWN book-matched dataset, because `source.datasetIds`
  lists the whole layer family layer-ascending and a layer-2 node's first
  dep is layer 1's dataset; (3) the root cause of this bug class — generators
  shape-sniffing the flat `deps` fingerprint array — is retired:
  `ThumbnailRequest` now carries TYPED `figureDeps`/`datasetDeps` slices
  built by the resolver (which knows each dep's type by construction), and
  both generators consume those. Otherwise the slice verified clean:
  SVG escaping and data-URL encoding sound, downsampling honest for
  recognition, frozen/live data routing matches the entity contracts, delete
  wording untouched, CSS token-clean with reduced-motion support, bundle
  unchanged at 814.9 kB. Three probes proven red first
  (`thumbnailPreviewHonesty.test.ts`).
- **2026-08-16 — Claude, E-c3 implementation (owner split, final slice):**
  Windowed tile rendering for large Libraries, reusing lib/gridwindow's
  clamped `computeAxisWindow` rather than new inline math (the pre-push
  self-review pass caught the duplication AND that the duplicate lacked the
  helper's shrink-under-scroll clamping — plus a container-change scroll
  reset, a null-root land-on-selection miss, and a focus-stealing hazard in
  the deferred focus retry; all four fixed with regression pins before
  push). Small libraries are structurally unvirtualized: every pre-existing
  workspace test passes byte-identical. The E-c1 sticky-visibility doc
  promise is narrowed honestly: virtualized unmount aborts in-flight
  generation like any unmount; completed thumbnails survive in the LRU.
  E-c (thumbnails + scale safeguards) is complete pending PR/merge.
- **2026-08-17 — Claude, PR #151 (E-c3) owner-directed critical review round
  before merge:** A fresh max-effort adversarial pass on my own PR found 8
  issues; all fixed with the four testable ones proven red first. The two
  real contract regressions: (1) the FOCUSED tile scrolling out of the
  rendered window unmounted and stranded keyboard focus on <body> — the
  grid container now takes focus (never fighting the scroll) and its own
  keydown resumes navigation from the roving tile's model position; (2)
  windowed listitems hid the true collection size from assistive tech —
  tiles now carry aria-setsize/aria-posinset. Also fixed: the
  container-entry scroll reset was gated on the virtualized path (a small
  container entered from a deep scroll landed at its clamped bottom); the
  deferred focus retry could steal focus from a DIFFERENT tile the user
  clicked mid-retry (now origin-aware); ensureVisible's fresh measurements
  now write back into the window state (no split-brain row height after
  container changes); the grid gap is read from computed style instead of
  a hardcoded 12; scroll events no longer re-measure geometry (ResizeObserver
  on the scroll container AND the grid owns that, catching thumbnail-driven
  tile growth); and the scale E2E now ASSERTS the Escape reveal target
  instead of claiming it in a comment.
- **2026-08-17 — Claude, PR E2 (#152, merge `dc2cb76`) — first
  parallel-delegation slice:** Owner directive: work E2 and F in parallel,
  delegating implementation to cheaper models after owning scope and plan.
  Claude scoped the contracts (the three additive `.dwk` fields, the L0.25
  worksheet-kind exclusion — a Claude scoping error the implementing agent
  correctly flagged and implemented right — sanitizer rules, safe-open
  semantics), a Sonnet worktree agent implemented, and a Claude review
  round found 5 defects, all red-proven before fix: restored
  `librarySelection` was synthesizing `selectedIds:[active]` (L0.25
  violation); `parseLibrarySelection` validated shape but not per-kind
  aliveness (a dangling folder id would feed import targeting); the
  maximized-window restore was exempt from the viewport clamp (unreachable
  one un-maximize later); autosave triggers omitted `workbooks`/`savedRois`;
  and a label-style fix ("Open without layout…"). Two Sol review rounds,
  both verified then fixed on the branch: P1 — gating the replace confirm
  on `datasets.length` let a dataset-free session holding figures/pages/
  reports be silently discarded (fixed with `hasWorkspaceContent` over
  every collection loadWorkspace resets, `7a6c5d7`); follow-up —
  `techniqueViewMemory` belongs in that predicate too (persisted, per-
  project, user-owned; `3f01530`). Final branch gate: tsc/lint clean,
  6,928 vitest, 51/51 local Playwright, both workflows green.
- **2026-08-17 — Claude, PR F (#153, merge `2966c69`) — second
  parallel-delegation slice:** Same delegation shape as E2, run
  concurrently in a second worktree. Claude fixed the fail-closed Quick
  Plot contract up front (closed technique allowlist, no inference, strict
  L0.11, never-replace creation); a Sonnet agent implemented; Claude's
  review round found 9 defects (4 red-proven), the substantive ones:
  single-channel-vs-time datasets wrongly rejected (`labels.length<=1`
  guard); silent worksheet substitution violating strict L0.11; a double
  history entry stranding an orphaned figure on single Undo (restructured
  to the createWindow-first single-entry pattern); `onStageOpen` firing on
  fail-closed no-ops (a disabled Quick Plot closed the tile workspace);
  all-NaN time passing a y-only finite check; palette flat-registry
  omission; `techniqueViewMemory` not threaded into the seeded view;
  repeat-run name collisions; a dead union payload. Two Sol review rounds,
  verified then fixed: P1 — an `xrd.rsm`-tagged 2-D map passed the
  technique gate and quick-plotted as a nonsense line figure (fixed with
  the explicit line-technique allowlist + `is2DMap` guard, `e86a07e`);
  follow-up — the data-shape signal must outrank the technique tag, so
  `is2DMap` now short-circuits BEFORE the allowlist (`abb3209`). Final
  branch gate: 6,954 vitest, 51/51 local Playwright, both workflows green.
- **2026-08-17 — Claude, post-merge ratchet reconciliation (`74070c8` on
  the #153 branch):** The two parallel slices were textually disjoint in
  `store/useApp.ts` (E2: loadWorkspace restore; F: slice composition) and
  GitHub merged them cleanly, but their line counts COMBINED pushed the
  store 2 lines over the 2818 architecture-ratchet pin — each PR was green
  alone; only the merge was red. Per the ratchet's own instruction
  (extract, never raise the pin), the single-flight lazy-book resolver
  (`installBookData` + its in-flight map, ORIGIN_FILE_DECODE_PLAN #38)
  moved to a new pure `lib/bookData.ts`, parameterized on the store's
  `set` (no store import, no cycle); `useApp.ts` dropped to 2,783 lines —
  35 banked under the pin. Full combined-head gate before re-merge: 6,986
  vitest, build 821.1 kB (32.9 kB under budget), CI + E2E + CodeQL green.
  Lesson for future parallel slices: the ratchet sums across branches —
  budget shared-pinned-file growth at scoping time, or pre-merge the
  second branch locally before its CI run.
- **2026-08-17 — Claude, G1-G3 orchestrated review + fix round (owner
  directive: cheaper models implement AND review where possible, Claude
  orchestrates):** Sol's stacked drafts #154/#155/#156 each got an
  independent Sonnet reviewer on its incremental diff (standing contract:
  useful / works / bugs, with probe-test evidence required); Claude
  adjudicated, a fourth Sonnet agent implemented the accepted findings
  red-first up the stack, and Claude verified and merged in order
  (#154 `32f6660` → #155 `dd9bc1f` → #156 `fc48d8e`, after retargeting
  #154 to main post-PR-F). Findings: G1 one P1 (the `loadWorkspace`
  transient-reset omission — the A2 lesson's exact bug class; probe showed
  the builder pinned over a freshly opened project) plus two contract
  divergences resolved as DOCUMENTED RULINGS with pin tests rather than
  reverts (Configure always-enabled supersedes the F-era stub contract —
  recorded at the G1 bullet; the Configure resolver's first-worksheet
  fallback deliberately diverges from Quick Plot's first-available); G2 two
  P2s in the pure mapping core (x-error orphaning on X reassignment;
  duplicate error-binding targets) — both "silently wrong error bars"
  defects that G3's live preview would have made user-visible, both
  reproduced red then fixed (`04e1eae`, `16b02a0`); G3 clean (no P1/P2),
  its reviewer proving the shared `GraphPreview` guard load-bearing via
  negative-control revert and the preview a true thin adapter; render-level
  regression pins + dead-CSS sweep landed as `a2a9460`. Stack-tip gate:
  7,011/7,011 vitest, tsc/eslint clean, build 821.9 kB (32.0 kB under
  budget); CI + E2E + CodeQL green per PR before each merge. G4
  (canonical figure creation) and G5 (hardening, incl. the half-pair
  visibility requirement recorded above) remain open.
- **2026-08-17 — Claude, G4 orchestrated round (scout → rulings → Sonnet
  implementation → independent Sonnet review → fix rounds; merged as PR
  #157, `f3d2e81`):** The scout pass caught the slice's load-bearing gap
  BEFORE implementation: the Stage payload pipeline read rich error spans
  only from `Dataset.errorRoles`, so builder-edited bindings would render
  in the preview and silently vanish in the created figure — fixed with a
  regression-proof activation predicate (`hasRichErrorBindings`: document
  errors win only when they carry something the legacy symmetric
  projection cannot express), mutation-tested (reverting the predicate
  kills 4 tests). The independent review round (`55566cd`) then caught a
  P1 inside the fix's own blast radius — the decimation-eligibility gate
  was blind to document errors, so a rich-error figure on a >10k-row
  dataset decimated the payload while spans stayed full-resolution,
  drawing error bars against the wrong points (red-proven on 20k rows) —
  plus the channelRoles preview/figure parity gap, resolved on the
  verified branch: `ChannelsCard.changeRole` genuinely relies on
  `effectiveChannels` filtering explicit lists, so the preview now applies
  the same filter and the builder hints when a mapped Y channel is
  role-filtered (the "should explicit assignment override roles?" question
  is booked under G5). Sol's PR review (`2cd1d3b`) surfaced that
  background windows never rendered rich spans AT ALL (a pre-G4 gap:
  dataset-sourced asymmetric bars already vanished on blur) —
  `BackgroundPlotWindow` now consumes `errorSpans` with each window's own
  document errors threaded, red-proven focused↔background parity;
  `PanelCell` noted as a residual (structurally cannot host a figure
  document). End-to-end parity test committed (builder preview === created
  figure payload). Final gate: 7,049/7,049 vitest, tsc/eslint clean,
  824.8 kB bundle (29.1 kB headroom), CI + E2E + CodeQL green pre-merge.
  G5 remains open (real-browser hardening, half-pair visibility,
  channelRoles semantic ruling).
- **2026-08-17 — Claude, PR #158 (G5 ambiguity slice) review + merge
  (`7bb0c76`):** Sol's delegated G5 slice reviewed under the orchestration
  model (Sonnet reviewer, Claude adjudication, Sonnet fix round). The UI
  layer verified strong — the reviewer RAN both new Chromium journeys
  against real Chromium (2/2; they assert store state and measured
  geometry, not appearances), per-target half-pair detection correct
  including the X-axis path, real aria-describedby wiring, no role
  mutation, and the plan's channelRoles ruling recorded as the answer to
  the G4-booked question. One P1, probe-proven then fixed red-first
  (`1075582`): "blocks creation" was true only at the button — the store
  action still gated on `mappingReady` alone, so a direct call with a
  half pair or a role-filtered-only mapping created exactly the
  silently-empty figure the PR exists to prevent (parallel-readiness
  drift, introduced and diverged within one PR). Closed with the single
  shared `canCreateQuickFigure` predicate consumed by both gates; a
  pre-existing test that was itself seeding a lone `+` binding was
  corrected. Also: blocked-framing notice copy, joint-condition
  aria-describedby lists both reasons, scoped selector replaces the CSS
  `!important`. Final gate: 7,058/7,058 vitest, tsc (app+e2e)/eslint
  clean, 826.1 kB bundle (27.9 kB headroom), both journeys 2/2 locally,
  13/13 checks green pre-merge. G5 remains partially open: Claude-owned
  save/close/reopen/project-reload proof and canonical-state review;
  final human visual acceptance stays a release-candidate task.
- **2026-08-17 — Claude, the G5 lifecycle proof (save/close/reopen/
  project-reload):** closed the first of the two remaining Claude-owned
  G5 handoff items — see the PR G / G5 entry above for the full Phase-0
  probe + real-browser-journey record. Its own summary line claimed G5
  `[x]` with only the release-candidate visual-acceptance pass left open,
  but silently dropped the SECOND handoff item (the canonical-state
  review the ownership matrix names). An independent reviewer flagged the
  `[x]` as a merge-blocking overclaim.
- **2026-08-17 — Claude, the G5 canonical-state review (correcting the
  overclaim above):** performed the review the previous entry's slice
  skipped — every code path that writes canonical `FigureDocument` state,
  against `lib/figureContract.ts` and the plan's L0.12/L0.13 contracts.
  Full path-by-path record is on the PR G / G5 entry above (search
  "canonical-state review"); summary: every write path CLEAN (pure,
  immutable, never-replace, one-history-entry-per-gesture, degrade-never-
  throw); reimport channel-index safety PROBED through the real
  `createQuickFigureFromMapping` path and confirmed already correct (new
  permanent pin, `frontend/src/store/quickFigureReimport.test.ts` — not a
  fix, nothing was broken); one real-but-out-of-scope finding (a stale
  `groupKey` surviving a shape-changing reimport can raise a raw backend
  `ValueError` at export/preview time instead of a clear message) booked
  under PR M with a pointer, per L0.55. Gate: tsc/eslint clean; full
  vitest 479/479 files, 7,062/7,062 tests; build 826.1 kB eager (27.9 kB
  headroom, unchanged). G5's `[x]` is now honest: both Claude-owned
  handoff items are done; only the release-candidate human visual
  acceptance pass remains, as originally noted.
- **2026-08-17 — Claude, PR #160 merged (`0519280`) — PR G closed:** the G5
  lifecycle proof + canonical-state review branch merged after both
  orchestrated review rounds (mutation-tested pins; the plan-honesty
  correction that surfaced and then performed the canonical-state review)
  and 13/13 checks green (one e2e runner hang — GitHub infra, cleared by
  re-run in the normal ~3 min). PR G (G1-G5) is complete end to end;
  the sole remaining G-item is the release-candidate human visual
  acceptance pass, owner-only by design.
