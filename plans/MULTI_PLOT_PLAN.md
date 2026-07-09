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

3. **Window chrome: `components/windows/` subtree** — (M) the MDI frame
   and canvas, tokens-only styling.
   - [ ] `PlotWindowFrame.tsx`: controlled title bar (drag), resize grip,
         close button, focus-on-pointerdown, z from store; `qzk-win*`
         family extended in `shell.css` (focused-title accent variant,
         resize grip) — design tokens only, unicode glyphs not emoji
   - [ ] `WindowCanvas.tsx`: hosts frames inside the stage cell (own
         stacking context, below workshop `ToolWindow`s); one maximized
         window renders borderless full-bleed (today's look)
   - [ ] `Stage.tsx`: Plot tab renders `WindowCanvas`; Map/Worksheet tabs
         untouched
   - [ ] Geometry clamped to the canvas (no lost off-screen windows);
         canvas-resize reflow keeps title bars reachable

4. **Focused-window routing + background rendering** — (M) the behaviour
   contract that makes N windows coherent.
   - [ ] Focused frame renders `PlotStage` (full tools/overlays/readouts/
         legend/toolbar); background frames render `PlotViewport` from
         their `PlotView` snapshot — live data, no tool plugins,
         pointerdown focuses first
   - [ ] `setActive` scopes its rebind + view reset to the focused window;
         unfocused windows keep pinned datasets; `removeDataset`/`clearAll`
         null/reset window bindings
   - [ ] Tool/gadget/overlay singleton state stays focused-only; switching
         focus clears transient tool state exactly as switching datasets
         does today
   - [ ] Row-state proof test: two windows on one dataset both reflect an
         exclusion toggle (no `architecture.test.ts` allowlist change)

5. **Window commands v1** — (S) New Graph Window, Duplicate Window, Close
   Window; menu + ⌘K entries wired through `store/commands.ts` / extracted
   hooks — zero lines added to `App.tsx` (954 pin).
   - [ ] Commands + shortcuts registered in the command registry; a Window
         menu section in `MenuBar`
   - [ ] "New Graph Window" clones the focused view onto the focused
         dataset by default (fast compare workflow)

## Tier 2 — Medium Impact

6. **Tile / Cascade / cycle focus** — (M) the MDI arrangement commands.
   - [ ] Pure tiling/cascade geometry in `lib/plotview.ts` (grid split +
         cascade offsets, unit-tested)
   - [ ] Commands: Tile, Cascade, Ctrl+Tab / Ctrl+Shift+Tab focus cycling
         (z-order aware), in the Window menu + palette

7. **Window layout persistence (`.dwk` + autosave)** — (M) round-trip
   `plotWindows` + `focusedWindowId` (snapshot the focused view on save).
   - [ ] `lib/workspace.ts`: serialize + `sanitizePlotWindows` on parse
         (clamp dataset refs/geometry); additive-optional, v3 stays
   - [ ] `useWorkspaceAutosave` subscription watches the windows slice
   - [ ] Legacy docs (and the visual-harness seam) load as one maximized
         window — identity with today verified

8. **Minimize / maximize + window strip** — (M) manage many windows.
   - [ ] `winState`: normal / minimized / maximized; minimized windows
         unmount their uPlot (perf) and dock to a strip at the canvas
         bottom; maximize toggles full-bleed
   - [ ] Double-click title = maximize/restore (Origin habit)

9. **Open Origin figures / figure docs in new windows** — (M) the payoff
   for `.opj` imports with many graph windows.
   - [ ] `applyOriginFigure` gains an "open in new window" path (new window
         + apply, instead of overwriting the focused view); Library
         Figures / FigureDoc context menus get "Open in New Window"
   - [ ] Window title from `figureLabel` / doc name

10. **Window titles, rename, dataset badge** — (S) chrome polish: title
    defaults to dataset name, double-click-to-rename (askParams), a small
    JetBrains Mono channel-count/rows badge.

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
