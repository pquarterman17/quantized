# Origin curve and axis fidelity

This is the evidence and handoff record for item 52 of
`plans/ORIGIN_FILE_DECODE_PLAN.md`. It separates fields that are safe to render
from candidates that still need an independent oracle or a truthful target.

## Verified curve fields

| Record field | Meaning | Evidence | Quantized target |
|---|---|---|---|
| byte 76 `0xc8` | Origin plot 200, line | OriginLab `plotxy` reference and corpus oracle | line series |
| byte 76 `0xc9` | Origin plot 201, scatter | OriginLab `plotxy` reference and corpus oracle | marker-only series |
| byte 76 `0xca` | Origin plot 202, line + symbol | OriginLab `plotxy` reference; 36 Moke curves | line plus markers |
| u16 at 21, divided by 500 | line width in points | 92/92 COM-oracle exact | series width |
| u16 at 25, divided by 500 | symbol size in points | 92/92 COM-oracle exact | marker size |

Primary format reference:
<https://docs.originlab.com/x-function/ref/plotxy/>.

Unknown plot bytes `0xe7` and `0xe9` remain omitted. Color, symbol, and size
fields may still be applied independently; the importer does not invent a
line/scatter mode for those families.

The fidelity manifest now reports `line_symbol_mode`, `line_width`, and
`symbol_size` when present, so the UI and future corpus acceptance matrix do
not understate what was recovered.

## Connection-mode candidate (not yet shipped)

A read-only comparison of 69 shared curve records against Origin COM dumps
found zero contradictions for byte 17:

| byte 17 | COM `line.connect` | Origin meaning |
|---|---|---|
| `0` | `1` | straight |
| `1` | `2` | two-point segments |

This is strong decoding evidence, but two-point segments require alternating
pair strokes and gaps. The current uPlot series model has no native setting for
that path. Do not expose this field until a custom path builder and publication
renderer reproduce it in both interactive and export views. Official connection
codes are documented at
<https://docs.originlab.com/labtalk/ref/get_options_for_lines/de>.

## Remaining item 52 work

- Establish independent visibility ground truth; do not reuse the confounded
  PNR bytes from item 42.
- Add typed worksheet-unit to axis-unit conversion and transform data, limits,
  ticks, annotations, and regions as one operation.
- Implement only connection, dash, edge/fill, and axis features that both the
  oracle and the Quantized renderers can represent truthfully.
- Record unsupported features as omissions and retain the saved Origin preview
  as the visual reference.

## Rendering rules from the preview-oracle sweep (Lane F, 2026-11-20)

