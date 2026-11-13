# Publication figure export: fidelity rules

How the server-side matplotlib export (`src/quantized/calc/figure*.py`,
`routes/export_figures.py`) stays faithful to the screen and to the page the
user asked for. Each rule names the code that owns it and the test that pins
it.

## Page size and margins

* The figure's size has ONE source of truth: the window's `pageSetup`
  (`frontend/src/lib/pagesetup.ts`). Page setup, the Export dialog and the
  Publication preview's Canvas group all read and write it
  (`lib/pageSizeFields.ts`, `figurebuilder/CanvasPanel.tsx`). With no page set,
  an export uses the style preset's own size; the default page is that
  preset's 6 × 4 in. Units: cm, mm, in, px.
* Page **margins are outer padding**, never the axes position. They ride the
  request as `overrides.page_pad` (fractions of the page) and the figure is
  laid out with `tight_layout` inside the padded page
  (`calc/figure_layout.py`), so tick labels, axis titles, the title and an
  outside legend always fit; the page itself is exactly the requested size
  (no `bbox_inches="tight"` crop). A page too small for its own labels is
  reported as a warning. `overrides.margins` keeps its separate meaning — the
  Figure Builder's hand placement of the axes box.
  Test: `tests/test_export_page_margins.py`.

## Preview == export

The Publication preview (`/api/export/figure-hitmap`) and Export
(`/api/export/figure`) build their renderer arguments from one function,
`_flat_render_kwargs` — size, error bars and transparency included.
Test: `tests/test_export_preview_parity.py`.

## Axis limits

An autoscaled axis takes the canvas' own rule (`calc/figure_autoscale.py`):
x exactly the data; y uPlot's `rangeNum(min, max, 0.1, true)`; a
non-ascending x (a loop) or a waterfall X step the canvas' full-scan pads; a
log axis uPlot's `rangeLog`. Data-anchored annotations, text boxes and shapes
therefore land at the same place on screen and in the PDF.
Tests: `tests/test_export_linear_autoscale.py` (with its canvas half
`frontend/src/lib/linearAutoscaleFixture.test.ts`), `test_export_flat_autoscale.py`.

## Typography

* `font_size` scales the preset's title and legend sizes with it (a larger base
  never leaves a smaller title); `title_size`, `label_size`, `tick_size` and
  `legend_size` set each element (`calc/figure_fonts.py`).
* Font names resolve against the installed families (`GET /api/export/fonts`).
  Arial / Helvetica → Liberation Sans (or Arimo), Times New Roman → Liberation
  Serif (or Tinos), Courier New → Liberation Mono (or Cousine), Calibri →
  Carlito, Cambria → Caladea — metric-compatible, so line breaks and label
  widths match. A family with no installed substitute falls back to DejaVu and
  the export says so.
* Rich-text markup, including Origin's `\+( \-( \g( \b( \i(` escapes:
  [rich_text_labels.md](rich_text_labels.md).

## Decorations

* A new region shade spans the full plot height (`full_height`), so it reads
  the same on a linear or log axis; a data-y shade with a side ≤ 0 on a log
  axis runs from the axis floor instead of vanishing (`calc/figure_decor.py`,
  `frontend/src/lib/uplotRegionShades.ts`).
* A reference line or shade outside the axis range is reported as a warning
  in the export and marked "(off-scale)" at the plot edge on screen.
* A text box is ink on the plot's paper colour (the `--axes-bg-*` token) with
  an ink border on screen, as the export's white card with a black border; an
  arrow's head is drawn in its stroke colour on both.

## Render warnings

Whatever the export cannot honour is said, not swallowed
(`calc/figure_warnings.py`): `/api/export/figure` returns them in the
`X-Figure-Warnings` header (a JSON list; the client toasts each), the preview
in the hit-map's `warnings` list (shown under the image).

## Clipboard formats, and why there is no EMF

"Copy figure" places a 300-DPI PNG, an HTML `<img>` of that PNG, and (where
the browser accepts it) a text-as-paths SVG on the clipboard
(`frontend/src/lib/copyFigureCommand.ts`). EMF is deliberately not offered:

* matplotlib has had no EMF backend since 1.x;
* the converters that exist are either GPL / LGPL (Inkscape, pyemf, PyEMF3)
  — the project allows no GPL runtime dependency — or a heavyweight external
  install (LibreOffice) that cannot be assumed on a user's machine;
* a browser cannot write `image/emf` (or the Windows `CF_ENHMETAFILE`
  format) to the clipboard at all; only the OS-gated optional Origin/COM
  path could, and it is Windows-only and untestable in CI.

Current Office versions paste the SVG as an editable vector graphic, which
is the purpose EMF used to serve; the PNG covers everything else. Revisit if
a permissively licensed, maintained SVG→EMF writer appears.
