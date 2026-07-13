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

## Verified connection mode

A read-only comparison of 69 shared curve records against Origin COM dumps
found zero contradictions for byte 17:

| byte 17 | COM `line.connect` | Origin meaning |
|---|---|---|
| `0` | `1` | straight |
| `1` | `2` | two-point segments |

Two-point segments are now rendered as alternating pair strokes and gaps by a
custom uPlot path and by NaN-separated pairs in matplotlib publication export.
Straight remains an explicit decoded value and uses each renderer's normal line
path. Official connection codes are documented at
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
