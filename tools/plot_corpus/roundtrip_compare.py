"""Plan item 9: pure verdicts for one round-trip export read back from Origin.

Every item is ``match`` / ``wrong`` / ``missing`` / ``phantom`` with a reason:

* ``wrong``   -- Origin shows a value the exporter WROTE and it differs from
  the truth (a column's values, designation, long name or unit; a curve's X;
  the plot type; an axis type or a limit the script set; the book title);
* ``missing`` -- the path did not carry it (no graph on a data-only path, no
  style field, a row mask, an empty long name) -- a feature gap, not a lie;
* ``phantom`` -- Origin shows something the truth does not have (an extra
  column or curve).

The truth is the specimen's planted sheet (``scratch_data.graph_columns``:
values, long names, units, designations) and Origin's own graph of it
(``oracle.json``: curves, plot type, axes, styles). Designation codes are
quantized's own LabTalk table (``io._column_roles.LABTALK_COLUMN_TYPE``).
"""

from __future__ import annotations

import math
import re
import unicodedata
from typing import Any

from quantized.io._column_roles import LABTALK_COLUMN_TYPE

__all__ = ["DIMS", "Tally", "score_book", "score_graph", "score_shipped"]

DIMS = (
    "values",
    "designation",
    "long_name",
    "unit",
    "book_title",
    "shipped_import",
    "curves",
    "plot_type",
    "error_bars",
    "axis_type",
    "axis_range",
    "styles",
    "row_mask",
)
ERROR_BAR_TYPES = (231, 233)
# Origin's text escape for a character outside the code page, as the .opj
# writer writes it: Origin keeps it literally in ``lname$`` and draws the
# character in graph text (2026-11-16 PNG: ``2\(x03B8)`` -> "2θ").
_ESCAPE = re.compile(r"\\\(x([0-9A-Fa-f]{4})\)")
_REL = 1e-9
_ABS = 1e-12


class Tally:
    """Per-dimension verdict counts plus the first few reasons per verdict."""

    def __init__(self) -> None:
        self.d: dict[str, dict[str, Any]] = {}

    def add(self, dim: str, verdict: str, reason: str = "", n: int = 1) -> None:
        cell = self.d.setdefault(
            dim, {"match": 0, "wrong": 0, "missing": 0, "phantom": 0, "why": {}}
        )
        cell[verdict] += n
        if verdict != "match" and reason:
            why = cell["why"].setdefault(verdict, [])
            if reason not in why and len(why) < 6:
                why.append(reason)

    def to_json(self) -> dict[str, dict[str, Any]]:
        return self.d


def _num_equal(a: Any, b: Any) -> bool:
    if a is None or (isinstance(a, float) and math.isnan(a)):
        return b is None or b == "" or (isinstance(b, float) and math.isnan(b))
    if isinstance(b, str):
        try:
            b = float(b)
        except ValueError:
            return False
    if b is None:
        return False
    return math.isclose(float(a), float(b), rel_tol=_REL, abs_tol=_ABS)


def _values_verdict(truth: dict[str, Any], got: list[Any]) -> tuple[str, str]:
    want = truth["text"] if truth.get("text") is not None else truth["values"]
    # Trailing blank truth cells are no rows in Origin; any other shortfall is lost data.
    if len(got) < len(want) and not all(v is None for v in want[len(got) :]):
        return "wrong", f"{len(got)} of {len(want)} rows"
    bad = 0
    first = ""
    for i, w in enumerate(want):
        g = got[i] if i < len(got) else None
        ok = (str(g) == str(w)) if truth.get("text") is not None else _num_equal(w, g)
        if not ok:
            bad += 1
            if not first:
                first = f"row {i}: {g!r} for {w!r}"
    if bad:
        return "wrong", f"{bad}/{len(want)} cells differ ({truth['fmt']}; first {first})"
    extra = [g for g in got[len(want) :] if g not in (None, "")]
    if extra:
        return "wrong", f"{len(extra)} extra non-empty rows past the truth's {len(want)}"
    return "match", ""


