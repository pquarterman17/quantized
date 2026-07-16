# Feature and GUI Interaction Audit

> **This is the raw source audit (reference only). The LIVE tracked plan is
> [`GUI_INTERACTION_PLAN.md`](GUI_INTERACTION_PLAN.md) — record status,
> checkmarks, and decisions THERE, not here.** (Adopted as a MAIN_PLAN sub-plan
> 2026-07-12; kept for provenance.)

**Auditor:** ChatGPT — Sol  
**Created:** 2026-07-12  
**Last updated:** 2026-07-12 17:44 EDT (UTC−04:00)  
**Goal:** Identify the feature, interaction, and usability gaps most likely to make the owner leave quantized and return to OriginPro, then turn that criticism into a roadmap for a genuinely great scientific workbench.

## How to use this plan

- `[ ]` Not implemented or not yet verified.
- `[x]` Implemented and verified against the acceptance condition.
- Do not check an item merely because supporting code exists; check it only when the complete user-facing behavior works.
- Whenever this plan changes, update **Last updated** and append a row to **Revision log**.
- Whenever an item is checked, append it to **Completed log** with its completion date, PR/commit, and verification evidence.
- Copy the checkbox wording into the completion log so later edits do not make the historical record ambiguous.

## Agent handoff and execution guide

This section is written for ChatGPT/Sol, Claude, or another implementation agent opening the plan without the preceding conversation.

### What this document is

This is simultaneously:

1. a point-in-time audit of the application as inspected on 2026-07-12;
2. a record of owner decisions gathered through a one-question-at-a-time interview;
3. a prioritized implementation backlog; and
4. an acceptance tracker for making Quantized the owner's default replacement for OriginPro.

The owner interview is authoritative for product intent. Generic Origin parity is secondary. The goal is not to reproduce every Origin feature; it is to eliminate the real situations that cause the owner to return to Origin, JMP, MATLAB, or a coding agent.

### How to interpret the checkboxes

- An unchecked item means the complete user-facing acceptance behavior has **not been verified under this plan**.
- It does **not** necessarily mean no supporting code exists. Many items extend partially implemented capabilities.
- Before implementing an item, inspect current `main`, the relevant tests, `plans/MAIN_PLAN.md`, `plans/PORT_CHECKLIST.md`, and the archived `GAP_*` plans. Claude or another agent may have implemented part or all of it after this audit.
- If the complete behavior already exists, verify it, add or strengthen tests if needed, then check it and log the evidence. Do not reimplement it.
- If only part exists, leave the item unchecked until its complete acceptance behavior works. Add a short indented progress note beneath the item if that prevents duplicated effort.
- A section heading such as **Later**, **Lower priority**, **Deferred**, **Stretch**, or **Revisit after use** is a scheduling constraint. Do not promote those items merely because they are easy.
- “Revisit after use” means retain the recorded initial decision, gather real usage evidence, and reconsider later; it is not an immediate implementation task.

Reference a task in commits and PRs as `SOL GUI audit — <section>: <exact checkbox wording>`. The section plus exact wording is the stable task identifier.

### Current priority order

Work from the first unfinished coherent slice in this order unless the owner explicitly redirects:

1. **Primary product milestone:** import → attractive first plot → mouse/Properties editing → Office copy/paste.
2. **Interaction safety:** comprehensive current-session Undo/Redo, clear active-tool feedback, reliable Cancel, discoverable drag/drop, and accessible tooltips.
3. **Coherent plot editing:** double-click Properties, right-click quick actions, selection-aware Inspector/Plot Objects, legends, axes, curves, and formatting copy/paste.
4. **Durable figure construction:** saved PlotSpecs/templates, multi-panel builder, workspace restoration, and export fidelity.
5. **Scientific traps:** weighted fitting, selected-channel baseline/pipeline execution, and other owner-confirmed escape workflows.
6. Lower-priority, deferred, later, and stretch items only after the earlier workflow is usable or when the owner explicitly chooses one.

Do not select work solely by checkbox order or implementation ease. Prefer a complete vertical workflow that the owner can test over several disconnected primitives.

### Non-negotiable owner decisions

- Original source files and imported raw data are immutable. Corrections create reversible steps or linked corrected data; never rewrite the original.
- An existing customized figure is never silently restyled by a template, remembered setting, or data-family inference.
- Suggested templates, error-column pairings, statistical tests, source re-imports, and destructive changes require preview or explicit confirmation as specified below.
- Figure editing must be possible without changing code or asking Claude/Sol to implement a one-off adjustment.
- Direct edits update live, while Cancel restores the exact pre-dialog state.
- Routine edits rely on Undo; confirmations are reserved for destructive or difficult-to-reverse operations.
- Application theme and figure/export theme are independent.
- Windows and macOS are required for the complete workflow. Ubuntu is a desirable bonus.
- Workspace restore must be exact, but Undo history only needs to persist for the current session.
- Raw scientific data remains full resolution for analysis even when display rendering is downsampled.

### Terminology used in this plan

| Term | Meaning |
|---|---|
| **Stage** | The central interactive Plot/Map/Worksheet area and plot-window canvas. |
| **Properties** | The complete editor for the selected curve, axis, legend, annotation, figure, or other object. It opens movable and may dock into Inspector. |
| **Inspector** | The existing right sidebar; evolve it into the selection-aware dock target rather than adding another permanent sidebar. |
| **ToolWindow/workshop** | Existing movable analysis dialogs mounted by `AppOverlays`; extend the shared abstraction instead of rebuilding each workshop. |
| **Import template** | Parsing, skipped/header lines, metadata extraction/cleanup, column roles, and error pairing. |
| **Figure template** | Plot types, styles, axes, legend, dimensions, annotations, and export settings. |
| **Workflow template** | A composable import template plus analysis steps and figure generation. |
| **Template type** | A user-named reusable setup with optional filename/header/metadata matching rules; it is suggested, never imposed. |
| **PlotSpec** | The durable graph specification shared by Graph Builder, Stage, Figure Builder, workspace persistence, and export. |
| **Display-only transform** | Scaling, offset, stack/waterfall, color limits, or other presentation change that never mutates raw values. |
| **Linked result** | A fit, slice, crop, derived column, corrected dataset, or panel that retains provenance and can recalculate from its source until explicitly frozen/unlinked. |
| **Robust autoscale** | Initial view may omit isolated orders-of-magnitude outliers from bounds while retaining and visibly indicating every point. |
| **Production-ready** | Correct plot semantics/error bars, intentional styling, readable legend/axes, correct physical size, and reliable Office/publication output. |

### Existing architecture to preserve

Follow the repository `AGENTS.md` and architecture guards. In particular:

- Keep `datastruct.py`, `io/`, and `calc/` pure; routes remain thin adapters.
- Keep backend source modules under 500 lines and frontend components near the 400-line convention.
- Use `DataStruct` as the data contract and parser registry/sniffers for imports.
- Keep uPlot for interaction and server-side matplotlib for vector publication export.
- Reuse the current `App.tsx` shell, `Library`, `Stage`, `Inspector`, `StatusBar`, `ToolWindow`, plot-window system, and design tokens.
- Extend shared actions and interaction primitives rather than adding feature-specific copies.
- Preserve existing user changes in a dirty worktree and run the repository guards before declaring work complete.

