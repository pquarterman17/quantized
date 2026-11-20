"""``.opju`` error-bar plots: draw their bars on the curve they decorate.

An error-bar DataPlot (record byte 76 ``0xe7`` = Origin plot 231 Y-error,
``0xe9`` = 233 X-error; ``opju_plot_gates``) is not a curve. It is left out
of the layer as ``error_bar_plot``. This module attaches its column to the
curve it decorates, as that curve's ``yErr``, wherever the binding is proven.

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
* Distribution (both corpora, 3,654 decoded error-bar records): every X
  field names a column of the error column's own book; 3,214 name exactly
  one data curve of the same layer, none names two; the other 440 name a
  column the layer does not plot (left out).
* Direction, record offset 23: bit ``0x01`` = plus, ``0x02`` = minus
  (1,491 records read 3 = both; 1,075 curves carry a ``1`` + ``2`` pair).
  Proven on ``Graph_Template.opju``: 14 halves on columns their author
  named ``Lower_Bound`` / ``LB_*`` / ``XerrMinus*`` (2) and ``Upper_Bound``
  / ``UB_*`` / ``XerrPlus*`` (1), and Origin's saved preview of ``32New``
  draws the bar extents ``T - U .. T + V`` (not the swapped ones). Bit
  ``0x10`` = an X-error plot: on all 8 ``0xe9`` records and on exactly 12
  ``0xe7`` ones (the 12 ``0xe7`` tokens COM reads as 233; their columns
  are the ``XerrMinus/Plus`` ones).
* What attaches: one both-ways Y plot, or a plus + minus pair whose two
  columns hold the same values on every row (symmetric bars). Unequal
  halves (asymmetric bars: the figure path carries one symmetric column),
  two plots in one direction or two both-ways plots, any other flag value
  and every X-error plot stay left out.
* A hidden error plot (offset 38 ``21``) is left out as
  ``hidden_in_origin`` (``opju_curve_token_x``) and never attaches: Origin
  draws no bars for it (public ``Fig3_e`` Graph1 preview); Graph2 plots the
  same columns shown, and its preview draws them.

``.opj`` stores the same record as its curve anchor (``opj_curves``), so it
uses the same rule; its error plots were drawn as lines before.

The bars' look (whiskers or a filled band, cap, colour) is not decoded:
quantized draws plain whiskers in the curve's colour.

Two steps, because the pair rule needs the data: :func:`error_link` reads
the record while the layer decodes, and :func:`attach_error_bars` binds once
the books are imported. Pure ``io``: bytes and books in, plain values out.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.origin_project.opju_plot_gates import PLOT_TYPE_OFF

__all__ = ["ERROR_BAR_PLOT", "attach_error_bars", "error_link", "link_error_plots"]

ERROR_BAR_PLOT = "error_bar_plot"  # the omission reason (opju_plot_gates)
_Y_ERROR, _X_ERROR = 0xE7, 0xE9
_X_ID = 35  # u16 LE: the decorated curve's column id
_DIRECTION = 23  # bits 0x01 plus, 0x02 minus (3 = both); 0x10 = an X-error plot
_BOTH = 3
_X_AXIS = 0x10
# the link keys a left-out note carries until attach_error_bars reads them
_DECORATES, _DIR, _AXIS = "decorates", "direction", "axis"


def error_link(record: bytes | None) -> tuple[int, int, str] | None:
    """``(decorated column id, direction, "y" | "x")`` of an error-bar plot
    record, or ``None`` for any other record or an unreadable link. Offset 37
    must be an error plot's (``0x30``, or ``0x10`` with the Text & Numeric
    bit clear) and offset 38 a SHOWN plot's ``61`` / ``60``."""
    if record is None or len(record) <= PLOT_TYPE_OFF:
        return None
    kind = record[PLOT_TYPE_OFF]
    if kind not in (_Y_ERROR, _X_ERROR):
        return None
    if record[_X_ID + 2] & 0xDF != 0x10 or record[_X_ID + 3] & 0xFE != 0x60:
        return None
    target = int.from_bytes(record[_X_ID : _X_ID + 2], "little")
    flags = record[_DIRECTION]
    direction, axis = flags & _BOTH, "x" if flags & _X_AXIS else "y"
    # byte 76 0xe7 with bit 0x10 is an X-error plot (COM reads 233 on all 12)
    if not target or not direction or flags & ~(_BOTH | _X_AXIS):
        return None
    return None if kind == _X_ERROR and axis == "y" else (target, direction, axis)


