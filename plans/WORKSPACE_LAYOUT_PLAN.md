# Workspace layout plan: floating, dockable windows ("option D")

Status: **direction signed off 2026-11-23** (owner reviewed the mockups and
picked option D). Not started. Visual reference: the mockup canvas
https://claude.ai/artifact/6GRgYos7ua7fAkgtmgqKPz, artboard `Floating.dc.html`.
This replaces the 2026-11-22 "one right panel with Data · Analysis · Style
tabs" plan. Superseded decisions are listed below so nobody rebuilds them.

## Problem (unchanged)

- The stage shows ONE full-screen view at a time (Plot · Map · Worksheet ·
  Workflow tabs, `components/Stage/Stage.tsx`, `lib/stagetab.ts` `StageTab`).
  Checking data or running an analysis means leaving the plot.
- Workflow buttons come from a hidden technique tag (`lib/techniqueDefaults.ts`
  `techniqueOf`, `lib/techniqueWorkflow.ts`), so the set changes between
  datasets with no explanation.
- There are three separate window systems today, each with its own rules:
  MDI plot windows inside the stage cell (`components/windows/WindowCanvas.tsx`,
  `store/windows.ts`, `PlotWindow.geometry/z/winState`), app-wide floating
  `ToolWindow`s (`components/overlays/ToolWindow.tsx`, geometry in
  `store/toolwindows.ts` `toolWindowLayout`), and the single-owner side-column
  dock (`store/toolDock.ts`, which swaps a tool in for the Inspector).

## Decisions

### Owner, 2026-11-23 (option D)

| # | Topic | Decision |
|---|---|---|
| D1 | Windows | Every panel is a window: each plot, **Data** (worksheet), **Analysis** (guide + tool list), each analysis tool (Curve fit, Statistics, …) and **Style** (the Inspector). Each can float (move/resize), close and reopen |
| D2 | Docking | Dock to the left, right or bottom edge, or the **centre**. Drag the title bar onto an edge or the centre (drop-zone preview), or use the title-bar dock buttons; pressing the pressed dock button again floats the window |
| D3 | Sharing a slot | Several windows on one edge stack along it; several in the centre share it side by side |
| D4 | Arranging | "Tile all" (any set of windows), one-click "Plot \| Data side by side", "Dock all" (plot centre, Data right, tool bottom), "Float all" |
| D5 | Default on open | **Remember the last layout** (persistence choice below) |
| D6 | Small screens (< ~1280 px) | Windows **stay floating** by default. A setting lets the user change that default (for example, tile below a chosen width). Answered by the owner on 2026-11-23 |

### Kept from 2026-11-22 (still valid)

- Stage tabs are removed. Map becomes a plot type in a plot window, with the
  **Map toolbar on the plot** (as the plot toolbar is today).
- **Data follows the focused plot** by default, with a **pin**, plus a setting
  to follow the Library selection instead. Selection is linked both ways
  (plot points ↔ worksheet rows).
- **Analysis guide:** technique detection with suggestions and an override
  (saved on the dataset); five steps (Inspect → Clean → Plot → Analyze →
  Report) with not started / done / out of date status from the result
  lifecycle, click to reopen, next step highlighted; the full tool list
  below it, with tools that don't fit greyed out and a one-line reason.
- **Library** gets an easy collapse toggle (`leftCollapsed` already exists).
- **Rollout:** opt-in setting first, then the default in a later release.

### Superseded 2026-11-23 (do not build)

| Old # | Was | Replaced by |
|---|---|---|
| 2, 10 | ONE right panel with Data · Analysis · Style tabs | D1, D2: separate windows, dock anywhere |
| 12 | Maximise Data swaps it with the plot (live thumbnail) | Dock/tile; a window's own maximise fills the centre |
| 13 | Overlay drawer on small screens | D6 |
| 14 | Tools open inside the Analysis tab, with pop-out | Each tool is its own window |

## Layout model (pure, `lib/windowLayout/`)

Window identity is a typed `WindowRef` string:

| Ref | Kind | Count | Content today |
|---|---|---|---|
| `plot:<PlotWindow.id>` | plot, snapshot, panel, worksheet, map document windows | many | `WindowCanvas` renderers |
| `data` | Data (follows focus / pin) | 1 | `WorksheetPane` (lazy chunk) |
| `analysis` | guide + tool list | 1 | new |
| `style` | Inspector | 1 | `components/Inspector/Inspector` (lazy) |
| `tool:<id>` | analysis tool | one per tool id | `ToolWindow` children, id = its existing `id` prop |

