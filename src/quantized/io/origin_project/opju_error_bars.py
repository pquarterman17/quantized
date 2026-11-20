"""``.opju`` error-bar plots: draw their bars on the curve they decorate.

An error-bar DataPlot (record byte 76 ``0xe7`` = Origin plot 231 Y-error,
``0xe9`` = 233 X-error; ``opju_plot_gates``) is not a curve. It is left out
of the layer as ``error_bar_plot``. This module attaches its column to the
curve it decorates, wherever the binding is proven: ``yErr`` / ``xErr``
(symmetric bars), ``yErrPlus`` + ``yErrMinus`` / ``xErrPlus`` + ``xErrMinus``
(asymmetric bars), and ``errBand`` when Origin fills the Y error as a band.

**The record names the curve it decorates.** Offsets 35-36 of a plot record
hold the X column id (``opju_curve_token_x``). An error-bar plot's X is the
column of the curve its bars sit on, and offsets 37-38 then read ``30 61``
(``10 60`` on a non-Text & Numeric column) where a data curve reads
``21 61``. Plot order is not the binding: the decorated curve may come
before or after the error plot, and not next to it.

Evidence (``docs/origin_re/error_bars.md``):

* COM plot lists + Origin's exported graphs (owner corpus): ``Fixed Lambdas
  SI`` Graph1 plots ``I`` (SA), ``K`` (Theory SA), then the error column
  ``J``; its X field names ``I``, and Origin draws the bars on the SA
  scatter, not on the ``K`` line before ``J``. ``UnpolPlots`` NdNiO3NR plots
  ``H`` (dR Fresnel) FIRST, then ``G``; ``H`` names ``G``, and the bars are
  on ``G``.
* Distribution (both corpora): every X field names a column of the error
  column's own book; none names two data curves of the layer.
* Direction, record offset 23: bit ``0x01`` = plus, ``0x02`` = minus (3 =
  both); bit ``0x10`` = an X-error plot (on all 8 ``0xe9`` records and on the
  12 ``0xe7`` ones COM reads as 233). Which half is which is proven three
  ways: the author's column names in ``Graph_Template.opju`` (14 halves:
  ``Lower_Bound`` / ``XerrMinus*`` = 2, ``Upper_Bound`` / ``XerrPlus*`` = 1),
  and Origin's saved previews of its ``32New`` (bars ``T - U .. T + V``) and
  of ``PerceivedRiskandPrediction`` Graph1 (band ``C - B .. C + D``, B = 2).
  ``43Lollipop``'s X halves (minus = the X value, plus = 0) draw the lollipop
  stems from 0 to each point, as its preview does.
* Band, record offset 28 (``_BAND``): ``2`` = Origin fills the Y error as a
  band, ``0`` = bars. Error plots read only 0 or 2 (data curves 0 or 1).
  Every saved preview of a ``2`` plot draws a band (7 projects), every ``0``
  plot bars (20+ projects); ``calibration_for_fig4`` Graph2 draws both in one
  graph, bars exactly on its two ``0`` plots.
* What attaches, per curve and axis: one both-ways plot; a plus + minus pair
  (asymmetric, or one symmetric column when both hold the same values); two
  both-ways plots whose columns hold the same values (identical bars, either
  way). Two unequal both-ways plots, half a pair, mixed band flags, an X
  band, any other flag value stay left out.
* An error plot whose X names no data curve of its layer (a column the layer
  does not plot, or another error plot's column) draws nothing in Origin:
  ``calibration_for_fig4`` Graph3 keeps three such plots of Book6-8 and its
  preview has no bars there, while Graph2 plots those curves and draws their
  bands; ``PerceivedRiskandPrediction`` Graph29's ``F`` (naming the error
  column ``D``) and ``H`` (naming a curve of layer 2) draw nothing either.
  They are left out as ``error_bar_no_curve``, which is not a loss.
* A hidden error plot (offset 38 ``21``) is left out as
  ``hidden_in_origin`` (``opju_curve_token_x``) and never attaches: Origin
  draws no bars for it (public ``Fig3_e`` Graph1 preview).

``.opj`` stores the same record as its curve anchor (``opj_curves``), so it
uses the same rule. Cap width and colour are not decoded: bars and bands
take the curve's colour.

Two steps, because the pair rule needs the data: :func:`error_link` reads
the record while the layer decodes, and :func:`attach_error_bars` binds once
the books are imported. Pure ``io``: bytes and books in, plain values out.
"""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping, Sequence
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.origin_project.opju_plot_gates import PLOT_TYPE_OFF

