# Quantized UI — Analysis Workbench (first slice)

Implementation plan for the React/TypeScript frontend (PORT_PLAN W7), starting
from the Claude Design "Quantized Design System" handoff. This plan builds the
**foundation** (scaffold + vendored design tokens + `qz-*` primitives + app
shell) and the **first working feature: the Analysis Workbench shell with a live
uPlot plot** wired to the existing FastAPI backend. Later tiers add the
DataWorkspace worksheet, fitting workshops, and DiraCulator. Design references
live in `plans/design/` (copied from the handoff kit); the authoritative spec is
`plans/design/DESIGN_HANDOFF.md` + `DESIGN_GUIDE.md`.

**Status:** Active
**Created:** 2026-06-21
**Updated:** 2026-06-21

---

## Context

### How the pieces fit together
The `quantized` repo currently ships **backend only** (`src/quantized/` —
parsers, calc, FastAPI routes; 254 golden-tested). There is **no frontend yet**.
This plan adds a `frontend/` React app that talks to the backend over HTTP.

- **Design source of truth:** `plans/design/` — `DESIGN_HANDOFF.md` (mock→real
  mapping + worksheet spec), `DESIGN_GUIDE.md` (voice, color, type, density,
  iconography rules), `WORKBENCH_KIT.md` (screen inventory), `tokens/*.css`
  (the 122 design tokens + `qz-*` class layer), `components/*.prompt.md`
  (primitive usage specs).
- **Structural/visual reference (reuse):** `../fermiviewer/frontend/src/` —
  `App.tsx` grid, `components/Shell/*` (TitleBar/MenuBar/StatusBar),
  `components/Inspector/Card.tsx`, `theme.css` / `theme-web.css`, `store/`
  (Zustand conventions). The design tokens were lifted verbatim from
  fermiviewer's theme, so code ports between the two apps.
- **Backend contract (already live):**
  - `GET  /api/health` → `{status}`
  - `POST /api/parsers/import` → DataStruct JSON (import a file)
  - `POST /api/plot/series` → plot series (DataStruct → `calc/plotting.build_series`)
  - Server: `uvicorn quantized.app:app` on `127.0.0.1:8000` (`qz` CLI).
- **Stack (settled, per handoff + PORT_PLAN W7):** Vite + React 19 + TypeScript +
  Zustand + uPlot (interactive 1-D); Canvas2D for future 2-D maps; server-side
  matplotlib for vector export (later). Apache-2.0 / no-GPL runtime deps.

### Data / control flow
```
file ──▶ POST /api/parsers/import ──▶ DataStruct (time, values, labels, units, metadata)
                                          │  (held in Zustand: datasets[])
                                          ▼
   select dataset ──▶ POST /api/plot/series ──▶ {x, series[{label,color,data}]}
                                          ▼
                              uPlot instance in <Stage> renders
   Inspector edits (corrections/axes) ──▶ (later) POST /api/corrections ──▶ re-plot
```
Dev: Vite dev server proxies `/api/*` to uvicorn (`qz --dev`). Prod: backend
mounts the built SPA via `StaticFiles` and `qz` opens the browser.

### Dependency map
- Item 1 (scaffold) gates everything.
- Items 2 (tokens) + 3 (primitives) are parallel after 1; 3 needs 2.
- Item 4 (shell) needs 2+3. Items 5 (Library), 6 (Stage/uPlot), 7 (Inspector)
  need 4; 6 needs 8 (API client) + 9 (store).
- Item 10 (dev/prod serving) is independent after 1; do early for the live loop.
- Tier 2/3 screens all dock into the Tier-1 shell.

---

## Tier 1 — High Impact

1. **Frontend scaffold** — `frontend/` Vite + React 19 + TS + Zustand + uPlot
   - [ ] `npm create vite@latest frontend -- --template react-ts`; pin React 19
   - [ ] add deps: `zustand`, `uplot`; dev: `vitest`, `@testing-library/react`,
     `eslint` + the design kit's `_adherence.oxlintrc.json` rules as a guide
   - [ ] `vite.config.ts`: dev `server.proxy` `/api` → `http://127.0.0.1:8000`;
     build `outDir` to `src/quantized/web/` (so the backend can serve it)
   - [ ] `tsconfig` strict; ESLint + a `.tsx` ~400-line ceiling note in CLAUDE.md
   - [ ] `index.html` sets `<html data-theme="dark" data-accent="violet" data-density="regular">`

2. **Vendor the design system** — tokens + fonts + global CSS
   - [ ] copy `plans/design/tokens/{colors,typography,spacing,fonts}.css` +
     `styles.css` + `components.css` → `frontend/src/styles/` (the qz-* layer)
   - [ ] vendor JetBrains Mono WOFF2 from the kit `assets/fonts/` →
     `frontend/src/assets/fonts/` (keep `OFL.txt`)
   - [ ] import `styles.css` once in `main.tsx`; verify tokens resolve
   - [ ] `data-theme` / `data-accent` / `data-density` switching wired to a store slice

3. **Port the `qz-*` primitives** — React components reading the CSS custom props
   - [ ] buttons: `Button`, `IconButton`, `SegmentedControl`, `Pill`
   - [ ] forms: `NumberField`, `Select`, `Checkbox`, `Switch`, `SliderRow`
   - [ ] data: `Card` (collapsible `<details>`), `MetaRow`, `Badge`, `StatusDot`,
     `DataTable`
   - [ ] each typed (`.d.ts` specs in the kit are the contract); cursors `default`;
     Unicode glyph icons (no icon font); never emoji
   - [ ] a `components/_primitives/` Storybook-less specimen route for visual QA

