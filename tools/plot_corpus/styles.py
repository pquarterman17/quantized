"""LabTalk spellings the builder needs, derived from quantized where it decides.

* ``LT_DESIGNATION`` -- LabTalk ``wks.col.type`` for each designation wire
  string. Origin's LabTalk enum is the file enum + 1 (1 Y, 2 disregard,
  3 Y-error, 4 X, 5 label, 6 Z, 7 X-error), so it is computed from the
  writer's ``_DESIGNATION_CODE`` -- the same table quantized writes ``.opj``
  designations with -- rather than restated.
* ``curve_style`` -- the known per-curve style the corpus applies (LabTalk
  ``set %C -<opt> <val>``); the oracle then records what Origin reports.
"""

from __future__ import annotations

from quantized.io.origin_project.writer import _DESIGNATION_CODE

__all__ = [
    "LT_DESIGNATION", "LT_FORMAT", "STEP_HORIZONTAL_CONNECT", "STYLED_TYPES", "curve_style",
]

LT_DESIGNATION: dict[str, int] = {name: code + 1 for name, code in _DESIGNATION_CODE.items()}

# LabTalk wks.col.format: 1 numeric, 2 text, 4 date.
LT_FORMAT = {"numeric": 1, "text": 2, "date": 4}

# Origin colour-list indices: 2 red, 4 blue, 3 green, 6 magenta.
_COLORS = (2, 4, 3, 6)
_LINE_TYPES = {
    "line", "line_symbol", "step_horizontal", "double_y", "stacked_lines_offset", "polar",
}
# bubble / color_mapped are NOT styled: a fixed colour or symbol size overrides
# the very column mapping those types exist for (measured: `set -c` painted
# every colour-mapped point red; `set -z` flattened the bubble sizes).
_SYMBOL_TYPES = {"scatter", "line_symbol", "y_error"}
_FILL_TYPES = {"column", "stacked_column", "bar", "stacked_bar", "area", "stacked_area"}
STYLED_TYPES = frozenset(_LINE_TYPES | _SYMBOL_TYPES | _FILL_TYPES)

# `layer.plotN.line.connect` for a horizontal step. Measured 2026-11-15 by
# setting 0-14 and exporting PNGs: 1 none, 2 straight, 3 2-point segment,
# 4 3-point segment, 7 step horizontal, 8 step vertical, 9/10 centred steps.
# (`set %C -l n` uses a DIFFERENT numbering and has no step value 0-11.)
STEP_HORIZONTAL_CONNECT = 7


def curve_style(ptype: str, index: int) -> dict[str, int]:
    """``{set-option: value}`` for curve ``index`` of a ``ptype`` graph."""
    st = {"c": _COLORS[index % len(_COLORS)]}
    if ptype in _LINE_TYPES:
        st["w"] = 1000  # line width, 1/500 pt units -> 2 pt
        st["d"] = index % 3  # dash: 0 solid, 1 dash, 2 dot
    if ptype in _SYMBOL_TYPES:
        st["k"] = 2 + index % 3  # symbol shape
        st["z"] = 8
    return st
