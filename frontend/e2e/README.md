# Playwright interaction-journey harness

`GUI_INTERACTION_PLAN.md` #15 — "real-browser interaction coverage". jsdom
(what `npm test` runs under) cannot validate canvas hit targets, native
pointer capture, real HTML5 drag/drop, or high-DPI (`deviceScaleFactor`)
rendering. This suite drives the same journeys through a **real headless
Chromium** against a **real FastAPI backend** serving the **built SPA** —
exactly how a user runs `qz`.

## Running it

```bash
# 1. Build the SPA once (or after any src change) — this is what the
#    backend serves; the suite does NOT build for you.
npm run build

# 2. Run the suite (installs its own webServer — see below).
npm run e2e
```

First time only: install the Chromium binary Playwright drives —
`npx playwright install chromium` (already done if you ran the setup that
added `@playwright/test`).

## How the server comes up

`e2e/playwright.config.ts`'s `webServer` runs

```
uv run qz --no-browser --port 8934
```

with `cwd` set to the repo root (where `pyproject.toml` lives), and waits
for `http://127.0.0.1:8934/api/health` before starting tests. Port 8934 is
dedicated to this suite — distinct from `qz`'s default `:8000` and
`qz --dev`'s `:5173` Vite proxy target — so a developer's already-running
instance is never disturbed. `--no-browser` also means the server's
`QZ_AUTO_SHUTDOWN` app-lifecycle flag never arms (see
`src/quantized/cli.py`'s `_serve`), so it doesn't self-terminate as
Playwright's browser contexts open/close their `/api/ws` presence sockets
between tests.

Locally the config reuses an already-running server on that port
(`reuseExistingServer: true` outside CI) so repeat runs are fast; in CI it
always starts fresh.

## Layout

```
e2e/
  playwright.config.ts   # webServer, projects (zoom matrix), reporters
  fixtures/               # synthetic CSVs ONLY — never ../test-data
  utils/
    harness.ts            # gotoApp() (?harness seam), waitForDatasetCount()
    dnd.ts                 # real OS-style file drag-and-drop helper
    fixtures.ts             # fixturePath() resolver
  specs/                  # one spec file per journey
```

### The `?harness` seam

`gotoApp()` always navigates to `/?harness` — the same query-param seam
`tools/visual`'s headless-Chrome harness uses (see `frontend/src/main.tsx`)
— which exposes `window.__qz.useApp` (the live Zustand store). Specs read
plain-data store fields through it for assertions a DOM query can't reach
cleanly ("did the series style actually change", not just "did some pixel
change"). It is gated on the query param, so it's inert in normal use.

### Fixtures are synthetic, always

`e2e/fixtures/*.csv` are small hand-written files the generic delimited-
table parser accepts. This suite never references the `../test-data`
instrument corpus — it exists precisely so the suite needs no private data
and runs the same everywhere.

## Zoom matrix (Windows-scaling parity)

Three Playwright projects at `deviceScaleFactor` 1.0 / 1.25 / 2.0
(`chromium-100` / `chromium-125` / `chromium-200`), the plan's "100/125/
200% Windows-scaling matrix". Running every spec at every scale would
triple an already browser-heavy suite for marginal extra coverage, so:

- **`chromium-100`** runs every spec (the full suite).
- **`chromium-125`** / **`chromium-200`** run only specs/tests tagged
  `@core` — the ones that directly exercise canvas hit-testing, pointer
  capture, or native drag-and-drop (import-drop, folder-organize,
  curve-restyle, region-tool-escape, channel-axis-drag,
  annotation-shape-lifecycle): the exact gaps jsdom leaves uncovered and
  the ones most likely to regress under a DPI change. Axis editing, the
  Graph Builder, the keyboard-only journey, the export round trip, and
  window arrange/tile/cascade are plain DOM form/keyboard/pointer-on-chrome
  interactions — not DPI-sensitive (no canvas hit-testing involved) — so
  they run at the 100% baseline only.

Run one project directly: `npx playwright test --project=chromium-125`.

## Journeys shipped

| # | Spec | Tag |
|---|------|-----|
| a | `import-drop.spec.ts` — drop a synthetic CSV, dataset appears + auto-plots | `@core` |
| b | `folder-organize.spec.ts` — create/nest/reorder folders via grip-handle drag, 3-zone drop; drag a dataset into a folder | `@core` |
| c | `curve-restyle.spec.ts` — right-click the plotted curve, change colour + marker via the context menu | `@core` |
| d | `axis-title-limits.spec.ts` — edit an axis label, set explicit numeric limits | 100% only |
| e | `graph-builder.spec.ts` — build a graph, Save As a named PlotSpec, reopen it | 100% only |
| f | `region-tool-escape.spec.ts` — arm Integrate, drag, Esc cancels the gesture (tool stays armed); Esc with no drag reverts to Pointer | `@core` |
| g | `keyboard-only.spec.ts` — import via the Command Palette, Shift+F10 opens a row's context menu, Enter activates an action — no mouse | 100% only |
| h | `export-roundtrip.spec.ts` — Graph Builder → Figure Builder preview → real matplotlib PDF/SVG/PNG download → saved FigureDoc reopen → identical request | 100% only |
| i | `channel-axis-drag.spec.ts` — drag a channel chip from the Channels card onto the plot's X/Y/Y2 axis bands, re-plotting it through the same store actions the card's own checkboxes use | `@core` |
| j | `annotation-shape-lifecycle.spec.ts` — annotation create/edit-text/move/delete (right-click menu AND the selection mini-toolbar); shape draw/Dashed-toggle/delete — no undo coverage (gated on #1) | `@core` |
| k | `window-arrange.spec.ts` — New Graph Window ×2, Tile Windows (non-overlapping grid), Cascade Windows (staggered offsets), maximize/restore via title-bar double-click, close via the title bar's own right-click menu | 100% only |

## Residuals (booked, not shipped here)

See `plans/GUI_INTERACTION_PLAN.md` #15 for the dated progress note. Only
remaining open sub-item: undo/redo of a folder reorganize (gated on the
separate #1 owner decision — annotation/shape undo is the same gate).

## Notes for CI / non-interactive runs

- `forbidOnly`/`retries`/`workers` are `CI`-env-gated in the config
  (matches the Playwright default template).
- `trace`/`screenshot`/`video` are all `retain-on-failure` /
  `only-on-failure` — a green run produces no artifacts.
- The suite is READ-ONLY against the backend beyond ordinary app usage
  (file imports through the real `/api/parsers/...` upload path); nothing
  here needs cleanup between runs — the app's persistence
  (`localStorage`-based autosave) is scoped to each test's own fresh
  browser context, never shared across tests or workers.
