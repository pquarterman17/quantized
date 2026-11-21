"""Floating-column (207) and vector (218) plots of a ``.opju`` layer, drawn as marks.

Neither kind is a series quantized can draw; both are rectangles / arrows at
DATA coordinates, so a resolved layer gets ``figure["data_marks"]`` -- a list
of ``{"kind": "rect" | "arrow", "x1", "y1", "x2", "y2", ...}`` the frontend
turns into plot shapes (``lib/originDataMarks``; screen and the matplotlib
export already draw shapes). The plots themselves leave ``curves``.
Everything not proven below stays left out (``plot_type_not_drawn``).

**Plot type** 207 / 218 is byte 76 of the curve record (``opju_plot_kinds``).
**Modifiers.** The token's modifier block (``opju_plot_kinds.token_modifiers``)
names extra columns by Origin C ``COLDESIG_*``: 39 on a floating column =
the width column, 13 / 14 on a vector = its X / Y end.

Floating column -- PROVEN on the two ``Degree of impact`` error-block pages
(Graph511, Graph512; saved previews, measured in pixels): exactly two 207
plots, a group head (record byte 6 ``& 0x30`` = ``0x20``, value 41) then a
member (``0x10``, value 17), both naming the same width column (39). One
rectangle per row, centred on the plots' X with the width column's value as
its FULL width, spanning the head's Y to the member's Y. Preview blocks of
Graph511 are 20 / 30 / 41 px wide for widths 0.4 / 0.6 / 0.8 on a 50.7 px
per unit axis, centred on X = 1 / 2 / 3; Graph512 (X, width, bottom and top
are four different columns) 25 / 25 / 40 px for 0.5 / 0.5 / 0.8 and
0.7..1.1 / 1.8..2.3 as 11 / 14 px tall. NOT proven, left out: three or more
floating plots (``Graph26``: bars between consecutive Y plots is a reading of
its preview only, its preview also has group gaps its X does not carry) and a
floating plot with no width column. The bar colour is not decoded (the
record's colour is the black outline; the preview fills green):
``data_marks_not_decoded``.

Vector -- PROVEN on the two XYXY vector plots of the corpus (``30流场`` Graph6,
``50流场`` Graph10): one 218 plot whose modifiers are exactly 13 and 14 on
columns of its own sheet; the arrow runs (X, Y) -> (X end, Y end). Every
arrow of Graph6 is horizontal (the end Y equals the start Y on all 227 rows)
from a station line to the profile the layer's other plot draws (end X vs end
Y), as the preview shows. The arrowhead's size is not decoded.

Both need a one-page layer (shapes are the page's, not a panel's) and are
capped at ``MAX_MARKS`` rows.
"""

from __future__ import annotations

from collections.abc import MutableMapping, Sequence
from typing import Any

import numpy as np

from quantized.io.origin_project.opju_plot_gates import PLOT_TYPE_OFF
from quantized.io.origin_project.opju_plot_kinds import _sheet_column

__all__ = [
    "DATA_MARKS",
    "DATA_MARKS_NOT_DECODED",
    "FLOAT_PLOT",
    "SCRATCH_KEYS",
    "VECTOR_PLOT",
    "apply_mark_modifiers",
    "resolve_marks",
]

FLOAT_PLOT = 207
VECTOR_PLOT = 218
WIDTH_DESIG = 39  # COLDESIG: the floating column's width
X_END_DESIG = 13
Y_END_DESIG = 14
MAX_MARKS = 2000
DATA_MARKS = "data_marks"
DATA_MARKS_NOT_DECODED = "data_marks_not_decoded"
SCRATCH_KEYS = ("floatWidth", "vectorX2", "vectorY2")  # curve keys read here, then dropped


def apply_mark_modifiers(
    curve: MutableMapping[str, str | float],
    mods: list[tuple[int, str]] | None,
    record: bytes | None,
) -> None:
    """Note the width column of a 207 plot (``curve["floatWidth"]``) or the end
    columns of a 218 plot (``vectorX2`` / ``vectorY2``) when the modifier block
    has exactly the proven shape and names columns of the curve's own sheet."""
    if not mods or record is None or len(record) <= PLOT_TYPE_OFF:
        return
    book = str(curve.get("book", ""))
    codes = [c for c, _ in mods]
    kind = record[PLOT_TYPE_OFF]
    if kind == FLOAT_PLOT and codes == [WIDTH_DESIG]:
        if col := _sheet_column(mods[0][1], book):
            curve["floatWidth"] = col
    elif kind == VECTOR_PLOT and sorted(codes) == [X_END_DESIG, Y_END_DESIG]:
        by = dict(mods)
        cx, cy = _sheet_column(by[X_END_DESIG], book), _sheet_column(by[Y_END_DESIG], book)
        if cx and cy:
            curve["vectorX2"], curve["vectorY2"] = cx, cy


