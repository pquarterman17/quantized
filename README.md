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

## Quick start (target)

```bash
uv sync --group dev
uv run qz            # API + SPA on :8000, opens the browser
uv run qz --desktop  # native desktop window
```

License: Apache-2.0.
