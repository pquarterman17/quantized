"""A histogram layer with Origin's cumulative-percent layer on top, drawn from Origin's own bins.

Origin's "Histogram + Probabilities" graph is a page of TWO layers: layer 1
bins a column (a row-less 219 plot, ``opju_stat_plots``), layer 2 draws a line
of the bin table Origin writes into a new sheet of the SAME book (``Book@N``:
bin centre X, counts, cumulative sum, cumulative percent). quantized's Stat
Stage bins with its own rule and cannot share a page with an XY layer, so such
a page was left out (``stat_layer_in_multi_layer_page``).

**The rule** (every part must hold, else the page is left as it was):

* the page has exactly two decoded layers with the same frame and the same
  X range;
* layer 1's only curve is a row-less histogram of book ``H``'s column ``T``;
* layer 2's only curve is on a sheet ``H@N`` of that book;
* the bin table reproduces the histogram: ``H@N``'s X column (layer 2's X)
  is finite, strictly increasing and evenly spaced (bin width ``w``), and some
  other column of ``H@N`` equals the bin counts of ``T``'s finite values over
  the edges ``X - w/2 .. X[-1] + w/2`` -- with every finite value inside them,
  bins closed on the left or (one rule for all bins) on the right.

The counts are recomputed from the raw column at import, so the bars drawn are
Origin's bins by construction, not by name. Layer 1's curve is then re-bound to
that counts column against the bin-centre X as a column plot (``plotType``
``"column"``; ``histogram_source`` names the binned column), and the page
draws as an ordinary two-layer double-Y figure: the bars on the left axis, the
cumulative line on the right, as Origin does. All four real pages also carry
Origin's ``HISTPROB`` ("Histogram + Probabilities") page template, an
independent field of the page header; the rule does not need it.

Not decoded (the figure says ``bar_width_not_decoded``): Origin draws the bins
edge to edge; quantized's column bars keep their 60 % width rule. The
cumulative line keeps its decoded line style (Origin's step connect is not
read for it).

Real corpus: ``SOP_meas`` Graph37 / 38 / 42 / 45 (``docs/origin_re/plot_kinds.md``).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np

from quantized.io.origin_project.opju_bar_kinds import book_column

__all__ = ["BAR_WIDTH_NOT_DECODED", "HISTOGRAM_SOURCE", "pair_histogram_cumulative"]

BAR_WIDTH_NOT_DECODED = "bar_width_not_decoded"
HISTOGRAM_SOURCE = "histogram_source"  # {book, y}: the column Origin binned


def _sheet_columns(books: Sequence[Any], book: str) -> list[str]:
    for bk in books:
        meta = getattr(bk, "metadata", {}) or {}
        if str(meta.get("origin_book") or "") == book:
            return [str(n) for n in meta.get("origin_column_names") or []]
    return []


def _counts_column(books: Sequence[Any], hist: dict[str, Any], line: dict[str, Any]) -> str | None:
    """The column of the bin sheet that holds the counts of the histogram's
    data over the bin sheet's X (module docstring), or ``None``."""
    sheet, x_col = str(line["book"]), str(line["x"])
    x = book_column(books, sheet, x_col)
    data = book_column(books, str(hist["book"]), str(hist["y"]))
    if x is None or data is None or x.size < 2 or not np.all(np.isfinite(x)):
        return None
    d = np.diff(x)
    if not (d[0] > 0 and np.allclose(d, d[0], rtol=1e-9, atol=0.0)):
        return None
    w = float(d[0])
    edges = np.append(x - w / 2, x[-1] + w / 2)
    v = data[np.isfinite(data)]
    if v.size == 0 or v.min() < edges[0] or v.max() > edges[-1]:
        return None
    left = np.searchsorted(edges, v, side="right") - 1  # [lo, hi)
    right = np.searchsorted(edges, v, side="left") - 1  # (lo, hi]
    rules = []
    for idx in (left, right):
        if np.all((idx >= 0) & (idx < x.size)):
            rules.append(np.bincount(idx, minlength=x.size).astype(float))
    for col in _sheet_columns(books, sheet):
        if col in (x_col, str(line["y"])):
            continue
        c = book_column(books, sheet, col)
        if c is not None and c.shape == x.shape and any(np.array_equal(c, r) for r in rules):
            return col
    return None


def pair_histogram_cumulative(
    figs: list[dict[str, Any]], books: Sequence[Any]
) -> list[dict[str, Any]]:
    """``figs`` with each histogram + cumulative-percent page's histogram
    layer re-bound to Origin's own bin table (module docstring)."""
    pages: dict[str, list[int]] = {}
    for i, f in enumerate(figs):
        if f.get("name"):
            pages.setdefault(str(f["name"]), []).append(i)
    out = list(figs)
    for idx in pages.values():
        if len(idx) != 2:
            continue
        first, second = sorted(idx, key=lambda i: int(figs[i].get("layer") or 0))
        a, b = figs[first], figs[second]
        ca, cb = a.get("curves") or [], b.get("curves") or []
        if len(ca) != 1 or len(cb) != 1:
            continue
        hist, line = ca[0], cb[0]
        book = str(hist.get("book", ""))
        if hist.get("x") != "" or hist.get("plotType") != "histogram" or "@" in book:
            continue
        if str(line.get("book", "")).rpartition("@")[0] != book or not line.get("x"):
            continue
        if not a.get("frame") or a.get("frame") != b.get("frame"):
            continue
        if (a.get("x_from"), a.get("x_to")) != (b.get("x_from"), b.get("x_to")):
            continue
        counts = _counts_column(books, hist, line)
        if counts is None:
            continue
        bars: dict[str, Any] = {
            "book": line["book"],
            "x": line["x"],
            "y": counts,
            "xRecorded": True,
            "plotType": "column",
        }
        if hist.get("color"):
            bars["color"] = hist["color"]
        source = {"book": book, "y": str(hist.get("y", ""))}  # the binned column
        out[first] = {**a, "curves": [bars], BAR_WIDTH_NOT_DECODED: True, HISTOGRAM_SOURCE: source}
    return out