def _column(books: Sequence[Any], book: str, col: str) -> np.ndarray | None:
    """Column ``col`` of ``book`` as floats: its X column or a named value
    column. ``None`` for anything else (never a row-index stand-in)."""
    for bk in books:
        meta = getattr(bk, "metadata", {}) or {}
        if str(meta.get("origin_book") or "") != book:
            continue
        names = [str(n) for n in meta.get("origin_column_names") or []]
        if col == str(meta.get("x_column_name") or ""):
            return np.asarray(bk.time, dtype=float)
        if col in names:
            return np.asarray(np.asarray(bk.values, dtype=float)[:, names.index(col)], dtype=float)
        return None
    return None


def _columns(books: Sequence[Any], book: str, cols: Sequence[str]) -> list[np.ndarray] | None:
    out = [_column(books, book, c) for c in cols]
    if any(c is None for c in out):
        return None
    arrays: list[np.ndarray] = [c for c in out if c is not None]
    return arrays if len({a.size for a in arrays}) == 1 else None


def _floating(curves: list[dict[str, Any]], books: Sequence[Any]) -> list[dict[str, Any]] | None:
    """The rectangles of the proven head + member pair, else ``None``."""
    head, member = curves
    book, x, width = str(head.get("book")), str(head.get("x")), head.get("floatWidth")
    if not (head.get("plotGroup") == "head" and member.get("plotGroup") == "member"):
        return None
    if not width or width != member.get("floatWidth"):
        return None
    if (str(member.get("book")), str(member.get("x"))) != (book, x):
        return None
    cols = _columns(books, book, [x, str(head.get("y")), str(member.get("y")), str(width)])
    if cols is None:
        return None
    xs, lo, hi, w = cols
    ok = np.isfinite(xs) & np.isfinite(lo) & np.isfinite(hi) & np.isfinite(w) & (w > 0)
    return [
        {
            "kind": "rect",
            "x1": float(xs[i] - w[i] / 2),
            "y1": float(min(lo[i], hi[i])),
            "x2": float(xs[i] + w[i] / 2),
            "y2": float(max(lo[i], hi[i])),
        }
        for i in np.flatnonzero(ok)
    ]


def _vector(curve: dict[str, Any], books: Sequence[Any]) -> list[dict[str, Any]] | None:
    """The arrows of the proven XYXY plot, else ``None``."""
    ends = (curve.get("vectorX2"), curve.get("vectorY2"))
    if not all(ends):
        return None
    book = str(curve.get("book"))
    cols = _columns(books, book, [str(curve.get("x")), str(curve.get("y")), *map(str, ends)])
    if cols is None:
        return None
    ok = np.logical_and.reduce([np.isfinite(c) for c in cols])
    extra: dict[str, Any] = {}
    if isinstance(curve.get("color"), str):
        extra["stroke"] = curve["color"]
    if isinstance(curve.get("lineWidth"), (int, float)):
        extra["width"] = max(0.5, float(curve["lineWidth"]))
    x, y, x2, y2 = cols
    return [
        {
            "kind": "arrow",
            "x1": float(x[i]),
            "y1": float(y[i]),
            "x2": float(x2[i]),
            "y2": float(y2[i]),
            **extra,
        }
        for i in np.flatnonzero(ok)
    ]


def resolve_marks(
    curves: list[dict[str, Any]], layers: int, books: Sequence[Any]
) -> tuple[list[dict[str, Any]], list[int], list[int]]:
    """``(marks, drawn, left_out)`` for the layer's provisional ``"floating"``
    and ``"vector"`` curves: the marks, the positions they replace, and the
    positions of plots to leave out (a kind that did not prove, module
    docstring)."""
    marks: list[dict[str, Any]] = []
    drawn: list[int] = []
    gone: list[int] = []
    for kind, size in (("floating", 2), ("vector", 1)):
        pos = [i for i, c in enumerate(curves) if c.get("plotType") == kind]
        if not pos:
            continue
        got = None
        if layers == 1 and len(pos) == size:
            plots = [curves[i] for i in pos]
            got = _floating(plots, books) if kind == "floating" else _vector(plots[0], books)
        if got:
            marks += got
            drawn += pos
        else:
            gone += pos
    if len(marks) > MAX_MARKS:
        return [], [], sorted(drawn + gone)
    return marks, sorted(drawn), sorted(gone)