def unescape(text: str) -> str:
    """``\\(xHHHH)`` escapes as the characters Origin draws for them, NFKC-
    normalised: the .opj writer deliberately writes the Greek mu as the
    Latin-1 micro sign (same glyph; NFKC maps one onto the other)."""
    return unicodedata.normalize("NFKC", _ESCAPE.sub(lambda m: chr(int(m.group(1), 16)), text))


def _find(cols: list[dict[str, Any]], truth: dict[str, Any], j: int) -> dict[str, Any] | None:
    """The read-back column of truth column ``j``: by long name, else by position."""
    named = [c for c in cols if unescape(c.get("long") or "") == unescape(truth["long"])]
    if named:
        return named[0]
    return cols[j] if j < len(cols) else None


def score_book(
    t: Tally, truth_cols: list[dict[str, Any]], books: list[dict[str, Any]], title: str
) -> None:
    """Data dimensions: the first read-back book's first sheet vs the truth."""
    if not books or not books[0]["sheets"]:
        for dim in ("values", "designation", "long_name", "unit"):
            t.add(dim, "missing", "no workbook in Origin", len(truth_cols))
        t.add("book_title", "missing", "no workbook in Origin")
        return
    if len(books) > 1:
        t.add("values", "phantom", f"{len(books)} workbooks for one dataset", len(books) - 1)
    book = books[0]
    got_title = book.get("long_name") or book.get("book", "")
    if got_title == title:
        t.add("book_title", "match")
    else:
        t.add("book_title", "wrong", f"{got_title!r} for {title!r}")
    cols = book["sheets"][0]["columns"]
    used: set[int] = set()
    for j, tc in enumerate(truth_cols):
        rc = _find(cols, tc, j)
        if rc is None:
            for dim in ("values", "designation", "long_name", "unit"):
                t.add(dim, "missing", f"no column for {tc['long']!r}")
            continue
        used.add(id(rc))
        v, why = _values_verdict(tc, rc.get("values", []))
        t.add("values", v, f"{tc['long']!r}: {why}")
        want_type = LABTALK_COLUMN_TYPE.get(tc["designation"])
        got_type = None if rc.get("type") is None else int(rc["type"])
        if got_type == want_type:
            t.add("designation", "match")
        else:
            t.add(
                "designation",
                "wrong",
                f"{tc['long']!r}: type {got_type} for {want_type} ({tc['designation']})",
            )
        for dim, key, want in (("long_name", "long", tc["long"]), ("unit", "unit", tc["units"])):
            got = unescape(rc.get(key) or "")
            if got == unescape(want):
                t.add(dim, "match")
            elif not got:
                t.add(dim, "missing", f"{tc['long']!r}: empty, truth {want!r}")
            else:
                t.add(dim, "wrong", f"{got!r} for {want!r}")
    for rc in cols:
        if id(rc) not in used:
            t.add("values", "phantom", f"extra column {rc.get('short')!r} ({rc.get('long')!r})")


def score_shipped(t: Tally, shipped: dict[str, Any] | None, nrows: int) -> None:
    """The .ogs run exactly as downloaded (its CSV named relative to nothing)."""
    if shipped is None:
        return
    rows = shipped.get("rows") or []
    if rows and max(rows) >= nrows:
        t.add("shipped_import", "match")
    else:
        t.add(
            "shipped_import", "wrong", f"as shipped the script imports {rows} rows, truth {nrows}"
        )


def _dataset_long(name: str, cols_by_book: dict[str, dict[str, str]]) -> str:
    book, _, col = name.partition("@")[0].rpartition("_")
    return cols_by_book.get(book, {}).get(col, f"?{name}")


def _curves(
    graph: dict[str, Any], cols_by_book: dict[str, dict[str, str]]
) -> dict[tuple[int, str], dict[str, Any]]:
    """(layer, Y long name) -> the plot (its X long name, type), error bars apart."""
    out: dict[tuple[int, str], dict[str, Any]] = {}
    for layer in graph.get("layers", []):
        for p in layer.get("plots", []):
            y = _dataset_long(p.get("dataset", ""), cols_by_book)
            entry = {
                "x": _dataset_long(p.get("x_dataset", ""), cols_by_book),
                "type": p.get("plot_type"),
                "plot": p,
            }
            key = (layer["index"], ("err:" if p.get("plot_type") in ERROR_BAR_TYPES else "") + y)
            out.setdefault(key, entry)
    return out