4. **App shell** — TitleBar / MenuBar / Stage grid / StatusBar (the `qzk-app` grid)
   - [ ] `App.tsx` CSS-grid shell mirroring fermiviewer `App.tsx` + the kit `shell.css`
   - [ ] `components/Shell/{TitleBar,MenuBar,StatusBar}.tsx` (reuse fermiviewer structure)
   - [ ] three-column layout: Library | Stage | Inspector, with collapse toggles
   - [ ] status copy register per `DESIGN_GUIDE.md` (terse: "backend ready", etc.)

5. **Library panel** — dataset list + import + sparklines
   - [ ] `components/Library/Library.tsx`: dataset rows (name, parser badge, units)
   - [ ] mini sparkline per dataset (tiny uPlot or inline SVG path)
   - [ ] click-to-activate (drives Stage); search/filter field (`⌕`)
   - [ ] import button → file picker → `POST /api/parsers/import` → store

6. **Stage + live uPlot plot** — the hero canvas wired to the backend
   - [ ] `components/Stage/PlotStage.tsx`: uPlot instance reading live CSS tokens
     (dark plot canvas in both themes), series palette `--series-1..8`
   - [ ] fetch `POST /api/plot/series` for the active dataset → uPlot series
   - [ ] axes labels/units from DataStruct; legend; nice ticks; log-Y toggle
   - [ ] tool dock (pan `✥`, box-zoom `⛶`, data cursor `✛`) — amber `--capture`
     when a pick mode is armed
   - [ ] Worksheet tab stub (read-only table placeholder; full build in Tier 2)

7. **Inspector** — stacked `Card` panels (read-only first, wiring later)
   - [ ] `components/Inspector/Inspector.tsx`: one `Card` per concern
   - [ ] Corrections card (offsets/BG/trim/smooth/normalize controls — UI only,
     wire to `/api/corrections` when that route lands)
   - [ ] Axes card (limits, log toggle) driving the uPlot scales
   - [ ] Appearance card (series color, line width, theme/density/accent selects)

8. **API client + types** — typed fetch layer
   - [ ] `lib/api.ts`: `importFile`, `plotSeries`, `health`; NaN/Inf-safe JSON
     (backend maps non-finite → null at the route boundary)
   - [ ] `lib/types.ts`: `DataStruct`, `PlotSeries` matching the backend payloads

9. **Zustand store** — app state
   - [ ] `store/useAppStore.ts`: `datasets[]`, `activeId`, `theme/accent/density`,
     `inspector` slice; mirror fermiviewer `store/` conventions

10. **Dev + prod serving** — close the live loop
    - [ ] `qz --dev`: launch uvicorn + Vite HMR together (CLI flag in `cli.py`)
    - [ ] backend `StaticFiles` mount of the Vite build at `/` (prod); `qz` opens browser
    - [ ] document `make dev` / `npm run dev` in README

---

## Tier 2 — Medium Impact

11. **DataWorkspace Worksheet** — the OriginPro worksheet (handoff NEXT TASK, W5/W7 #43)
    - [ ] multi-sheet tabs; sticky column header (name + role chip + unit); row gutter
    - [ ] range selection + keyboard nav; sortable headers; ≥1 column filter
    - [ ] no-eval formula columns (reuse the dispatch-table approach; computed cells
      tinted/read-only; inline parse errors) — back with a `calc/` formula fn
    - [ ] stats footer (count/mean/std/min/max/median) via `calc/stats`
    - [ ] Inspector "Columns" + "Sort/Filter" cards; spec in `DESIGN_HANDOFF.md`

12. **Import flow polish** — drag-and-drop + column mapper
    - [ ] drag a file onto the Library → import; format auto-detect via registry
    - [ ] CSV/Excel column-mapper dialog (role assignment) when confidence low

13. **Curve-Fit workshop** — first draggable tool window (exercises the fit engine)
    - [ ] `components/workshops/CurveFit/*` (state hook + view + sub-components, <400 lines)
    - [ ] model + background pickers (from `calc/fit_models` catalog); param table
      (value ± error); residual scatter; R²/χ²ᵣ/iter stats
    - [ ] needs backend `/api/fit` route over `calc/fitting.curve_fit` + `autoGuess`

14. **Theme/density/accent + status system** — the rationed-color discipline
    - [ ] live theme (dark/light), accent (violet/teal/ocean/amber/rose), density
      (compact/regular/comfy) via `data-*` attrs; persisted
    - [ ] StatusDot/Badge status vocabulary; armed-capture pulsing banner

15. **Frontend CI + tests** — extend the W0 workflow
    - [ ] vitest component tests for primitives + store; ESLint + tsc gate
    - [ ] add `frontend` job to `.github/workflows/ci.yml` (npm ci, lint, test, build)
    - [ ] component-size ratchet test (~400-line `.tsx` ceiling)

---

## Tier 3 — Nice-to-Have

16. **Hysteresis workshop** — M(H) Hc/Mr/Ms extraction + on-plot markers (over `calc/magnetometry`)

17. **Reflectivity workshop** — stacked R(Q)+SLD subplots + editable layer stack (over `calc/reflectivity`, `calc/sld`)

18. **DiraCulator screen** — calculator nav + Bragg d↔2θ↔Q converter + reflections table

19. **Command palette** — glass floating menu (`--shadow` + `backdrop-filter`); keyboard-driven actions

20. **Vector figure export** — server-side matplotlib (PDF/SVG) export route + Inspector "Export figure…" action

21. **2-D maps** — Canvas2D heatmap stage for XRDML/Rigaku RSM (blocked on the 2D-RSM data-contract decision — see backend port memory)

---

## Completed

_(none yet)_
