# Multi-Plot Windows — MDI Graph Windows in the Stage

Give the Boson Plotter OriginPro-style multiple graph windows: moveable,
resizable, focusable plot windows floating inside the stage (plot) area, so
the user can view and compare several plots at once instead of one Stage
plot at a time. The core architectural move is separating "a plot's view
state" (today ~40 singleton fields in `store/useApp.ts`) from "the plot"
(today the single `PlotStage.tsx` uPlot instance) via a focused-window
facade, so the existing Inspector / tools / shortcuts / workshops keep
working unchanged while extra windows render alongside.

**Status:** Active
**Created:** 2026-07-09
**Updated:** 2026-07-09

---

## Context

### How the pieces fit together

- `frontend/src/components/Stage/Stage.tsx` — tab strip (Plot · Map ·
  Worksheet); the Plot tab renders `PlotStage`. This cell becomes the
  window canvas host.
- `frontend/src/components/Stage/PlotStage.tsx` (490 lines, ratchet-pinned
  at 491) — the singleton hero plot: subscribes to ~40 view fields from
  `store/useApp.ts`, fetches a `PlotPayload` (`lib/plotdata.ts`, offline
  fallback), folds overlays + exclusion masks via `composeDisplayPayload`
  and `lib/rowstate.droppedRows`, and owns one uPlot instance + one
  ResizeObserver. Alternate modes (`PolarStage`, `StatStage`,
  `MultiPanelStage`) return early before the plain XY path.
- `frontend/src/store/useApp.ts` — ALL plot view state is singleton:
  `xKey`/`yKeys`/`y2Keys`/`y2Lim`/`y2Log`, log flags, `xLim`/`yLim`,
  tick formats, title/axis labels, `seriesStyles`/`seriesLabels`/
  `errKeys`/`seriesOrder`/`hiddenChannels`, `waterfall`, `refLines`,
  `annotations`, legend/grid/template/axis-box, and the mode flags
  (`stackMode`/`insetMode`/`polarMode`/`statMode`). `addDataset` and
  `setActive` reset this block; `useActiveDataset()` is the one plotted
  dataset. Tool/gadget/overlay state (`plotTool`, `qfit*`, `gadget*`,
  `fitOverlay`/`peakOverlay`/`baselineOverlay`/`derivOverlay`) is also
  singleton and written by the workshops.
- `frontend/src/components/overlays/ToolWindow.tsx` — the existing 70-line
  draggable floating window used by ~24 workshop panels. Deliberately
  store-decoupled: local position, module-level z counter, fixed width, no
  resize / minimize / persistence.
- `frontend/src/components/Inspector/*` — edits "the" plot by writing the
  same singleton fields (e.g. `AxisLimits`, `TitlesCard`,
  `SeriesStyleCard`).
- `frontend/src/lib/rowstate.ts` + `frontend/src/architecture.test.ts` —
  the #50 row-state chokepoint: every view reads rows via
  `rowstate.analysisData` / `droppedRows`, never `Dataset.excludedRows` /
  `filter` directly; plus the 400-line `.tsx` ceiling with three
  grandfathered pins (`App.tsx` 954, `PlotStage.tsx` 491,
  `ThinFilmTab.tsx` 442).
- `frontend/src/lib/workspace.ts` — `.dwk` v3 save/load. Plot view state
  is NOT persisted today (it resets on load) — window persistence is the
  first time it will be.
- `frontend/src/lib/figuredoc.ts` — `FigureDoc` already models "plot
  config as a value" (dataset ref by id + `FigureConfig` + live/frozen
  data), the closest existing shape to a per-window view record.
- `frontend/src/components/Stage/MultiPanelStage.tsx` +
  `useMultiPanelStage.ts` — existing precedent for N simultaneous uPlot
  instances (x-sync via uPlot sync groups) and for the hook + thin-view
  decomposition pattern.
- `tools/visual/` — the headless-Chrome harness screenshots the real uPlot
  canvas via the `?harness` store seam in `frontend/src/main.tsx`; jsdom
  cannot verify canvas output, so this is the only automated pixel check.

### Data / control flow

Current (singleton):

```
Library click → setActive (resets singleton view block) → useActiveDataset
  → PlotStage: fetchPlot → PlotPayload → composeDisplayPayload(+droppedRows)
  → one uPlot instance
Inspector / menus / shortcuts / workshops → the same singleton fields
```

Target (focused-window facade):

```
                ┌ plotWindows[]: {id, kind:"plot", title, datasetId,
store/useApp ───┤   geometry{x,y,w,h}, z, winState, view: PlotView}
                ├ focusedWindowId
                └ singleton view fields ≡ the FOCUSED window's LIVE view
focus switch = snapshotView(singletons) → old record;
               hydrateView(new record)  → singletons   (one chokepoint)

Stage Plot tab → WindowCanvas → N × PlotWindowFrame
  focused frame    → PlotStage core (full tools/plugins, fed from singletons)
  background frame → PlotViewport (LIVE data through rowstate, view from its
                     PlotView snapshot, no tool plugins; pointerdown focuses)
.dwk v3 + autosave ⇄ plotWindows[]/focusedWindowId (additive-optional;
                     legacy docs → one maximized window)
```

Key decisions (cross-cutting, kept out of the tiers):

1. **Focused-window facade, not a keyed-collection rewrite.** The ~40
   singleton view fields stay in `useApp` and are redefined as "the
   focused window's live view"; each window record stores a `PlotView`
   snapshot, swapped in/out only by the focus-switch action through two
   pure helpers in a new `lib/plotview.ts`. Alternative considered:
   migrating every field into `windows: Record<id, PlotView>` and
   rewriting all ~40 setters plus every consumer (Inspector cards, MenuBar,
   shortcuts, macro recorder, all workshops) in one pass — rejected as a
   big-bang with no working intermediate state. The facade means Inspector,
   keyboard shortcuts, plot tools, and workshops target the focused window
   with zero changes, which is exactly OriginPro's "active graph window"
   model the user already knows.
