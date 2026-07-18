# GUI Interaction & Origin-Parity UX Plan

The interaction/UX campaign that turns quantized's broad-but-scattered gesture
set into one coherent, discoverable, reversible workbench — the work most likely
to keep the owner in quantized instead of reopening OriginPro. Backend analysis
parity is essentially done; the remaining risk is **"the capability exists, but
the user can't discover it, can't predict which gesture applies, or can't safely
undo the result."** Also folds in the scientific-selection correctness traps
(fits/baselines silently using the wrong column or ignoring error bars), which
for a publication tool outrank any discoverability gap.

**Status:** Active
**Created:** 2026-07-12
**Updated:** 2026-07-17
**Parent:** MAIN_PLAN.md
**Origin:** ChatGPT-"Sol" GUI interaction audit, 2026-07-12 (raw audit preserved
at `plans/SOL_FEATURE_GUI_INTERACTION_AUDIT.md` — reference only; THIS file is the
live tracker, update here, not there).

---

## Context

### How the pieces fit together
The interaction surface spans several subsystems that today each own their own
editing grammar:
- **Plot canvas** (`components/Stage/`, `lib/uplot*`) — pointer/zoom/pan/cursor
  tools, annotations, shapes, reference lines, baseline anchors, axis-label drag +
  Format, legend drag; many competing pointer plugins on one DOM node.
- **Inspector / context menus** (`PlotContextMenu`, `ContextMenu`, Inspector
  cards) — series/axis/annotation/shape/dataset/worksheet actions.
- **Library** (`components/Library/`) — folders, smart folders, tags, figures,
  reports, book families; dense drag/drop with 3-zone folder drops.
- **Workshops** (`components/workshops/*`, floating `ToolWindow`s) — the no-code
  analysis UIs (curve fit, peaks, baseline, filter, pipeline…).
