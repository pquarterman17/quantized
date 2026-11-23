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
| D7 | Tool copies | **One window per tool**; reopening a tool focuses its window (multiple copies may come later) |
| D8 | Tool input | Tool windows **follow the focused plot, with a pin**, the same as Data |
| D9 | Library | Stays a **fixed, collapsible left column**, not a window |
| D10 | Older releases | Opted-in projects save as **v8 and older releases refuse them**; acceptable during opt-in, no "save for older versions" option |
| D11 | OS pop-out | Wanted, as a **late phase** after the in-app windows work |
| D12 | Named layouts | Wanted, as a **later phase**; remember-last-layout and Reset layout come first |
| D13 | Shortcuts | The plan's scheme: **F6** cycles windows, **Alt+Shift+M** move/dock mode, **Ctrl+B** Library collapse, **Ctrl+Shift+D** Plot \| Data. Verify each is free in the existing shortcut map first; a clash goes back to the owner |
| D14 | Multi-dataset analyses | Data shows the **focused input with a switcher** between the analysis's inputs |

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
  *Shipped 2026-11-23* (`claude/workspace-layout-p5`): the stage-tab adapter
  (`windowlayout/stageTabAdapter.ts`), the map window (`store/windowLayoutMap.ts`),
  the narrow tile (`lib/windowLayout/narrowTile.ts`, `useNarrowTile`) and the
  Small screens preference; choices in "Provisional decisions (P5)" below.
- **P6 — Remember last layout end to end.** The per-user template is applied
  to new or older projects; fixture-backed restore tests (the project wins
  over the template); "Reset layout" in the Window menu. *Accept:* opening
  each realdata fixture project restores the exact placements.
  *Shipped 2026-11-23* (`claude/workspace-layout-p6`): the template seeds a
  project without a layout (`seedWithTemplate`, `store/windowLayoutRun.ts`
  `seedProjectLayout`) and places a tool the project never placed
  (`toolFirstPlacement`); the template write merges over the last one
  (`mergeTemplate`); Window ▸ "Reset layout…" and ⌘K
  (`lib/windowLayout/reset.ts`, `store/windowLayoutReset.ts`). Tests:
  `store/windowLayoutRestore.test.ts` on the repo's synthetic `.dwk` fixtures
  (v1, v4, the converted Origin fixture, v8 with its own layout); the realdata
  run is `uv run python tools/layout_corpus_run.py`, which converts every corpus
  Origin project to `.dwk` in a temp dir and runs
  `store/windowLayoutRestore.corpus.test.ts` (skipped without it): 344 of 344
  converted projects restored exactly (13 more are refused by the converter).
  No `.dwk` or template format change. Choices in "Provisional decisions (P6)".
- **Pn-1 — Default flip** (owner call, in a later release): new users start
  in windows mode, and an existing user's explicit choice is kept.
- **Pn — Remove classic** (one release after that): stage tabs,
  `toolDock.ts`, the side-column CSS and `stageTab` go, and the freed eager
  bytes lower the budget pin.

## Open questions for the owner (ask, don't guess)

None open. All answered 2026-11-23 (D6–D14).

## Provisional decisions (UX pass 3, 2026-11-23; owner to confirm)

Made fail-closed while fixing the pass 3 findings; each is easy to reverse.

- **Escape never closes a tool window.** From the tool's body it steps back to the window's title
  bar; from the title bar it moves focus to the focused plot and says the tool is still open. The
  Close button closes it. (It used to close the tool and drop the workshop's typed state silently,
  unlike Escape in a field.) Applies to docked and floating tool windows.
- **Below 1280 px a tool never placed opens floating, in front** (D6), instead of at the bottom
  dock. A tool with a saved placement keeps it; a window that would reopen docked under floating
  windows that cover (nearly) all of its slot floats instead.
- **A first-floated Style, Data, Analysis or tool window starts 36 px below the desk top**, so it
  clears a plot window's title bar and its dock and close buttons.
- **Analysis takes 65% of a slot it opens into beside other windows**, and keeps at least half of it
  when Data then opens beside it.
- **"suggested" tool marks only for a known technique** (recorded or chosen); nothing is suggested
  for unidentified data.