```ts
type Slot = "left" | "right" | "bottom" | "centre";
interface Placement {
  slot: Slot | null;          // null = floating
  order: number;              // position in its slot's stack (0 = first)
  share: number;              // fraction of the slot's length, renormalised
  lastSlot: Slot | null;      // where "Dock" sends it after a float
  open: boolean;              // closed windows keep their placement for reopen
}
interface WindowLayoutV1 {
  v: 1;
  placements: Record<WindowRef, Placement>;
  z: WindowRef[];             // floating stack, back → front
  edges: { left: number; right: number; bottom: number }; // px; 0 = empty
  centre: "row" | "grid";     // how centre windows share it
  data: { pinned: string | null; follow: "plot" | "library" };
}
```

- **Float rect stays where it lives today**, so there is one source of truth:
  `PlotWindow.geometry` for `plot:*`, `toolWindowLayout[id]` for `tool:*`,
  and new `toolWindowLayout` entries for `data`, `analysis`, `style`. Float
  rects are relative to the workspace area (between Library and status bar)
  and are clamped on viewport resize by the existing sanitizers.
- **Tiling is centre docking, not a third mode.** "Tile all" moves the
  chosen set to `centre` with `centre: "grid"`. "Plot | Data" puts the
  focused plot and `data` in the centre with `"row"` and leaves the other
  windows where they are. "Dock all" = focused plot → centre, `data` → right,
  open tools → bottom, `style`/`analysis` → right under Data. "Float all"
  sets every `slot` to null at its saved float rect (a cascade for a window that never floated).
  This reuses `store/windows.ts` `arrangedWindowsPatch`.
- **z:** a floating window is above every docked one. `PlotWindow.z` is
  rewritten from `z` on save, so classic mode and older readers get a sane
  stacking order.
- `winState` stays: `minimized` goes to the strip, `maximized` fills the
  centre while it lasts (other centre windows hide, nothing is re-placed).
- All operations (`dock`, `toggleDock`, `float`, `move`, `close`, `reopen`,
  `tileAll`, `plotBesideData`, `dockAll`, `floatAll`, `seedFromClassic`,
  `sanitize`) are pure functions of `(layout, refs) → layout` with unit
  tests. React and the store only call them.

## Persistence and versioning

**Choice: the layout is saved with the project (`.dwk`), and the last layout
is also kept per user as a fallback template.**
- Project: a top-level `windowLayout` key. Placements are keyed by window
  ids that only exist in that project, and plot-window geometry is already
  saved per project. Reopening a project restores its own desk.
- Per user: `qz.windowLayout` in localStorage (added to `KNOWN_STORAGE_KEYS`
  in `lib/storageKeys.ts`) stores the last layout *shape*: the slot, edge
  sizes and centre mode for each kind (data, analysis, style, tool kind,
  "first plot"). It applies when a project has no `windowLayout` (a new
  project, an import, or a file from before this change). Opening a dataset
  inside a project keeps that project's layout.
- **Older releases must refuse, not drop.** v0.39–v0.41 accept v7 and read
  top-level keys one by one, so they would silently lose `windowLayout`. The
  v7 gate (`NEW_SINCE_V038`) is not enough. P0 adds
  `WORKSPACE_VERSION_POST_041 = 8` and a `NEW_SINCE_V041` set, classifies
  `Workspace.windowLayout` as `"gated"` in `WORKSPACE_TOP`, and adds the
  `FEATURES` case. This first needs the measurement procedure in
  `__fixtures__/workspace/README.md`, run against `git archive v0.41.0`. If
  v0.41 turns out to carry unknown keys through untouched, record
  `kept-by-034`-style evidence and skip the bump. `parseWorkspace` accepts 8.
- `windowLayout` is written **only while the new layout is on**. A classic
  user's saves are byte-for-byte unchanged (same version, no key). The
  trade-off for opted-in users is that their saved projects open only in
  this release or later.
- A layout with `v` > 1, or one that fails sanitizing, is dropped with a
  `migrationWarnings` note and re-seeded. The layout is never data, so it
  never blocks opening the project.

## Store slice and ratchets

- New `store/windowLayout.ts` slice (`WindowLayoutSlice`: `windowLayout`,
  `layoutMode`, thin setters that call the pure ops). It is composed into
  `useApp` like `store/toolwindows.ts`. `store/useApp.ts` is at **470 / 471**
  (STORE_PINS), so the composition lines have to be funded by an extraction
  in the same PR. Pins only go down. `store/windows.ts` is at 499 / 500, so
  nothing gets added there.
