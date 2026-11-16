"""``.opju`` heatmap / contour / ternary layers: the plot bound to its matrix or XYZ columns.

A graph layer's curve token (``opju_curve_token``) names ONE dataset id and
its record's byte 76 the plot type (``DataPlot::GetPlotType()``). An XY curve
resolves that id through the column-id table (``opju_figure_curves``); a map
plot names a dataset that table deliberately leaves out:

* **Matrix plots** -- 105 heatmap, 226 contour, 220 image (plan item 7 code
  table). The id is the matrix object's own column record, in the matrix
  book's page span: designation code 0, NO short name (offset 18 is NUL),
  flags 0x01 / 0x60 (``opju_column_fixed`` layout). A page holding exactly
  one such record and no named column is a one-matrix book; its id maps to
  the page name, which is the imported matrix book's ``origin_book``.
* **XYZ contour** -- 243. The id is the Z column (designation code 5,
  flags 0x00 / 0x60); its record's offset-35 associated id is its Y, whose
  own associated id is its X: the plot is ``(X, Y, Z)``.
* **Ternary** -- a scatter / line / line+symbol (201 / 200 / 202) on a page
  made from Origin's ``Ternary`` template, bound to a Z column the same way:
  Origin's axes are ``(A, B, C)`` = ``(X, Y, Z)`` in that order.

Evidence (Origin 2026b Student COM, ``DataPlot::GetRangeString`` /
``GetDatasetName``, 2026-11-15): ``heatmap_matrix`` ``[Mat]MSheet1!1``,
``contour_matrix`` ``[Mat]MSheet1!1``, ``contour_xyz``
``[XYZ]Sheet1!(A"x",B"y",C"height")``, ``ternary`` ``[Tern]Sheet1!(A,B,C)``
with ``GetCoordinateType()`` 2 -- every one equal to the chain above. Real
corpus: see ``ORIGIN_PLOT_TYPE_PARITY_PLAN`` item 7.

The figure gets ``map`` (``{"book", "kind"[, "x", "y", "z"]}``) or
``ternary`` (``{"book", "a", "b", "c"}``) only when that plot is the layer's
ONLY token: a map with XY overlays, a second map, a matrix book with more
than one matrix object, or a column on another sheet fails closed (the layer
keeps what it had). Colour levels / palette are not decoded: such a figure
carries ``map_scale_not_decoded`` (quantized draws its own colormap over the
data's own Z range). A map plot type whose dataset does not resolve is never
drawn as an XY line: ``map_plot_not_decoded`` names it instead.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from quantized.io.origin_project.curve_style_color import opju_style_record
from quantized.io.origin_project.opju_column_fixed import record_prefix
from quantized.io.origin_project.opju_curve_token import CURVE_TOKEN, column_id_records, token_id
from quantized.io.origin_project.opju_layer_kind import page_layer_kind
from quantized.io.origin_project.opju_plot_gates import PLOT_TYPE_OFF

__all__ = [
    "MAP_NOT_DECODED",
    "MAP_SCALE_NOT_DECODED",
    "MapIds",
    "bind_map_books",
    "layer_map",
    "map_ids",
]

MATRIX_KINDS = {105: "heatmap", 226: "contour", 220: "image"}
XYZ_CONTOUR = 243
_XY_TYPES = frozenset({200, 201, 202})  # a ternary layer's curves
MAP_SCALE_NOT_DECODED = "map_scale_not_decoded"
MAP_NOT_DECODED = "map_plot_not_decoded"
_TERNARY = ((re.compile(rb"(?i)ternary"), "ternary"),)
_Z_CODE = 5


@dataclass(frozen=True)
class MapIds:
    """``matrix``: id -> one-matrix book page; ``z``: Z column id -> (book,
    name, Y id); ``cols``: X / Y column id -> (book, name, associated id);
    ``pages``: the matrix book pages (book pages, not graph pages)."""

    matrix: dict[int, str] = field(default_factory=dict)
    z: dict[int, tuple[str, str, int]] = field(default_factory=dict)
    cols: dict[int, tuple[str, str, int, int]] = field(default_factory=dict)
    pages: frozenset[str] = frozenset()


def _name(buf: bytes, lit: bytes) -> str | None:
    end = buf.find(b"\x00", 18, 30)
    if end < 0 or not all(lit[18:end]):
        return None
    try:
        return buf[18:end].decode("ascii")
    except UnicodeDecodeError:
        return None


def map_ids(b: bytes, pages: Sequence[tuple[int, str]]) -> MapIds:
    """Matrix-object and column ids of every book page (module docstring)."""
    matrix: dict[int, str] = {}
    z: dict[int, tuple[str, str, int]] = {}
    cols: dict[int, tuple[str, str, int, int]] = {}
    seen: dict[int, tuple[str, str]] = {}
    poisoned: set[int] = set()
    bounds = [*pages, (len(b), "")]
    for (start, page), (end, _next) in zip(bounds, bounds[1:], strict=False):
        unnamed: list[int] = []
        named = False
        for off, cid, _fields in column_id_records(b, start, end):
            got = record_prefix(b, off)
            if got is None:
                continue
            buf, lit = got
            name = _name(buf, lit)
            if name is None or int.from_bytes(buf[4:6], "little") != cid:
                continue
            if seen.get(cid, (page, name)) != (page, name):
                poisoned.add(cid)
            seen[cid] = (page, name)
            code, flags = buf[17], (buf[37], buf[38])
            assoc = int.from_bytes(buf[35:37], "little")
            if not name:
                if code == 0 and flags == (0x01, 0x60) and assoc == 0:
                    unnamed.append(cid)
                continue
            named = True
            if code == _Z_CODE and flags == (0x00, 0x60):
                z[cid] = (page, name, assoc)
            elif code in (0, 3):
                cols[cid] = (page, name, assoc, code)
        if len(unnamed) == 1 and not named:
            matrix[unnamed[0]] = page
    for cid in poisoned:
        for d in (matrix, z, cols):
            d.pop(cid, None)
    return MapIds(matrix, z, cols, frozenset(matrix.values()))


def _xyz(ids: MapIds, cid: int, off_sheet: Mapping[int, str]) -> tuple[str, str, str, str] | None:
    """``(book, X, Y, Z)`` of a Z column: Z -> its Y -> the Y's X, one book,
    first sheet (an id on another sheet fails closed)."""
    zc = ids.z.get(cid)
    yc = ids.cols.get(zc[2]) if zc else None
    xc = ids.cols.get(yc[2]) if yc else None
    if zc is None or yc is None or xc is None or (yc[3], xc[3]) != (0, 3):
        return None
    if len({zc[0], yc[0], xc[0]}) != 1 or {cid, zc[2], yc[2]} & set(off_sheet):
        return None
    return zc[0], xc[1], yc[1], zc[1]


def layer_map(
    b: bytes,
    start: int,
    end: int,
    ids: MapIds,
    off_sheet: Mapping[int, str],
    page: tuple[int, str] | None,
) -> dict[str, Any]:
    """The ``map`` / ``ternary`` keys for the layer whose tokens lie in
    ``b[start:end]`` (module docstring); ``{}`` when it has no map plot."""
    tokens = list(CURVE_TOKEN.finditer(b, start, end))
    found: list[dict[str, Any]] = []
    plain = 0  # tokens that are not a map plot
    undecoded = False
    ternary: bool | None = None
    for m in tokens:
        cid = token_id(b, m)
        rec = opju_style_record(b, m.start() + 3)
        pt = rec[PLOT_TYPE_OFF] if rec is not None and len(rec) > PLOT_TYPE_OFF else None
        if pt in MATRIX_KINDS:
            if cid in ids.matrix:
                found.append({"map": {"book": ids.matrix[cid], "kind": MATRIX_KINDS[pt]}})
            else:
                undecoded = True
        elif pt == XYZ_CONTOUR:
            xyz = None if cid is None else _xyz(ids, cid, off_sheet)
            if xyz is None:
                undecoded = True
            else:
                bk, x, y, z = xyz
                found.append({"map": {"book": bk, "kind": "contour", "x": x, "y": y, "z": z}})
        elif pt in _XY_TYPES and cid in ids.z and page is not None:
            if ternary is None:
                ternary = page_layer_kind(b, page[0], page[1], _TERNARY) == "ternary"
            abc = _xyz(ids, cid, off_sheet) if ternary else None
            if abc is None:
                plain += 1
            else:
                bk, a, bb, c = abc
                found.append({"ternary": {"book": bk, "a": a, "b": bb, "c": c}})
        else:
            plain += 1
    if len(found) == 1 and not plain and not undecoded:
        return {**found[0], MAP_SCALE_NOT_DECODED: True}
    if found or undecoded:
        return {MAP_NOT_DECODED: True}
    return {}


def bind_map_books(figs: list[dict[str, Any]], books: Sequence[Any]) -> list[dict[str, Any]]:
    """Keep a figure's ``map`` / ``ternary`` only when the import produced its
    book -- a matrix map's book as a matrix (``origin_matrix``), an XYZ /
    ternary book as a worksheet; else drop it for ``map_plot_not_decoded``."""
    kinds: dict[str, bool] = {}
    for bk in books:
        meta = getattr(bk, "metadata", {}) or {}
        name = str(meta.get("origin_book") or "")
        if name and "@" not in name:
            kinds.setdefault(name, bool(meta.get("origin_matrix")))
    out: list[dict[str, Any]] = []
    for fig in figs:
        spec = fig.get("map") or fig.get("ternary")
        if not spec:
            out.append(fig)
            continue
        want_matrix = "map" in fig and "z" not in spec
        if kinds.get(str(spec.get("book"))) is want_matrix:
            out.append(fig)
            continue
        rest = {k: v for k, v in fig.items() if k not in ("map", "ternary", MAP_SCALE_NOT_DECODED)}
        out.append({**rest, MAP_NOT_DECODED: True})
    return out