- **Plot step with no saved figure** still opens the Quick Figure Builder (it replaces the layout
  host while it is open, as Library tiles do); it now says the windows are kept, and on return
  focus goes to the Analysis window's title bar with an announcement. Embedding the builder in a
  window is left for a later phase.

## Provisional decisions (P5, 2026-11-23; owner to confirm)

Made fail-closed while building P5 (map on the plot, small screens); each is easy to reverse.

- **A Map request opens a separate map window**, the existing `kind: "map"` document window (MapStage
  with the Map toolbar inside the window, on the plot), rather than turning the focused XY plot window
  into a map. One map window per dataset: a second request brings it forward (restoring a minimized
  one). A map request for another map dataset opens another window; nothing is retargeted, the same as
  classic's rule that Library clicks never retarget a document window (so browsing many maps opens many
  windows, and the user closes them).
- **Where a new map window goes:** docked in the centre beside the plot at 1280 px and over, floating in
  front under 1280 px (D6), the same as a tool's first placement.
- **A Map request for data that cannot be drawn as a map** (classic's own `canRenderMap` rule) opens
  nothing; the status line and the live region say why (classic silently stays on Plot).
- **The 2-D map card (gridding, contours) shows in the Style window while a map window is open** in
  windows mode, beside the plot cards; classic shows it only on the Map tab, as before.
- **"Tile below a width" setting:** a per-user preference (`qz.prefs` `layoutTileBelow`, px; 0 = keep
  floating, the default), not saved with the project. Preferences ▸ Interaction ▸ Small screens, shown
  only in windows mode; turning it on starts at 1280 px, range 600 to 3,840. The width is the browser
  window's (`innerWidth`), as the existing 1280 px rule uses. Stored as a number rather than the
  plan's `"float" | { tileBelow }` shape (one sanitizer line, eager bytes).
- **What tiles:** every window on screen, Style included (unlike the Tile all button), so nothing
  floats over the grid on a narrow screen. A window opened while narrow joins the grid; a window the
  user moves while narrow stays where they put it.
- **What widening gives back:** the user's saved arrangement exactly (slots, order, shares, edge sizes,
  centre mode, floating stack). Rearrangements made while narrow are dropped. What is content rather
  than arrangement is kept: windows opened or closed while narrow stay open or closed (at their saved
  place), plot windows closed while narrow stay gone, and the Data / Analysis / tool pins and the Data
  follow setting are kept. A save or the per-user template while narrow writes the saved layout, never
  the tile (the tile lives only in the session, `WindowLayoutV1.tiled`, which no file carries).
- **Known wart:** tiling or untiling changes `windowLayout`, so it marks the project dirty (as any
  window move does), although the saved content is unchanged.

## Provisional decisions (UX pass 4, 2026-11-23; owner to confirm)

Made fail-closed while fixing the pass 4 findings (M1 to M5, most minors); each is easy to reverse.