- `layoutMode: "classic" | "windows"` lives in `store/prefs.ts` (`qz.prefs`),
  defaults to `"classic"`, and is reachable from View ▸ "Window layout
  (preview)" and from Preferences. D6's setting (`smallScreen: "float" |
  { tileBelow: px }`) goes in the same blob.
- Layout changes are working state and do not go on the undo stack (the same
  as mapRoi and window moves today). P0 confirms with a test that undo
  leaves placements alone.
- **Bundle:** the eager budget is 816,042 B (796.9 kB) with about 2 kB of
  headroom. The eager part has to stay below about 0.5 kB: the slice state,
  the pref read and the `layoutMode === "windows"` branch in `App.tsx`. The
  ops, the sanitizer (if the workspace parser is eager, measure first), the
  host, the chrome, the drop-zone overlay and every window body go behind
  `lazyRegion` seams. Each PR lists its before/after eager bytes, measured
  after `npm ci` and a rebuild. A raise is the last resort, as the script
  header says.
- **.tsx ceiling 400, zero pins:** the chrome becomes a
  `components/workshops/windowlayout/` subtree (`LayoutHost`, `DockRegion`,
  `FloatLayer`, `LayoutWindowFrame`, `DockButtons`, `DropZones`,
  `useLayoutDrag`, `useLayoutKeyboard`). `App.tsx` (267 lines) gains a single
  lazy mount only. Every new lazy seam gets an entry in the
  `lazyRenderSeams`-style seam test.
- `toolDock.ts` stays exactly as it is in classic mode. In windows mode,
  `useToolWindowDock` steps aside (it does not register) and `ToolWindow`
  renders its body through `LayoutWindowFrame`. `toolDock` is deleted with
  classic mode (Pn).

## Keyboard and accessibility

- **Roles:** a docked window is a `role="region"` labelled by its title. A
  floating window keeps `ToolWindow`'s `role="dialog"` (non-modal). Dock
  buttons are real buttons ("Dock left", "Dock right", "Dock bottom", "Dock
  centre") with `aria-pressed` on the current slot, plus Close.
- **Focus order** follows the layout, not z or DOM history: Library → left
  stack (top→bottom) → centre (left→right) → right stack → bottom
  (left→right) → floating (back→front). **F6 / Shift+F6** cycle windows
  (F6 is free today). Focus lands on the title bar and Tab enters the body.
- **Moving and docking without a mouse:** the title-bar menu (and
  `Alt+Shift+M` on a focused title bar, proposed) enters a move mode.
  Arrows move by 16 px, Shift+arrows by 1 px, Ctrl+arrows resize, L / R / B /
  C dock to the matching slot, F floats, Enter commits and **Escape cancels
  and restores**. The same drop-zone preview shows during the mode. Every
  "Dock all / Float all / Tile all / Plot | Data" command and "Reopen
  <window>" is in the Window menu and ⌘K.
- **Escape:** cancelling a drag or move mode claims the `gesture` layer of
  `lib/escapeStack.ts`. Otherwise Escape falls through the existing ladder.
  It never closes, docks or floats a window.
- A polite live region announces placements ("Curve fit docked right, 2 of
  2"). Drop-zone previews do not animate under `prefers-reduced-motion`.
  Colours come from design tokens only.

## Migration of existing users

- Nothing changes until a user turns the setting on. The first time they do,
  `seedFromClassic` builds a layout from current state:
  - a maximized plot goes to the centre, other plot windows float at their
    current geometry;
  - the Inspector becomes `style` on the right;
  - a docked tool (`toolDockSnapshot().owner`) is stacked right under Style;
  - floating tools stay floating at their `toolWindowLayout` rects;
  - `data` and `analysis` start closed, with right as their `lastSlot`.
- Turning the setting off goes back to classic and keeps `windowLayout` in
  state, so turning it on again restores the same layout. Classic ignores
  the key.
- `stageTab` stays in classic mode. In windows mode, the code paths that set
  `stageTab` (`datasetSelection.ts`, `analysisCenterRun.ts`,
  `analysisResultPlotOpen.ts`, `WindowWorkspaceControls`) are routed to
  "open/focus the matching window" through one adapter. Each call site gets a
  test.

## Phases (each one mergeable PR; behind `layoutMode` until Pn-1)

- **P0 — Model, store, setting (no visible change for classic users).**
  `lib/windowLayout/` types, pure ops and sanitizer; the `store/windowLayout.ts`
  slice; the `layoutMode` pref and the View/Preferences toggle (it shows a
  placeholder host while windows mode is on); the `.dwk` key with the v0.41
  measurement, v8 and `NEW_SINCE_V041`; `qz.windowLayout`; `seedFromClassic`.
  *Tests:* op tables (dock, toggle-to-float, stack order, renormalised
  shares, close/reopen remembers, tile, plotBesideData, dockAll, floatAll);
  sanitize (unknown refs, clamped rects, future `v`); round trip; the
  forward-compat FEATURES case and the v8 refusal fixture; a classic save
  byte-identical to the previous release; undo does not touch the layout.
  *Accept:* the full gate is green, eager growth ≤ 0.5 kB, the STORE_PINS
  value does not rise.
- **P1 — Host + docking by buttons.** Lazy `LayoutHost` replaces Stage +
  Inspector in windows mode. Edge regions and splitters, the centre
  row/grid, the float layer, `LayoutWindowFrame` with dock buttons, plot
  windows (focused `PlotStage` / background renderers) and Style. The
  commands Dock all, Float all and Tile all. The Library collapse toggle
  (works in both modes). F6 cycling. Stage tabs are hidden in windows mode.
  *Tests:* each button docks and pressing it again floats; stacking;
  splitter resize persists; F6 order; a11y names/pressed; the lazy seams.
  *Accept:* "Dock all" matches the mockup; classic is unchanged.
- **P2 — Drag to dock + keyboard move mode.** Title-bar drag with drop-zone
  preview (edges, centre, an index between stacked windows), move mode,
  Escape cancel, the live region. *Tests:* pointer-event drags that drop on
  each zone; keyboard parity for every zone; Escape restores the rect
  (asserted on state, no weak waits). *Accept:* every D2 gesture works
  without a mouse.
- **P3 — Data window.** `data` hosts `WorksheetPane`. It follows the focused
  plot, with a pin and the follow-Library setting; selection is linked both
  ways; the "Plot | Data side by side" button. *Tests:* follow, pin and
  Library modes; selection ↔ rows; a removed dataset shows the empty state.
- **P4 — Analysis window + tool windows.** The guide (detection with
  confidence and candidates, override saved on the dataset, step status
  from the result lifecycle, reopen, next-step highlight); the searchable
  tool list with greyed-out tools and reasons (from the analysis inputs
  resolver). Tools open as `tool:*` layout windows (default bottom, or their
  remembered slot); `ToolWindow` renders through the layout frame in windows
  mode. *Tests:* step state transitions, the greyed reasons, opening a
  tool, a tool re-docking where it was, toolDock not registering.
- **P5 — Map on the plot + small screens.** Map is a plot type in a plot
  window with its toolbar on the plot; `stageTab` call sites are adapted.
  D6: floating by default, the "tile below width" setting re-arranges as
  long as the width rule holds, and the saved layout is never overwritten.
  *Tests:* map toolbar placement, resize across the threshold (both
  settings), the layout restored after widening.
- **P6 — Remember last layout end to end.** The per-user template is applied
  to new or older projects; fixture-backed restore tests (the project wins
  over the template); "Reset layout" in the Window menu. *Accept:* opening
  each realdata fixture project restores the exact placements.
- **Pn-1 — Default flip** (owner call, in a later release): new users start
  in windows mode, and an existing user's explicit choice is kept.
- **Pn — Remove classic** (one release after that): stage tabs,
  `toolDock.ts`, the side-column CSS and `stageTab` go, and the freed eager
  bytes lower the budget pin.

## Open questions for the owner (ask, don't guess)

1. Should the **Library** also become a window (dockable or floatable), or
   stay a fixed, collapsible left column? The plan assumes a fixed column.
2. Can a tool be open **more than once** (for example, two Curve fit windows
   on different datasets side by side), or is there one window per tool?
   The plan assumes one per tool.
3. Do tool windows **follow the focused plot** the way Data does (with a
   pin), or stay bound to the dataset they were opened on?
4. Is a real **OS-level pop-out** (a separate browser or desktop window for
   a second monitor) still wanted now that windows float inside the app?
5. Should users be able to **save named layouts** (presets such as
   "Fitting", "Review"), or is the remembered last layout enough?
6. Keyboard shortcuts: **F6** for window cycling, `Alt+Shift+M` for move
   mode, and is there a shortcut for the Library collapse and for "Plot |
   Data"?
7. For a multi-dataset analysis (batch, By), should Data show **all of its
   inputs** or only the focused one? (Carried over from 2026-11-22.)
8. Opted-in users' projects are saved as v8, so v0.41 and earlier
   **refuse** them. Is that acceptable during the opt-in period, or should
   opted-in saves omit the layout when compatibility matters (a "save for
   older versions" option)?

## Constraints (unchanged rules)

400 lines per `.tsx` and 500 per module; store, `getState()`, weak-wait and
storage-key ratchets; design tokens only; JetBrains Mono for numbers;
new behaviour is opt-in until the owner flips the default.