2. **One fully-interactive plot at a time.** Only the focused window mounts
   the tool plugins (wheel-zoom, gadgets, region tools, peak-marker
   editing) and overlays. Background windows render live data with their
   snapshot view but no tool plugins; any pointerdown focuses them first
   (interaction then lands on a live window). Matches OriginPro and keeps
   the per-instance cost of N windows low.
3. **New `components/windows/` subtree; `ToolWindow` is not extended.**
   Plot windows need controlled geometry (store-owned, persisted), resize,
   z-stack, focus highlight — bolting that onto the deliberately
   store-decoupled 24-consumer `ToolWindow` would churn every workshop.
   `PlotWindowFrame` shares the `qzk-win*` CSS family (extended in
   `shell.css` with a resize grip + focused-title variant, design tokens
   only — `--accent` for the focused title, no hardcoded colours) but is a
   separate controlled component. Workshop `ToolWindow`s keep floating
   above the whole app; plot windows z-stack among themselves inside the
   stage cell (its own stacking context), below workshop overlays.
4. **Windows bind a dataset by id; the focused window follows the
   Library.** `setActive` keeps today's semantics but scoped to the focused
   window (rebind + view reset); unfocused windows keep their pinned
   dataset. Removing a dataset nulls the binding (window shows an empty
   "dataset removed" state — the `FigureDoc`/`originFigures` precedent),
   never force-closes.
5. **Row-state chokepoint is satisfied by construction.** Row exclusion /
   filter live on the `Dataset` in the flat `datasets[]`, not in view
   state; every window's render path reuses the existing
   `droppedRows`/`composeDisplayPayload` pipeline, so N windows on the
   same dataset all reflect exclusions simultaneously. No
   `architecture.test.ts` allowlist change is expected — new files import
   from `lib/rowstate`, never the raw fields.
6. **Default = one maximized window, pixel-identical to today.** Every
   workspace has ≥1 window; a single maximized window renders exactly the
   current full-bleed Stage (no chrome). MDI chrome appears at ≥2 windows
   or on explicit restore-down. This is the migration guarantee: the
   existing visual-harness shots must not change in the default state.
7. **Scope v1: XY plot windows only.** Window records carry a
   `kind: "plot"` discriminator so worksheet/map/figure window types can
   be added later without a model change. The confirmed long-term
   direction is full Origin-style MDI (item 17), but Map and Worksheet
   stay stage tabs until then, and the alternate render modes
   (polar/stat/stack/inset) work only in the focused window in v1 (they
   read the singleton store directly today). EM-style tooling remains out
   of scope entirely.
8. **Persistence is additive-optional on `.dwk` v3** (the `smartFolders`
   precedent — no version bump): `plotWindows` + `focusedWindowId`, with a
   `sanitizePlotWindows` boundary validator clamping dataset refs and
   geometry. Legacy docs load as one maximized window bound to `activeId`.

### Dependency map

- Items 1 and 2 are independent of each other (parallelizable); item 3
  requires 2; item 4 requires 1 + 2 + 3; item 5 requires 2 + 3.
  **Tier 1 (items 1–5) alone is the usable v1**: ≥2 simultaneous movable,
  resizable, focusable plot windows fed by the existing plot pipeline.
- Item 6 requires 3; item 7 requires 2 + 4; item 8 requires 3; item 9
  requires 4; item 10 requires 3.