- **A map tool (Analysis "ROI cuts") opens the active dataset's map window first**, without taking focus (the tool takes it).
- **The Window menu's "Open map in window" goes through the Map request adapter in windows mode**: one window per dataset, a refusal for a non-map. Classic still opens a document window directly.
- **The Style window's 2-D map card follows the front-most map window's dataset** (else the active dataset's own map window) and is titled with its name.
- **A map window under 560 px wide or 360 px high (`useCompactStage.ts`) collapses its toolbar to one "Map tools" button**; the full toolbar opens over the map and closes on Escape or an outside press. Classic keeps the inline toolbar.
- **A window that starts floating under a floating tool window is moved beside it** (never made worse when no band is wide enough); a window the user drops by hand, and the windows present at restore, are never moved.
- **Small screens width:** an out-of-range number is kept out of the pref and said (range 600 to 3,840, the width still in force), never snapped back silently. The hint says the setting is per user, not saved with the project.
- **Closing a window announces its title, not its id, and focus moves to the window in front. A restore replaying a map request opens the window silently.** Ctrl+Shift+W closes a map window the keyboard is in. The "pinned while it runs" status line is cleared when the run ends. Floating plot windows get 24 px title-bar targets (classic frame untouched).
- **The Map tools menu commits a typed colour limit when it closes** (an outside press or the 3-D button blurs the field first); Escape reverts it, as in the field.
- **"Open map in window" while the layout host is off screen** (Library tiles, Quick Figure Builder) opens the document window directly, as classic does, rather than setting a stage tab nobody hears. The classic 2-D map card shows only in classic mode; windows mode has the one MapStyleCard.
- **A window that returns floating when a narrow-screen tile ends is never moved aside from Style** (only windows opened or floated while untiled are).
- **A docked map window's title bar shows the same "map" chip the floating frame has.**

Left open (owner call or larger change):

- **m-1** Library activate of a map dataset rebinds the focused plot window (draws the columns as lines). That is the shared `setActive` rebind rule, the same in classic; changing it for windows mode only needs an owner decision on what a map click should do to a plot.
- **m-4 (floating)** the floating title still truncates a long name before the chip (the chip is kept; the name carries a tooltip).
- **m-8** "Float all" while tiled can leave floats overlapping, and the layout-back sentence names the rule but does not offer an undo.
- **Style card scope:** the card is titled with its map's name, but only its colour limits are per dataset; grid method, resolution and the contour settings are the store's global map settings, shared by every map window. Keying them per dataset is a data-model change for the owner.
- **Screen-reader chatter:** the Small screens width field announces its range message on each out-of-range keystroke (a partial entry such as "1" on the way to 1920). Announcing on blur only would change the pass 4 tests that assert the message on change; owner to confirm.
- **Focus after a restore:** the close-refocus in `LayoutAnnouncer` fires for any open window that drops out (a project load, a tile end), not only a user close; it only acts when focus is on `<body>`.
- **Polish:** the 3-D popover over Style, the H-cut label versus status wording, duplicated colour limits (kept in sync on purpose), the 1280 px threshold equalling the default tile width, the toast over Style, and the tiled desk giving the plot no more room.

## Provisional decisions (P6, 2026-11-23; owner to confirm)

Made fail-closed while building P6 (remember the last layout, Reset layout); each is easy to reverse.

- **When the template applies:** only where the project has no layout of its own: a new project
  (startup, Remove all), an import, a file from before the window layout, a layout the reader refused,
  and Open without layout. A project with a saved layout always opens with exactly that layout; the
  template is never mixed into it.
- **A tool the project never placed opens where the template keeps tools** (the first open tool's slot in
  the last layout), in any project; a tool the project placed keeps its own place. Under 1280 px a
  never-placed tool still floats in front (D6, UX pass 3 B2), whatever the template says.
- **The template applies at every width.** D6's floating default is the seed when there is no template.
  (Superseded in part by UX pass 5 below: it is still READ at every width, but a session under 1280 px
  never WRITES it, which is what stops a small window overwriting a wide desk.)
- **The template remembers each kind's last place:** a write merges over the previous template, so a
  kind with no window in the new layout (no tool open after a restart, no plot window) keeps where it
  was. The stored format is unchanged (`qz.windowLayout` v1).
- **The first plot** the template's plot rule moves is the focused plot window; other plot windows keep
  the seed's place.
- **Reset layout asks for confirmation** ("Reset the window layout?", Reset layout / Cancel) instead of
  being an undo step: layout changes are never undo steps (plan "Store slice and ratchets"), and a
  one-off undo entry for the layout would break that rule. It is in the Window menu (Arrange) and ⌘K,
  only while windows mode is on.
- **What Reset keeps:** it resets the arrangement to the default seed for the current width (the D6
  floating seed under 1280 px), never the template. Open windows stay open (Data, Analysis, Style, the
  tool windows of open tools) at their default places; closed ones stay closed. The Data follow setting
  and the Data / Analysis / tool pins are kept (a closed, pinned tool keeps a closed placement at its
  default so its pin is still saved). Float rects (plot-window geometry, tool rects) are kept. A
  narrow-screen tile is dropped (the width rule tiles the reset desk again while it holds).
- **Reset replaces the template outright** with the reset desk's shape (no merge), so the next new
  project opens with the default desk and a tool opens at the default bottom again. The confirmation
  says so. (On a wide, untiled desk only; see UX pass 5.)
- **A workspace replaced while the Reset question is open** (opened, restored, Remove all) is not reset:
  the user confirmed resetting the desk they were looking at.

## Provisional decisions (UX pass 5, 2026-11-23; owner to confirm)

Made fail-closed while fixing the pass 5 findings; each is easy to reverse.

- **M1, Reset puts plot windows where a new project's go.** At 1280 px and over, every plot window the
  seed leaves floating (the seed keeps a lone, unmaximized plot where classic had it) docks to the centre:
  the first at the head, the rest tiled beside it in a row, in the order the user's desk showed them. A
  plot the seed already docks (two or more visible plots gather in a grid) stays as the seed has it. Under
  1280 px the seed still floats everything (D6). Reset no longer leaves a floating plot, so the template
  never records `plot: float` from a reset.
- **M2, a narrow session never overwrites the remembered desk (fail-safe option).** The per-user template is
  not written while `innerWidth` is under 1280 px (`canRememberDesk`). That covers D6-forced tool floats, a
  first-ever narrow session (no template is written at all, so the next wide session still gets the plain
  seed), Float all and every other edit made while narrow, and Reset. The template is still READ at every
  width. Cost: a user who really lives on a small window has no remembered desk; the owner may prefer a
  per-width-class template (a `narrow` and a `wide` one) instead, which needs a stored-format addition.
  Reset while the windows are tiled by the width rule (Small screens setting) also leaves the template
  alone, at any width. The Reset question says which applies: the normal sentence promises new projects
  open that way; under 1280 px it says "too narrow to change the desk new projects open with: that stays
  as it was"; while tiled it says the tile is why.
- **m4, the template follows user layout edits only.** A layout the host writes to keep the project in step
  is never remembered: the reconcile after a project opens or a plot window appears or goes
  (`useLayoutSync`), a tool's first placement, closing a tool's window when it unmounts, dropping an
  unknown tool, the narrow-screen tile, and the map window's small-screen float. Opening saved project A
  therefore never makes A the template (project open, restore and reopen set the layout without a write; the
  reconcile that follows is marked). Mechanism: `applyLayout(op, remember = false)` marks the written layout
  object (`markNotRemembered`, a WeakSet in `lib/windowLayout/template.ts`) and the lazy writer skips it.
  Not covered: the Data-follow switch in Preferences writes the layout directly, so it still remembers the
  current layout's shape (it is a user edit of the layout, and changing it would put code in the eager Prefs
  chunk).
