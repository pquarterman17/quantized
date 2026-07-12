# quantized

**Plot, analyze, and publish lab data — magnetometry, X-ray/neutron
diffraction & reflectometry, transport — in one fast, reproducible app.**

A clean-architecture Python (FastAPI) + React application, born as a port
of the `quantized_matlab` scientific toolbox and grown into a full
OriginPro-class daily driver. Backend math is **golden-verified** against
the MATLAB original; the GUI is a ground-up revamp.

> **Install:** `pip install quantized-lab` → run `qz`
> (the PyPI name is `quantized-lab`; the package you import and the
> commands you run are plain `quantized` / `qz`)

## What it does

**Import instrument data** — Quantum Design VSM/PPMS/MPMS, Lake Shore VSM,
PANalytical XRDML (1-D scans *and* 2-D reciprocal-space maps with Q-space),
Rigaku, NCNR reflectometry/PNR, refl1d, SIMS, generic CSV/Excel — with
content sniffing for ambiguous extensions, drag-drop, paste, guided import
wizard, and one-click re-import when the source file changes.

**Read and write OriginPro files** — native, clean-room `.opj`/`.opju`
readers recover workbooks, figures (with styles, legends, annotations),
and notes; the `.opj` writer produces projects real Origin loads; plus
Origin-ASCII + `.ogs` scripts, `.otp` template import, and an optional
Windows COM "Send to Origin" bridge.

**Explore interactively** — an Origin-style pointer tool (drag, resize,
and pin plot text; draggable legends), multi-window MDI with linked
zoom/cursor groups, a ctrl-click panel builder (side-by-side / grid /
overlay with automatic dual-Y by unit family), linked row selection and
masking across every view, worksheet with formulas and filters, and
app-wide **undo/redo**.

**Analyze with domain depth** — 29+ fit models plus a no-eval custom
equation builder, AICc model scanning, global/batch/ODR fits, an optional
[bumps](https://github.com/bumps/bumps) engine with DREAM posterior
sampling; a Peak Analyzer wizard; baselines from ALS to Shirley to
interactive anchor points; Parratt reflectivity; RSM strain analysis;
Williamson-Hall, FFT film thickness, and reflectivity-FFT reductions;
hysteresis, relaxation, and a full statistics suite.

**Publish** — vector PDF/SVG export (server-rendered matplotlib) that
matches the screen: rich-text labels (µ₀H, Å⁻¹, χ″…), journal size
presets (APS/Nature/thesis…), per-series styles, fills, color-mapped
scatter, engineering/scientific tick formats, and a multi-panel figure
composer for Fig. 1(a)–(d)-style pages.

**Stay reproducible** — every correction is a replayable pipeline step
with a recalculation DAG, a macro recorder emits runnable scripts,
workspaces save to a single `.dwk` file, and everything is scriptable
through the HTTP API and a plugin system.

**DiraCulator** — the built-in materials calculators (units, X-ray/neutron,
crystallography, SLD, semiconductors, superconductors, magnetism, optics,
vacuum, and more) also launch standalone: `diraculator` (or
`qz --calc`), with its own Start Menu entry in the Windows installer.

## Scope

Magnetometry / XRD / reflectometry / lab-data analysis. Electron-microscopy
tooling (EELS/EDS, imaging) is **out of scope** and lives in the separate
`fermiviewer` project.

## Run it

| Method | Command | Notes |
|--------|---------|-------|
| pipx (recommended) | `pipx install quantized-lab && qz` | isolated env, `qz` on PATH, no dev tools needed |
| uv tool | `uv tool install quantized-lab && qz` | same idea, via `uv` |
| pip | `pip install quantized-lab && qz` | into whatever env is active |
| Native installer | download from [Releases](https://github.com/pquarterman17/quantized/releases) | Windows `.exe` (NSIS, auto-updates), macOS `.dmg`, Linux `.deb` — no Python required |
| From source | see below | for development |

Once installed, `qz` serves the app at `http://127.0.0.1:8000` and opens a
browser tab. An empty library shows a **"Drop files here, or use ⊞ to import
/ ✚ for a demo"** hint — click **✚** for an instant synthetic dataset, so a
fresh install has something to plot within seconds.

**From source — double-click a launcher** (builds the UI + installs deps on
first run, then opens the app in your browser):

- **Windows:** double-click `run.cmd`
- **macOS:** double-click `run.command` (first time: right-click → Open)

**Or one command** (after `uv` + Node.js are installed):

```bash
# first time only: build the UI bundle the app serves
cd frontend && npm install && npm run build && cd ..

uv run qz                 # serve on :8000 and open a browser tab
uv run qz --port 9000     # different port
uv run qz --no-browser    # headless (don't open a tab; never auto-exits)
uv run qz --desktop       # native window (needs: pip install quantized-lab[desktop])
uv run qz --dev           # contributor mode: Vite HMR + reloading backend
uv run diraculator        # the materials calculators, standalone
```

The default mode behaves like an app: closing the last browser tab shuts
the server down (a page refresh doesn't). Set `QZ_AUTO_SHUTDOWN=0` to opt
out, use `--no-browser` for a persistent/headless server, or stop any mode
with **Ctrl+C** in its window. A busy port falls back to a free one
automatically, so the app and a standalone DiraCulator coexist.

Building your own wheel/sdist? Build the frontend **first** —
`cd frontend && npm ci && npm run build` — before `uv build`, or the wheel
ships without a UI.

## Documentation

- **[Wiki](https://github.com/pquarterman17/quantized/wiki)** — installation,
  getting started, feature guides, Origin interop
- **[Releases](https://github.com/pquarterman17/quantized/releases)** —
  installers + changelogs
- [`RELEASE.md`](https://github.com/pquarterman17/quantized/blob/main/RELEASE.md)
  — how releases are built and published
- In-app: **⌘K** command palette, **Help ▸ Keyboard shortcuts**, and
  **Help ▸ Text formatting** for the rich-text label syntax

## Architecture (for contributors)

Pure `io/` + `calc/` libraries (data in → results out, no web imports),
thin FastAPI `routes/`, a 500-line per-module ceiling, ~400-line React
component ceiling, and **golden tests** that freeze MATLAB outputs as the
parity oracle — enforced by tests, not convention. See
[`CLAUDE.md`](https://github.com/pquarterman17/quantized/blob/main/CLAUDE.md).

```bash
uv sync --group dev          # backend deps
uv run pytest                # backend tests (+ `-m golden` for MATLAB parity)
uv run ruff check src tests && uv run mypy src
cd frontend && npm test && npm run build
```

License: Apache-2.0.