- **Graph/Figure Builder** — plot construction; builder output is a durable
  saved `PlotSpec` since 2026-07-17 (#11 core; Figure-Builder handoff still open).
- **History** (`store/history.ts`) — undo/redo, today scoped to DATA mutations
  only; visual/layout/organization edits are excluded by design.

### The central thesis
quantized has the individual gestures Origin has, but not one **object-editing
language**. An expert can be productive; the owner after weeks away, or a new
user, must remember too much. The return-on-effort is making existing
capability **visible, predictable, and reversible** — not adding algorithms.

### Default-tool readiness (condensed from the audit; risk labels as of the
2026-07-12 audit — the 2026-07-17 campaign has since addressed much of this)
Highest return-to-Origin risk THEN: **direct graph editing** (capable but
hidden — #3/#7/#8/#9 shipped since), **undo/recovery** (strong for data, weak
for visual/organizational — still true, gated on #1), **buttons & tooltips**
(dense, icon-only — #7 shipped since), **reusable graph construction**
(was ephemeral — #11 core shipped saved PlotSpecs). Lower risk: core 2-D
plotting, publication export.

### Dependency map / sequencing notes
- **Correctness traps first.** #5 (baseline channel) and #6 (pipeline channel)
  produce silently-wrong published results — worse than any UX gap. #4 (weighted
  fitting) already shipped.
- **#1 (undo) underpins #2/#3** — direct manipulation only feels safe when
  reversible; build the undo scopes before widening drag/edit surfaces.
- **#8 (context-action registry) feeds #2 (Plot Objects tree)** — one action
  definition reused across right-click / tree / palette / mini-toolbar.
- **#12 (canonical plot spec) touches everything** — Graph Builder (#11), export,
  Figure Builder; do it deliberately and do NOT dissolve the intentional
  fast-canvas (uPlot) vs. vector-export (matplotlib) split — unify the SPEC, keep
  the renderers.
- The **friction-log acceptance test** (Reference) is the empirical re-prioritizer
  — run it once against a real month of projects and let it reorder the middle.

---

## Tier 1 — High Impact

1. **Undoable mouse-driven visual edits** — every committed visual/layout/
   organization edit becomes one named, coalesced history transaction.
   - [ ] Decide the undo **scopes** first (Origin uses scoped undo; a single flat
         stack mixing "undo my fit" with "undo my axis colour" is confusing) —
         this is an owner gate, see Owner gates.
   - [ ] Coalesce a drag into ONE step (`Move annotation`, not 80 pointer moves).
   - [ ] Cover: axis-title drag/format, annotation/shape move/resize/delete, curve
         colour/marker/width/order/visibility/Y-axis, ref-line move, window
         move/resize/close/rebind, folder/dataset reparent, graph-spec changes.
   - [ ] Show the action name in Edit▸Undo + a brief toast; keep navigation-only
         zoom/pan as a SEPARATE Back/Forward view history (resolve the "one Ctrl+Z
         restores exactly the previous state" vs. separate-view-history tension).

2. **Unified "select object → edit it" model (Plot Objects tree)** — one
   synchronized tree (Inspector mode) exposing curves/axes/layers/legends/
   annotations/shapes.
   - [ ] Two-way selection sync (click canvas ↔ tree row highlights).
   - [ ] Row actions: visibility, reorder, delete, duplicate, Properties — map
         these onto the channel model (a "curve" = a dataset channel; settle what
         "duplicate"/"delete" mean per object type before building).
   - [ ] Multi-select: align, distribute, group, shared styling for graphic objects.
   - [ ] Large bet — size it deliberately; reuses #8's action registry.

5. **Baseline analysis honors the plotted X/Y channels** — the baseline workshop
   still computes on `time`/`values[0]` and subtracts into `values[0]`, diverging
   from the displayed channels. (Correctness trap.)
   - [ ] Bind baseline to the plotted X + selected primary Y, show those names in
         the workshop, store them in provenance, subtract into that same channel.
   - [ ] OWNER GATE: the OriginPro audit frames baseline as a BACKEND corrections/
         recalc-DAG change (`bgAnchors`/`applyCorrections`), not a frontend read —
         scope which before starting (see Owner gates).

## Tier 2 — Medium Impact

8. **Context menus as a complete system** — one **context-action registry** keyed
   by selected object type, reused in right-click menus, the Plot Objects tree
   (#2), Command Palette, and an optional mini-toolbar.
   - [x] Keyboard-complete menus: `role="menu"`/`menuitem`/`menuitemcheckbox`,
         arrow-key nav, type-ahead, Home/End, Esc-returns-focus.
   - [x] A resting cue that right-click is available; shared confirm/undo policy for
         destructive/reorganizing actions.
   - [ ] Residual (2026-07-17): the registry (`lib/contextActions.ts`, keyed
         `dataset`/`folder`/`curve`) landed with its 3 MANDATORY retrofits —
         the Library dataset-row menu, the folder-row menu, and the plot
         curve/series menu all now BUILD from shared `ContextAction<T>`
         entries instead of hand-rolled arrays, so a label/gate is defined
         once. `ContextMenu.tsx` is keyboard-complete (arrow-nav math split
         into pure `lib/menuKeyboardNav.ts` to hold the .tsx ceiling); rows
         gained `tabIndex` + the ContextMenu-key/Shift+F10 handler and a
         "⋯" resting-cue button (hidden until hover/focus, coexisting with
         #13's drag handle); `destructive: true` entries (Remove/Remove-N-
         selected, Delete folder[+datasets]) now confirm via the shared
         `askConfirm` before running. Superseded `lib/panelMenu.ts`'s
         `multiSelectMenuItems` (folded into the registry) — deleted rather
         than left as unused duplicate logic. NOT done: Command Palette /
         Plot Objects tree (#2, owner-gated) / mini-toolbar reuse of the
         SAME entries (the registry's `run(target)` shape supports it, but
         no consumer wired yet); the worksheet column/row, window, and
         annotation/shape menus are untouched (still hand-built) — retrofit
         on next touch, not urgent since they're lower-traffic than the 3
         done. Axis/plot-level pickers in `plotMenu.ts` (colour swatches,
         line/width/marker/scale submenus) deliberately stayed hand-built —
         parameterized pickers, not discrete actions, don't fit the
         registry's `{id,label,run}` shape. Frontend 265 files / 3647 tests
         green (net: +1 file vs. pre-#8 after `panelMenu.ts`'s deletion);
         build green.

11. **Graph Builder → durable artifact** — promote its output to a first-class
    saved `PlotSpec` in `.dwk`.
    - [x] Save / Save As / Duplicate / Rename / Delete, from a new PlotSpecBar
          toolbar in the Graph Builder panel.
    - [x] `.dwk` persistence (`savedPlotSpecs`, additive-optional).
    - [x] The builder surfaces which saved spec it's bound to + an
          unsaved-changes dot (scoped to the builder header, not the Stage
          canvas — see the 2026-07-17 progress note below).
    - [x] Export (scoped to the xy family — see the progress note).
    - [x] Open ordinary single-dataset XY line/scatter specs in Figure Builder
          (PR #62). The bridge preserves explicit X/Y display order and
          per-series publication styles; scatter remains point-only. Grouped,
          faceted, statistical, incomplete, and cross-dataset specs fail closed
          until their target contracts exist.
    - [ ] Finish faceting for statistical marks.
    - [ ] Allow plot/layer reordering.

    _Progress (2026-07-17):_ core landed — a `savedPlotSpecs` collection
    (`store/graphBuilder.ts`, a new slice; also absorbed the pre-existing
    `graphBuilderOpen`/`graphBuilderSeed` handshake relocated from
    `useApp.ts` verbatim) with id/name/created/modified + the `PlotSpec`
    payload (`lib/plotspec.ts`'s existing grammar — serialization was
    already there from #51, this only added `SavedPlotSpec` +
    `sanitizeSavedPlotSpecs` + `plotSpecsEqual`). Round-trips through `.dwk`
    v3 as an additive-optional field (legacy files load unchanged).
    `PlotSpecBar.tsx` (new sub-component) shows the active spec's name + a
    dirty dot (structural compare vs. the saved payload) and a collapsible
    "Saved graphs" list with per-row Open/Duplicate/Rename/Delete; Save/Save
    As prompt via the existing `askParams`/`askConfirm` dialogs. Export
    calls `sendToStage()` then reuses the ordinary "Export figure…" File
    command for the xy family (scatter/line) — box/violin/bar render via
    the Stat Stage's OWN hook-local exporter (`useStatStage.exportFigure`,
    which needs live UI state — bin rule, fit distribution — that only
    exists once that view is mounted), so Export hands off with a toast
    there instead of building a second export pipeline; a faceted spec's
    export also inherits the existing gap that `facetByColumn` resets the
    live xKey/yKeys (baked into panels instead), so it falls back to the
    plot's default channel selection — both are the residuals this item's
    open boxes already track. `useApp.ts` stayed within its ratchet pin
    (3239/3240 at the start of this work → **3229/3240** after) by
    relocating the Graph Builder's pre-existing open/seed state into the
    new slice alongside the new savedPlotSpecs fields — a net reduction
    that funds the slice's own wiring cost. Frontend 3637 tests green
    (+70 new), build green.

12. **One canonical plot specification** across Stage / Graph Builder / Figure
    Builder / export — all edit or render the same underlying object.
    - [ ] Keep Stage=fast renderer, Figure Builder=page editor, export=vector
          renderer, but over ONE spec; add export-preview + parity tests (axis
          limits, labels, fonts, colours, widths, markers, annotations, error bars,
          legends, facets, panel geometry). Do NOT dissolve the canvas/vector split.

15. **Real-browser interaction coverage** — jsdom can't validate canvas hit
    targets, pointer capture, drag/drop, high-DPI, overlapping-plugin contention.
    - [x] Playwright harness (`frontend/e2e/`) — own `playwright.config.ts`,
          separate `npm run e2e` script (never runs inside `npm test`/vitest),
          synthetic CSV fixtures only (never `../test-data`), 100/125/200%
          zoom-matrix projects.
    - [x] File-drop import
    - [x] Folder create/nest/reorder + drag a dataset into one via its grip
          handle (3-zone drop)
    - [x] Right-click curve restyle (colour + marker)
    - [x] Axis title + limits edit
    - [x] Graph build/save/reopen (PlotSpecBar)
    - [x] Each analysis drag + Esc-cancel (region-tool arm/cancel + ToolHud)
    - [x] The same essential journey keyboard-only (Command Palette import,
          Shift+F10 context menu, Enter activates)
    - [ ] Folder reorder/nest **undo** — gated on the #1 undo-scopes owner
          decision; there is no visual-edit undo to test yet.
    - [ ] channel→X/Y/Y2 drag (the on-canvas `CHANNEL_DND` legend/axis-band
          drag, distinct from the Graph Builder's ZoneWell click-to-assign
          path already covered above)
    - [ ] annotation/shape move/edit/delete/undo
    - [ ] window arrange/restore
    - [ ] export round-trip
    - [x] CI workflow — `.github/workflows/e2e.yml` VERIFIED LIVE 2026-07-17:
          first push-run failed 4 menu tests (spec `role="button"` locators vs
          the #8 registry's explicit `role="menuitem"`; local runs had masked
          it via `reuseExistingServer` against a STALE server), fixed in
          `a2fb74a` — second live run green 18/18 (run 29610916988).

    _Progress (2026-07-17):_ core harness + 7 journeys shipped. Server under
    test: `uv run qz --no-browser --port 8934` (cwd = repo root), Playwright's
    `webServer.url` polls `/api/health`; `--no-browser` means
    `QZ_AUTO_SHUTDOWN` never arms, so the server survives the browser
    contexts' `/api/ws` presence-socket churn between tests. Prerequisite is
    `npm run build` (documented in `frontend/e2e/README.md`) — the backend
    serves the built SPA from `src/quantized/web/`, exactly the `qz` run
    model. State assertions read the `?harness` seam already used by
    `tools/visual` (`window.__qz.useApp.getState()`) for store fields a DOM
    query can't reach cleanly (series style, axis label/limits,
    `savedPlotSpecs`, folder tree). Zoom matrix: `chromium-100` runs all 8
    tests (7 spec files, `region-tool-escape.spec.ts` has 2); `chromium-125`/
    `chromium-200` run only the 4 `@core`-tagged specs (import-drop,
    folder-organize, curve-restyle, region-tool-escape) — the ones touching
    canvas hit-testing/pointer capture/native drag-drop, the actual gaps this
    plan item names; axis-limits/graph-builder/keyboard-only are plain DOM
    form/keyboard interactions, not DPI-sensitive, so they run at the 100%
    baseline only. 18 tests total (8+5+5), all green across 3 consecutive
    full-suite runs (54/54). Zero `frontend/src` changes — the `?harness` seam
    (`main.tsx`) already existed for `tools/visual`; no new testability seam
    was needed. Menu-dependent selectors (context-menu items, the
    concurrently-refactored `ContextMenu.tsx`/`PlotContextMenu.tsx`) are
    located by accessible name/text, never DOM structure, so they survive
    that refactor. `npm test` (3671 tests) and `npm run build` both still
    green.

## Tier 3 — Nice-to-Have

16. **Owner-dependent Origin feature gaps** — prioritize ONLY from real projects
    (the friction-log test), not Origin's checklist.
    - [ ] Candidates: worksheet stack/unstack/reshape/transpose/pivot/join-by-key;
          date/time axes + date-aware ops; broad signal processing; general 3-D
          surface/mesh/contour outside the RSM path; database/query connectors;
          `.opju` migration edges (matrix books, some 2-D instrument data, richer
          graphic-object/callout fidelity). (Several overlap MAIN owner gates /
          deferrals — reconcile, don't double-book.)

17. **Buttons / labels / menus / tooltips polish**
    - [ ] Text on high-consequence actions (Fit/Apply/Subtract/Export/Delete/Save/
          Send to Stage); standard dialog button order (secondary first, primary
          last, destructive separated); split buttons for last-used tool.
    - [ ] Regroup menus: Analyze by Fit/Peaks-Baseline/Magnetometry/XRD-Reflectivity/
          Transform-Signal/Statistics/Workflow; Graph owns builders/plot-types/
          layers/themes/templates/export; Data owns worksheet/row-col/filter/
          reshape/merge/correction/metadata; fill out Help (searchable tool help,
          mouse interactions, import guides, Origin migration, `What is this?` mode).
    - [ ] Show shortcuts in menus; Command Palette labels match menu labels exactly;
          optional first-run "show interaction hints" mode.

---

## Owner gates (decide before the gated item starts)

- **Undo scopes (#1)** — one unified stack vs. scoped undo (visual / data /
  organization) + a separate view-history for zoom/pan. Origin uses scoped;
  pick the model before building.
- **Baseline: frontend bind vs. backend DAG (#5)** — cross-audit contradiction.
  This plan says "bind to plotted X/Y"; the OriginPro audit says baseline is
  entangled with the corrections/recalc DAG. Resolve the scope first.
- **Plot Objects tree scope (#2)** — full Origin-style Object Manager is a large
  bet; confirm it's wanted vs. better-signposted existing gestures + undo.
- **Shared AnalysisSelection contract** — the OriginPro audit wants ONE selection
  contract across fitting/peaks/baseline/magnetometry; #4 shipped a small shared
  `lib/fitweights` helper as the seed. Decide when to generalize it into the full
  contract (before #5/#6 vs. after).

---

## Completed

- ~~**#3 Make powerful gestures discoverable**~~ (2026-07-17) — closed as a
  gap-audit-and-fill: sibling work landed earlier the SAME day already
  delivered most of it — #13 (grip-dot drag handles + hover "⋯" menu cue on
  dataset/folder rows) and #8 (keyboard-complete context menus + the
  `lib/contextActions.ts` registry) — this pass audited every OTHER drag
  surface and closed the remaining gaps against the item's 4 sub-boxes.
  (1) **Drag handles**: Library rows already had `.qzk-drag-handle`; legend
  rows + the Channels-card row (both channel→axis-band drags) got
  `cursor: grab` via a `[draggable="true"]` CSS selector (a dedicated handle
  doesn't fit a checkbox/legend-entry row — the existing hover tooltips
  cover the rest); the panel-cell/plot-window/tool-window title-bar drag
  surfaces got discoverability tooltips (PanelCell already had
  `cursor: grab`; MDI/ToolWindow title bars deliberately KEEP
  `cursor: default`, matching real OS title-bar convention — changing that
  would be the actual regression). (2) **Cursor + drop-target reveal**:
  audited every plot-canvas draggable object (annotations, shapes, ref
  lines, axis titles, the legend box) — all already show grab/move/resize
  cursors on hover, zero gap found there. Added a `store/libraryPanel.ts`
  `activeDrag` field (set on a dataset/folder row's `.qzk-drag-handle`
  dragstart, cleared on dragend) so EVERY eligible drop target gets a
  resting `.drop-candidate` dashed-outline tint the MOMENT a drag starts,
  not only the one the pointer happens to hover — wired into FolderRow (the
  named primary case) and PlotWindowFrame (the window-rebind case, same
  `DATASET_DND` gesture, second real drop-target family). `AxisDropZones`'
  pre-existing "reveal all 3 axis bands once the drag enters the stage" was
  left as-is — a partial but reasonable implementation of the same idea;
  making it fire on drag-START across every mounted plot window would be a
  materially bigger lift for a lower-traffic gesture, noted rather than
  silently skipped. (3) **3-zone drop label**: a small `.qzk-drop-label`
  floating near the pointer, positioned/updated on every `FolderRow`
  dragover, reading `Move inside X` / `Place before X` / `Place after X`.
  (4) **A menu path for every drag** (audit table): dataset→folder =
  pre-existing (folder-row menu's dynamic "Move to …" list); **folder
  reorder = ADDED** (`folderRowMenu.ts`'s new "Move to …" list, mirroring
  the dataset one, built from the newly-split `folderCoreActions`/
  `folderBulkActions`/`folderDeleteActions` groups); legend/curve reorder =
  pre-existing (PlotLegend's own arrows + hand-built menu) **+ ADDED** to
  the shared `curveActions` registry so the plot-canvas right-click curve
  menu offers "Move earlier/later" too, not just the legend's own menu;
  channel→X/Y/Y2 = pre-existing (Channels card checkboxes/Select/Y2 pill —
  reachable from the plot side, not just the worksheet); annotation/shape
  **nudge = ADDED** — precise X/Y (Shapes: x1/y1/x2/y2) edit fields on their
  Inspector-card rows, strictly more useful than a nudge and the first
  non-mouse path either object ever had; window **rebind = ADDED**
  (`WindowTitleButtons`'s new "⇄" button opens a dataset picker, guarded the
  same `kind !== snapshot/panel` way the drag gesture already is). All 4
  sub-boxes close — none left open. `store/useApp.ts` untouched (3229/3240,
  zero ratchet cost — the new `activeDrag` state and every new action live
  in existing slice files); `PlotWindowFrame.tsx` 398/400, `DatasetRow.tsx`
  395/400 (both inside their pins). Frontend 269 files / 3736 tests green
  (+2 files / +28 tests); build green.

- ~~**#13 Folder organization density**~~ (2026-07-17) — 5 of 6 sub-items
  shipped: a dedicated grip-dot drag handle (`.qzk-drag-handle`, the ONLY
  draggable element) on both dataset and folder rows, replacing whole-header
  dragging without touching the existing 3-zone drop-target logic; "Show in
  folder" (DatasetRow's context menu, gated on `folderId`) posts a
  `revealTarget` signal (new tiny `store/libraryPanel.ts` slice) that
  Library.tsx consumes to clear the filter, expand ancestor folders, select,
  and scroll into view — plus a "Folder › Subfolder" path caption on filtered/
  smart-folder rows and an Inspector breadcrumb for the active dataset
  (`lib/foldertree.folderPath`/`folderPathLabel`); a compact multi-select bar
  (`N selected · Plot · Move · Tag · Export · Clear`) wired entirely to
  existing bulk ops (`createPanelWindow`/`moveDatasetToFolder`/
  `addDatasetTag`/the new shared `folderOps.exportDatasets` core); folder
  Properties (name/notes/colour/default template) via `askParams` + a new
  `updateFolder` store action, with `notes`/`color`/`defaultTemplate` added
  as ADDITIVE-OPTIONAL `FolderNode` fields round-tripped through `.dwk`
  (`lib/workspace.ts`'s `parseFolders`) — colour reuses the SAME
  `ACCENT_SWATCHES` fixed-paint table now shared with the Preferences accent
  swatches (de-duplicated); default template pre-selects
  `runTemplateOnFolder`'s picker. Panel width persists via a new
  `libraryPanelWidth` pref (`store/prefs.ts`, applied to the `--lw` CSS
  custom property `shell.css` already declared but never wired) with a
  drag-resize handle (`useLibraryResize.ts`, mirrors
  `worksheet/useColResize.ts`); expand/collapse already lived in the
  workspace (`expandedFolders`, unchanged). Undo for folder moves/creates/
  renames/deletes is DEFERRED — it rides the owner-gated undo-scopes decision
  (#1), out of scope here. `store/useApp.ts` held to 3231/3240 (offset via
  the `store/libraryPanel.ts` slice + reusing the generic `setPref`, not new
  per-field setters); `DatasetRow.tsx` extraction (`datasetRowMenu.ts`) kept
  it at 367/400 despite the new handle/caption/reveal wiring. Frontend
  3463 green (+42 tests), build green.

- ~~**#9 Active-tool feedback + universal cancel**~~ (2026-07-17) — a floating
  `ToolHud.tsx` strip shows the armed non-Pointer tool's name + one-line
  gesture hint + "Esc cancels" (e.g. `∩ Peak / FWHM — drag a range to measure
  a peak's width · W · Esc cancels`), sourced from `plotToolbarDefs.ts`
  (extended with an optional `hint` override + a `region`-tool entry +
  `toolDefFor` lookup, one source of truth with the toolbar's own tooltips)
  and `plotToolKeys.ts`'s `keyForTool`. A new `lib/gestureCancel.ts` registry
  lets a drag (pan/measure/stats/integrate/FWHM/quick-fit ROI/gadget cursors —
  every custom-JS gesture in `uplotTools`/`uplotRegionTools`/`uplotGadgets`)
  register a canceller at mousedown and be aborted from OUTSIDE its own
  closure: Esc (the one centralized handler in `useGlobalShortcuts`) cancels
  a live gesture first (tool stays armed for an immediate retry), then an
  idle-armed qfit gadget (folded in from `useGadgetChip`'s old per-effect
  listener, which re-registered on every drag tick and could race the new
  gesture-cancel for the same keypress), and only then reverts the tool to
  Pointer — skipped while typing in a field or when the new "Persistent plot
  tool" preference (`store/prefs.ts`, own `qz.interactionPrefs` key, default
  off — `store/useApp.ts` has zero ratchet headroom) is set. Right-click
  (`useStageContextMenu.ts`, extracted from `PlotStage.tsx` to hold its
  line-ceiling pin while mounting the HUD) now always cancels any live
  gesture and opens the menu, replacing an `e.buttons & 1` guard that
  silently swallowed the click while the drag's listeners stayed live
  underneath. `ContextMenu.tsx` now `stopPropagation()`s on Escape so an open
  menu owns the key (matches the dialogs' capture+stopPropagation
  precedence) instead of also reaching the new tool-revert handler. Cursor
  audit found ONE real gap — the "select" tool (native uPlot rubber-band, no
  plugin to set one inline) had no crosshair; added to `shell.css`'s existing
  rule. uPlot's own native rubber-band (zoom box, select/region x-band) has
  no exposed "abort this drag" API — documented as a deliberate scope gap,
  not silently dropped. `PlotStage.tsx` 398/400 lines (was exactly at 400,
  net negative after the context-menu extraction); `store/useApp.ts`
  untouched (3238/3240). Frontend 263 files / 3568 tests green; build green.

- ~~**#7 Plot toolbar legibility**~~ (2026-07-17) — the shared `TooltipLayer`
  (already mounted app-wide) now renders a bold NAME + one-line BEHAVIOUR
  description + optional keyboard SHORTCUT, shows on keyboard focus (not just
  hover, via delegated focusin/focusout) and dismisses on Esc. Every
  `PlotToolbar` button carries `aria-label` + `aria-pressed` (toggle/tool-
  select buttons) sourced from a single `{tool: key}` table
  (`lib/plotToolKeys.ts`'s new `keyForTool`, the exact inverse of the existing
  `toolForKey`, so the tooltip can't drift from the real handler). Buttons
  regrouped into six named ARIA groups (Navigate/Inspect/Analyze/Annotate/
  View/Export, new `PlotToolbarGroup`) with a subtle uppercase caption
  toggleable from a new "..." flyout — persisted via `store/prefs.ts`'s
  `loadToolbarPrefs`/`saveToolbarPrefs` (own `qz.toolbarPrefs` key,
  deliberately NOT `store/useApp.ts`, which sits at its ratchet ceiling with
  zero headroom). No button moved behind a flyout — pointer/zoom/pan/
  autoscale stay one click away. Two buttons disable with a real reason:
  Reset View when `xLim`/`yLim` are both null (mirrors the "A" key's own
  no-op guard), and Copy Image when `clipboardImageSupported()` is false (the
  same condition `usePlotStageActions`' `snapshot()` already falls back on).
  Data lives in the new pure `lib/plotToolbarDefs.ts`; `PlotToolbar.tsx` stays
  at 255 lines, `PlotStage.tsx` (already at its exact 400-line ceiling) and
  `store/useApp.ts` (3239/3240) untouched. Frontend 258 files / 3534 tests
  green; build green.

- ~~**#14 Worksheet windows: scope selection state**~~ (2026-07-17) — an MDI
  worksheet document window's row selection now lives in its own entry in the
  new `store/worksheetSelection.ts` slice (`worksheetSelections`, keyed by
  window id), fully independent of every other worksheet window — including
  another document window on the SAME dataset (root cause: the legacy actions
  keyed off `activeId`, not the worksheet's own dataset, so a background
  window's clicks silently wrote into whatever was active). The Stage
  "Worksheet" tab keeps the legacy active-dataset `selection` singleton — the
  ONE deliberate link to the live plot's brush-select/highlight — now surfaced
  explicitly via a "⧟ Linked to plot" badge (`WorksheetToolbar`) instead of
  silently; a document window is NEVER linked. The column context menu's
  "Set as X axis"/"Plot as Y" now claim the focused plot for the worksheet's
  own dataset first (`claimForPlotIntent`, shared with "Plot selection") so
  they can no longer silently retarget an unrelated active plot, and read as
  gated-null (no stale checkmark) while unlinked. `windows.ts`'s `closeWindow`
  drops the closed window's selection entry (no leak); a document-window
  rebind leaves the old entry pointing at the old dataset, self-healing via
  the same "live only if datasetId matches" guard the legacy singleton always
  used. No new allowlist entries — `excludeSelectedRows`/`keepOnlySelectedRows`
  (the only actions touching `Dataset.excludedRows`) stayed in `useApp.ts`,
  widened with an optional `windowId`. "Active cell"/"range" don't exist as
  separate dimensions today — nothing to scope. Frontend 3457 green;
  `useApp.ts` 3236/3240, `windows.ts` 750/750 (both at their ratchet pins).

- ~~**#10 Floating workshops recoverable**~~ (2026-07-17) — `ToolWindow`
  (`components/overlays/ToolWindow.tsx`) now clamps the ENTIRE title bar
  (not just the top-left corner) inside the viewport, both on drag end and
  on every `window resize` (the monitor-unplug loss scenario); a View-menu
  `Reset window positions` command (`commands/uiCommands.ts`) restores every
  ToolWindow to its default layout in one shot. Geometry (position/size/
  collapsed) moved out of local `useState` into a new `store/toolwindows.ts`
  slice keyed by each window's `id` prop (threaded through all 24 consumers
  + `ResultsWindow`), so a window survives close/reopen and round-trips
  through the `.dwk` workspace (`lib/workspace.ts`'s `toolWindowLayout`
  field, additive-optional — legacy files load unchanged — and
  viewport-clamped on load). Added collapse (double-click the title bar or
  its chevron button) and corner-drag resize (`.qzk-win-resize`), both
  persisted alongside position. Docking into the right panel deferred per
  the plan. Frontend 3483 tests green; `store/useApp.ts` 3231/3240.

- ~~**#6 Pipeline fit execution reproduces the interactive fit**~~ (2026-07-16,
  Opus worktree agent, merged `7d49fd9`) — recorded "fit" steps now carry the
  typed recipe via `lib/fitselection.fitStepParams`/`fitSpecFromStepParams`
  (model + xKey/yKey + non-`none` weight; the result snapshot is never encoded
  — a step is a recipe, not a result), and `executeSteps` replays it through
  the SAME `fitDataForSpec` path the recalc graph uses: target's analysis rows
  (exclusion∪filter) honored, unresolvable weight column fits unweighted with
  the `dyForFit` issue surfaced in the step log note (folder batches see it).
  Legacy `{model}`-only template steps deliberately keep the old
  `time`/`values[0]` unweighted behavior so saved templates' outputs never
  silently change (regression-pinned). Scope check: the interactive registry
  fit sends only model/x/y/dy — no ROI (quickfit ROI is preview-only by
  documented decision) and no bounds to thread; custom-equation fits remain
  the separately-booked follow-up. Frontend 3357 green; useApp.ts held at
  3311/3312.

- ~~**#4 Weighted fitting by plotted error columns**~~ (2026-07-12, PR #24
  `dbb0c5c`) — Curve Fit workshop weighting selector (none / Y-error column /
  Poisson / manual); `dy` is the single canonical error→weight convention across
  `/fit`+`/equation/fit`+`/scan` (`weights_from_dy`), recorded in
  `FitSpec.weight` provenance and reproduced by the recalc graph via
  `fitDataForSpec`; shared `lib/fitweights.dyForFit` builds `dy` over the #50/#53
  analysis rows. Registry-model path; custom-equation + pipeline + X-error (ODR)
  are booked follow-ups (#6 covers pipeline). Backend 262 + frontend 3294 green.

---

## Reference

### Universal interaction spec (adopt + enforce across all features)
| Gesture | Universal meaning |
|---|---|
| Single click | Select / activate the object |
| Ctrl/Shift-click | Extend / range-select where valid |
| Double-click | Open the object's primary Properties editor |
| Right-click | Select the target, then open its contextual actions |
| Drag selected object | Move it; show destination/coords; one Undo step |
| Drag handle | Reorder / reparent; show the exact result before drop |
| Delete | Delete the selected editable object, with Undo |
| Enter | Edit / confirm the selected object |
| Escape | Cancel the gesture/dialog/tool, restore prior state |
| Ctrl+Z / Ctrl+Shift+Z | Undo/redo the last committed data/visual/org edit |

Every action must also have a non-mouse path (Properties, menu, or Command
Palette). NOTE the double-click conflict: today double-click-empty = autoscale
(uPlot-native) and double-click-text = edit; reconcile with "double-click =
Properties" before adopting the table literally.

### "Great app" acceptance test (the empirical re-prioritizer)
From a clean install, no dev tools: import a real month of files by drag/drop →
organize into a project tree → clean/filter/mask/fit/compare with no code →
build a multi-panel publication figure (error bars, fitted curves, annotations,
precise formatting) → save/close/reopen/alter/undo/re-export without losing
intent → complete it using only visible UI + Help. Keep a **friction log**: every
guessed glyph, recalled hidden gesture, repeated accidental action, or
Origin-reopen becomes a concrete issue that re-ranks this plan.
