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

> Status: **planning**. See [`plans/PORT_PLAN.md`](plans/PORT_PLAN.md) for
> the detailed workstream plan, and [`CLAUDE.md`](CLAUDE.md) for the
> architecture hard-rules.

## Scope

Magnetometry / XRD / lab-data analysis (parity with `quantized_matlab`).
Electron-microscopy tooling (Fermi viewer, EELS/EDS, imaging) is **out of
scope** and lives in the separate `fermiviewer` project.

## Run it

**Easiest — double-click a launcher** (builds the UI + installs deps on first
run, then opens the app in your browser):

- **Windows:** double-click [`run.cmd`](run.cmd)
- **macOS:** double-click [`run.command`](run.command) (first time:
  right-click → Open)

**Or one command** (after `uv` + Node.js are installed):

```bash
# first time only: build the UI bundle the app serves
cd frontend && npm install && npm run build && cd ..

uv run qz                 # serve on :8000 and open a browser tab
uv run qz --port 9000     # different port
uv run qz --no-browser    # headless (don't open a tab)
```

Stop the app with **Ctrl+C** in its window.

## Develop

```bash
uv sync --group dev          # backend deps
uv run pytest                # backend tests (+ `-m golden` for MATLAB parity)
uv run ruff check src tests && uv run mypy src
cd frontend && npm test && npm run build
```

License: Apache-2.0.
