"""Origin pie and doughnut layers (plot 225), and the bar-plot group role.

**What the curve binds.** A pie plot's curve record names ``(X, Y)`` like
any other: the Y column holds the wedge VALUES, the X column the wedge
LABELS (a text X is the category list, a numeric X its values). Evidence:
``soil deep`` Graph3 / SOILDEEP1 (``soildeep``: X = A text, Y = B) print
52.3 % / 34.1 % / 13.6 % on their wedges in Origin's saved previews, which is
B's 69 / 45 / 18 over their sum, and the legend reads A's three labels. A
layer of several pie plots is a multi-ring DOUGHNUT: ``RSOS_SC_micstruc``
RSOS_SC_CIR (10 plots, ``Matlab`` A vs B..K) and ``RSOS_TC_micstruc``
RSOS_TC_CIR (9 plots) draw one ring per plot, the FIRST plot innermost,
each ring split by its own column's values, clockwise from 12 o'clock: the
wedge borders measured on the preview (ring by ring, every 0.5 degrees)
equal the cumulative shares of B..K within 1-2 degrees.

**The record** (the ``.opj`` curve-anchor layout ``curve_style_color``
reconstructs; offsets below). Corpus: 34 plot-225 records (public 351 +
owner 104 projects; ``generated/`` and the synthetic sets excluded) in four
projects -- 13 ``soil deep`` pies (``Pie2D`` / ``MergeGrap`` pages), 19
RSOS doughnut rings (``Doughnut`` pages) and 2 ``TEA_ExcelGraphs`` bar-of-pie
plots (``BarofPie`` pages):

* byte 206: ``00`` on every pie and bar-of-pie, ``01`` on every doughnut ring
  -- the doughnut flag. Byte 165: ``0x28`` = 40 on every ring; the previews'
  hole is 25 / 64 px = 0.39 of the outer radius (RSOS_SC_CIR, both axes),
  i.e. byte 165 is the hole size in percent. A pie stores ``0x32`` (50 %,
  Origin's default) there and draws no hole: the size is read only when
  the flag is set.
* bytes 27 and 114: ``04`` on both bar-of-pie plots, ``00`` on every pie and
  ring. A bar-of-pie is not drawn (its bar is not decoded): any non-zero
  value leaves the plot out.
* byte 150: ``0x5a`` = 90 on all 34 (the first wedge starts at 12 o'clock in
  every preview); another value is not read (left out). Every preview runs
  clockwise; no record byte varies with it in the corpus.

Wedge colours, the wedge labels Origin prints, the radius and explosion are
not decoded (``pie_marks_not_decoded``): quantized draws the theme's series
colours, the share in percent on a one-ring pie, and the labels as a legend.

**Group role** (``plot_group``): byte 6's ``0x30`` bits, the role byte of
``curve_style_color`` (``0x2_`` group head, ``0x1_`` member, ``0x0_``
standalone) read on bar-family plots, whose low bits differ from a line's.
Every corpus layer that Origin draws side by side (the grouped column pages
of ``plot_kinds.md``: ``fig_6_a`` Graph1, ``fig_7_a``, ``5_sidechain``,
``Supplemetary_Fig_9``, ``Figure_1`` / ``Figure_2``, ``TEA_ExcelGraphs``
Graph2) is one head plus members; the two-plot horizontal layers
``LSA_fig6`` Graph6 / Graph8 are standalone plots, and their previews draw
both bars at the same position with the same thickness, overlapping (a
translucent cyan over yellow reads green where they overlap: row 37
C = 0.512, E = 0.499 is green to 0.499 with a yellow tip). A GROUPED
turned layer is not decided by the role: ``TEA_ExcelGraphs`` Graph9 is a
head plus a member and still overlaps in its preview (the group's overlap
setting is not decoded), so it stays left out.
"""

from __future__ import annotations

from collections.abc import MutableMapping, Sequence
from typing import Any

from quantized.io.origin_project.opju_plot_gates import PLOT_TYPE_OFF

__all__ = [
    "PIE_MARKS_NOT_DECODED",
    "PIE_PLOT",
    "mark_pie",
    "pie_spec",
    "plot_group",
]

PIE_PLOT = 225
PIE_MARKS_NOT_DECODED = "pie_marks_not_decoded"
_DOUGHNUT_OFF = 206  # 00 pie, 01 doughnut
_HOLE_OFF = 165  # hole size in percent, read only on a doughnut
_START_OFF = 150  # 90: the first wedge at 12 o'clock
_BAR_OF_PIE_OFFS = (27, 114)  # 04 on a bar-of-pie, 00 on a pie / ring
_GROUP_OFF = 6
_GROUP_ROLES = {0x20: "head", 0x10: "member", 0x00: "standalone"}
_RECORD_LEN = _DOUGHNUT_OFF + 1


def pie_hole(record: bytes | None) -> float | None:
    """The hole of a pie plot's record as a fraction of the radius (``0.0``
    for a plain pie), or ``None`` when the record is not one quantized reads
    (module docstring)."""
    if record is None or len(record) < _RECORD_LEN or record[PLOT_TYPE_OFF] != PIE_PLOT:
        return None
    if record[_START_OFF] != 90 or any(record[o] for o in _BAR_OF_PIE_OFFS):
        return None
    flag = record[_DOUGHNUT_OFF]
    if flag == 0:
        return 0.0
    hole = record[_HOLE_OFF]
    return hole / 100.0 if flag == 1 and 0 < hole < 100 else None


def mark_pie(curve: MutableMapping[str, str | float], record: bytes | None) -> None:
    """``plotType`` ``"pie"`` plus its provisional ``pieHole`` when the
    record reads, else ``"not_drawn"`` (left out by ``opju_bar_kinds``)."""
    hole = pie_hole(record)
    if hole is None:
        curve["plotType"] = "not_drawn"
    else:
        curve["plotType"] = "pie"
        curve["pieHole"] = hole


def plot_group(record: bytes | None) -> str | None:
    """``"head"`` / ``"member"`` / ``"standalone"``: a bar-family plot's
    group role (module docstring); ``None`` when unreadable."""
    if record is None or len(record) <= _GROUP_OFF:
        return None
    return _GROUP_ROLES.get(record[_GROUP_OFF] & 0x30)


def pie_spec(
    curves: Sequence[dict[str, Any]],
    layers: int,
    template: str | None,
    is_book_x: Any,
) -> dict[str, Any] | None:
    """The ``pie`` figure key -- ``{"book", "x", "y": [...], "hole"}`` -- for
    a layer whose every curve is a read pie plot, or ``None`` to leave them
    out: the page has one layer, the plots share one sheet and its own X
    (``is_book_x(book, x)``), one hole, several plots only as doughnut
    rings, and the page template does not contradict the record
    (``BarofPie``, a ``Doughnut`` page with no hole or a ``Pie`` page with
    one)."""
    if layers != 1 or not curves or any(c.get("plotType") != "pie" for c in curves):
        return None
    holes = {c.get("pieHole") for c in curves}
    if len(holes) != 1:
        return None
    hole = holes.pop()
    if not isinstance(hole, float) or (len(curves) > 1 and hole <= 0):
        return None
    if template == "bar_of_pie" or (
        template in ("pie", "doughnut") and (template == "doughnut") != (hole > 0)
    ):
        return None
    pairs = {(str(c.get("book")), str(c.get("x"))) for c in curves}
    if len(pairs) != 1:
        return None
    book, x = pairs.pop()
    ys = [str(c.get("y")) for c in curves]
    if len(set(ys)) != len(ys) or not is_book_x(book, x):
        return None
    return {"book": book, "x": x, "y": ys, "hole": hole}
