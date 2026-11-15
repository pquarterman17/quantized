"""Read a built graph back FROM ORIGIN into ``oracle.json`` fields.

Everything here is a readback of Origin's live state, never a restatement
of what the builder asked for:

* plot type -- Origin C ``DataPlot::GetPlotType()`` (``qz_oracle.c``); LabTalk
  has no property for it and ``plotxy plot:=N`` accepts any N;
* datasets -- ``layer -c`` then ``%Z`` per layer, and each plot's
  ``[Book]Sheet!Col`` reference via ``range -w``, plus its X via ``xof``;
* axes -- ``layer.x/y.from/to/type`` per layer;
* style -- ``layer.plotN.color``, ``line.width``, ``line.connect``,
  ``symbol.kind``/``size`` and ``get %C -l/-d/-c`` (connect, dash, colour).

``session`` is an :class:`origin_session.OriginSession` with ``qz_oracle.c``
loaded.
"""

from __future__ import annotations

from typing import Any

__all__ = ["read_graph", "read_book_sheets"]

_PLOT_NUM = {
    "color": "layer.plot{i}.color",
    "line_width": "layer.plot{i}.line.width",
    "line_color": "layer.plot{i}.line.color",
    "line_connect": "layer.plot{i}.line.connect",
    "symbol_kind": "layer.plot{i}.symbol.kind",
    "symbol_size": "layer.plot{i}.symbol.size",
}
# `get <dataset> -<opt>` readbacks (the LabTalk set/get option letters).
_GET_OPTS = {"get_connect": "l", "get_dash": "d", "get_color": "c", "get_symbol": "k"}
_AXIS = ("from", "to", "type", "inc")


def _int(v: float | None) -> int | None:
    return None if v is None else int(v)


def _get(session: Any, opt: str) -> float | None:
    session.lt("double __g = -987654;")
    session.lt(f"get %C -{opt} __g;")
    v = float(session.app.LTVar("__g"))
    return None if v == -987654 else v


def _xof(session: Any) -> str:
    """X dataset of the active plot (the ``%A = xof(%C)`` idiom)."""
    session.lt("%A = xof(%C);")
    return str(session.lts('"%A"'))


def read_layer(session: Any, page: str, li: int) -> dict[str, Any]:
    """Layer ``li`` (0-based) of graph ``page``; the page must be active."""
    session.lt(f"page.active = {li + 1};")
    session.lt("layer -c;")
    layer: dict[str, Any] = {
        "index": li,
        "Z": session.lts('"%Z"').split(),
        "count": _int(session.ltn("count")),
        "axes": {
            ax: {k: session.ltn(f"layer.{ax}.{k}") for k in _AXIS} for ax in ("x", "y")
        },
        "plots": [],
    }
    n = _int(session.ltn(f'qz_nplots("{page}", {li})')) or 0
    for pi in range(n):
        i = pi + 1
        session.lt(f"layer.plot = {i};")
        session.lt(f"range -w __rp = {i};")
        plot: dict[str, Any] = {
            "index": pi,
            "plot_type": _int(session.ltn(f'qz_ptype("{page}", {li}, {pi})')),
            "ref": session.lts('"%(__rp)"'),
            "dataset": session.lts('"%C"'),
            "x_dataset": _xof(session),
        }
        for key, expr in _PLOT_NUM.items():
            plot[key] = session.ltn(expr.format(i=i))
        for key, opt in _GET_OPTS.items():
            plot[key] = _get(session, opt)
        layer["plots"].append(plot)
    return layer


def read_graph(session: Any, page: str) -> dict[str, Any]:
    session.lt(f"win -a {page};")
    nl = _int(session.ltn(f'qz_nlayers("{page}")')) or 0
    return {
        "page": page,
        "long_name": session.lts('"%(page.longname$)"'),
        "n_layers": nl,
        "layers": [read_layer(session, page, li) for li in range(nl)],
    }


def read_book_sheets(session: Any, book: str) -> dict[str, Any]:
    """Sheet names + row/col counts of a workbook, read back after build."""
    session.lt(f"win -a {book};")
    n = _int(session.ltn("page.nlayers")) or 0
    sheets = []
    for k in range(1, n + 1):
        session.lt(f"page.active = {k};")
        sheets.append({
            "name": session.lts("wks.name$"),
            "ncols": _int(session.ltn("wks.ncols")),
            "nrows": _int(session.ltn("wks.maxrows")),
        })
    return {"book": book, "sheets": sheets}
