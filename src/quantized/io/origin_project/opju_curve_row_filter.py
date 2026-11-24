"""Draw a filtered ``.opju`` book's curves with only the rows its filter keeps.

Owner decision 2026-11-24 (ledger B-37, plan item 43): an imported curve from
a book with an Origin worksheet data filter plots exactly the rows the
decoded condition keeps (``opju_worksheet_filter``, ledger F-119), instead of
being left out. The curve carries the condition as its row subset::

    curve["rowFilter"] = {"column": <short name>, "op": ">", "value": 0.0}

and the frontend overlay (``lib/originRowFilter.ts``) draws the curve from a
copy of the book holding only the rows that pass. The condition, not a row
list, travels: it is evaluated on the book's current values, as Origin's
filter is, so a later edit of the worksheet cannot leave stale row indices.

Only a condition whose comparison is PROVEN is drawn: op ``02`` (``>``,
strict, simulated-IFN 1549 of 1600 where ``>=`` keeps 1550). Op ``04``
(``<``) keeps leaving the curves out (``worksheet_filter``): whether a row
equal to the threshold is kept is unproven (no tie in the COM oracle data),
so ``inclusive`` is ``None`` and the page is not drawable. Every other
doubt also leaves the curve out with that reason, never drawing all rows:

* the curve's sheet is not the one sheet the filter was stamped on, or its
  stamp disagrees with the page's condition;
* the filter column holds a non-finite value (how Origin treats a missing
  value under the condition is not proven);
* the condition keeps no row;
* the curve is a plot kind the frontend does not draw through the overlay
  (``plotType``, bubble / colour-map / floating / pie fields).

Evidence: COM ``sum()`` counts per plotted book (recorded 2026-11-15,
``docs/origin_project_format.md`` "Worksheet data filter"); ``kept_rows``
reproduces all 6 (``tests/test_io_origin_curve_row_filter.py``).

Pure ``io``: no web framework.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from typing import Any

from quantized.datastruct import DataStruct
from quantized.io.origin_project.opju_curve_sheets import without_captions, without_positions
from quantized.io.origin_project.opju_worksheet_filter import WORKSHEET_FILTER_KEY, page_filters

__all__ = [
    "ROW_FILTER_KEY",
    "WORKSHEET_FILTER",
    "apply_row_filters",
    "drawable_filter_pages",
    "kept_rows",
]

ROW_FILTER_KEY = "rowFilter"
WORKSHEET_FILTER = "worksheet_filter"

# curve fields of plot kinds drawn outside the frontend overlay path
_OTHER_KINDS = ("plotType", "sizeBy", "colorBy", "floatWidth", "pieHole", "plotGroup")


def _proven(cond: Mapping[str, object] | None) -> bool:
    return cond is not None and isinstance(cond.get("inclusive"), bool)


def drawable_filter_pages(raw: bytes) -> frozenset[str]:
    """Book pages whose filter condition decodes with a proven comparison."""
    return frozenset(page for page, cond in page_filters(raw).items() if _proven(cond))


def _passes(v: float, op: str, value: float, inclusive: bool) -> bool:
    if not math.isfinite(v):
        return False
    if inclusive and v == value:
        return True
    return v > value if op == ">" else v < value if op == "<" else False


def _column(ds: DataStruct, short: str) -> list[float] | None:
    md = ds.metadata
    if short == str(md.get("x_column_name", "") or ""):
        return [float(v) for v in ds.time]
    shorts = [str(c) for c in md.get("origin_column_names") or []]
    if shorts.count(short) != 1:
        return None
    k = shorts.index(short)
    return [float(row[k]) for row in ds.values]


def kept_rows(ds: DataStruct, cond: Mapping[str, Any]) -> list[int] | None:
    """The 0-based rows of ``ds`` that ``cond`` (a stamped
    ``origin_worksheet_filter``) keeps; ``None`` when it cannot be evaluated
    as proven (unproven comparison, missing column, a non-finite value)."""
    if not _proven(cond) or cond.get("op") not in (">", "<"):
        return None
    col = _column(ds, str(cond.get("column_short", "")))
    if col is None or not all(math.isfinite(v) for v in col):
        return None
    value, op, inclusive = float(cond["value"]), str(cond["op"]), bool(cond["inclusive"])
    return [i for i, v in enumerate(col) if _passes(v, op, value, inclusive)]


def _row_filter(
    curve: Mapping[str, Any], ds: DataStruct | None, page_cond: Mapping[str, Any]
) -> dict[str, Any] | None:
    """The curve's ``rowFilter``, or ``None`` to leave it out."""
    if ds is None or any(k in curve for k in _OTHER_KINDS):
        return None
    stamp = ds.metadata.get(WORKSHEET_FILTER_KEY)
    if not isinstance(stamp, Mapping):
        return None
    if any(stamp.get(k) != page_cond.get(k) for k in ("column", "op", "value", "inclusive")):
        return None
    rows = kept_rows(ds, stamp)
    if not rows:
        return None
    return {
        "column": str(stamp["column_short"]),
        "op": str(stamp["op"]),
        "value": float(stamp["value"]),
        "inclusive": bool(stamp["inclusive"]),
    }


def apply_row_filters(
    figs: list[dict[str, Any]], books: Iterable[DataStruct], raw: bytes
) -> list[dict[str, Any]]:
    """``figs`` with each curve of a drawable filtered book given its
    ``rowFilter``, or moved to ``curve_sheet_omitted`` (``worksheet_filter``,
    legend caption dropped) when any check in the module docstring fails."""
    conds = {p: c for p, c in page_filters(raw).items() if c is not None and _proven(c)}
    if not conds:
        return figs
    by_book: dict[str, list[DataStruct]] = {}
    for ds in books:
        by_book.setdefault(str(ds.metadata.get("origin_book", "")), []).append(ds)
    out: list[dict[str, Any]] = []
    for fig in figs:
        curves = [dict(c) for c in fig.get("curves") or []]
        drop: set[int] = set()
        for i, c in enumerate(curves):
            book = str(c.get("book", ""))
            page_cond = conds.get(book.partition("@")[0])
            if page_cond is None:
                continue
            held = by_book.get(book, [])
            rf = _row_filter(c, held[0] if len(held) == 1 else None, page_cond)
            if rf is None:
                drop.add(i)
            else:
                c[ROW_FILTER_KEY] = rf
        if not drop and curves == list(fig.get("curves") or []):
            out.append(fig)
            continue
        notes = list(fig.get("curve_sheet_omitted") or [])
        for i in sorted(drop):
            c = curves[i]
            notes.append(
                {
                    "book": str(c["book"]).partition("@")[0],
                    "x": str(c.get("x", "")),
                    "y": str(c.get("y", "")),
                    "recorded": str(c["book"]),
                    "reason": WORKSHEET_FILTER,
                }
            )
        new = {**fig, "curves": without_positions(curves, drop)}
        if drop:
            new["legend_labels"] = without_captions(fig.get("legend_labels") or [], drop)
            new["curve_sheet_omitted"] = notes
        out.append(new)
    return out
