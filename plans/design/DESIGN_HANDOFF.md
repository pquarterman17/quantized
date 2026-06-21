# Quantized — Frontend Implementation Plan (Claude Code handoff)

## Overview

**Quantized** is an open-source, modern alternative to OriginPro for
materials-characterization data (magnetometry VSM/PPMS/MPMS, XRD/XRR, neutron
reflectometry, generic lab data). It is a Python (FastAPI) + React/TypeScript
port of the `quantized_matlab` toolbox, sharing the visual language and shell
conventions of the sibling **fermiviewer** EM app.

This repo is the **design system + UI-kit reference** for that frontend. The
HTML/JSX files here are **design references** — prototypes showing the intended
look and behavior — **not production code to copy verbatim**. The task for
Claude Code is to **recreate these designs in the real `quantized/frontend/`**
(React 19 + TypeScript + Vite + Zustand + uPlot, per `quantized/plans/PORT_PLAN.md`
W7), reusing fermiviewer's `theme.css` / shell conventions and the design tokens
defined here.

**Fidelity: high.** Colors, typography, spacing, density, and interaction states
are final. Recreate pixel-faithfully using the codebase's real stack (uPlot for
interactive 1-D plots, Canvas2D for 2-D maps, server-side matplotlib for vector
export). The Canvas2D plotting in these mocks is a stand-in for uPlot — match the
*visual result*, not the mock's rendering code.

---

## What's already designed (reference these)

Repo root is the design system. Key files:

| Path | What it is |
|------|-----------|
| `styles.css` | Single CSS entry point — `@import`s all tokens + the `qz-*` component class layer |
| `tokens/colors.css` · `typography.css` · `spacing.css` · `fonts.css` | All design tokens (122) — oklch surfaces, accent schemes, series palette, type roles, density modes |
| `components/components.css` | `qz-*` class layer (buttons, inputs, cards, tables, switches…) |
| `components/{buttons,forms,data}/*.jsx + *.d.ts` | React primitive specs: `Button`, `IconButton`, `SegmentedControl`, `Pill`, `NumberField`, `Select`, `Checkbox`, `Switch`, `SliderRow`, `Card`, `MetaRow`, `Badge`, `StatusDot`, `DataTable` |
| `readme.md` | The full design guide — content fundamentals, visual foundations, iconography |
| `ui_kits/workbench/` | The product mock: shell + screens (see below) |

### Existing workbench screens (in `ui_kits/workbench/`)

- `index.html` — **Analysis Workbench** shell: TitleBar / MenuBar / Library
  (datasets + sparklines) / Stage (Canvas2D plot + Worksheet tab) / Inspector
  (corrections, axes, appearance, peak-fit) / StatusBar.
- `curve-fit.html` — peak-fit workshop window (param table, residuals, stats).
- `hysteresis.html` — M(H) loop analysis (Hc/Mr/Ms extraction + on-plot markers).
- `reflectivity.html` — **stacked R(Q) + SLD-profile** subplots + layer-stack workshop.
- `diraculator.html` — materials-science calculator panels (Bragg d↔2θ↔Q).

Shared infra: `shell.css` (the `qzk-*` chrome), `Workbench.jsx` (reusable shell —
props `initialId`, `forceFit`, `overlay`, `stage`), `data.js` (synthetic
DataStruct-shaped datasets), `plot.js` / `refl.js` (Canvas2D renderers),
`Library.jsx`, `Stage.jsx`, `Inspector.jsx`, `Workshops.jsx`, `ReflWorkshop.jsx`.

### Mapping mock → real frontend

| Mock construct | Real frontend |
|---|---|
| `qzk-*` shell CSS + `Workbench.jsx` | `frontend/src/components/Shell/*` (TitleBar, MenuBar, StatusBar) + `App.tsx` grid |
| `Library.jsx` | `components/Library/*` (dataset list, import, groups, search) |
| `plot.js` / `refl.js` Canvas2D | uPlot instances in `components/Stage/*`; 2-D maps → Canvas2D |
| `Inspector.jsx` cards | `components/Inspector/*` (one `Card` per concern) |
| `Workshops.jsx` floating windows | `components/workshops/*` (state hook + view + sub-components, <400 lines each) |
| `qz-*` primitives | shared UI components reading the CSS custom properties |
| `data.js` | real `routes/plot` → DataStruct → uPlot series contract |

Hard rules from `quantized/CLAUDE.md` still apply: 500-line module ceiling,
~400-line `.tsx` ceiling (heavy features → `workshops/` subtree), pure
`io/`+`calc/` layers, Apache-2.0 / no GPL runtime deps.

---

## NEXT TASK — DataWorkspace Worksheet (W5 / W7 #43)

Build the **spreadsheet view** — the OriginPro "worksheet" analogue. The mock
`Stage.jsx` already has a read-only `Worksheet` table as a starting point; this
task makes it a real, interactive workspace. **Design it in a fresh session**
using this design system (link `styles.css`, mount from `_ds_bundle.js`); a
detailed spec follows so it can be built standalone.