def link_error_plots(
    notes: Sequence[dict[str, str]],
    cids: Sequence[int],
    links: Sequence[tuple[int, int, str] | None],
) -> None:
    """Mark each left-out error plot (``notes[i]`` reason ``error_bar_plot``,
    ``links[i]`` read) with the curve it decorates: the ONE kept data curve
    of the layer (``links[j] is None``, no reason) whose column id is the
    link's, in the same book and sheet. Anything else stays unmarked."""
    for i, link in enumerate(links):
        if link is None or notes[i]["reason"] != ERROR_BAR_PLOT:
            continue
        target, direction, axis = link
        hits = [j for j, c in enumerate(cids) if c == target and links[j] is None]
        if len(hits) != 1:
            continue
        data, note = notes[hits[0]], notes[i]
        if data["reason"] or (data["book"], data["recorded"]) != (note["book"], note["recorded"]):
            continue
        note.update({_DECORATES: data["y"], _DIR: str(direction), _AXIS: axis})


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


def _bar_column(ds: DataStruct, plots: list[dict[str, str]]) -> str | None:
    """The column a curve's Y-error plots draw symmetric bars from, if proven."""
    if len(plots) == 1 and plots[0][_DIR] == str(_BOTH):
        return plots[0]["y"] if _column(ds, plots[0]["y"]) is not None else None
    if len(plots) == 2 and {p[_DIR] for p in plots} == {"1", "2"}:
        a, b = (_column(ds, p["y"]) for p in plots)
        if a is not None and b is not None and np.array_equal(a, b, equal_nan=True):
            return plots[0]["y"]
    return None


def _plain(note: Mapping[str, str]) -> dict[str, str]:
    return {k: v for k, v in note.items() if k not in (_DECORATES, _DIR, _AXIS)}


def attach_error_bars(
    figs: list[dict[str, Any]], books: Iterable[DataStruct]
) -> list[dict[str, Any]]:
    """``figs`` with each proven error-bar plot drawn as its curve's ``yErr``
    and its left-out note removed; every other note loses its link keys."""
    data = _values(books)
    out: list[dict[str, Any]] = []
    for fig in figs:
        notes = list(fig.get("curve_sheet_omitted") or [])
        if not any(_DECORATES in n for n in notes):
            out.append(fig)
            continue
        groups: dict[tuple[str, str], list[dict[str, str]]] = {}
        for n in notes:
            if _DECORATES in n and n[_AXIS] == "y":
                groups.setdefault((n["recorded"], n[_DECORATES]), []).append(n)
        curves = [dict(c) for c in fig.get("curves") or []]
        used: set[int] = set()
        for (book, y), plots in groups.items():
            at = [k for k, c in enumerate(curves) if (c.get("book"), c.get("y")) == (book, y)]
            ds = data.get(book)
            col = _bar_column(ds, plots) if ds is not None and len(at) == 1 else None
            if col is not None:
                curves[at[0]]["yErr"] = col
                used.update(id(p) for p in plots)
        kept = [_plain(n) for n in notes if id(n) not in used]
        rest = {k: v for k, v in fig.items() if k != "curve_sheet_omitted"}
        out.append({**rest, "curves": curves, **({"curve_sheet_omitted": kept} if kept else {})})
    return out
