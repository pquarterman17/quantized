# quantized

A clean-architecture Python + React port of the
[`quantized_matlab`](../quantized_matlab) scientific data toolbox for
magnetometry, X-ray/neutron diffraction, and generic lab data.

- **Backend parity** with the MATLAB toolbox: parsers, corrections,
  plotting, peak & curve fitting, materials calculators (DiraCulator),
  and a spreadsheet workspace (DataWorkspace).
- **Revamped GUI** built fresh in React, sharing the look-and-feel and
  component conventions of the sibling [`fermiviewer`](../fermiviewer)
  Python app.
- **Architecture that holds the line:** pure `io/` + `calc/` libraries,
  thin FastAPI `routes/`, a 500-line per-module ceiling, and golden tests
  that freeze MATLAB outputs as the parity oracle — so this port never
  grows the god-scripts the MATLAB original accumulated.

> Status: **active development** — backend + GUI are functional; native
> installers and PyPI packages publish from tagged releases (see
> [`RELEASE.md`](RELEASE.md)). See [`plans/PORT_PLAN.md`](plans/PORT_PLAN.md)
> for the detailed workstream plan, and [`CLAUDE.md`](CLAUDE.md) for the
> architecture hard-rules.

## Scope

Magnetometry / XRD / lab-data analysis (parity with `quantized_matlab`).
Electron-microscopy tooling (Fermi viewer, EELS/EDS, imaging) is **out of
scope** and lives in the separate `fermiviewer` project.

## Run it

**Install matrix** — pick whichever fits your workflow:

| Method | Command | Notes |
|--------|---------|-------|
| pipx (recommended) | `pipx install quantized-lab && qz` | isolated env, `qz` on PATH, no dev tools needed |
| uv tool | `uv tool install quantized-lab && qz` | same idea, via `uv` |
| pip | `pip install quantized-lab && qz` | into whatever env is active |
| Native installer | download from [Releases](https://github.com/pquarterman17/quantized/releases) | Windows `.exe` (NSIS, auto-updates), macOS `.dmg`, Linux `.deb` — no Python required, see [`RELEASE.md`](RELEASE.md) |
| From source | see below | for development |

Once installed, `qz` serves the app at `http://127.0.0.1:8000` and opens a
browser tab. An empty library shows a **"Drop files here, or use ⊞ to import
/ ✚ for a demo"** hint — click **✚** for an instant synthetic dataset (built
client-side), or hit `GET /api/samples/demo` for a bundled sample dataset
parsed server-side through the normal import path — so a fresh install has
something to plot within seconds, no data file required.

**From source — double-click a launcher** (builds the UI + installs deps on
first run, then opens the app in your browser):

- **Windows:** double-click [`run.cmd`](run.cmd)
- **macOS:** double-click [`run.command`](run.command) (first time:
  right-click → Open)

**Or one command** (after `uv` + Node.js are installed):

```bash
# first time only: build the UI bundle the app serves
cd frontend && npm install && npm run build && cd ..

uv run qz                 # serve on :8000 and open a browser tab
uv run qz --port 9000     # different port
uv run qz --no-browser    # headless (don't open a tab; never auto-exits)
uv run qz --desktop       # native window (needs: pip install quantized-lab[desktop])
uv run qz --dev           # contributor mode: Vite HMR + reloading backend
```

The default mode behaves like an app: closing the last browser tab shuts
the server down (a page refresh doesn't). Set `QZ_AUTO_SHUTDOWN=0` to opt
out, use `--no-browser` for a persistent/headless server, or stop any mode
with **Ctrl+C** in its window.

Building your own wheel/sdist (e.g. for `pip install .`)? Build the frontend
**first** — `cd frontend && npm ci && npm run build` — before `uv build` /
`python -m build`, or the wheel ships without a UI (`qz` still runs; it just
prints a "UI not built" warning instead of serving one).

## Develop

```bash
uv sync --group dev          # backend deps
uv run pytest                # backend tests (+ `-m golden` for MATLAB parity)
uv run ruff check src tests && uv run mypy src
cd frontend && npm test && npm run build
```

License: Apache-2.0.