__all__ = [
    "ERROR_BAR_NO_CURVE",
    "ERROR_BAR_PLOT",
    "ErrorLink",
    "attach_error_bars",
    "error_link",
    "link_error_plots",
]

ERROR_BAR_PLOT = "error_bar_plot"  # the omission reason (opju_plot_gates)
ERROR_BAR_NO_CURVE = "error_bar_no_curve"  # names no curve of its layer: Origin draws nothing
_Y_ERROR, _X_ERROR = 0xE7, 0xE9
_X_ID = 35  # u16 LE: the decorated curve's column id
_DIRECTION = 23  # bits 0x01 plus, 0x02 minus (3 = both); 0x10 = an X-error plot
_BAND = 28  # 2 = a filled band, 0 = bars
_BOTH = 3
_X_AXIS = 0x10
# the link keys a left-out note carries until attach_error_bars reads them
_DECORATES, _DIR, _AXIS, _FILL = "decorates", "direction", "axis", "band"
_LINK_KEYS = (_DECORATES, _DIR, _AXIS, _FILL)
# (axis, side) -> the curve field; side "" = symmetric
_FIELDS = {
    ("y", ""): "yErr",
    ("y", "+"): "yErrPlus",
    ("y", "-"): "yErrMinus",
    ("x", ""): "xErr",
    ("x", "+"): "xErrPlus",
    ("x", "-"): "xErrMinus",
}

#: ``(decorated column id, direction, "y" | "x", band)``
ErrorLink = tuple[int, int, str, bool]


def error_link(record: bytes | None) -> ErrorLink | None:
    """``(decorated column id, direction, "y" | "x", band)`` of an error-bar
    plot record, or ``None`` for any other record or an unreadable link.
    Offset 37 must be an error plot's (``0x30``, or ``0x10`` with the Text &
    Numeric bit clear), offset 38 a SHOWN plot's ``61`` / ``60``, and offset
    28 a value seen on error plots (0 bars, 2 band)."""
    if record is None or len(record) <= PLOT_TYPE_OFF:
        return None
    kind = record[PLOT_TYPE_OFF]
    if kind not in (_Y_ERROR, _X_ERROR):
        return None
    if record[_X_ID + 2] & 0xDF != 0x10 or record[_X_ID + 3] & 0xFE != 0x60:
        return None
    target = int.from_bytes(record[_X_ID : _X_ID + 2], "little")
    flags, band = record[_DIRECTION], record[_BAND]
    direction, axis = flags & _BOTH, "x" if flags & _X_AXIS else "y"
    # byte 76 0xe7 with bit 0x10 is an X-error plot (COM reads 233 on all 12)
    if not target or not direction or flags & ~(_BOTH | _X_AXIS) or band not in (0, 2):
        return None
    return None if kind == _X_ERROR and axis == "y" else (target, direction, axis, band == 2)


def link_error_plots(
    notes: Sequence[dict[str, str]],
    cids: Sequence[int],
    links: Sequence[ErrorLink | None],
    layer_ids: Collection[int] | None = None,
) -> None:
    """Mark each left-out error plot (``notes[i]`` reason ``error_bar_plot``,
    ``links[i]`` read) with the curve it decorates: the ONE kept data curve
    of the layer (``links[j] is None``, no reason) whose column id is the
    link's, in the same book and sheet. An error plot whose id names no data
    curve of the layer at all becomes ``error_bar_no_curve``. ``layer_ids``:
    every plot id of the layer, decoded or not (default: ``cids``), so a plot
    the decoder skipped is never mistaken for an absent one."""
    plotted = set(cids if layer_ids is None else layer_ids)
    errors = {c for c, n in zip(cids, notes, strict=True) if n["reason"] == ERROR_BAR_PLOT}
    curves = {c for c, n in zip(cids, notes, strict=True) if n["reason"] != ERROR_BAR_PLOT}
    for i, link in enumerate(links):
        if link is None or notes[i]["reason"] != ERROR_BAR_PLOT:
            continue
        target, direction, axis, band = link
        if target not in plotted or (target in errors and target not in curves):
            notes[i]["reason"] = ERROR_BAR_NO_CURVE
            continue
        hits = [j for j, c in enumerate(cids) if c == target and links[j] is None]
        if len(hits) != 1:
            continue
        data, note = notes[hits[0]], notes[i]
        if data["reason"] or (data["book"], data["recorded"]) != (note["book"], note["recorded"]):
            continue
        fill = "1" if band else ""
        note.update({_DECORATES: data["y"], _DIR: str(direction), _AXIS: axis, _FILL: fill})