def score_graph(
    t: Tally,
    oracle_graph: dict[str, Any],
    oracle_cols: dict[str, dict[str, str]],
    graphs: list[dict[str, Any]],
    got_cols: dict[str, dict[str, str]],
    *,
    graph_path: bool,
    script: str = "",
) -> None:
    """Curves, plot type, error bars, axes and styles of the export's graph
    against Origin's own graph of the same data. ``graph_path`` is False for
    a data-only path (everything is missing: the path cannot express it)."""
    want = _curves(oracle_graph, oracle_cols)
    n_curves = sum(1 for k in want if not k[1].startswith("err:"))
    n_err = len(want) - n_curves
    if not graph_path or not graphs:
        why = "path writes data only" if not graph_path else "no graph in Origin"
        t.add("curves", "missing", why, n_curves)
        t.add("plot_type", "missing", why, n_curves)
        if n_err:
            t.add("error_bars", "missing", why, n_err)
        t.add("axis_type", "missing", why, 2)
        t.add("axis_range", "missing", why, 2)
        t.add("styles", "missing", why, n_curves)
        return
    got = _curves(graphs[0], got_cols)
    for key, w in want.items():
        g = got.get(key)
        dim = "error_bars" if key[1].startswith("err:") else "curves"
        if g is None:
            t.add(dim, "missing", f"layer {key[0] + 1} {key[1]!r} not plotted")
            if dim == "curves":
                t.add("plot_type", "missing", f"{key[1]!r} not plotted")
            continue
        if w["x"].startswith("?"):
            t.add(dim, "match")  # Origin's plot has no X column (box, histogram): Y decides
        elif g["x"] != w["x"]:
            t.add(dim, "wrong", f"{key[1]!r} against {g['x']!r}, Origin {w['x']!r}")
        else:
            t.add(dim, "match")
        if dim == "curves":
            if g["type"] == w["type"]:
                t.add("plot_type", "match")
            else:
                t.add("plot_type", "wrong", f"type {g['type']} for {w['type']}")
            t.add("styles", "missing", "no style field on the path")
    for key in got:
        if key not in want:
            dim = "error_bars" if key[1].startswith("err:") else "curves"
            t.add(dim, "phantom", f"layer {key[0] + 1} {key[1]!r}")
    lay_w = (oracle_graph.get("layers") or [{}])[0].get("axes", {})
    lay_g = (graphs[0].get("layers") or [{}])[0].get("axes", {})
    for ax in ("x", "y"):
        aw, ag = lay_w.get(ax, {}), lay_g.get(ax, {})
        if aw.get("type") == ag.get("type"):
            t.add("axis_type", "match")
        elif f"layer.{ax}.type" in script:
            t.add(
                "axis_type",
                "wrong",
                f"{ax} type {ag.get('type')} for {aw.get('type')} (script sets it)",
            )
        else:
            t.add(
                "axis_type",
                "missing",
                f"{ax} type {ag.get('type')} for {aw.get('type')} (not exported)",
            )
        lo, hi = aw.get("from"), aw.get("to")
        glo, ghi = ag.get("from"), ag.get("to")
        if None in (lo, hi, glo, ghi):
            t.add("axis_range", "missing", f"{ax} range unread")
            continue
        span = abs(hi - lo) or 1.0
        if abs(glo - lo) <= 0.05 * span and abs(ghi - hi) <= 0.05 * span:
            t.add("axis_range", "match")
        elif f"layer.{ax}.from" in script or f"layer.{ax}.to" in script:
            t.add(
                "axis_range",
                "wrong",
                f"{ax} [{glo:.4g}, {ghi:.4g}] for [{lo:.4g}, {hi:.4g}] (script sets it)",
            )
        else:
            t.add(
                "axis_range",
                "missing",
                f"{ax} [{glo:.4g}, {ghi:.4g}] for [{lo:.4g}, {hi:.4g}] (autoscaled, not exported)",
            )