### Implementation workflow for one checklist item

1. Read the entire relevant subsection, not only the checkbox.
2. Inspect the current implementation and recent git history to determine what already exists.
3. State the user-visible acceptance behavior and the smallest coherent vertical slice.
4. Reuse the existing architecture and shared interaction/action systems.
5. Implement with current-session Undo, preview/Cancel, provenance, accessibility, and persistence where the subsection requires them.
6. Add proportionate unit/integration tests. Mouse, canvas, drag/drop, focus, clipboard, and layout work should also receive a real-browser interaction test where practical.
7. Run relevant frontend/backend tests and architecture guards.
8. Manually exercise the user workflow, not only the isolated control.
9. Update **Last updated**, append **Revision log**, check the item only if fully verified, and append **Completed log** with evidence.
10. In the PR description, state partial/deferred edges explicitly so a later agent does not infer completeness.

### Definition of done

An item is done only when:

- the owner-visible behavior is complete and discoverable;
- normal mouse and keyboard paths work where applicable;
- destructive behavior is guarded and/or undoable as specified;
- raw data and provenance rules are preserved;
- workspace/template/export behavior persists where required;
- automated tests pass;
- the relevant end-to-end interaction has been manually or browser-verified; and
- the checkbox and logs in this file have been updated.

Code merged without user-facing verification is implementation progress, not completion.

## Revision log

Append new entries; do not rewrite earlier history.

| Updated | Author | Change |
|---|---|---|
| 2026-07-12 | ChatGPT — Sol | Created the feature and GUI interaction audit. |
| 2026-07-12 17:43 EDT | ChatGPT — Sol | Added owner-interview requirements, existing-design compatibility findings, checkable tracking, timestamps, and completion-record conventions. |
| 2026-07-12 17:44 EDT | ChatGPT — Sol | Added an agent handoff guide, priority order, terminology, architectural constraints, implementation workflow, and definition of done so future Claude/Sol sessions can execute the plan without conversation context. |

## Progress tracker

### Interaction safety and discoverability

- [ ] Visual, organizational, and window-layout edits participate in coherent Undo/Redo.
- [ ] Plot objects use one consistent select, edit, right-click, drag, delete, and cancel model.
- [ ] Draggable objects and valid drop targets are discoverable before or immediately when dragging.
- [ ] The active mouse tool always shows its name, instructions, target, and cancellation behavior.
- [ ] Plot toolbar buttons have understandable grouping, accessible labels, pressed states, and shared tooltips.
- [ ] Context menus are keyboard-complete and share actions with Properties and Command Palette.
- [ ] Floating workshop windows stay recoverable, can be reset, and persist their positions.
- [ ] Real-browser tests cover the essential mouse, drag/drop, pointer-capture, and keyboard journeys.

### Plot construction and organization

- [ ] A synchronized Plot Objects tree exposes curves, axes, layers, legends, annotations, and shapes.
- [ ] Graph Builder specifications can be named, saved, reopened, duplicated, and stored in `.dwk`.
- [ ] Stage, Graph Builder, Figure Builder, and publication export use one canonical plot specification.
- [ ] Folder moves, nesting, selection, filtering, and bulk actions are explicit and undoable.
- [ ] Worksheet selection and highlights are scoped to the correct worksheet/window.

### Scientific workflow blockers

- [ ] Curve fitting supports explicit weighting and uses designated error columns when requested.
- [ ] Baseline analysis and subtraction operate on the selected plotted X/Y channels.
- [ ] Pipeline fits reproduce the interactive fit's channels, ROI, filtering, bounds, and weighting.
- [ ] Owner-confirmed Origin escape workflows are captured and prioritized from real projects.

## Existing-design compatibility

The recommended workspace does **not** require a full shell rewrite. The current implementation already has the correct structural foundation:

- `App.tsx` composes `TitleBar`, `MenuBar`, `Library`, `Stage`, `Inspector`, and `StatusBar` as separate components.
- `.qzk-main` is already a three-column CSS grid: left Library, flexible center Stage, and right Inspector.
- The left and right panels already have collapse controls.
- Stage already owns Plot, Map, and Worksheet views and hosts multiple movable plot windows.
- The Inspector already contains collapsible, plot-related cards.
- Analysis workshops already use a shared movable `ToolWindow` abstraction.
- The status bar already has connection, dataset, and project-count information.
- The existing Figure Page workshop is already the starting point for a multi-panel builder.

The target layout should be implemented by extending these seams:

- [ ] Evolve the existing Library into the linked project tree; retain its current folder, dataset, figure, report, and smart-folder components.
- [ ] Make the existing Inspector selection-aware so it becomes the dock target for Properties instead of introducing a second right sidebar.
- [ ] Extend `ToolWindow` with dock/undock, resize, viewport clamping, collapse, and persistent position rather than replacing workshop components.
- [ ] Add a collapsible bottom drawer for Worksheet, Results, Jobs, and Messages as a nested Stage/app-grid row.
- [ ] Extend the existing StatusBar with active-tool instructions, cursor/selection information, and background-job progress.
- [ ] Add draggable splitters that update the existing `--lw` and `--rw` sidebar-width variables.
- [ ] Persist panel widths, collapsed state, bottom-drawer state, and docked/floating Properties state.
- [ ] Add named layout presets by saving those same shell fields; do not create separate layout implementations.

### Important persistence gap

Plot-window geometry and views already persist in `.dwk`, but several shell and transient interaction fields do not. Current loading intentionally resets or omits items such as the active Stage tab, open workshops/dialogs, sidebar layout, and some selections. Meeting the owner's **exact workspace restoration** requirement therefore needs an additive workspace-schema extension and migration defaults.

- [ ] Define a versioned `uiLayout` workspace object for panel sizes, collapse/dock state, active tabs, open tools, floating-window positions, and selections.
- [ ] Keep crash-recovery state separate from the last intentional `.dwk` save.
- [ ] Restore safely when a saved monitor or viewport is no longer available by clamping every floating window into view.

### Compatibility verdict

Keep the current shell and evolve it. The only new structural element is the optional bottom drawer; everything else is an enhancement of an existing component boundary. A full rewrite would add risk without providing a better route to the requested workflow.

## Owner workflow requirements — interview findings

These requirements were captured from the owner after the initial audit. They refine the roadmap and take precedence over generic Origin feature parity.

### Primary product milestone

The first major milestone is the complete production-figure loop:

- [ ] Drop or import an arbitrary dataset.
- [ ] Preview and correct parsing, metadata extraction, column roles, and error pairing.
- [ ] Produce an attractive and scientifically appropriate first plot.
- [ ] Modify every important figure object through direct manipulation and Properties—without asking a coding agent to change the app.
- [ ] Copy a correctly sized, high-quality figure into PowerPoint or Word within seconds.

Acceptance targets:

- [ ] A familiar file with a saved template reaches a presentation-ready figure within **20 minutes at most**; faster is better.
- [ ] An unfamiliar text dataset reaches a clean first plot within **30 minutes at most**; faster is better.
- [ ] Copy/paste into PowerPoint or Word takes only **seconds** once the figure is ready.

### Import wizard and reusable template types

- [ ] Provide an import wizard with a raw-file preview and parsed-table/plot preview.
- [ ] Allow lines, header blocks, and instrumental text to be ignored for plotting while retaining them as searchable metadata.
- [ ] Support delimiter, decimal format, header length, skipped lines, repeated headers, and multiple numeric blocks.
- [ ] Let multi-block files become separate datasets, separate curves, or one combined table.
- [ ] Expose explicit column roles: X, Y, X error, Y error, metadata, and ignored.
- [ ] Suggest error-column pairings from common names (`err`, `error`, `sigma`, `SD`, `SEM`, `yerr`, shared name stems), adjacency, compatible units, and row counts.
- [ ] Show pairings clearly, e.g. `Moment ± Moment Error`, and always allow override.
- [ ] Preserve ignored instrument headers as searchable metadata and provenance.
- [ ] Save confirmed parsing, cleanup, metadata mapping, roles, and error pairings as an import template.
- [ ] Match future templates by filename pattern first, then headers and metadata.
- [ ] Always show a preview before applying a suggested template.
- [ ] Keep `Create plot after import` as a wizard option, but default to importing and waiting for the user to request a plot.
- [ ] Support batch import using one representative preview; process confident matches together and flag only exceptions.
- [ ] Keep import, figure, and complete workflow templates separate but composable.
- [ ] Let the user save a finished workflow as a named **template type**, with optional matching rules.
- [ ] Suggest template types for future datasets but never impose them automatically.
- [ ] Never modify existing customized figures when a template changes; `Update from template` must be explicit.
- [ ] Show template provenance quietly in metadata/Properties, including a non-distracting `modified` state.
- [ ] Surface favorite and recently used templates in import and plotting menus.

Lower priority:

- [ ] Save reusable metadata-cleanup steps: rename, find/replace, regex extraction, split/merge fields, filename parsing, fill-down, type/unit assignment, and validation.
- [ ] Watch a folder and offer template-based import of newly created instrument files.
- [ ] Export, version, install, and share templates between users.

### Working paths and external source files

- [ ] Add a MATLAB-like visible working-directory dropdown.
- [ ] Support recent paths, pinned/named favorite paths, Browse, parent, Back, and Forward.
- [ ] Remember a per-project working directory and separate recent import/export locations.
- [ ] Open file dialogs in the active working directory by default.
- [ ] Reference dragged/imported source files in place; never move or rewrite them.
- [ ] Cache parsed project data so datasets remain usable when network sources are offline.
- [ ] Add quiet source-status icons for unchanged, changed, missing, offline/network unavailable, and unverified.
- [ ] Detect changed source files but never re-import automatically; offer Review Differences and Re-import.
- [ ] Do not treat a disconnected network drive as file deletion or repeatedly interrupt the user.
- [ ] Provide a bulk Relink Missing Files wizard using filenames, metadata, and checksums.

### Direct plot-object interaction contract

- [ ] Double-click empty plot space to reset zoom to the figure's default view.
- [ ] Double-click a curve, axis, legend border, label, or other object to open that object's Properties.
- [ ] Right-click an object to select it and open quick actions plus the same full Properties command.
- [ ] Properties opens as a movable dialog and can be docked into the existing Inspector.
- [ ] Properties updates the figure live; Cancel restores the exact pre-dialog state.
- [ ] Show common settings first and complete controls under Advanced.
- [ ] Provide `Reset this section` and Copy/Paste Settings in each Properties section.
- [ ] Remember the last Properties section by user-defined template/data type, not globally.
- [ ] Do not let remembered UI state restyle existing customized plots.
- [ ] Support copying formatting from a curve, axis, legend, or entire figure and pasting formatting without changing data.
- [ ] Apply common style changes to multi-selection: width, color, visibility, line style, opacity, markers, error bars, axis assignment, drawing order, legend inclusion, and labels.
- [ ] Keep comprehensive edit Undo/Redo for the current session; persisted Undo history is not required.
- [ ] Keep zoom/pan Back/Forward history separate from edit Undo/Redo.
- [ ] Support persistent named views such as `full range` or `low-field region`.

### Mouse tools and navigation

- [ ] Use an explicit Pan tool rather than making ordinary Pointer drags pan unexpectedly.
- [ ] In Pan mode, plot-area drag pans both axes and axis-gutter drag pans only that axis.
- [ ] Axis range handles appear when an axis is selected in Pointer mode.
- [ ] Show active-tool name and a one-line instruction in the status bar.
- [ ] Use concise, one-sentence tooltips with shortcuts and disabled-state explanations.
- [ ] Make Esc reliably cancel the active gesture/tool.
- [ ] Use fixed, consistent shortcuts initially.

Low priority:

- [ ] Add customizable keyboard shortcuts.
- [ ] Add switchable guided and compact toolbar presentations.

### Default plot quality and plot selection

The most visible first-plot failures are incorrect line/scatter/line+marker choice, incorrect error bars, weak colors/line widths, outlier-distorted autoscaling, and poor legends.

- [ ] Make plot type explicit and easy to change among line, scatter, line+marker, and relevant specialized types.
- [ ] Use import roles and saved figure templates to create an appropriate first plot.
- [ ] Ship several polished visual presets with common and colorblind-safe palettes.
- [ ] Let a finished figure be saved as a reusable figure template.
- [ ] Separate application UI theme from figure/export theme.
- [ ] Provide grayscale and print preview.
- [ ] Support metadata-driven ordered color gradients for parametric series.
- [ ] Offer both discrete legend entries and a continuous colorbar for numeric metadata such as temperature or field.

### Robust autoscaling

- [ ] Ignore an isolated point from initial autoscaling when it is orders of magnitude from the main distribution.
- [ ] Preserve every point in data and analysis unless the user explicitly excludes it.
- [ ] Show a small axis-edge indicator with the count of off-screen points.
- [ ] Hover to inspect their range and series; click to include all.
- [ ] Right-click for Include All, Keep Robust Scale, Inspect Points, and Exclude from Analysis.
- [ ] State robust-autoscale status in Axis Properties.
- [ ] Omit off-screen indicators from publication export unless explicitly enabled.

### Axes, bounds, units, and ticks

- [ ] Edit plot bounds and margins with direct handles and synchronized numeric Properties controls.
- [ ] Support secondary axes, linked axes, and axis breaks as near-term priorities.
- [ ] Create and adjust axis breaks both directly on the axis and through numeric Properties.
- [ ] Support display-only scaling using `displayed = raw × scale + offset`, including multiply/divide by arbitrary values.
- [ ] Preserve raw data and optionally create a separate permanently rescaled dataset.
- [ ] Offer named unit conversions, automatic SI prefixes, and manual scale overrides.
- [ ] Update labels automatically with scale notation such as `Moment (×10⁻⁶ emu)`, while allowing manual text.
- [ ] Support custom tick positions, labels, formatting, and visibility.
- [ ] Double-click an individual tick label to override it and provide Restore Automatic Label.
- [ ] Detect overlapping tick labels and suggest spacing, rotation, or fewer labels without silently changing customized axes.

