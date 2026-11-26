# Undock / resize audit (lane `undock-resize`)

**Owner report:** "When in the new mode, if data is undocked, you can't resize that window."
**Baseline:** `origin/main` cf38baf0 (v0.45.0). Checked live (Playwright, Chromium) at 1440x900 dark and 1024x700 light, in both layout modes.
All choices below are provisional, owner to confirm.

## Root cause

"The new mode" is the window layout (Preferences / Window layout, `layoutMode: "windows"`). Its undocked Data window is a classic `ToolWindowFrame` at the `toolWindowLayout["data"]` rect (`FloatLayer.tsx`). That frame had:

1. one 14 px bottom-right grip (`ToolWindowResizeGrip.tsx`), no edge or other corner handles, unlike plot windows (8 handles);
2. an unclamped resize: the stored height/width grew with the pointer while shell.css caps the rendered frame at `100% - top - 32px`. After one drag past the cap the stored height was larger than the screen (measured 817 px at 1440x900, 717-817 at 1024x700), so the next drags up or in changed nothing visible (dead zone), and the oversize was persisted.
3. a minimum width (200) narrower than the layout title bar (dock buttons, Close, help, collapse overflowed the frame).

## Fix (reuses the existing frame and grip, no new resize system)

- `lib/toolwindow.ts`: `resizeToolWindow` (all 8 edges, min size, viewport clamp, fixed opposite edge), `clampToolWindowSize`, `WINDOW_BOTTOM_GAP`.
- `ToolWindowResizeGrip.tsx`: 8 handles (SE keeps the visible grip); `ToolWindowFrame.tsx`: size clamp on mount, viewport resize, drag end and keyboard resize.
- `shell.css`, `windowlayout.css`: invisible edge strips; min-width 280 px for floating layout windows (340 px for Data) read as the resize floor.
- Persistence is the existing `toolWindowLayout` (saved in the project and the session).
- Tests: `lib/toolwindow.test.ts`, `components/overlays/ToolWindowResize.test.tsx`, `e2e/specs/undock-resize.spec.ts` (Data window, both viewports).

## Sweep

Result key: OK = works; FIXED = fixed here; OPEN = documented, not fixed. "Persist" = geometry survives close/reopen and reload.

| Surface (mode) | Resize | Move | Persist | Off-screen / oversize | Small size scrolls | Maximize | Result / where |
|---|---|---|---|---|---|---|---|
| Data, floating (windows) | FIXED (was SE only) | OK | OK (after fix, no oversize stored) | FIXED (stored size clamped; was 817 px) | OK, body `overflow-y:auto` (shell.css .qzk-win-body) | none offered | `FloatLayer.tsx:136-160`, `ToolWindowResizeGrip.tsx` |
| Style, floating (windows) | FIXED | OK | OK | FIXED | OK | none offered | same frame |
| Analysis, floating (windows) | FIXED | OK | OK | FIXED | OK | none offered | same frame |
| Tool windows floated (windows; `FloatingTool.tsx`) | FIXED | OK | OK | FIXED | OK | none offered | same frame |
| Docked tool floated by Float / drag out (classic, `toolDock.ts`, 340 px dock policy) | FIXED | OK | OK | FIXED; thresholds unchanged | OK | none offered | `ToolWindowFrame.tsx`, `useToolWindowDock.ts` |
| Result windows, reports, 66 other workshops (`<ToolWindow>`) | FIXED | OK | OK | FIXED | OK | none offered | `ResultsWindow.tsx:41` uses the same frame |
| Plot window floating (both modes) | OK, all 8 edges | OK | OK (reload keeps rect) | OK for position (40 px margin keeps the title bar reachable, `plotWindows.ts:278`); size not clamped, OPEN-minor | OK | OK (button; restores) | `PlotWindowFrame.tsx:281` |
| Library panel | OK, splitter | n/a docked | OK | OK | OK | n/a | not floatable (rail collapse only) |
| Inspector (classic) / docked windows (windows) | OK, splitters (`LayoutHost.tsx:118`, keyboard via `Splitter.tsx`) | OK via title drag / dock buttons | OK | OK (edges clamped, `layoutGeometry.ts`) | OK | n/a | |
| Preferences and other modals | fixed size by design | n/a | n/a | OK (`.qzk-prefs` width `min(640px,94vw)`, max-height 80vh) | OK (pane scrolls) | n/a | `shell.css:137-147` |

## Open (documented, not fixed)

- A window dragged low is squashed visually to 120 px by the CSS cap while its stored height stays (it springs back when moved up). Design-level: keep (no data loss).
- Keyboard resize (Shift+arrows on the title bar) uses the 200 px floor, not the 280/340 px layout floor, so the last 80-140 px of a keyboard shrink only clips the title bar's buttons. Minor.
- A north-edge drag above the desk top is pushed back down by `FloatLayer` (window shifts instead of clamping at the desk top). Minor.
- Plot windows: a stored size larger than the viewport is not clamped on restore (position only). Minor.
- No maximize/restore for tool windows (collapse only); a design question, not a defect.
- The edge handles have no visible affordance except the cursor; the SE grip stays the visible one.
