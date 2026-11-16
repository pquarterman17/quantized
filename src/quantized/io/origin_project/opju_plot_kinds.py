"""``.opju`` curve plot kinds quantized can draw beyond line / scatter / bars.

Read from the curve record ``curve_style_color.opju_style_record``
reconstructs (the ``.opj`` curve-anchor layout; offsets in
``opju_plot_gates``). Each sets ``curve["plotType"]``; the frontend maps it
to a series style (``lib/originCurveText.ts::originCurveSeriesStyle``).

* **Area** -- byte 76 ``0xcc`` = Origin plot 204 (``worksheet -p 204 Area``;
  ``DataPlot::GetPlotType()`` reads 204). Origin fills each curve down to
  Y = 0, not to the axis (``area/negative``: fill crosses the X axis at 0),
  which is quantized's ``fill: "under"``.
* **Step** -- byte 76 ``0xc8`` (a line plot) with byte 17 = 11
  (``layer.plotN.line.connect = 7``, "step horizontal": hold Y to the next
  X, then jump), which is quantized's ``step: "post"``. The straight-line
  style stays withheld (``opju_plot_gates.withhold_step_style``).

Evidence (Origin 2026b Student COM, ``tools/plot_corpus``, 2026-11-15): every
area specimen's curve record (30 / 30) carries ``0xcc`` and every step
specimen's (27 / 27, plus one error-bar token) byte 17 = 11; no other
specimen type carries either. Real corpus (359 ``.opju``): 0 of the ~10,300
decoded curve records carry ``0xcc`` or byte 17 = 11, so no real file
changes. Stacked area (``0xd6`` = 214) and offset lines are NOT mapped:
quantized cannot draw them yet, so they stay the default line view.

* **Column** -- byte 76 ``0xcb`` = Origin plot 203: ``"column"`` (bars from
  zero at each X); a layer keeps it only for its ONLY column series
  (``opju_stat_plots``).
* **Box / histogram with no X column** -- byte 76 206 (box, violin, strip)
  or 219 (histogram) with record X id 0 (``x_not_a_column``): the curve is
  kept from its Y alone (``x == ""``) with ``"box"`` / ``"histogram"``
  (``rowless_kind``); ``opju_stat_plots`` resolves the box kind per page. A
  206 / 219 curve that is not row-less is omitted (``stat_x_reason``).

Byte 76 equals ``DataPlot::GetPlotType()`` on every plot of the 231 built
plot-corpus specimens (2026-11-15); real-corpus COM evidence for the column
and row-less curves is in ``opju_stat_plots``.

* **Bubble / colour-mapped scatter** -- a scatter (byte 76 ``0xc9``) whose
  token carries a plot-modifier block names the column that drives the
  symbol size or colour: ``SYSTEM 03 00 ce 02 01 d0 02 06 <n>`` then ``n``
  length-prefixed ``"<desig>|<dataset>"`` strings. ``<desig>`` is Origin C's
  ``COLDESIG_*`` (``OC_const.h``): 9 = ``COLDESIG_SIZE``, 18 =
  ``COLDESIG_EDGE_COLOR``. Read back with Origin C
  ``DataPlot::GetModifiers`` (Origin 2026b Student COM, 2026-11-15): every
  bubble specimen 9 -> column C, every colour-mapped one 18 -> C; on the real
  corpus every decoded block's designation and column equal Origin's (see
  ``ORIGIN_PLOT_TYPE_PARITY_PLAN`` item 7). A bubble block also stores a 12
  naming the same dataset, which ``GetModifiers`` does not report; it is
  tolerated only in that shape. ``curve["sizeBy"]`` / ``curve["colorBy"]``
  is the column's short name, set only when the dataset is a column of the
  curve's own sheet and the record proves the mode (:func:`apply_marker_modifiers`);
  any other modifier set leaves the curve as it was.

  COM agreement: of the 21 real-corpus 18-entries, 20 equal Origin's
  modifier; the 21st (``YbMnBi2_new_origin_reference_cloned``) names a book
  the plot no longer uses (Origin: ``PBANDMnSOC1`` etc., file:
  ``PBANDMnSOC``) -- the same-sheet rule rejects it. The mode: the record's
  symbol size u16 @25 = 101 marks "size from the column" (Plot Details
  ``SizeColIdx``, every bubble specimen); the edge colour u32 @306 =
  ``0x00400065`` is a colour MAP (Plot Details ``EdgeColor`` 0x2_0040_0065;
  ``colormapped`` PNG). Without the 0x40 flag it is Origin's colour INDEX
  mode (``Analysed and Plotted Graph`` Graph1: ``EdgeColor`` 0x2_0000_0065,
  legend "Red: short-like / Blue: long-like"), which ``colorBy`` would draw
  wrong; ``0x48`` (``SOP_meas``) and other low bytes are unproven. So only the
  exact specimen values are read; every real-corpus curve fails closed
  (0 real curves change).
"""

