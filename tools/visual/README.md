# Visual verification harness

Screenshots the **real uPlot canvas** of the Boson Plotter plot. The frontend
unit tests run in jsdom, which has no canvas — so the on-screen plot is the one
crown-jewel surface with no automated check. This harness closes that gap: it
serves the built SPA, drives it in the installed Chrome via `puppeteer-core`,
injects a dataset + plot state through the `?harness` store seam (see
`frontend/src/main.tsx`), waits for uPlot to draw, and writes a PNG per shot.

It found a real production bug on its first run — every imported Origin dataset
plotted truncated because uPlot reads the last x value as the axis max and
Origin worksheets carry trailing `null` x (allocated-but-unfilled rows). Fix:
`dropTrailingNullX` in `frontend/src/lib/plotdata.ts`; regression repro is the
`trailing_null_x_repro` shot in `spec.example.json`.

## Run

```bash
cd frontend && npm run build        # produce the SPA the harness serves
cd ../tools/visual && npm install   # one-time; puppeteer-core, no browser download
npm run shoot                       # -> out/*.png  (uses spec.json if present, else spec.example.json)
```

Needs Google Chrome installed (auto-detected; override with `QZ_CHROME=<path>`).
No backend required — the plot's offline column-packing fallback renders locally.

## Specs

A spec is `{ "shots": [ { name, dataset, stageTab?, state? } ] }`:
- `dataset` — `{ id, name, data: { time, values, labels, units, metadata } }`
  (non-finite → `null`; the app's `addDataset` action is used so per-dataset
  view state initializes exactly as in the real UI).
- `state` — plot-state overrides applied after load (`yKeys`, `y2Keys`,
  `xLim`, `plotTitle`, …).
- `stageTab` — `plot` (default) | `map` | `worksheet`.

### MDI (multi-window) shots

A shot may instead describe a whole window layout (MULTI_PLOT_PLAN item 16):

```json
{ "name": "mdi_tile_2x2",
  "datasets": [ { "id": "a", "name": "Sine", "data": { … } }, … ],
  "windows": [
    { "dataset": 0,
      "view": { "yKeys": [0], "plotTitle": "Sine" },
      "geometry": { "x": 8, "y": 8, "w": 483, "h": 317 },
      "winState": "normal",
      "title": "…" },
    …
  ],
  "focusedIndex": 0,
  "state": { "leftCollapsed": true, "rightCollapsed": true } }
```

- `datasets` — shot-level list, same shape as a single-window shot's
  `dataset`; each window binds one by index (two windows may share an index).
- `windows[]` — per window: `dataset` (index), optional partial `view` (the
  same vocabulary as `state` — merged over a fresh `defaultPlotView()`),
  optional `geometry` `{x,y,w,h}` in canvas px, optional `winState`
  (`normal` default | `minimized` — docks into the bottom window strip |
  `maximized`), optional `title` (defaults to the dataset name).
- `focusedIndex` — which window is focused (default: the last non-minimized
  one). The focused window renders the full interactive `PlotStage` with the
  `--accent` title highlight; the others render background viewports.
- `state` — optional overrides applied after the layout (e.g. collapse the
  Library/Inspector panels for more canvas room, as above).

The layout is built through the REAL store actions (`addDataset` →
`createWindow` → `moveWindow`/`resizeWindow` → `focusWindow` →
`minimizeWindow`/`toggleMaximizeWindow`) via the `main.tsx` seam helper —
never raw `setState` window records — and the harness waits for EVERY visible
window's uPlot canvas to draw before screenshotting. The default screenshot
target for MDI shots is `.qzk-wincanvas` (frames + window strip). Existing
single-window shots are unaffected (`mdi_tile_2x2`, `mdi_overlap_focus`, and
`mdi_minimized_strip` in `spec.example.json` are the committed examples).

`spec.example.json` is corpus-free and committed. To verify against real Origin
data, generate a local `spec.json` from `../../../test-data` (gitignored, never
committed — see `.gitignore`); `shoot.mjs` prefers it automatically.

## Reference comparison (optional)

For side-by-side fidelity vs Origin itself, export the same graph from Origin
via COM (`expGraph type:=png`) and diff against the harness PNG. COM is
Windows + installed-Origin only; keep it out of CI.