- **m3, "Open without layout..." copy in windows mode** says the project opens in one default window, arranged
  like the user's last desk (the template lays out a project with no layout of its own). Classic keeps its
  sentence.
- **m5, the reset is said once, by the status line** (a live region). The layout's own live region is held
  silent for the reset (`holdAnnouncement("")`), so the screen reader hears one sentence, not two.
- **m1, Cancel and Escape on the Reset question** hand focus to the focused plot window's title bar (the
  opener, a menu item or the palette, is gone). The shared confirm dialog is untouched.
- **m2, arrow keys inside a submenu** rove within it (Up, Down, Home, End, type-ahead): they used to bubble to
  the parent list's handler and move focus back to the parent. A confined fix in `ContextMenu.tsx`
  (submenus stop the propagation of their own roving keys); the root list is unchanged.
- **Polish:** a menu flyout over its parent list is opaque (`--surface-1`), so the parent's labels no longer
  show through the glass.
- **Declined, aria-modal on the confirm dialog.** `ConfirmDialogBody.tsx` leaves `aria-modal` out on purpose
  (R12: it hides the app's live regions for as long as the dialog is open; modality is the background
  `inert`), and `architecture.test.ts` keeps the attribute out. The Reset question uses that shared dialog.
  Owner call if the trade-off should change for every confirm.
- **Left alone:** the Style card's control sizes (outside this scope), the three 255 px right-column panes
  and the cramped plot at 1024 px after a Reset (layout defaults, not a defect of this pass).

## Constraints (unchanged rules)

400 lines per `.tsx` and 500 per module; store, `getState()`, weak-wait and
storage-key ratchets; design tokens only; JetBrains Mono for numbers;
new behaviour is opt-in until the owner flips the default.