### Purpose
Tabular view + light editing of one or more datasets as columns, with
column-role semantics, no-eval formula columns, sort/filter, and descriptive
stats — feeding plots and fits.

### Layout
- Reuse the workbench shell (`qzk-app` grid). The Worksheet replaces the Stage
  cell when the **Worksheet** tab is active (the tab already exists).
- **Sheet tabs** (bottom or top of the stage cell): one tab per worksheet, plus
  a `+` to add. Active tab uses the accent underline (`qzk-tab.active` pattern).
- **Column header row** (sticky): each column shows its **name**, a **role
  chip** (X · Y · yErr · computed · label), and **unit**. Match the existing
  `.qzk-sheet th` / `.role` styling (uppercase tracked accent-text role label).
- **Row-number gutter** (sticky left, `.rownum` style — `surface-1`, faint,
  centered).
- **Cells**: monospace, right-aligned numerics; selected cell/range outlined in
  accent; computed-column cells tinted (faint accent background) and read-only.
- **Formula bar** above the grid: shows `= <expression>` for the selected
  computed column; editable. Use a `qz-input` mono field + a `Σ`/`fx` icon button.
- **Stats footer** (collapsible, `Card`-style): count, mean, std, min, max,
  median for the selected column/range — monospace `MetaRow`s.
- **Inspector** (right) gains a **Columns** card: list columns with role
  `Select`, rename, units `NumberField`, delete; and a **Sort / Filter** card.

### Components to use (from this design system)
`DataTable` styling as the base, but build the interactive grid directly with
the `qz-table` / `qzk-sheet` classes. `Card`, `MetaRow`, `Select`,
`SegmentedControl`, `NumberField`, `Checkbox`, `Badge`, `Button`, `IconButton`.

### Interactions & behavior
- **Cell/range selection**: click + shift-click + drag; arrow-key navigation.
- **Column roles**: a `Select` per column (X / Y / Y error / label / computed).
  Changing roles updates which columns a plot/fit consumes.
- **Sort**: click a header (or Sort card) → asc/desc by that column; show a tiny
  caret. Stable multi-key sort optional.
- **Filter**: per-column predicate (range, >, <, contains) in the Sort/Filter
  card; filtered rows hidden, count badge updates.
- **Formula columns (NO eval)**: a safe expression over column refs
  (`col("moment") / mass`, `deriv(col("M"), col("H"))`, `A2-B2`-style cell refs).
  Parse to a dispatch-table AST (mirror `calc/` formula engine); recompute on
  dependency change; computed cells are read-only and visibly tinted. Show parse
  errors inline (danger color) — never `eval`.
- **Masking**: checkbox to exclude rows from downstream fits (struck-through row).
- **Edit**: double-click a raw numeric cell to edit; commit on Enter/blur;
  revert on Esc. Computed cells are not editable.
- **Add column / add sheet / duplicate / delete** via header context menu
  (reuse the `qzk-dropdown` glass-menu styling).

### State (Zustand, mirror `store/` conventions)
```
WorksheetModel = {
  sheets: { id, name, columns: Column[], rowMask: boolean[] }[]
  activeSheetId
  selection: { col, row, anchorCol, anchorRow }   // range
  sort: { col, dir } | null
  filters: { col, op, value }[]
}
Column = { id, name, role: "x"|"y"|"yerr"|"label"|"computed",
           unit, values: number[] | null, formula?: string, error?: string }
```
Computed columns store `formula` + a snapshot of `values`; recompute is a pure
`calc/` function (golden-testable). Selection/sort/filter are view state.

### Design tokens (exact — already in `styles.css`)
- Surfaces: `--surface-0/1/2/3`; sheet bg `--surface-0`, header `--surface-2`,
  gutter `--surface-1`, hover `--surface-1`.
- Accent `--accent` (oklch(0.7 0.17 295)); computed tint `--accent-soft`;
  role label `--accent-text`. Borders `--border`/`--border-soft`. Danger
  `--danger` for formula errors. Mono `--font-mono` (JetBrains Mono) for all
  cells; `--font-size-sm`; radii `--radius`/`--radius-sm`.

### Acceptance
- Multi-sheet tabs; sticky header + gutter; role chips per column.
- Range selection + keyboard nav; sortable headers; at least one working filter.
- One computed column via the no-eval formula engine, recomputing live, with an
  inline parse-error state.
- Stats footer for the selected column. Visually faithful to `qzk-sheet`.

---

## Files in this handoff
The entire repo is the reference. Start at `readme.md` (design guide) and
`ui_kits/workbench/` (product mock). For the worksheet task, study
`ui_kits/workbench/Stage.jsx` (`Worksheet`), `shell.css` (`.qzk-sheet`), and
`components/data/DataTable.*`.