## Origin<->quantized figure comparison campaign (plan item #39)

Two more scripts turn "export every corpus graph as PNG via COM" into a
side-by-side gallery against quantized's own render:

```bash
cd frontend && npm run build       # build the SPA (served by qz itself below)
cd ../tools/visual && npm install  # one-time; puppeteer-core

# 1. Import the project through the REAL backend once, replay the Library's
#    "click a figure" flow (addOriginFigures + applyOriginFigure) for every
#    decoded graph window, screenshot each, and write a structural report.
node origin_figures.mjs --opj "<path>/PNR.opj" --project PNR

# 2. Pair those screenshots against the COM oracle's manifest.json + PNGs
#    (see ../../../test-data/origin/_exports/<project>/, produced separately
#    by a COM export script) into one static HTML gallery.
node gallery.mjs --project PNR

# 3. Mark each visual category in gallery.html, download review.json into
#    that project's _exports/<project>/ directory, then aggregate every
#    available project into one durable JSON/CSV row per graph.
node acceptance_matrix.mjs
# or select a controlled subset:
node acceptance_matrix.mjs --projects Moke,PNR,RockingCurve
```

The per-project scripts default to `<test-data>/origin/_exports/<project>/`, found by
walking up from this directory for a `test-data` sibling (works from a plain
checkout or a nested `.claude/worktrees/` agent) — override with
`--exports-root <dir>` or `QZ_TEST_DATA_ROOT=<path to test-data>`.
For `acceptance_matrix.mjs`, `--exports-root` names the shared `_exports`
directory instead; its default corpus discovery is otherwise identical.

`origin_figures.mjs` starts its own `uv run qz --no-browser` backend (default
port 8793, override with `--port`) to parse the project — the SAME process
also serves the just-built SPA, so no separate static server is needed — and
kills the whole process tree on exit. It uploads via `/api/parsers/upload`
(the OneDrive-dehydrated-file-immune path — never the path-based `/import`),
then drives the store directly through the `?harness` seam, exactly mirroring
`useApp.importFiles`'s real book-naming + `addOriginFigures` call. Multi-layer
graph windows (double-Y pairs, spatial multi-panel figures) are applied ONCE
per graph-window family — clicking any one row applies the whole family, so
screenshotting every layer separately would just duplicate shots.

Output (gitignored, in `_exports/<project>/`, never committed):
- `quantized/<ShortName>.png` — one screenshot per graph window, keyed by the
  SAME short name the COM oracle manifest uses (`figure.name`, the Origin
  window's own object name), so pairing is a plain key match.
- `quantized_manifest.json` — pairing metadata (folder path, resolved
  book/dataset, single/doubleY/multiPanel mode).
- `structural_report.json` — per-figure pass/fail comparing the decoded
  figure record (axis range, log flag, tick step) against the store state
  `applyOriginFigure` actually produced. This is a "first cut": it mostly
  validates apply-ROUTING (right axis, right panel, no stale cross-figure
  leakage), not deep rendering fidelity — mismatches are data for the gap
  register, not CI failures. Log checks derive from the current typed
  `xScale`/`yScale`/`y2Scale` fields; legacy `xLog` store fields do not exist.
  Browser exceptions are attributed to the graph being applied, deduplicated,
  recorded in both manifests, and make that graph structurally fail even when
  its axis/panel checks happen to pass.
- `gallery.html` — Origin PNG | quantized PNG side by side per figure, a
  structural-pass badge, and 7 clickable eyeball-checklist chips (scales /
  ticks / legend / colours / markers / annotations / panels) that cycle
  neutral -> ok -> mismatch and persist to `localStorage` (per project, so
  re-running the generator doesn't lose marks). Unpaired figures (Origin PNG
  with no quantized match, quantized render with no Origin PNG, or an Origin
  export that never finished) get their own sections at the end.
- `review.json` — an explicit export of the gallery's visual-review marks.
  The gallery can import it again; keeping it beside the generated manifests
  makes review state durable without committing private graph information.
- `_exports/acceptance_matrix.json` and `.csv` — corpus-wide rows joining
  source books/curve bindings, layout, preview and fidelity omissions,
  structural failures, screenshot pairing, and exported review status. Missing
  artifacts remain explicit (`missing`, `unreported`, or `unreviewed`).