Later: reversed, nonlinear, categorical, and date/time axes.

### Legend model

- [ ] Support multiple named column-metadata rows rather than one Origin-style Comment field.
- [ ] Let the user choose or combine fields such as Sample ID, Field, and Temperature into a legend label.
- [ ] Support configurable templates such as `{Sample ID} · {Field} Oe · {Temperature} K`.
- [ ] Drag the legend freely; snapping is optional and can be disabled/bypassed.
- [ ] Double-click an entry for inline label editing.
- [ ] Double-click the legend border/empty area for full Legend Properties.
- [ ] Right-click entries for series actions and the legend body for layout actions.
- [ ] Preserve automatic metadata labels beneath manual overrides and provide Restore Automatic Label.
- [ ] Manually drag entries into the desired order, rows, and columns; never automatically reflow them.
- [ ] Provide a real multiline legend editor with selection, cut/copy/paste, line breaks, scientific symbols, LaTeX-style text, and metadata placeholders.

Revisit after use:

- [ ] Decide whether an optional command should synchronize legend order with curve drawing order. Keep them independent initially.

### Scientific text and annotations

- [ ] Support plain/rich labels, Greek letters, degree and Ångström symbols, and other common scientific symbols.
- [ ] Support equations, arrows, callouts, scale bars, and data-linked values.
- [ ] Provide a searchable symbol palette plus LaTeX-style entry.
- [ ] Keep direct positioning, Properties editing, and publication export visually consistent.

### Curve and selected-range context menus

- [ ] Curve menu: Properties, Hide/Show, legend rename, change plot type, style/error quick controls, axis assignment, order, fit, display normalization/offset, source data, copy values, copy/paste formatting, duplicate, and remove from figure.
- [ ] Keep source-data deletion separated, guarded, and undoable.
- [ ] Point menu: exact values/metadata, source worksheet row, copy, exclude/include, label/callout, fit boundary/baseline anchor/cursor, linked highlight, point style, quality note, and guarded delete.
- [ ] Synchronize selected rows/points across linked plots and worksheets, with right-click Unlink.
- [ ] Range Selection menu: zoom/set axis range, copy/export/create dataset, mask/include/invert, note/highlight, fit, peak analysis, statistics, transformations, inset/magnifier, shading, reference lines, and send to plot/panel.
- [ ] Put common actions first and organize the rest into Selection, Fit, Peak Analysis, Analyze, and Plot/Annotation submenus.
- [ ] Preserve raw data and preview all data-changing actions.

### Stack/waterfall plots

- [ ] Add a dedicated display-only Stack/Waterfall command.
- [ ] Support additive vertical spacing and multiplicative/decade spacing.
- [ ] Suggest automatic spacing but allow exact manual override.
- [ ] Support metadata ordering, drag reorder, reverse order, individual fine adjustment, labels beside curves, and one-click return to overlay.
- [ ] Store the arrangement in the figure template.
- [ ] Do not add horizontal offsets; vertical separation is sufficient for the owner's workflow.

### Clipboard, Office, and export

- [ ] Ctrl+C on a selected plot copies a 300-DPI image by default.
- [ ] Preserve exact physical dimensions, layout, background, and optional transparency.
- [ ] Add Copy SVG/Vector, Copy Transparent Image, Copy at Physical Size, and Copy Plotted Data.
- [ ] Make clipboard output reliable on Windows and macOS; Ubuntu is a desirable bonus.
- [ ] Add an export bundle containing SVG/PDF/PNG, plotted data, and provenance.
- [ ] Add Send to system share sheet where supported.

Later/stretch:

- [ ] Embed a reopenable, editable Quantized figure in PowerPoint/Word.

### Multi-panel builder

- [ ] Expand the existing Figure Page workshop into a multi-panel builder wizard.
- [ ] Keep panels linked to source figures by default and provide explicit Unlink.
- [ ] Support grid presets and custom rows/columns.
- [ ] Support equal panel size, equal plot-area size, and preserved source aspect ratio.
- [ ] Support shared X, shared Y, shared both, independent axes, and selected link groups.
- [ ] Align plot interiors so axes line up despite different labels.
- [ ] Control horizontal/vertical spacing and repeated inner tick labels.
- [ ] Support shared/per-panel titles, legends, and automatic panel labels.
- [ ] Provide live drag/resize canvas, snapping/alignment guides, and numeric position/size controls.
- [ ] Permit completely free positioning when snapping is disabled.
- [ ] Include journal-column and presentation-slide presets.

### 2D map interaction and performance

- [ ] Optimize interaction tests for large 2D color maps, including recoloring, zooming, slicing, and export.
- [ ] Provide pan/zoom, pixel inspection, direct color-scale editing, and rectangular/free ROI selection.
- [ ] Create horizontal, vertical, and arbitrary-angle slices as linked 1D plots.
- [ ] Support adjustable slice averaging width.
- [ ] Update color appearance live without recalculating source data.
- [ ] Add colorbar handles and Properties for limits, robust percentiles, linear/log/symmetric-log, diverging center, palette reversal, clipping, NaN color, and out-of-range indicators.
- [ ] ROI results: count/area, min/max/mean/median/std/sum/integral, peak, intensity-weighted center, horizontal/vertical projections, crop, mask, export, annotation, and cross-map comparison.
- [ ] Keep generated slices, projections, and crops linked by default with Unlink.
- [ ] Add link groups for shared color limits, ROI, slice position, zoom, and cursor across related maps.
- [ ] Propagate linked 2D changes after mouse release, not continuously while dragging.

### Fitting and expressions

- [ ] Drag, resize, and move one or more fit regions directly on the plot.
- [ ] Support disjoint fit regions and individual-point exclusions without altering raw data.
- [ ] Preview model, guesses, bounds, constraints, and weighting with linked residuals.
- [ ] Support confidence/prediction bands, model comparison, and repeat across selected curves/datasets.
- [ ] Support shared, fixed, independent, bounded, and derived parameters across curve series.
- [ ] Store accepted fits as linked analysis objects with complete provenance and optional recalculation/freeze.
- [ ] Make fit overlays ordinary editable plot objects.
- [ ] Add a custom-equation builder using Python-style syntax.
- [ ] Explicitly mark parameters as fitted, fixed, bounded, shared, or derived.
- [ ] Reuse the same expression system for calculated worksheet columns and transformations.
- [ ] Keep calculated columns live/recalculating by default with Freeze to Values.
- [ ] Reference columns and metadata by readable names.
- [ ] Output batch/multi-curve parameters as a first-class table that is directly plottable.

Later/stretch:

- [ ] Render Python-style equations as pretty mathematical notation.
- [ ] Support editable LaTeX-style equation entry/conversion.
- [ ] Add intelligent expression autocomplete for columns, metadata, functions, units, and parameters.

