# Origin import: start here

What quantized reads from OriginPro projects (`.opj`, `.opju`), what it
still leaves out, and where the evidence lives. User-facing guide:
[../opening_origin_files.md](../opening_origin_files.md). Format reference:
[../origin_project_format.md](../origin_project_format.md). Rules for code
changes: [src/quantized/io/origin_project/CLAUDE.md](../../src/quantized/io/origin_project/CLAUDE.md).

## What works now

- **Books:** every workbook and matrix book, `.opj` back to Origin 7 and
  `.opju`: real column names, units, comments, designations, every numeric
  type, text cells, used rows only. Data Connector books saved without data
  and graph-only projects are named as such.
- **Graph pages:** every page Origin lists is accounted for (decoded,
  filtered, or reported with its saved preview). Axis ranges, scales and
  titles come from the graph-layer record.
- **Curves:** each curve binds its own `(book, X, Y)` from the file's curve
  record, including the right sheet and a recorded X that wins over any
  inference; hidden plots are left out as hidden; line width, symbol size and
  colours (including restyled symbols) are read.
- **Plot kinds:** line, scatter, line+symbol, single-series column, area,
  step, box/violin/strip, histogram (and histogram + cumulative pages),
  stacked area, single horizontal bar, grouped and stacked columns, bubble,
  colour-mapped, polar, heatmap/contour/image, XYZ contour,
  ternary.
- **Error bars:** symmetric, asymmetric (plus/minus) and X error bars attach
  to the curve they decorate; filled bands draw as bands.
- **Layout and text:** double-Y and top-X layers, stacked multi-panel pages,
  category (text) X axes with their labels, page-attached and rotated text,
  `.opj` tick "Divide by".
- **Safety net:** anything not proven is left out with a named reason in the
  fidelity panel (Recover lists it) instead of being guessed.

## What does not work yet

- **Plot kinds left out** (`plot_type_not_drawn`): stacks on user templates,
  grouped horizontal bars, bar-of-pie, the three-plot floating column
  (pie / doughnut, two-plot floating columns and vectors draw since #794 / #798).
  Grouped columns over a text X on a later sheet stay `x_not_imported`
  (F-117). See [plot_kinds.md](plot_kinds.md) "Left out".
- **Error bars left out** (39 public plots): see [error_bars.md](error_bars.md)
  "Still left out".
- **Not decoded:** `.opju` tick "Divide by", bar widths, the cumulative line's
  step connect, connect modes other than step, `.opj` saved previews.
- **Open owner COM checks**, one per area:
  - hidden plots: [curve_visibility.md](curve_visibility.md) "The COM check that would settle it"
  - restyled colours (byte 310): [curve_colors.md](curve_colors.md) "The COM check that would settle it"
  - error bars: [error_bars.md](error_bars.md) "COM checks for the owner"
  - plot kinds (SOP_meas Graph67 horizontal bar): [plot_kinds.md](plot_kinds.md) "Owner checks (COM) left open"
  - page text / divide-by: [page_text_and_tick_divide.md](page_text_and_tick_divide.md) "Owner COM checks left"
  - `.opj` bindings: [curve_bindings_opj.md](curve_bindings_opj.md) "Not proven here: owner COM checks"
  - embedded graphs: [opju_embedded_graphs.md](opju_embedded_graphs.md) "Still open (owner COM checks)"
  - layer record: [opju_layer_record.md](opju_layer_record.md) "Still open (owner COM checks)"
  - layout: [multi_layer_pages.md](multi_layer_pages.md) "Not fixed here"
  - Hc2 Graph34/40: [hc2_open_gaps.md](hc2_open_gaps.md)
  - full list: [DECODE_LEDGER.md](DECODE_LEDGER.md) section 6

## Reading the ledger

[DECODE_LEDGER.md](DECODE_LEDGER.md) is the index: one line per fact,
decision, regression or PR, each linking its detail doc and naming the test
that guards it.

- Section 2 `F-nnn`: proven facts (field, meaning, evidence, guard).
  Evidence codes: SPEC specimen, COM Origin COM/LabTalk, PREV Origin's own
  image, DIST corpus distribution, NEG negative control, 3P paired file.
- Section 3 `B-nn`: behaviour rules and owner decisions.
- Section 4 `R-nn`: regressions, what caught them, the guard now.
- Section 5: change log per PR with its corpus delta. Section 6: open
  questions.
- **UNGUARDED** marks a fact with no test: not a contract. The count is at
  the top of section 2.

## Running the checks (local corpus needed)

The corpus sits beside the checkout (`<root>/test-data/origin/`, or
`QZ_ORIGIN_PUBLIC_CORPUS` / `QZ_ORIGIN_OWNER_CORPUS`); nothing from it is
ever committed.

- **Regress gate** (every Origin change): `uv run python tools/gate.py
  --origin --origin-allow docs/origin_re/regress_allow/<lane>.json`. It
  compares HEAD with `origin/main` project by project and fails on any change
  not explained, with a reason, in the allow-file. See
  [regress_allow/](regress_allow/) for examples.
- **Visual check against Origin's images:** the three steps in
  [tools/visual/README.md](../../tools/visual/README.md) "Origin preview
  oracle" (`origin_preview_extract.py`, `origin_preview_shots.mjs`,
  `origin_preview_report.py`) write `gallery.html`: Origin's image beside
  ours, most suspicious first.