def _values(books: Iterable[DataStruct]) -> dict[str, DataStruct]:
    out: dict[str, DataStruct] = {}
    for ds in books:
        name = str(ds.metadata.get("origin_book", ""))
        if name and isinstance(ds.metadata.get("origin_column_names"), list):
            out.setdefault(name, ds)
    return out


def _column(ds: DataStruct, name: str) -> np.ndarray[Any, Any] | None:
    names = [str(n) for n in ds.metadata["origin_column_names"]]
    if names.count(name) != 1:
        return None
    k = names.index(name)
    values = np.asarray(ds.values, dtype=float)
    return values[:, k] if values.ndim == 2 and k < values.shape[1] else None


def _bar_columns(ds: DataStruct, plots: list[dict[str, str]]) -> dict[str, str] | None:
    """One axis' error plots of a curve -> ``{side: column}`` (side ``""``
    symmetric, ``"+"`` / ``"-"`` the halves) if what Origin draws is proven."""
    cols = [c for p in plots if (c := _column(ds, p["y"])) is not None]
    if len(cols) != len(plots):
        return None
    dirs = sorted(p[_DIR] for p in plots)
    if dirs == [str(_BOTH)]:
        return {"": plots[0]["y"]}
    if len(plots) != 2 or dirs not in (["1", "2"], ["3", "3"]):
        return None
    if np.array_equal(cols[0], cols[1], equal_nan=True):  # identical bars, whichever is which
        return {"": plots[0]["y"]}
    if dirs == ["3", "3"]:  # two different both-ways bars: not proven
        return None
    return {"+" if p[_DIR] == "1" else "-": p["y"] for p in plots}


def _attach(curve: dict[str, Any], ds: DataStruct, axis: str, plots: list[dict[str, str]]) -> bool:
    """Set ``curve``'s error fields for one axis' plots; whether it did."""
    bands = {p.get(_FILL, "") for p in plots}
    if len(bands) != 1 or (axis == "x" and bands != {""}):
        return False  # mixed fill, or an X band: no proven rendering
    cols = _bar_columns(ds, plots)
    if cols is None:
        return False
    curve.update({_FIELDS[axis, side]: col for side, col in cols.items()})
    if bands == {"1"}:
        curve["errBand"] = True
    return True


def _plain(note: Mapping[str, str]) -> dict[str, str]:
    return {k: v for k, v in note.items() if k not in _LINK_KEYS}


def attach_error_bars(
    figs: list[dict[str, Any]], books: Iterable[DataStruct]
) -> list[dict[str, Any]]:
    """``figs`` with each proven error-bar plot drawn on its curve (the
    fields above) and its left-out note removed; every other note loses its
    link keys."""
    data = _values(books)
    out: list[dict[str, Any]] = []
    for fig in figs:
        notes = list(fig.get("curve_sheet_omitted") or [])
        if not any(_DECORATES in n for n in notes):
            out.append(fig)
            continue
        groups: dict[tuple[str, str, str], list[dict[str, str]]] = {}
        for n in notes:
            if _DECORATES in n:
                groups.setdefault((n["recorded"], n[_DECORATES], n[_AXIS]), []).append(n)
        curves = [dict(c) for c in fig.get("curves") or []]
        used: set[int] = set()
        for (book, y, axis), plots in groups.items():
            at = [k for k, c in enumerate(curves) if (c.get("book"), c.get("y")) == (book, y)]
            ds = data.get(book)
            if ds is not None and len(at) == 1 and _attach(curves[at[0]], ds, axis, plots):
                used.update(id(p) for p in plots)
        kept = [_plain(n) for n in notes if id(n) not in used]
        rest = {k: v for k, v in fig.items() if k != "curve_sheet_omitted"}
        out.append({**rest, "curves": curves, **({"curve_sheet_omitted": kept} if kept else {})})
    return out