### Categorical statistics and JMP-like Graph Builder

- [ ] Extend Graph Builder with JMP-like drag/drop for numeric Y and nested categorical X fields such as Lot, Wafer, and Type.
- [ ] Support Color, Facet, Filter, and Row/Column wells and draggable grouping order.
- [ ] Switch quickly among box, violin, strip, swarm, bar, and summary-point views.
- [ ] Overlay raw points by default for small/medium groups; tune opacity/size or downsample display for dense groups.
- [ ] Show sample count and statistics and save the arrangement as a PlotSpec/template.

Lower tier:

- [ ] Add guided statistical-test suggestions, explicit confirmation, multiple-comparison corrections, and linked significance brackets.

### Dataset combination and derived quantities

Deferred:

- [ ] Add a dataset-combination wizard for append, merge, join, column matching, X alignment/interpolation, unit reconciliation, and provenance.
- [ ] Add a calculator-style, unit-aware derived-quantity wizard using the shared Python expression system.

### Project organization and search

- [ ] Use one linked project tree for Raw/Processed Data, Analyses, Figures, Reports, Notes, and Project Templates.
- [ ] Keep default folders optional, renameable, and removable.
- [ ] Link figures and analyses to source data without unnecessary duplication.
- [ ] Show dependencies, generated outputs, notes, timestamps, provenance, and related items.
- [ ] Support tags, smart folders, Favorites, Recent, Unfiled, and object-type filters.
- [ ] Warn about dependencies but allow deletion after confirmation.
- [ ] Make ordinary edits fast and reserve confirmation dialogs for destructive/difficult-to-reverse actions.

Revisit after real use:

- [ ] Evaluate whether the single project tree becomes cluttered or mismatches the owner's workflow; revise the organization model if needed.

Later:

- [ ] Add project-wide search across names, instrument metadata, notes, legend fields, fit results, and analysis parameters.
- [ ] Add persistent project Trash with restore, explicit emptying, configurable size/retention limits, pinned items, largest-item review, and no silent active-session purge.

### Workspace, startup, and long-running jobs

- [ ] Start on a home screen emphasizing Recent Projects and file drop/import.
- [ ] Offer Restore Last Session; do not reopen it automatically.
- [ ] Restore saved workspace visual state exactly, including layout, zoom, selections, open tools/dialogs, and unfinished figure state.
- [ ] Autosave to a separate crash-recovery copy without overwriting the last intentional save.
- [ ] Support named workspace snapshots such as `before normalization`.
- [ ] Keep long imports, fits, and exports in background jobs while the UI remains usable.
- [ ] Show a contextually placed progress bar with step/item count, reliable ETA, and Cancel.
- [ ] Use the status bar for routine progress rather than interrupting the user.
- [ ] Use an adaptive collapsed bottom drawer for Worksheet, Results, Jobs, and Messages.
- [ ] Open it for explicitly requested content or results requiring review; use badges for unseen results/errors.
- [ ] Remember drawer height/tab and allow pinning in named layouts.

### Errors and diagnostics

- [ ] Show a plain-language summary, affected item, partial-change status, likely cause, and a specific next action.
- [ ] Continue safe batch items and collect failures into one review list.
- [ ] Keep errors in a notification/history panel rather than only transient toasts.
- [ ] Put original errors, parser/model, path, version, job ID, Copy Diagnostics, and Save Diagnostic Report under expandable Technical Details.

### Data integrity, provenance, and sharing

- [ ] Treat imported raw data and original source files as immutable.
- [ ] Store cleaning, rescaling, exclusions, corrections, and derived quantities as reversible steps or linked corrected datasets.
- [ ] Export lightweight data-only output or a reproducible bundle.
- [ ] Embed provenance where supported and offer a JSON sidecar for CSV/TSV.
- [ ] Record source name/checksum, import template, corrections, exclusions, formulas, units, timestamps, and Quantized version.
- [ ] Offer lightweight referenced workspaces and validated self-contained portable project bundles.
- [ ] Add optional user name plus created/modified author/time on major project objects.
- [ ] Keep a deliberately small project log for explicit saves, imports, analysis creation, and template application—not every mouse edit.
- [ ] Export the log with reproducible bundles.

Full real-time collaboration, approvals, and detailed version-control-style diffs remain out of scope unless real use demonstrates a need.

## Scope

This audit covers:

- analysis and data-processing tools;
- interactive and publication plotting;
- mouse workflows, direct manipulation, right-click menus, and drag/drop;
- buttons, icons, tooltips, menus, dialogs, and layout clarity;
- library, folders, workspaces, and project organization;
- discoverability, feedback, error prevention, and recovery;
- remaining OriginPro parity gaps that materially affect daily work.

## Method

- Inspect the current plans, backlog, implementation, and recent audit-fix history.
- Exercise the running application with a mouse-oriented workflow.
- Inspect contextual menus and drag/drop contracts in both the live UI and source.
- Separate observed behavior from source-only or plan-documented gaps.
- Prioritize by likelihood of reopening Origin, not by implementation novelty.

## Executive verdict

Quantized is much closer to an Origin replacement than a simple feature-count comparison suggests. It already has a broad scientific-analysis surface, fast interactive plotting, publication export, worksheets, workspaces, folders, multiple plot windows, graph building, and a surprisingly large set of direct plot interactions.

The main risk is no longer “there is no way to do this.” The risk is:

> **The capability exists, but the user cannot discover it, cannot predict which gesture applies, or cannot safely undo the result.**

That distinction matters. Origin is sticky partly because a scientist can click an object, right-click it, drag it, or double-click it and usually find a path to modify it without code. Quantized has many of those individual gestures, but not yet one coherent object-editing language. An expert who helped build the app can be productive; a future user—or the owner after several weeks away—will have to remember too much.

The highest-return work is therefore not another long list of analysis algorithms. It is to turn the existing capabilities into a consistent, visible, reversible GUI.

### Default-tool readiness

| Area | Current assessment | Risk of returning to Origin |
|---|---|---:|
| Core 2D interactive plotting | Strong | Low |
| Direct graph editing | Capable but inconsistent and hidden | **High** |
| Right-click workflows | Strong where implemented; incomplete as a system | Medium–high |
| Drag/drop | Broad, but weakly signposted | Medium–high |
| Undo/recovery | Good for data edits, weak for visual and organizational edits | **High** |
| Buttons and tooltips | Dense, icon-heavy, mostly browser-title hints | **High** |
| Folder/project organization | Feature-rich but interaction-dense | Medium |
| Reusable graph construction | Graph Builder is promising but ephemeral | **High** |
| Analysis breadth | Strong and rapidly improving | Medium |
| Publication output | Strong vector-export foundation | Low–medium |
| Advanced Origin niches | Several owner-dependent gaps remain | Medium |

## What is already good

This audit should not erase the amount of good interaction work already present.

