# Quantized — Frontend

React 19 + TypeScript + Vite + Zustand + uPlot. The Analysis Workbench UI for
the `quantized` backend, realised against the Claude Design "Quantized Design
System" (vendored under `src/styles/` + `src/assets/`; source in
`../plans/design/`). Shares its visual language with the sibling **fermiviewer**.

## Develop

Two processes — backend (FastAPI) + Vite dev server:

```bash
# terminal 1 — backend on :8000
cd ..            # repo root
uv run uvicorn quantized.app:app --reload --port 8000

# terminal 2 — Vite dev server on :5173 (proxies /api → :8000)
cd frontend
npm install      # first time
npm run dev
```

Open http://localhost:5173. The UI also runs **offline** (no backend): use
*Library → ✚ Add demo dataset* — the Stage falls back to client-side column
packing and the status bar reads "offline — demo mode".

## Build (served by the backend)

```bash
npm run build    # emits to ../src/quantized/web/ (gitignored)
```

`quantized.app` mounts that dir at `/` when present, so `uv run uvicorn
quantized.app:app` then serves the SPA same-origin (no proxy needed).

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest
npm run lint        # eslint
```

## Layout

```
src/
  main.tsx · App.tsx          shell entry + qzk-app grid
  styles/                     vendored design tokens + qzk-* shell chrome
  components/
    Shell/                    TitleBar · MenuBar · StatusBar
    Library/                  dataset list + Sparkline
    Stage/                    PlotStage (uPlot) · Stage tabs · Worksheet
    Inspector/                stacked Cards (metadata · corrections · axes · appearance)
    primitives/               qz-* design-system components (Button, Card, …)
  lib/                        api · types · plotdata · uplotOpts · demo
  store/                      useApp (Zustand)
```

Conventions (per `../CLAUDE.md`): ~400-line `.tsx` ceiling (heavy features →
`workshops/`), Unicode-glyph icons (never emoji), cursors `default`, all numbers
in JetBrains Mono. Tokens are the single styling source — read CSS custom
properties, don't hardcode colors.