from __future__ import annotations

import re
from collections.abc import MutableMapping

from quantized.io.origin_project.opju_plot_gates import (
    CONNECT_OFF,
    PLOT_TYPE_OFF,
    STEP_HORIZONTAL,
    withhold_step_style,
)

__all__ = [
    "AREA_PLOT",
    "COLUMN_PLOT",
    "LINE_PLOT",
    "X_NOT_A_COLUMN",
    "apply_plot_kind",
    "mark_rowless",
    "rowless_kind",
    "stat_x_reason",
]

AREA_PLOT = 0xCC  # Origin plot 204
LINE_PLOT = 0xC8  # Origin plot 200
X_NOT_A_COLUMN = "x_not_a_column"  # opju_curve_token_x: the record X id is 0
# Plot types Origin draws with no X column (box family 206, histogram 219):
# kept from their Y alone, see ``opju_stat_plots``.
_ROWLESS = {206: "box", 219: "histogram"}
COLUMN_PLOT = 203  # Origin's vertical column plot (plotType "column")
_MAP_TYPES = frozenset({105, 220, 226, 243})  # heatmap, image, contour, XYZ contour


def apply_plot_kind(
    curve: MutableMapping[str, str | float], record: bytes | None, rowless: str | None = None
) -> None:
    """Set ``curve["plotType"]`` to ``"area"`` / ``"step"`` / ``"column"``
    when ``record`` proves it, or re-bind a row-less curve (``rowless``, from
    `rowless_kind`) to no X (see the module docstring); leave the curve as it
    is otherwise."""
    withhold_step_style(curve, record)
    if rowless:
        mark_rowless(curve, rowless)
        return
    if record is None or len(record) <= PLOT_TYPE_OFF:
        return
    kind = record[PLOT_TYPE_OFF]
    if kind == COLUMN_PLOT:
        curve["plotType"] = "column"
    elif kind == AREA_PLOT:
        curve["plotType"] = "area"
    elif kind == LINE_PLOT and record[CONNECT_OFF] == STEP_HORIZONTAL:
        curve["plotType"] = "step"


def rowless_kind(x_reason: str, record: bytes | None) -> str | None:
    """``"box"`` / ``"histogram"`` when a curve whose X field reads
    ``x_reason`` is a 206 / 219 plot with no X column (``opju_stat_plots``),
    else ``None``: the curve is then drawn from its Y alone."""
    if x_reason != X_NOT_A_COLUMN or record is None or len(record) <= PLOT_TYPE_OFF:
        return None
    return _ROWLESS.get(record[PLOT_TYPE_OFF])


def mark_rowless(curve: MutableMapping[str, str | float], kind: str) -> None:
    """Re-bind ``curve`` to no X with ``plotType`` ``kind``; a decoded
    line / scatter style is not what Origin draws, so it is dropped."""
    curve["x"] = ""
    curve["plotType"] = kind
    curve.pop("style", None)