## Index of this folder

| File | Purpose |
|---|---|
| [README.md](README.md) | This entry point |
| [DECODE_LEDGER.md](DECODE_LEDGER.md) | Index of proven facts, owner decisions, regressions and change log |
| [ORIGIN_CONVENTIONS.md](ORIGIN_CONVENTIONS.md) | Consolidated reference of Origin conventions, with citations |
| [validation_log.md](validation_log.md) | Dated COM / license-window validation runs and the repeatable checklist |
| [curve_axis_fidelity.md](curve_axis_fidelity.md) | Curve style and axis fields safe to render; byte-17 history; category X |
| [curve_bindings_opj.md](curve_bindings_opj.md) | `.opj` curve bindings from the anchor record (recorded X, hidden, names) |
| [curve_colors.md](curve_colors.md) | Colours of restyled symbol plots (record byte 310) |
| [curve_visibility.md](curve_visibility.md) | Shown/hidden plots (offset 38) and why COM lists are not a visibility oracle |
| [error_bars.md](error_bars.md) | Which curve an error-bar plot decorates; halves, X errors, bands |
| [plot_kinds.md](plot_kinds.md) | Column, bar, stacked, pie, histogram + cumulative plot kinds |
| [page_text_and_tick_divide.md](page_text_and_tick_divide.md) | Page text placement, script buttons, tick "Divide by", style holders |
| [multi_layer_pages.md](multi_layer_pages.md) | Stacked panels and top-X layers |
| [opju_layer_record.md](opju_layer_record.md) | `.opju` graph-layer record = sparse `.opj` layer block (axes) |
| [opju_embedded_graphs.md](opju_embedded_graphs.md) | Graph pages Origin lists that were not decoded; the page census |
| [opju_no_worksheet_data.md](opju_no_worksheet_data.md) | Projects without worksheet data; non-project files |
| [hc2_open_gaps.md](hc2_open_gaps.md) | Two undecoded Hc2 graphs and the COM queries that would settle them |
| [saved_graph_previews.md](saved_graph_previews.md) | Contract for attaching Origin's saved page previews |
| [fidelity_manifest.md](fidelity_manifest.md) | Fidelity manifest and the omissions UI |
| [full_data_figure_apply.md](full_data_figure_apply.md) | Full-data preflight when applying a figure |
| [workbook_graph_builder_fallback.md](workbook_graph_builder_fallback.md) | Workbook / Graph Builder fallback for imported figures |
| [opj_figures.md](opj_figures.md) | Stub: consolidated into the format reference |
| [opj_windows_section.md](opj_windows_section.md) | Stub: consolidated into the format reference |
| [opju_container.md](opju_container.md) | Stub: consolidated into the format reference |
| [regress_allow/](regress_allow/) | Explained-changes files for `gate.py --origin`, one per lane |