- The plot supports pointer, box zoom, pan, data cursor, measurement, region statistics, row-range selection, integration, peak/FWHM analysis, a live gadget, shape drawing, reset, autoscale, snapshots, stack, inset, polar, and statistical modes.
- Curves and axes have a substantial plot context menu: curve style, color, line width, marker, visibility, rename, left/right Y assignment, scale, limits, grid, legend, export, data copy, and tool selection.
- Plot annotations and shapes can be selected, moved, resized, edited, pinned to data or page coordinates, styled through right-click menus, and deleted.
- Reference lines and baseline anchors can be manipulated directly on the plot.
- Dataset rows and folders have meaningful context menus, including bulk operations.
- Worksheet row and column context menus cover designation, sorting, statistics, plotting, masking, and Graph Builder handoff.
- OS file drop, dataset-to-folder drop, folder nesting/reordering, channel-to-axis drop, channel-to-Graph-Builder drop, dataset-to-window drop, and panel-cell reordering all exist.
- Plot windows can be moved, resized, snapped, renamed, maximized, pinned, rebound to other data, and arranged into panels.
- Figure Builder already supports dragging legends and annotations in its preview and direct text editing.

These are real strengths. The criticism below is about making them feel like one excellent application instead of a collection of individually good interactions.

## Critical interaction findings

### P0 — Mouse-driven visual edits are not comprehensively undoable

The current history system deliberately records data-mutating actions but excludes plot view, styles, window layout, preferences, shapes, annotations, and folder-tree edits. The source describes those changes as “cheap to redo by hand.” That assumption is not appropriate for a direct-manipulation scientific editor.

Examples of actions a user should be able to reverse immediately include:

- accidentally dragging an axis title or annotation;
- resizing or deleting a shape;
- changing a curve color, marker, line width, order, visibility, or Y axis;
- moving a reference line;
- rearranging, resizing, closing, or rebinding a plot window;
- reparenting a folder or dataset through a slightly inaccurate drop;
- changing a graph specification and then deciding the previous view was better.

This is the largest interaction-level reason to reopen Origin. Free experimentation only feels easy when it is safe.

**Recommendation:** make every committed mouse edit create a named history transaction. Coalesce a drag into one step—`Move annotation`, not 80 pointer-move entries. Keep navigation-only zoom/pan history separate if necessary, but provide Back/Forward view history. Include the action name in Edit → Undo and in a brief toast.

**Acceptance test:** after any visual, organizational, or window-layout edit, one Ctrl+Z restores exactly the previous state and Ctrl+Shift+Z reapplies it.

### P0 — There is no unified “select object, then edit it” model

Quantized currently has several overlapping editing grammars:

- right-click a curve or axis zone on the plot;
- click or drag shapes and annotations in Pointer mode;
- drag reference lines directly;
- double-click some text elements;
- use the legend for some series operations;
- use Inspector cards for other series and axis operations;
- open Graph Builder or Figure Builder for still other plot construction tasks.

Each path works locally, but the user has to know which object owns which action. This becomes harder as the plot grows more sophisticated.

Origin's current interface uses an Object Manager tree and context-sensitive mini toolbars so a selected plot, layer, or graphic object exposes relevant actions near the selection. Its Object Manager also supports selection, visibility, reordering, grouping, property editing, and drag/drop across plot objects. See the official [Object Manager documentation](https://docs.originlab.com/origin-help/object-manager/) and [Mini Toolbar documentation](https://docs.originlab.com/origin-help/mini-toolbar/).

**Recommendation:** add a Plot Objects panel, probably as an Inspector mode, with a tree such as:

```text
Graph
├─ Layer / panel 1
│  ├─ X axis
│  ├─ Left Y axis
│  ├─ Right Y axis
│  ├─ Curve: Moment
│  ├─ Curve: Fit
│  ├─ Legend
│  ├─ Reference line
│  └─ Annotation
└─ Layer / panel 2
```

Selection must synchronize both ways: click an object on the plot and its tree row selects; click a row and the plot object highlights. The row should provide visibility, reorder, delete, duplicate, and Properties. Multi-select should support alignment, shared styling, grouping, and distribution for graphic objects.

### P0 — Powerful gestures are mostly invisible

The app contains many drag/drop and double-click behaviors, but their resting UI rarely advertises them. A user cannot infer all of the following just by looking:

- channels can be dragged to plot axes and Graph Builder wells;
- datasets can be dropped into folders, plot windows, and panel cells;
- a folder drop has three different meanings depending on whether the pointer is near the top, middle, or bottom of a row;
- legend entries can be dragged or right-clicked;
- plot titles, axis titles, annotations, reference lines, and shapes have different editing gestures;
- double-clicking the empty plot resets the view while double-clicking text edits it.

The implementation has drop highlighting, which is good, but that feedback appears only after a drag has already begun. Discovery happens too late.

**Recommendation:** add visible drag handles or grip dots to draggable rows and legend entries; show a one-time hint on hover; change the cursor over draggable/editable objects; reveal valid drop targets immediately when dragging begins; and add equivalent menu/button paths for every drag action. An interaction should never be drag-only.

For the three-zone folder drop, render a clear insertion line for before/after and a filled folder highlight for “move inside.” Add a temporary label such as `Move inside Results` or `Place after Results` so the consequence is unambiguous before mouse-up.

### P1 — The floating plot toolbar is too dense and too cryptic

The plot toolbar presents roughly two dozen small glyph-only buttons. Most have only a native HTML `title` attribute. Several glyphs are visually similar or culturally unfamiliar, and the toolbar mixes four conceptual groups:

- navigation and selection;
- interactive analysis gadgets;
- drawing and annotation;
- export, view mode, and plot-type actions.

The result is compact but not self-explanatory. Native title tooltips are delayed, inconsistently styled, hard to scan, and not a substitute for accessible names. Most plot toolbar buttons have no `aria-label`; a quick source inspection found labels in some window and Graph Builder controls, but not in the main plot dock or generic context-menu semantics.

**Recommendation:**