Found by `tools/visual/origin_preview_*` (Origin's own saved previews and the
owner's COM exports beside our render). Each rule has a unit test; the pages
named were re-rendered and compared before/after against Origin's image.

| Finding | Rule now | Evidence | Code / test |
|---|---|---|---|
| A2 | **A curve's recorded X wins** (owner decision 2026-11-20). When the file records a curve's X column (the `.opju` curve record names it: `curve.xRecorded`, `opju_figure_curves.py`) and it decoded, the curve is drawn against it, even where `lib/perSeriesX.ts`'s nearest-preceding-X rule picks another X; the apply routes the figure through the per-curve-X overlay (segment-concatenated, row order kept, so multi-X and non-monotonic X stay protected). The nearest-preceding rule applies only when the file names no X. A recorded X that did not import is never replaced: the curve is left out with a toast naming it. | Etna `origin.opju` Graph16 (x=L "K (ppm)": points now spread 1000..15000 as in Origin, were all at x≈0 against D); Catchment A-E Graph6 (x=D Year). Negative control that set the provenance rule: Moke.opj Graph8/9, where the `.opj` reader INFERS x=E for y=B (nearest preceding X in its column order) while Origin draws B against A; an early version that let any decoded X win flipped that loop, so a `.opj` X never wins. Controls after the fix: Moke, XMCD multi-X books, RockingCurve unchanged. | `lib/originRecordedX.ts`, `store/originApplyRecordedX.test.ts`, `tests/test_io_origin_opju_token_x.py` |
| A3 | A layer that records curves (or omitted curves) none of which resolves draws **empty with a stage note**, never every channel. A layer with no curve evidence keeps the dataset-default view; map/ternary/stat layers are unaffected. | Moke Graph2 (Origin: empty graph; we drew 11 channels), hc2convert Graph1/4/6-11 (31-33 phantom channels; their X `A` is the C5 mixed-text column), Catchment Graph1/2 (16 phantom channels; curves on the text Month X `A`, which is not the book's X). | `figureHasCurveEvidence`, `store/originApplyFailClosed.test.ts` |
| A1b | A designated-X TEXT (category) column gives `.time` = 1..N (Origin places row r at x = r + 1). | Whole corpus (owner + public): 59 graph layers bind a text X; every x range starts above 0 (most exactly [0.5, N+0.5]), none at or below 0. Moke Graph4/5/6, XMCD Graph17/19 now show the first category. An undecoded NUMERIC X keeps the 0-based placeholder. | `opj_books._build_book`, `tests/test_io_origin_opj_typed.py` |
| A6 | `%(?X)` / `%(?Y)` axis titles resolve from the layer's first curve: Long Name (else Short Name) plus " (Units)"; `@LL`, `@LU`, `@LC`, `@C` as Origin defines them. Any other option (`@WL` in the corpus) or an unimported column leaves "" (data-derived label), never the raw code. | Catchment Graph6 "Year" / "ΔS". Corpus forms: `%(?X)` x40, `%(?Y)` x31, `%(?Y,@LC)` x3, `%(?Y, @WL)` x1. | `lib/originAxisTitles.ts` + test |
| A8 | A 2-layer window with decoded coincident frames, one X range and two Y ranges is a double-Y window even when its layers use different books: one overlay, layer-2 curves on y2. Undecoded frames keep the spatial multi-panel apply. | Absorption-D3: 20 pages (Cys_Cu, CAM-B3Lyp, Cu2..5, ...) now draw the orange right-axis curve on 0..2 as Origin does. | `overlayDoubleYPair`, `store/originApplyOverlayY2.test.ts` |

Not changed, with the reason:

- **A5 (0.5 pt lines look faint).** The codebase already defines the width
  unit: a series width is ONE number, read as CSS px on the canvas and as pt in
  the export (`lib/exportStyles.ts` "Screen px are read as points";
  `calc/figure.py` passes it to matplotlib `linewidth`). Origin's widths (u16/500,
  pt, 92/92 COM-exact) are applied under that rule, so the export is faithful.
  The faint look is sub-pixel rasterisation: 0.5 CSS px at DPR 1 is a 50%-alpha
  stroke, while Origin and PDF viewers draw a hairline at least one device pixel
  wide. A true pt->px factor (x4/3) would give 0.67 px (still faint) and break
  the export rule. Proposal for the owner: a canvas-only floor of one device
  pixel (`max(width, 1 / devicePixelRatio)`) in `lib/uplotSeries.ts`, which is
  what a vector viewer shows for the exported hairline.
- **A4 (pale/yellow/green curves become ink on the light canvas).** Deliberate:
  `lib/contrastColor.ts` `resolveDrawColor` swaps any literal colour below
  WCAG contrast 2.2 against the canvas for the theme ink (written for Origin's
  black curves on the dark canvas). But it is luminance-only, so it also swaps
  saturated luminous hues: #00FF00 (1.3:1) and #FFFF80 (1.0:1) on the light
  canvas, which contradicts its own doc ("any hue at ~40-60% lightness
  untouched"; #00FF00 is HSL 50%). JV-Study Graph1 loses all three series
  identities this way. Owner decision needed: e.g. swap only near-achromatic
  colours, or keep the hue and darken it.
- Remaining gaps seen while verifying: category ticks still read 1, 2, 3 where
  Origin prints the text labels; a text X that is NOT the book's X (Catchment
  Graph1/2 Month) fails closed rather than drawing columns over categories;
  the spatial multi-panel and same-dataset double-Y apply paths do not yet
  apply the A2 recorded-X rule (no corpus page seen needing it).