- Item 11 requires 1 + 3; item 12 requires 3; item 13 requires 3 + 4
  (reuses `MultiPanelStage`'s uPlot sync-group idiom); item 14 requires
  3 + 4; item 15 requires 1 + 4 and touches everything — do last; item 16
  requires 7; item 17 requires 15 (the long-horizon endgame — schedule
  after everything else).
- **PROJECT_ORGANIZATION_PLAN #10 interplay:** item 1 here WAS the
  `PlotStage.tsx` sub-task of org #10 — closed there as a side-effect
  completion (2026-07-09), and its 491 pin is REMOVED (not just lowered;
  312 ≤ 400, `architecture.test.ts`'s generic ceiling). The `App.tsx`
  sub-task of org #10 neither blocks nor is blocked by this plan, but item 5
  must wire the Window commands through the command registry / extracted
  hooks, never inline in `App.tsx` — its 954 pin cannot rise.

### Risks & open questions

Risks:

- **Facade double-truth.** The focused window's record is stale while
  focused (the singletons are live). Mitigation: only the focus-switch,
  window-close, and `.dwk`-save paths read window records for the focused
  id, and all three snapshot first through the single
  `snapshotView`/`hydrateView` chokepoint in `lib/plotview.ts` (unit-tested
  round-trip: snapshot → hydrate is identity).
- **uPlot lifecycle in hidden/occluded windows.** N windows = N instances +
  N ResizeObservers; drag-resize fires `setSize` storms (throttle to
  animation frames); minimized windows must unmount their uPlot entirely
  (item 8); switching `stageTab` away unmounts the whole canvas (as
  PlotStage unmounts today). `MultiPanelStage` shows ~6–10 instances are
  fine; cap expectations around that, don't engineer for 50.
- **`setActive` retarget UX.** Clicking the Library while comparing windows
  rebinds the focused window (view reset included) — the current
  single-plot muscle memory, but potentially surprising mid-comparison.
  v1 ships the focused-follows model; a per-window pin toggle is item 14's
  natural companion if it grates.
- **jsdom blindness.** Unit tests can assert window-manager state and DOM
  structure but not canvas output; the visual harness is the real check —
  default-state pixel identity is the migration acceptance gate, and item
  16 extends specs to MDI layouts.
- **Macro recorder / pipeline replay** records store actions that are now
  focused-window-scoped; replay semantics stay "act on the focused window"
  (documented), matching MATLAB/Origin behaviour — revisit only if
  window-addressed macros are ever requested.

Owner decisions (resolved 2026-07-09):

- **Focused window follows Library clicks** (Origin-like). Unfocused
  windows keep their pinned dataset; the per-window pin toggle (item 14)
  is the opt-out if it grates mid-comparison.
- **Full Origin-style MDI is the long-term direction** — worksheets and
  2-D maps eventually become window kinds (item 17). v1 stays XY plot
  windows only; the `kind` discriminator carries the door open.
- **Persist window layout + plot view in `.dwk`** — item 7 confirmed
  (the first persistence of plot view state at all).
- **Cross-window linking is opt-in link groups** (item 13 as designed) —
  no automatic same-dataset coupling.

---

## Tier 1 — High Impact

**All 5 items shipped 2026-07-09 — Tier 1 is complete** (≥2 simultaneous
movable, resizable, focusable plot windows, fed by the existing plot
pipeline, are in the app today). See `## Completed` below for items 3–5
(1–2 landed earlier the same day).

## Tier 2 — Medium Impact

**All 5 items shipped 2026-07-09 — Tier 2 is complete** (Tile/Cascade/
z-order-aware cycling, `.dwk`+autosave persistence, minimize/maximize +
window strip, Origin-figure/figure-doc "open in new window", and title/
rename/badge chrome are all in the app today). See `## Completed` below for
items 6–10.

## Tier 3 — Nice-to-Have

11. **Snapshot-as-window** — (M) freeze the focused window's current
    display payload into a static compare window (the ⎘ tool's natural
    upgrade; `FigureDoc` frozen-data precedent).

12. **Edge / grid snapping** — (S) snap frames to canvas edges and
    sibling window edges while dragging.

13. **Cross-window crosshair + x-range linking** — (M) opt-in link groups
    using uPlot sync groups (the `MultiPanelStage` idiom) so cursors/zoom
    track across windows showing comparable x-axes.

14. **Drag-and-drop dataset onto a window** — (M) drop a Library row onto
    a frame to rebind it (onto empty canvas = new window); companion
    per-window pin toggle to opt out of Library-follows behaviour.

15. **Alternate render modes in background windows** — (L) make
    polar/stat/stack/map render from a `PlotView` instead of store
    singletons so any window can hold any mode; touches `PolarStage`,
    `StatStage`, `MultiPanelStage`, `MapStage` — do last.

16. **Visual-harness multi-window specs** — (S) `tools/visual` spec gains
    a `windows[]` shape so MDI layouts (tile, overlap, focus highlight)
    get screenshot coverage.

17. **Worksheet / map window kinds (full MDI)** — (L) promote the Map and
    Worksheet stage tabs to window kinds so any document type can float
    in the canvas (the confirmed long-term direction); builds on item
    15's view-driven render modes — the endgame, schedule last.
    - Cross-reference (plan hygiene, no duplicate booking): the worksheet
      half of this item's mountability precondition is ALREADY satisfied —
      `WORKSHEET_PLAN.md` item 11 (closed 2026-07-09) audited
      `components/Stage/worksheet/` and confirmed `WorksheetPane(datasetId)`
      has zero `useActiveDataset`/`s.activeId` reads in the subtree (only the
      outer `Worksheet.tsx` wrapper, outside the subtree, supplies
      `datasetId` from `activeId` today). The pre-existing `xKey`/`yKeys`/
      `selection` singleton reads are a deliberate exception, unaffected by
      that audit — making THOSE window-scoped is still this plan's item 15's
      job. The actual window-kind promotion (this item) is still unbuilt.

## Completed

- ~~**1. Extract the plot render core from `PlotStage`**~~ (2026-07-09) — split
  the 441-line singleton `PlotStage.tsx` into `components/Stage/
  usePlotPayload.ts` (the fetch → `categoricalXPayload` → `composeDisplayPayload`
  pipeline plus the per-channel style/label/error/hidden mappings, parameterized
  over explicit params — no store reads) and `components/Stage/PlotViewport.tsx`
  (the uPlot create/resize/destroy effect + its `ResizeObserver`, driven
  entirely by props — `displayPayload`, a controlled `plotRef`, `theme`/
  `accent`, and `Omit<BuildOptsArgs,"width"|"height"|"peakWizardEdit">`; zero
  store imports). `PlotStage.tsx` is now the thin 312-line focused-window
  composition: the ~40 singleton `useApp` selectors + `usePlotPayload` +
  `<PlotViewport>` + the toolbar/legend/readouts/context-menu chrome. Kept the
  uPlot-rebuild effect's dependency list field-for-field identical to the
  original (not a naively-memoized single `args` object) to avoid a rebuild-
  frequency regression from callback-prop identity churn; `qfitRoi`/
  `gadgetCursors` stay imperative reads (never a PlotViewport dependency);
  `peakWizardEdit` is threaded as its own RAW prop (not the transformed
  `{markers,onAdd,onRemove}` shape) so the effect keys off the stable
  store-selected reference, not a fresh wrapper object. Verified pixel-identical
  via `tools/visual`: all 4 harness shots (`multiseries_baseline`,
  `double_y_render`, `trailing_null_x_repro`, `library_folder_tree`) are
  BYTE-IDENTICAL (sha256) before vs. after the split. This IS the
  `PlotStage.tsx` half of `PROJECT_ORGANIZATION_PLAN` #10 — closed there as a
  side-effect completion, and the `architecture.test.ts` grandfathered pin
  (491) is REMOVED entirely (312 ≤ 400, the generic ceiling). +0 net test
  count change (all 1772 pre-existing tests pass unchanged — no new tests
  needed since behavior is provably identical). Frontend 1772 green.
- ~~**2. `PlotView` model + window-manager store slice**~~ (2026-07-09) — new
  `lib/plotview.ts`: the `PlotView` type (the ~35 singleton plot-view fields —
  `xKey/yKeys/y2Keys/y2Lim/y2Log/y2Step/y2AxisLabel`, `xLog/yLog`,
  `xLim/yLim/xStep/yStep/xFmt/yFmt`, `plotTitle/xAxisLabel/yAxisLabel`,
  `seriesStyles/seriesLabels/errKeys/seriesOrder/hiddenChannels`, `waterfall`,
  `refLines/annotations`, `showGrid/showLegend/legendPos/plotTemplate/
  showAxisBox`, and `stackMode/insetMode/polarMode/statMode` — deliberately
  EXCLUDING tool/gadget/overlay transient state and global Preferences
  defaults, per the plan's "Key decisions" #1/#2), `defaultPlotView()`,
  `snapshotView`/`hydrateView` (pure field-pick + fresh-copy; round-trip
  IDENTITY unit-tested), `sanitizePlotWindows` (untrusted-.dwk-boundary
  validator, per-field fallback like `loadPrefs`/`sanitizeFigureDocs`; wired by
  item 7, not called from any live path yet), `WindowGeometry`/`WinState`/
  `PlotWindow` types, and `cascadeGeometry` (new-window placement offset).
  `store/useApp.ts` gained the `plotWindows: PlotWindow[]` /
  `focusedWindowId: string | null` slice and 7 actions — `createWindow` /
  `closeWindow` / `focusWindow` (the ONLY two `snapshotView`/`hydrateView`
  callers) / `duplicateWindow` / `moveWindow` / `resizeWindow` / `raiseWindow`.
  The ≥1-window invariant holds at module init (a single `maximized` window,
  bound to `null`, computed once before `create()`) and after `loadWorkspace`
  (collapses back to one maximized window bound to the restored active
  dataset — window persistence itself is item 7); `closeWindow` is a no-op on
  the last surviving window. `removeDataset`/`removeSelected`/`removeDatasets`
  null a window's `datasetId` (never force-close — decision #4), matching the
  existing `figureDocs`/`originFigures` ref-pruning pattern. Deliberately did
  NOT touch `setActive`/`addDataset` (scoping the rebind+reset to the focused
  window specifically is item 4's job) or wire any chrome/focus-switch UX
  (items 3–5). +12 pure tests (`lib/plotview.test.ts`: default shape,
  round-trip identity, a superset-object snapshot pick, `cascadeGeometry`
  monotonicity, `sanitizePlotWindows` malformed/geometry/view/winState
  handling) + 14 store tests (`store/useApp.test.ts`: the invariant, load
  reset, `createWindow` default/override, `focusWindow` snapshot+hydrate +
  no-op cases, `closeWindow` top-z refocus / unfocused-drop / last-window
  no-op, dataset-removal nulling across all three remove actions,
  `duplicateWindow` snapshot-if-focused + unknown-id, geometry/z actions).
  Frontend 1797 green.
- ~~**3. Window chrome: `components/windows/` subtree**~~ (2026-07-09) — new
  `components/windows/PlotWindowFrame.tsx` (218 lines: controlled title bar
  with drag-move, resize grip, close button, `qzk-plotwin*` — a distinct
  prefix in the `qzk-win*` naming FAMILY, sharing tokens/conventions with
  `overlays/ToolWindow`'s `qzk-win*` without colliding class names, per Key
  Decision 3; geometry/z mutate ONLY through the existing
  `moveWindow`/`resizeWindow`/`raiseWindow`/`focusWindow` store actions,
  rAF-throttled — a `scheduledRef` boolean gates the pending flush rather than
  the rAF id itself, so a test's synchronous rAF stub can't have its own
  reset-to-null clobbered by the real (always-async) return-value assignment;
  ANY pointerdown anywhere in an unfocused frame focuses it first, implemented
  ONCE via a single capture-phase handler on the frame root — runs before
  uPlot's own native mousedown listeners on the canvas beneath, satisfying
  item 4's "background pointerdown focuses" contract for free) and
  `WindowCanvas.tsx` (66 lines: hosts N frames in its own stacking context,
  below workshop `ToolWindow`s; the single-maximized-window case renders
  `PlotStage` ALONE — no host div, no chrome — verified pixel-identical, see
  item 4's harness note). `Stage.tsx`'s Plot tab now renders `WindowCanvas`
  (Map/Worksheet untouched). Geometry clamping (canvas-resize reflow keeps
  title bars reachable) is a `bounds` prop from `WindowCanvas`'s own
  `ResizeObserver`, applied both live during a drag and reactively on a
  canvas-size change — a dragged/reflowed window always keeps ≥80×28px of its
  title bar on-canvas, never lost off-screen. `shell.css` gained the
  `qzk-plotwin*` family (focused-title `--accent` highlight, a
  gradient-drawn resize grip corner — no glyph/emoji). +7 component tests
  (`PlotWindowFrame.test.tsx`: drag, resize + min-size clamp, no grip when
  maximized, close-via-store, focus-on-unfocused-pointerdown, no-op when
  already focused, canvas-resize reflow) — landed atop the same-day
  WORKSHEET_PLAN Tier 1 merge (main at 1836 tests going in); running total
  after items 3–5 together is at item 5's entry below.
- ~~**4. Focused-window routing + background rendering**~~ (2026-07-09) — new
  `components/windows/BackgroundPlotWindow.tsx` (120 lines: the SAME
  `usePlotPayload` → `PlotViewport` pipeline the focused window uses, fed by
  the window's OWN `PlotView` snapshot instead of the live singleton fields —
  no toolbar/legend/readouts/context-menu, no on-plot tool plugins
  (`tool="zoom"`, `wheelZoom=false`, `fitOverlay`/`baselineOverlay`/
  `peakOverlay`/`derivOverlay` all forced `null` regardless of what the
  singleton happens to hold — decision #2), empty "no dataset" state for a
  null/removed binding). `WindowCanvas` dispatches: the focused window renders
  `PlotStage`, every other window renders `BackgroundPlotWindow`.
  `store/useApp.ts` closes the routing gaps item 2 left open: `setActive` and
  `addDataset` now ALSO rebind the FOCUSED window's `datasetId` (previously
  only the live singleton fields moved, so the window record's binding went
  stale until the next focus switch); `focusWindow`/`closeWindow`'s refocus
  now also retarget `activeId`/`selectedIds` to the newly-focused window's
  dataset (null → the empty state, matching decision #4 — "the window follows
  the Library, and vice versa") and clear the SAME transient tool/gadget/
  overlay fields `setActive` already clears for a dataset switch
  (`focusTransientReset`, a new shared helper — decision #2's "switching
  focus clears transient state exactly as switching datasets does today").
  **The migration guarantee (decision #6), verified via `tools/visual`:** a
  temporary baseline worktree at the pre-item-3 commit vs. the current build
  — all 4 existing harness shots (`multiseries_baseline`, `double_y_render`,
  `trailing_null_x_repro`, `library_folder_tree`) are BYTE-IDENTICAL (sha256)
  before vs. after items 3–5. **Row-state proof (item 4's own requirement):**
  a new `WindowCanvas.test.tsx` case renders two windows bound to the SAME
  dataset and toggles row exclusion — both windows' composed payloads null
  out the excluded row, with NO `architecture.test.ts` allowlist edit (the
  new files call `usePlotPayload`/`lib/rowstate`'s existing chokepoint, never
  touch `Dataset.excludedRows` raw). +4 `WindowCanvas.test.tsx` cases
  (single-maximized passthrough, ≥2-window chrome + focused-vs-background
  dispatch, the row-state proof, an unbound background window's empty state)
  + 4 `BackgroundPlotWindow.test.tsx` cases (empty state, no tool plugin,
  ignores the singleton's overlay state, honors its OWN view's `yLog`) + 6
  `store/useApp.test.ts` cases (setActive/addDataset window-binding sync,
  focusWindow's activeId/selectedIds retarget + empty-state case, the
  transient-reset contract, closeWindow's refocus following the same
  contract) — running total after item 5 below.
- ~~**5. Window commands v1**~~ (2026-07-09) — new
  `components/windows/useWindowCommands.ts` (128 lines): New Graph Window
  (⌘⇧N — clones the focused view onto the focused dataset via
  `createWindow(activeId, snapshotView(state))` then focuses it),
  Duplicate Window (⌘⇧D — `duplicateWindow(focusedWindowId)` + focus the
  copy), Close Window (⌘⇧W — `closeWindow(focusedWindowId)`, a no-op on the
  last survivor), Focus Next/Previous Window (⌃Tab / ⌃⇧Tab — deliberately
  Ctrl-only, never Cmd, so macOS's app switcher is never hijacked; cycles via
  a new pure `lib/plotview.cycleWindow` helper, by creation order — item 6's
  Tier-2 Ctrl+Tab upgrade makes this z-order-aware instead). Published into
  the EXISTING `store/commands.ts` registry (`useCommands.setMenuCommands`) —
  previously-unused scaffolding wired for the first time — rather than
  App.tsx's curated list, so App.tsx gained ZERO lines (954 pin honored, per
  the plan's own dependency-map rule). `MenuBar.tsx` now merges
  `useCommands().menuCommands` into what each menu displays (it previously
  only showed the curated `actions` prop), which is also how the new "Window"
  menu section (added to `MENUS`) gets its entries — the ⌘K palette already
  did this merge. `useWindowCommands()` is mounted from `Stage.tsx` (always
  mounted regardless of the active Stage tab), not `WindowCanvas` (Plot-tab-
  only) or `App.tsx` (pinned). `lib/shortcuts.ts` gained a "Window" cheat-
  sheet group and the mac/non-mac translator now also rewrites `⌃`→"Ctrl"
  (previously only `⌘`). +9 `useWindowCommands.test.ts` cases (the 5 published
  actions + shortcuts, each command's store effects, the ≥1-window no-op,
  forward/backward/wrapping cycling, Cmd+Tab is untouched, listener cleanup
  on unmount) + 4 pure `cycleWindow` tests (`lib/plotview.test.ts`) + 2
  `MenuBar.test.tsx` cases (eight-menu structure, registry-published entries
  render in their menu) + 1 `lib/shortcuts.test.ts` case (the `⌃` rewrite).
  **Tier 1 is now fully complete** (items 1–5 all shipped 2026-07-09) — the
  usable v1 the plan set out to deliver: ≥2 simultaneous movable, resizable,
  focusable plot windows fed by the existing plot pipeline. Frontend 1872
  green; `npm run build` (tsc + vite) green.
- ~~**6. Tile / Cascade / cycle focus**~~ (2026-07-09) — three pure helpers in
  `lib/plotview.ts`: `tileLayout` (grid split — cols = `ceil(sqrt(count))`,
  cells floored at a 200×140 minimum so a large count against a small canvas
  degrades to overlapping-but-usable cells rather than collapsing to zero),
  `cascadeLayout` (N windows via `cascadeGeometry` in turn — the "Cascade"
  command's re-lay-out-ALL-windows counterpart to that helper's
  one-new-window placement), and `zOrderIds` (stable-sorts by ascending z —
  replaces v1's plain creation-order input to `cycleWindow`, identical to v1
  whenever no window has been raised). `store/useApp.ts` gained the
  `plotCanvasBounds` field + `setPlotCanvasBounds` (the Plot tab's live pixel
  size — `WindowCanvas`'s ResizeObserver is the sole writer) and
  `tileWindows`/`cascadeWindows` actions (only re-lay-out VISIBLE windows;
  any that were maximized become "normal" so they actually show side by
  side/cascaded; minimized windows are untouched; a no-op below 2 visible
  windows; falls back to a default 1200×800 size when bounds aren't known
  yet). `useWindowCommands.ts`'s `cycleFocus` now feeds `zOrderIds` instead
  of plain array order, and gained "Tile Windows"/"Cascade Windows" (Window
  menu + palette, no keybinding). **A real behavioral interaction surfaced by
  this change**: `focusWindow` (unchanged since Tier 1) raises the newly-
  focused window's z on every switch, so repeated Ctrl+Tab/Ctrl+Shift+Tab
  presses reshuffle the stack as you go — cycling forward then immediately
  back is no longer a plain reversal once z differs (a real MDI/Alt-Tab
  trait, not a bug); the pre-existing Tier-1 "Ctrl+Tab...Ctrl+Shift+Tab"
  keyboard test needed its expected id updated to match (traced by hand:
  w1→w2 raises w2's z, so the very next "previous" step lands on w3, not
  back on w1). +19 pure tests (`lib/plotview.test.ts`: tileLayout grid/
  minimum-floor/empty cases, cascadeLayout, zOrderIds stable-sort) + 6
  `useApp.test.ts` cases (bounds setter, tile/cascade no-op and real
  rearrange, skip-minimized, un-maximize) + 3 `useWindowCommands.test.ts`
  cases (z-order-aware forward/backward cycling distinct from creation
  order, Tile/Cascade command effects) + updated the 7-command registry
  assertion and one existing keyboard-shortcut expectation.
- ~~**7. Window layout persistence (`.dwk` + autosave)**~~ (2026-07-09) —
  `lib/workspace.ts` gained `plotWindows`/`focusedWindowId` on
  `WorkspaceState`/`LoadedWorkspace`/the doc shape — passed through
  VERBATIM by `serializeWorkspace` (this module stays a plain serializer;
  the focused-view snapshot is the CALLER's job, per the interface doc) and
  validated on parse via the item-2 `sanitizePlotWindows` boundary
  validator (clamps dead dataset refs/malformed geometry, drops malformed
  entries, never throws) plus a `focusedWindowId` clamp to a surviving
  window id or null. `store/useApp.ts` gained `windowsForSave()` — a pure
  getter (not a mutation) that freezes the FOCUSED window's LIVE view into
  its record via the same `snapshotView` chokepoint `focusWindow`/
  `closeWindow` use; this is the plan's "save is one of the three sanctioned
  snapshot points" — the File▸Save command (`App.tsx`, kept to the SAME
  line so the 954-line pin never moves) and `useWorkspaceAutosave`'s save
  effect both call it instead of ever passing `state.plotWindows` raw.
  `loadWorkspace` restores a persisted layout when present (hydrating the
  restored FOCUSED window's view into the live singleton fields — the same
  invariant `focusWindow`/`closeWindow` uphold) while a legacy/fresh
  workspace (no `plotWindows` field) falls through to EXACTLY today's
  per-field reset, including the dataset-derived `errKeys`/
  `originHiddenChannels` smart defaults — verified with a dedicated
  regression test, zero behavior change on that path.
  `useWorkspaceAutosave.ts`'s subscribe comparison now also watches
  `plotWindows`/`focusedWindowId` (the "windows slice", exactly as the plan
  names it) alongside the pre-existing datasets/folders/active/selection/
  smartFolders set — a live-view-only edit with no accompanying window-
  structural change doesn't reset the debounce by itself, the same
  documented tradeoff `figureDocs`/`reports`/`macroSteps` already have here;
  an explicit Save always captures the live view regardless. +5
  `workspace.test.ts` cases (round-trip + focus id, dead-dataset clamp,
  focus-id clamp, pre-item-7-doc defaults to `[]`/`null`, malformed-entry
  drop) + 5 `useApp.test.ts` cases (`windowsForSave` freezes without
  mutating, restore-and-hydrate, dead-ref clamp via load, legacy-path smart
  defaults preserved, unmatched `focusedWindowId` falls back to the first
  restored window).
- ~~**8. Minimize / maximize + window strip**~~ (2026-07-09) — `WinState`
  already had "minimized" (item 2); `store/useApp.ts` gained
  `minimizeWindow` (flips winState; minimizing the FOCUSED window hands
  focus to the top-z remaining VISIBLE survivor — `closeWindow`'s exact
  refocus formula, but the window stays IN `plotWindows`, docked in the
  strip, rather than being removed; a no-op candidate-wise state — focus
  just stays put on the now-hidden window — when there's no other visible
  window, since the ≥1-window invariant is about array length, not
  visibility), `restoreWindow` (un-minimizes AND focuses in one atomic step
  — clicking a strip entry is "bring this back and make it live", a taskbar
  button, not an inert un-minimize), and `toggleMaximizeWindow` (flips
  normal<->maximized; a no-op on a minimized window). `components/windows/
  WindowCanvas.tsx` now partitions `plotWindows` into `visible` (renders a
  `PlotWindowFrame`, exactly as before) and `minimized` (renders NEITHER a
  frame NOR a `PlotStage`/`BackgroundPlotWindow` — fully unmounted, the
  plan's perf risk note — just one `qzk-winstrip-item` button in a new
  `qzk-winstrip` dock along the canvas bottom; click = `restoreWindow`).
  `shell.css` restructured `.qzk-wincanvas` into a flex-COLUMN outer wrapper
  around a new `.qzk-wincanvas-frames` inner box (the actual frame host —
  a maximized frame's `inset:0` fills only this inner box, never covering
  the strip sibling below it) plus the new `.qzk-winstrip`/`.qzk-winstrip-
  item` classes (tokens only). `PlotWindowFrame.tsx`'s title bar gained
  `onDoubleClick` → `toggleMaximizeWindow` (the Origin habit) — this
  coexists with item 10's rename-on-double-click-the-TEXT because the title
  text's own double-click handler stops propagation before it ever reaches
  the bar's handler. **Verified the migration guarantee still holds**: a
  temporary worktree at `ce58ed9` (pre-Tier-2 main) built + the visual
  harness shot all 4 canonical shots (`multiseries_baseline`,
  `double_y_render`, `trailing_null_x_repro`, `library_folder_tree`) —
  sha256 BYTE-IDENTICAL to the same 4 shots off this branch; the 5th,
  Tier-1-added `mdi_two_window_layout` shot differs ONLY by the new item-10
  channel/rows badge text now visible in each title bar (a deliberate,
  expected new-feature diff, not a regression — confirmed by eye). +6
  `useApp.test.ts` cases (minimize unfocused/focused-with-refocus/no-
  candidate, restore un-minimizes+focuses+hydrates, restore no-op when not
  minimized, maximize toggle + no-op on minimized) + 3 `WindowCanvas.test.tsx`
  cases (minimized window renders no frame/no plot + one strip entry, strip
  click restores+focuses, no strip when nothing's minimized) + 1
  `PlotWindowFrame.test.tsx` case (double-click the title BAR toggles
  maximize/restore).
- ~~**9. Open Origin figures / figure docs in new windows**~~ (2026-07-09) —
  `applyOriginFigure` gained an `opts?: { newWindow?: boolean }` param: when
  set, it creates + focuses a new window (bound to the figure's dataset,
  titled from `figureLabel(entry)` deduped via item 10's `dedupeWindowTitle`)
  BEFORE any of the existing apply logic runs — since that logic already
  acts entirely through `setActive`/singleton `set()` calls scoped to "the
  focused window" by construction, the rest of the (large, multi-branch)
  function needed ZERO changes to land on the new window instead of
  overwriting whatever was focused before. `store/useApp.ts` also gained
  `openFigureDocInWindow` (the figure-doc half): a LIVE doc with a resolved
  dataset only (a frozen doc's data snapshot isn't a live `Dataset` a v1
  window can bind to — documented as Tier 3 item 11's "snapshot-as-window"
  gap, not silently faked) creates + focuses a new window and applies its
  `FigureConfig`'s `xKey`/`yKeys`/log flags/title/axis labels onto it —
  deliberately NOT its `seriesStyles` (a `FigureConfig` carries the export-
  shape `ExportSeriesStyle[]`, which has no inverse back to the live
  `Record<number,SeriesStyle>`; `buildExportStyles` only goes the other
  way — the window opens with default series styling, same as any other
  fresh window). UI wiring: `Library/FigureRow.tsx` gained a second "⊞" icon
  button ("Open in a new graph window", enabled iff the figure resolved) —
  `SavedFiguresSection.tsx` gained the same for figure docs (enabled iff
  live + a resolved `datasetId`; otherwise a disabled button whose tooltip
  says why). Neither uses a right-click `ContextMenu` (the plan's own
  wording) — both rows' existing convention is an inline icon-button row
  (SavedFiguresSection already had duplicate/delete buttons this way;
  FigureRow gained its first), so the new action matches its neighbors
  instead of introducing a second interaction pattern for the same rows.
  +2 `useApp.test.ts` describe blocks (newWindow opens+focuses+titles from
  the figure label, non-newWindow unchanged, openFigureDocInWindow applies
  config + no-ops for frozen/unbound docs) + 1 `FiguresSection.test.tsx`
  case (the button opens a new window bound to the entry's dataset) + 2
  `SavedFiguresSection.test.tsx` cases (opens + applies config, disabled for
  a frozen doc).
- ~~**10. Window titles, rename, dataset badge**~~ (2026-07-09) — two pure
  helpers in `lib/plotview.ts`: `displayedWindowTitle` (a window's own title,
  else its bound dataset's name, else "Untitled graph" — mirrors
  `PlotWindowFrame`'s existing render-time fallback chain exactly) and
  `dedupeWindowTitle` (appends " (2)", " (3)", … against a supplied
  existing-titles list). `createWindow` gained an optional `title` param
  (an explicit title, e.g. from item 9's figure-label path, is used
  VERBATIM — no dedup on top of a caller's own already-resolved choice);
  omitted, it computes the bound dataset's name deduped against every
  window's CURRENT displayed title, so a second window on the same dataset
  reads "Foo (2)" instead of an indistinguishable second "Foo".
  `duplicateWindow` dedupes the SOURCE's own displayed title the same way
  ("Comparison" duplicated once → "Comparison (2)"). New `renameWindow`
  action sets an explicit title verbatim — never deduped, a user's rename is
  never second-guessed. `PlotWindowFrame.tsx`'s title span gained the
  DatasetRow/FolderRow inline-rename pattern (double-click → an `<input>`,
  Enter commits, Escape cancels, blur commits) — its own `onDoubleClick`
  stops propagation so it never ALSO triggers item 8's maximize toggle on
  the title bar beneath it (the plan named both "double-click the title" —
  resolved by scoping item 8's toggle to the BAR background and item 10's
  rename to the TEXT specifically, the ubiquitous title-bar-vs-title-text
  split most window managers already use). The existing dataset-name badge
  (item 3) is joined by a new JetBrains Mono channel-count/rows `Badge`
  (`{n}ch · {n}pts`, `tone="accent"` — reuses the `Badge` primitive
  DatasetRow already uses, which sets `font-mono` itself) fed by a new
  `datasetMeta` prop `WindowCanvas` computes from the bound `Dataset`. +6
  `lib/plotview.test.ts` cases (fallback chain, dedupe uniqueness/suffix) +
  5 `useApp.test.ts` cases (createWindow default/dedupe/explicit-verbatim,
  duplicateWindow dedupes the source's own title, renameWindow never
  dedupes even on a deliberate collision) + 3 `PlotWindowFrame.test.tsx`
  cases (rename commits on Enter and doesn't also maximize, Escape
  cancels, the meta badge renders `{n}ch · {n}pts`) + 1 `WindowCanvas.test.tsx`
  case (the badge text appears for a window bound to a live dataset).
  **Tier 2 is now fully complete** (items 6–10 all shipped 2026-07-09).
  Frontend 1927 green (+55 over Tier 1's 1872); `tsc -b --noEmit` and
  `npm run build` (tsc + vite) both green.
- ~~**18. Per-window background override + literal-colour contrast fix**~~
  (2026-07-09, owner request) — two related fixes, shipped together since the
  second's render path is the first's chokepoint:
  1. **Dark-lines-on-dark-mode fix.** New `lib/contrastColor.ts`:
     `parseColor` (hex 3/4/6/8-digit, `rgb()`/`rgba()`, `hsl()`/`hsla()`, a
     basic CSS named-colour table — deliberately DOM-free, unlike
     `lib/color.ts`'s canvas-based `resolveToHex`, so it behaves identically
     in jsdom and the browser) + `resolveDrawColor(color, isDarkBg, inkColor?)`
     (WCAG relative luminance vs. two canonical reference background
     luminances, contrast ratio < 2.2 → substitute the achromatic ink token,
     never a hue shift — matches/exceeds AA-for-small-text headroom for a
     thin plot stroke). Wired into `lib/uplotOpts.ts`'s `buildOpts` at every
     literal-colour draw site (series stroke/fill/markers/points-only via the
     single `stroke` computation, ref lines, annotations, error bars, the
     axis-box frame, the "excluded" muted-series grey) and into
     `PlotLegend.tsx`'s swatch colour (the DOM-side legend now matches
     whatever the canvas actually drew) — render-time only, never mutates a
     stored `SeriesStyle`/`RefLine`/`Annotation` colour, so light mode keeps
     a TRUE black line and a theme/background switch re-resolves live.
  2. **Per-window background override** ("could we toggle just one window to
     white/black" — Origin's white-graph-page-in-a-dark-app model). New
     `PlotBg` type (`"theme" | "light" | "dark"`) + `bg: PlotBg` field on
     `PlotWindow` (`lib/plotview.ts`; required, defaulted to `"theme"` at
     all three construction sites — `mainWindow`/`createWindow`/
     `duplicateWindow`, the last INHERITING the source's `bg` — and by
     `sanitizePlotWindows` for a persisted `.dwk`/malformed value; rides the
     existing window persistence for free, no `workspace.ts` change needed)
     + `nextPlotBg` (the theme→light→dark→theme toggle cycle, pure).
     `lib/uplotOpts.ts` gained `resolvePlotBg(bg?)` — THE resolution
     chokepoint both `buildOpts` (axis/grid/ink draw colours + the
     `isDarkBg` fed to `resolveDrawColor`) and the window-chrome components
     (inline container background) call; "theme"/"dark" reuse the existing
     always-dark `--axes-bg`/`--grid-line` tokens (already theme-invariant),
     "light" and both modes' ink use 6 NEW theme-invariant tokens added to
     `colors.css` (`--axes-bg-light`, `--grid-line-light`, `--ink-on-dark`/
     `--ink-dim-on-dark`, `--ink-on-light`/`--ink-dim-on-light` — mode-scoped,
     not theme-scoped, so a window's override stays correct even when it
     disagrees with the surrounding chrome's global theme). Rendering:
     `PlotStage.tsx` looks up the FOCUSED window's `bg` (a derived string
     selector, not a `plotWindows`-array dependency) and applies it to
     `AxisDropZones`'s new optional `style` prop (undefined for the default
     "theme" case → no `style` attribute at all, byte-identical to
     pre-item-18 markup — decision #6's migration guarantee) and to
     `PlotViewport`/`PlotLegend`; `PlotWindowFrame.tsx` applies the same
     resolved background to `.qzk-plotwin-body` for BACKGROUND (unfocused)
     windows. UI: a small ◐ glyph button in `PlotWindowFrame`'s title bar
     (new `.qzk-plotwin-bg` style in `shell.css`) cycling this ONE window's
     mode, tooltipped with the current state; a "Window Background" command
     (`useWindowCommands.ts`, 8th Window-group entry, no shortcut) cycles the
     FOCUSED window's mode via the registry/⌘K — works even for the sole
     maximized default window, which has no title bar. Multi-panel
     (`MultiPanelStage`/`useMultiPanelStage`) and every other `buildOpts`
     caller (`WaterfallView`, `ReflPanel`, `InsetPlot`) inherit the contrast
     fix for free (they call `buildOpts` without a `bg` arg, which defaults
     to "theme" → the always-dark tokens, matching their actual rendered
     background) — no per-caller change needed.
  +15 `contrastColor.test.ts` (parse forms, black→ink/white→ink per mode,
  true-black-stays-black on light / true-white-stays-white on dark, mid-greys
  and saturated colours pass through both modes, invalid input passthrough,
  near-black coloured stroke → achromatic not hue-shifted, built-in fallback
  ink) + 10 `uplotOpts.test.ts` cases (`resolvePlotBg` default/theme≡dark/
  light, literal black/white substitution per mode, visible literal colour
  unchanged, default palette token untouched, axis stroke flips per mode) + 2
  `plotview.test.ts` cases (bg sanitize round-trip/fallback, `nextPlotBg`
  cycle) + 3 `useApp.test.ts` cases (createWindow default, duplicateWindow
  inherits, `setWindowBg`) + 2 `useWindowCommands.test.ts` cases (cycles the
  focused window only, no-op with no focus) + 2 `PlotWindowFrame.test.tsx`
  cases (the ◐ button cycles + doesn't also start a drag) + 3
  `PlotLegend.test.tsx` cases (substitutes per mode, token override
  untouched). Frontend 2087 green (merged same-day with the plot right-click
  context-menu feature, `a214fea`); the lone `GridViewport.perf.test.tsx`
  timing case is pre-existing/load-dependent flake unrelated to this item —
  passes in isolation; `npm run build` green.
