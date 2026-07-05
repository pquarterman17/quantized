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

`spec.example.json` is corpus-free and committed. To verify against real Origin
data, generate a local `spec.json` from `../../../test-data` (gitignored, never
committed — see `.gitignore`); `shoot.mjs` prefers it automatically.

## Reference comparison (optional)

For side-by-side fidelity vs Origin itself, export the same graph from Origin
via COM (`expGraph type:=png`) and diff against the harness PNG. COM is
Windows + installed-Origin only; keep it out of CI.