1. Replace title-only hints with a shared tooltip component containing name, one-line behavior, and shortcut.
2. Add `aria-label`, `aria-pressed`, and keyboard focus styles to every icon button.
3. Split the toolbar into compact named flyouts: Navigate, Inspect, Analyze, Annotate, View, Export.
4. Keep the active tool visibly named in the status bar, e.g. `Peak/FWHM — drag across one peak · Esc cancels`.
5. Make the toolbar configurable and remember the configuration. Origin allows toolbar visibility and layout to persist; see [Customizing Toolbars](https://docs.originlab.com/origin-help/customize-toolbars/).
6. Disable impossible actions and explain why in the tooltip instead of letting the click do nothing.

An optional “expanded labels” toolbar mode would cost screen space but dramatically improve learnability.

### P1 — Context menus are strong but not a complete interaction system

Context menus are one of the better parts of the current UI. Dataset, folder, worksheet, plot, legend, shape, and annotation menus are all useful. However:

- contextual coverage is inconsistent across tabs, Inspector cards, tool windows, plot windows, reports, and saved figures;
- there is no small visual cue that right-click is available;
- generic menus do not expose menu/menuitem roles or full arrow-key navigation;
- submenus are hover-oriented, which is slower and less robust for trackpads and keyboard users;
- destructive and reorganizing actions do not all share one confirmation/undo policy;
- menu actions are not always mirrored in a visible Properties surface.

**Recommendation:** create a context-action registry keyed by selected object type. Use the same action definitions in right-click menus, the Plot Objects panel, Command Palette, and optional mini toolbar. This prevents four surfaces from drifting apart.

The menu component should implement standard keyboard behavior: focus the first enabled item; Up/Down to move; Right/Left to open/close submenus; Enter/Space to invoke; Home/End; type-ahead; Escape to close and return focus. Add `role="menu"`, `role="menuitem"`, `role="menuitemcheckbox"`, and accessible submenu state.

### P1 — Active tool modes need stronger feedback and escape behavior

The plot has many modal tools. That breadth is valuable, but modal interactions are where accidental edits and “why is my mouse doing this?” confusion appear.

Every mode should answer, without guesswork:

- Which tool is active?
- What does the next click or drag do?
- What object or curve will receive the action?
- How do I cancel?
- Did the operation commit?
- Can I adjust the result afterward?

**Recommendation:** use a consistent interaction HUD/status strip. Esc should always cancel the in-progress gesture and return to Pointer, unless a persistent-tool preference is enabled. Right-click during an unfinished gesture should cancel it before opening a menu. Temporary tools should return to Pointer after completion. Cursor shape and plot overlay should reflect the active mode.

### P1 — Floating workshops can be dragged partly off-screen and lack window controls

`ToolWindow` clamps its left/top coordinates to zero but has no corresponding right/bottom viewport clamp. A workshop can therefore be dragged far enough that important content or its title bar becomes inaccessible. Tool windows also do not provide resize, minimize/collapse, dock, or reset-position controls, and their positions are local component state rather than a durable workspace preference.

**Recommendation:** clamp the full title bar to the viewport, add a `Reset window positions` command, persist positions, and support at least collapse and resize. Longer term, allow docking workshops into the right panel. This matters as much as individual analysis features because workshops are the primary no-code interface.

### P1 — Graph Builder does not yet create a durable, reusable graph artifact

Graph Builder has excellent fundamentals: X/Y/Group/Facet wells, drag/drop plus click assignment, live preview, mark cycling, and Send to Stage. But the current action set is only Send to Stage and Reset. A graph specification cannot yet be named, saved, reopened, duplicated, exported directly, or attached as a reusable template. The live UI also states that box, violin, and bar marks do not facet.

Origin's Plot Setup can add/remove plots, change plot type, designate columns, reorder plots, group plots, and edit ranges in one persistent construction surface; see [Plot Setup](https://docs.originlab.com/origin-help/plot-setup/).

**Recommendation:** promote Graph Builder output to a first-class saved PlotSpec stored in `.dwk`. Add Save, Save As, Duplicate, Open in Figure Builder, and Export. The Stage should show which saved spec it is displaying and whether it has unsaved changes. Finish facets for statistical marks and allow plot/layer reordering in the builder.

### P1 — “Send to Stage” and builder/stage separation can break WYSIWYG confidence

Quantized intentionally separates fast canvas interaction from vector publication rendering. That architecture is sound, but users must trust that what they edit is what they export. Today, graph construction is spread among Stage, Graph Builder, Inspector, context menus, and Figure Builder.

**Recommendation:** define one canonical plot specification used by all surfaces. Stage is the fast renderer; Figure Builder is the page/layout editor; export is the vector renderer—but all three should edit or render the same underlying object. Provide an export preview and a parity test for axis limits, labels, fonts, colors, line widths, markers, annotations, error bars, legends, facets, and panel geometry.

### P1 — Folder organization is capable but has high gesture density

The Library supports nested folders, smart folders, tags, saved figures, reports, book families, filtering, dataset multi-selection, reordering, bulk analysis, and consolidated export. This is good feature coverage. It also creates several usability risks:

- folder rows are draggable across their full surface, so an intended click can become a drag;
- clicking anywhere on a folder toggles it, while double-clicking only the name renames it;
- one target row supports before, inside, and after drop semantics;
- search switches the tree to a flat result list, temporarily hiding organizational context;
- smart folders, normal folders, reports, figures, and book families are different object types but share a narrow panel;
- manual order is disabled under some filtered/organized states, which may be correct but needs visible explanation;
- folder-tree changes are outside Undo.

**Recommendation:**

- use a dedicated drag handle instead of making the whole folder header draggable;
- add breadcrumbs or `Show in folder` for filtered results;
- separate project content from saved queries with clearer section headers and optional collapse;
- expose a selection bar for multi-select (`7 selected · Plot · Move · Tag · Export · Clear`);
- add a folder Properties dialog with name, notes, color, default template, and automation;
- remember expanded/collapsed state and panel width in the workspace;
- provide Undo for all moves, creates, renames, and deletes.

### P1 — Multiple worksheet windows still share global selection/highlight state

`WorksheetPane` documents that multiple worksheet windows share global plot-column highlighting and row selection. That is an understandable v1 shortcut, but it is confusing in a multi-window scientific workspace: clicking in one sheet can visually affect another sheet that appears independent.

**Recommendation:** key worksheet selection, active cell, range, and plotted-column emphasis by worksheet/window ID. Cross-sheet linked selection should be explicit and visually labeled, not incidental global state.

### P1 — Mouse interactions need real-browser end-to-end coverage

There is extensive unit coverage of interaction bridges, hit tests, menus, drag contracts, overlays, and store actions. That is excellent engineering. Yet jsdom-level tests cannot fully validate canvas hit targets, pointer capture, browser drag/drop, menu placement, high-DPI scaling, overlapping plugins, or real focus behavior.

The number of specialized pointer plugins also creates an integration risk: zoom, annotations, shapes, axis labels, reference lines, baseline anchors, legend movement, and analysis gadgets can all compete for the same pointer stream.

**Recommendation:** add Playwright interaction journeys at 100%, 125%, and 200% scaling:

1. import by file drop;
2. create/nest/reorder folders and undo each action;
3. drag channels to X/Y/Y2;
4. right-click a curve and change style;
5. move/edit/delete/undo an annotation and shape;
6. edit an axis title and limits;
7. build/save/reopen/export a graph;
8. arrange and restore plot windows;
9. use each analysis drag tool and cancel with Esc;
10. complete the same essential journey using keyboard only.

## Analysis and plotting gaps that still threaten default use

The recent implementation work has closed many major audit findings. The following are still visible in the current source or live backlog.

### Weighted fitting is not connected to plotted error columns

The plot understands Origin-style error-column designations through `errKeys`, but the main curve-fit request still sends only model, X, and Y. This means error bars can be displayed while the fit silently treats every point equally.

**Required behavior:** allow none, instrumental Y error, instrumental X/Y error where supported, manual weights, Poisson, and common robust weighting. Display the weighting equation in the fit result, store it in fit provenance, and reuse it during recalculation and pipeline execution.

### Baseline analysis still assumes time versus the first value channel

The baseline workshop still calculates from `ds.data.time` and `values[0]`, and subtraction changes only the first value channel. If the displayed plot uses a different X or Y channel, the mouse-picked region/anchors and the actual computation can diverge.

**Required behavior:** bind baseline to the plotted X and selected primary Y, show those channel names in the workshop, store them in provenance, and subtract into that same selected channel.

### Pipeline fit execution still assumes time versus the first value channel

Interactive fitting now follows the plotted channels, but recorded pipeline fit execution still fits analysis-data time versus `values[0]`. A pipeline can therefore fail to reproduce the fit from which it was recorded.

**Required behavior:** store and execute the same typed fit specification—including X, Y, row filters, ROI, model, bounds, and weighting—that produced the original interactive result.

### Owner-dependent Origin feature gaps remain

These should be prioritized from real work, not from Origin's feature checklist:

- general worksheet stack/unstack, reshape, transpose, pivot, and join-by-key;
- date/time axes and date-aware worksheet operations;
- broad signal processing beyond the current targeted tools;
- general-purpose 3D surface/mesh/contour workflows outside the specialized RSM path;
- database/query connectors;
- remaining `.opju` migration edges such as matrix books, some 2D instrument data, and rich graphic-object/callout fidelity.

The correct test is simple: collect the last 20 real projects for which Origin was opened and identify the first nontrivial action Quantized could not complete.

## Buttons, labels, menus, and tooltips audit

### Buttons

- Do not rely on Unicode glyph recognition for primary workflows.
- Every icon button needs an accessible name, visible focus state, enabled/disabled explanation, and consistent pressed state.
- Use split buttons for a remembered last-used tool with a discoverable flyout.
- Put text on high-consequence actions such as Fit, Apply, Subtract, Export, Delete, Save, and Send to Stage.
- Standardize button order in dialogs: secondary actions first, primary action last; destructive action separated.
- Avoid using the same visual weight for a navigation tool and an irreversible data operation.

### Tooltips

A shared tooltip should show:

```text
Peak / FWHM
Drag across one peak to measure center, height, area, and width.
Shortcut: P   ·   Esc cancels
```

Tooltips should appear quickly, remain while the pointer is over them, support keyboard focus, avoid covering the target, and link to a short help topic for complex tools. A first-run “show interaction hints” mode would make the existing UI dramatically easier to learn.

### Menus

- File is broad and useful, but should surface recent workspaces and recovery/autosave status prominently.
- Analyze is feature-rich but becoming flat and difficult to scan. Group by Fit, Peaks/Baseline, Magnetometry, XRD/Reflectivity, Transform/Signal, Statistics, and Workflow.
- Graph should become the home for Graph Builder, Figure Builder, plot types, layers/panels, themes, templates, and export.
- Data should own worksheet, row/column, filter, reshape, merge/join, correction, and metadata operations.
- Help is too thin for an application of this depth. Add searchable tool help, mouse interactions, importing guides, Origin migration, example projects, diagnostics, report issue, and a `What is this?` mode.
- Show shortcuts in menus and ensure Command Palette labels match menu labels exactly.

## A coherent interaction specification

The app should adopt these rules and enforce them across all features:

| Gesture | Universal meaning |
|---|---|
| Single click | Select or activate the object |
| Ctrl/Shift-click | Extend or range-select where multiple selection is valid |
| Double-click | Open the primary Properties editor for the clicked object |
| Right-click | Select the target, then open its contextual actions |
| Drag selected object | Move it; show destination/coordinates; commit one Undo step |
| Drag handle | Reorder or reparent; show the exact result before drop |
| Delete | Delete the selected editable object, with Undo |
| Enter | Edit/confirm the selected object |
| Escape | Cancel the gesture/dialog/tool and restore the prior state |
| Ctrl+Z / Ctrl+Shift+Z | Undo/redo the last committed data, visual, or organization edit |

Every action must also have a non-mouse path through Properties, a menu, or Command Palette.

## Recommended implementation sequence

### Phase A — Make interaction safe and legible

- [ ] Extend Undo/Redo to visual objects, plot specs, window layout, and folders.
- [ ] Add shared accessible tooltips and `aria-label`/pressed state to every icon button.
- [ ] Add an active-tool status strip with instructions and universal Esc cancel.
- [ ] Clamp, reset, and persist ToolWindow positions.
- [ ] Add drag handles and explicit drop-result feedback in Library and legend.

These are relatively contained changes with an outsized effect on daily confidence.

### Phase B — Build the common object-editing model

- [ ] Add a Plot Objects tree synchronized with canvas selection.
- [ ] Centralize contextual actions and reuse them in menus, Properties, mini toolbars, and Command Palette.
- [ ] Standardize double-click Properties behavior.
- [ ] Add multi-object alignment, distribution, grouping, ordering, and shared styles.
- [ ] Add keyboard-complete context menus and object manipulation.

### Phase C — Make graph construction durable

- [ ] Persist named Graph Builder PlotSpecs in `.dwk`.
- [ ] Unify Stage, Graph Builder, Figure Builder, and export around the same spec.
- [ ] Finish statistical faceting and plot/layer organization.
- [ ] Add graph templates, Save As, duplication, and project-level reuse.
- [ ] Add export-preview parity tests.

### Phase D — Close scientific workflow traps

- [ ] Wire fitting to error columns and explicit weighting.
- [ ] Make baseline and pipeline fitting honor selected X/Y channels.
- [ ] Run the real-project Origin escape test.
- [ ] Implement only owner-confirmed advanced gaps that actually trigger an escape.

## “Great app” acceptance test

Quantized should be considered ready to replace Origin only after this exercise succeeds:

- [ ] Start from a clean installation with no developer tools open.
- [ ] Import a representative month of experimental files by drag/drop.
- [ ] Organize them into a project tree.
- [ ] Clean, filter, mask, fit, and compare data without writing code.
- [ ] Build a multi-panel publication figure with error bars, fitted curves, annotations, and precise formatting.
- [ ] Save, close, reopen, alter, undo, and re-export it without losing intent.
- [ ] Complete the workflow using only visible UI cues and Help—not remembered implementation knowledge.
- [ ] Keep a friction log. Any moment that requires guessing a glyph, recalling a hidden gesture, repeating an accidental action, or reopening Origin becomes a concrete issue.

The product goal should not be “Origin has more features.” It should be:

> **For the owner's real experimental workflow, Quantized is faster to understand, safer to modify, easier to reproduce, and more pleasant to use than Origin.**

That is achievable. The foundation is already much stronger than the remaining interaction polish makes it appear.

## Completed log

Append one row whenever a checkbox is changed to `[x]`. A PR or commit alone is not sufficient evidence; record the user-facing test, automated test, or acceptance exercise that verified completion.

| Completed | Item | PR / commit | Verification evidence | Verified by |
|---|---|---|---|---|
| — | _No items completed under this plan yet._ | — | — | — |

When the first item is completed, replace the placeholder row. Recommended entry format:

```markdown
| 2026-07-15 | Visual, organizational, and window-layout edits participate in coherent Undo/Redo. | PR #123 / `abc1234` | Playwright interaction journey plus manual restore check | Name |
```