SCATTER_PLOT = 0xC9  # Origin plot 201
SIZE_DESIG = 9  # COLDESIG_SIZE
EDGE_COLOR_DESIG = 18  # COLDESIG_EDGE_COLOR
_SIZE_SHADOW = 12  # stored beside a bubble's 9, not reported by GetModifiers
_MOD_BLOCK = re.compile(rb"SYSTEM\x03\x00\xce\x02\x01\xd0\x02\x06([\x01-\x10])", re.DOTALL)
_SIZE_FROM_COLUMN = b"\x65\x00"  # record u16 @25 (symbol size) on every bubble specimen
_SIZE_OFF = 25
_EDGE_COLOR_OFF = 306  # u32 symbol edge colour; 0x40 in byte 308 = colour-mapped
_COLORMAP_EDGE = b"\x65\x00\x40\x00"  # every colour-mapped specimen


def token_modifiers(b: bytes, start: int, end: int) -> list[tuple[int, str]] | None:
    """The ``(designation, dataset)`` modifier entries of the curve token
    spanning ``b[start:end]``, ``None`` when it has no (well-formed) block."""
    m = _MOD_BLOCK.search(b, start, end)
    if m is None:
        return None
    out: list[tuple[int, str]] = []
    q = m.end()
    for _ in range(m.group(1)[0]):
        if q >= end:
            return None
        ln = b[q]
        raw = b[q + 1 : q + 1 + ln]
        q += 1 + ln
        code, bar, name = raw.decode("utf-8", "replace").partition("|")
        if len(raw) != ln or not bar or not code.isdigit() or not name:
            return None
        out.append((int(code), name))
    return out


def _sheet_column(dataset: str, book: str) -> str | None:
    """The short column name of ``dataset`` when it is a column of ``book``
    (``Book`` or the pseudo-book ``Book@N`` of sheet N), else ``None``."""
    base, at, sheet = book.partition("@")
    suffix = f"@{sheet}" if at else ""
    if not dataset.startswith(f"{base}_") or not dataset.endswith(suffix):
        return None
    col = dataset[len(base) + 1 : len(dataset) - len(suffix) if suffix else None]
    if not col or "@" in col:
        return None
    return col


def apply_marker_modifiers(
    curve: MutableMapping[str, str | float],
    mods: list[tuple[int, str]] | None,
    record: bytes | None,
) -> None:
    """Set ``curve["sizeBy"]`` (bubble) or ``curve["colorBy"]`` (colour-mapped)
    when the token's modifier block and its record prove it (module
    docstring); leave the curve as it was otherwise."""
    if not mods or record is None or len(record) <= _EDGE_COLOR_OFF + 4:
        return
    if record[PLOT_TYPE_OFF] != SCATTER_PLOT:
        return
    codes = {c for c, _ in mods}
    names = {n for _, n in mods}
    if len(names) != 1:
        return
    col = _sheet_column(names.pop(), str(curve.get("book", "")))
    if col is None:
        return
    if codes in ({SIZE_DESIG}, {SIZE_DESIG, _SIZE_SHADOW}):
        if record[_SIZE_OFF : _SIZE_OFF + 2] == _SIZE_FROM_COLUMN:
            curve["sizeBy"] = col
            curve.pop("symbolSize", None)  # 101 = "from the column", not a size
    elif codes == {EDGE_COLOR_DESIG}:
        if record[_EDGE_COLOR_OFF : _EDGE_COLOR_OFF + 4] == _COLORMAP_EDGE:
            curve["colorBy"] = col


def stat_x_reason(stat: str | None, record: bytes | None) -> str:
    """``"stat_plot_x_not_decoded"`` for a 206 / 219 curve that is NOT
    row-less (its X field is undecodable or names a column): quantized cannot
    draw Origin's grouped box / histogram from it, and drawing it as a line
    against that X is a curve Origin does not show. ``""`` otherwise."""
    if stat is None and record is not None and len(record) > PLOT_TYPE_OFF:
        if record[PLOT_TYPE_OFF] in _ROWLESS:
            return "stat_plot_x_not_decoded"
    if record is not None and len(record) > PLOT_TYPE_OFF and record[PLOT_TYPE_OFF] in _MAP_TYPES:
        # a heatmap / contour / image is never an XY line (opju_map_plots binds it)
        return "map_plot_not_decoded"
    return ""
