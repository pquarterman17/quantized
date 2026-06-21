# Quantized — Analysis Workbench (UI kit)

A high-fidelity recreation of the **Quantized** desktop application: an
open-source, modern alternative to OriginPro for materials-characterization
data (magnetometry, XRD, neutron reflectometry, generic lab data). Built on the
shared design language of the sibling **fermiviewer** EM app so UI code ports
between the two.

> The `quantized` repo is in *planning* status — there is no shipped frontend
> yet. This kit is the **design proposal** for the React/TypeScript GUI
> described in `plans/PORT_PLAN.md` (W7), realised against the real token
> system and component conventions.

## Screens

| File | Starting point | What it shows |
|------|----------------|----------------|
| `index.html` | Analysis Workbench | The full shell — TitleBar · MenuBar · **Library** (dataset list with live sparklines) · **Stage** (interactive Canvas2D plot + Worksheet tab) · **Inspector** (corrections / axes / appearance / peak-fit) · StatusBar. Click datasets to switch; run the peak fit to overlay the model + peak markers; toggle the Worksheet tab for the spreadsheet view. |
| `curve-fit.html` | Curve Fit Workshop | The workbench with a draggable **Curve fit** tool window open over the plot — model + background pickers, a fitted-parameter table (center ± error / FWHM / area), a residual scatter plot, and R²/χ²ᵣ/iteration stats. The plot shows the fit overlay + peak markers. |
| `hysteresis.html` | Hysteresis Workshop | The workbench on a VSM M(H) loop with the **Hysteresis** tool window — extracted Hᶜ / Mᵣ / Mₛ / squareness / exchange bias — and on-plot annotation markers. |
| `reflectivity.html` | Reflectivity / SLD Workshop | A **stacked dual-subplot** stage — **R(Q)** reflectivity (log Y, data + Parratt fit) on **top**, the **SLD depth profile** on the **bottom** — with a Reflectivity workshop window carrying the editable **layer stack** (layer / thickness / SLD / roughness), method + radiation pickers, and χ² fit stats. |
| `diraculator.html` | DiraCulator | The materials-science calculator suite — a left calculator nav, a Bragg d-spacing ↔ 2θ ↔ Q converter with a reflections table, and a right source/output panel. |

## Structure

```
index.html        mounts the default Workbench (script wiring)
curve-fit.html    Workbench + Curve Fit workshop window
hysteresis.html   Workbench + Hysteresis workshop window + on-plot markers
diraculator.html  standalone calculator screen
shell.css         shared shell layout (qzk-* chrome + tool-window styles)
data.js           synthetic-but-plausible datasets (VSM loop, XRD pattern,
                  M(T), XRR) in the backend's DataStruct shape
plot.js           Canvas2D scientific-plot renderer (axes, nice ticks, grid,
                  trace, fit overlay, peak markers) — reads live CSS tokens
Library.jsx       left dataset panel + sparkline
Stage.jsx         PlotStage (plot + tool dock + chips + legend) and Worksheet
Inspector.jsx     stacked Card-based inspector
Workshops.jsx     draggable ToolWindow + Fit / Hysteresis workshops
ReflWorkshop.jsx  ReflStage (stacked R(Q) + SLD subplots) + layer-stack workshop
refl.js           XRR layer model + dual-subplot renderer (R(Q) over SLD)
Workbench.jsx     reusable shell (props: initialId, forceFit, overlay, stage)
App.jsx           mounts <Workbench/> for index.html
```

The kit **composes the design-system primitives** (`Button`, `Card`,
`MetaRow`, `SegmentedControl`, `NumberField`, `Select`, `Checkbox`, `Switch`,
`SliderRow`, `Badge`, `StatusDot`, `DataTable`) from `window.QuantizedDesignSystem_*`
via `_ds_bundle.js`. The shell chrome (grid layout, menubar, floating toolbar,
worksheet) is kit-specific CSS that references the shared tokens directly.

## Source of truth

- Visual language & shell conventions: **fermiviewer** `frontend/src/theme.css`,
  `theme-web.css`, `App.tsx`, `components/Shell/*`, `components/Inspector/Card.tsx`.
- Domain, datasets, feature naming: **quantized** `CLAUDE.md`,
  `plans/PORT_PLAN.md` (DataStruct, parsers, corrections, fitting, DiraCulator,
  DataWorkspace, uPlot interactive + matplotlib vector export).

Plots here are drawn with Canvas2D for the mock; the real app uses **uPlot** for
interactive 1-D plots and server-side **matplotlib** for vector publication
export (PDF/SVG), per the port plan.
