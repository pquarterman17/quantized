"""Plan item 3: a family's data as the file a quantized user would import.

Pure (no server): the sheet Origin graphed, written as the CSV a user would
open, plus how the imported DataStruct's channels map back to the family's
columns so the recipe harness can replay the user's worksheet edits (Set As
designations, masked rows, log axes, curve styles) and the scorer can find
each Origin curve's column.

* The graph sheet is the one ``origin_build.make_graph`` activates: the first
  book's first sheet; a matrix family is written long-form ``x, y, z`` (the
  form the Map tab regrids -- quantized has no matrix-sheet import).
* Dates are written as ISO dates: Origin stores day numbers, a CSV carries the
  calendar date, and quantized's importer turns that into epoch seconds.
"""

from __future__ import annotations

import csv
import io
import math
from datetime import UTC, datetime, timedelta
from typing import Any

from quantized.io.origin_project.opj_books import ORIGIN_DAY_NUMBER_OF_UNIX_EPOCH

__all__ = [
    "ORIGIN_COLORS",
    "channel_map",
    "graph_columns",
    "header_of",
    "origin_day_to_unix",
    "prelude",
    "sheet_csv",
]

# Origin colour-list indices (1-based) -> hex: the default Origin palette.
ORIGIN_COLORS = {
    1: "#000000",
    2: "#ff0000",
    3: "#00ff00",
    4: "#0000ff",
    5: "#00ffff",
    6: "#ff00ff",
    7: "#ffff00",
    8: "#808000",
    9: "#000080",
    10: "#800080",
}
# `set %C -d`: 0 solid, 1 dash, 2 dot -> SeriesStyle.line.
_DASH = {0: "solid", 1: "dashed", 2: "dotted"}
# `set %C -k`: Origin symbol shapes 1 square, 2 circle, 3 up/4 down triangle.
_SYMBOL = {1: "square", 2: "circle", 3: "triangle", 4: "downtriangle"}


def origin_day_to_unix(day: float) -> float:
    return (day - ORIGIN_DAY_NUMBER_OF_UNIX_EPOCH) * 86400.0


def graph_columns(fam: dict[str, Any]) -> list[dict[str, Any]]:
    """The columns of the sheet Origin graphed (``origin_build.make_graph``)."""
    if not fam["books"]:
        m = fam["matrices"][0]
        rows, cols = len(m["values"]), len(m["values"][0])
        xs = [m["x1"] + (m["x2"] - m["x1"]) * j / (cols - 1) for j in range(cols)]
        ys = [m["y1"] + (m["y2"] - m["y1"]) * i / (rows - 1) for i in range(rows)]
        flat = [(xs[j], ys[i], m["values"][i][j]) for i in range(rows) for j in range(cols)]
        return [
            {
                "short": "x",
                "long": "x",
                "units": "",
                "designation": "X",
                "fmt": "numeric",
                "text": None,
                "values": [r[0] for r in flat],
            },
            {
                "short": "y",
                "long": "y",
                "units": "",
                "designation": "Y",
                "fmt": "numeric",
                "text": None,
                "values": [r[1] for r in flat],
            },
            {
                "short": "z",
                "long": m["name"],
                "units": "",
                "designation": "Z",
                "fmt": "numeric",
                "text": None,
                "values": [r[2] for r in flat],
            },
        ]
    return list(fam["books"][0]["sheets"][0]["columns"])


def header_of(col: dict[str, Any]) -> str:
    return f"{col['long']} ({col['units']})" if col["units"] else col["long"]


def _cell(col: dict[str, Any], i: int) -> str:
    if col.get("text") is not None:
        return str(col["text"][i])
    v = col["values"][i]
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return ""
    if col["fmt"] == "date":
        return (
            datetime(1970, 1, 1, tzinfo=UTC) + timedelta(seconds=origin_day_to_unix(v))
        ).strftime("%Y-%m-%d")
    return repr(float(v))


def sheet_csv(columns: list[dict[str, Any]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow([header_of(c) for c in columns])
    n = max(len(c["text"] if c.get("text") is not None else c["values"]) for c in columns)
    for i in range(n):
        w.writerow([_cell(c, i) for c in columns])
    return buf.getvalue()


def channel_map(columns: list[dict[str, Any]], ds: dict[str, Any]) -> dict[str, int]:
    """Family column short name -> imported channel (-1 = the X/time axis).

    Matched by label, since the importer may reorder (a text column moves to
    a categorical channel and the axis becomes a row index)."""
    out: dict[str, int] = {}
    labels = list(ds["labels"])
    x_name = str(ds.get("metadata", {}).get("x_column_name", ""))
    for col in columns:
        if col["long"] in labels:
            out[col["short"]] = labels.index(col["long"])
        elif header_of(col) == x_name or col["long"] == x_name:
            out[col["short"]] = -1
    return out


def _style(st: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if "c" in st:
        out["color"] = ORIGIN_COLORS.get(int(st["c"]))
    if "w" in st:
        out["width"] = st["w"] / 500.0  # 1/500 pt units -> pt (the Series card width)
    if "d" in st:
        out["line"] = _DASH[int(st["d"])]
    if "k" in st:
        out["markerShape"] = _SYMBOL.get(int(st["k"]), "circle")
    if "z" in st:
        out["markerSize"] = float(st["z"])
    return out


def prelude(
    fam: dict[str, Any],
    columns: list[dict[str, Any]],
    chan: dict[str, int],
    oracle: dict[str, Any],
) -> dict[str, Any]:
    """The worksheet edits a user makes before choosing a plot type, replayed
    by the harness: Set As for designations the CSV cannot carry, masked rows
    excluded, the family's log axes, and the curve styles the corpus set."""
    designations: dict[str, str] = {}
    for col in columns:
        ch = chan.get(col["short"])
        if ch is None or ch < 0 or col.get("text") is not None:
            continue  # the axis itself, or a text X (imported as a category)
        if col["designation"] in ("X", "Y-error", "X-error"):
            designations[str(ch)] = col["designation"]
    masked: list[int] = []
    if fam["books"]:
        for rows in fam["books"][0]["sheets"][0].get("masked_rows", {}).values():
            masked.extend(int(r) for r in rows)
    # Styles apply to layer 1's plots in order; skip the error-bar companions
    # (231/233), which are not curves in quantized.
    plots = oracle.get("graph", {}).get("layers", [{}])[0].get("plots", [])
    reqs = oracle.get("requested_styles", [])
    styles = [
        _style(s)
        for i, s in enumerate(reqs)
        if i >= len(plots) or plots[i]["plot_type"] not in (231, 233)
    ]
    return {
        "designations": designations,
        "excluded_rows": sorted(set(masked)),
        "axis": dict(fam.get("axis", {})),
        "styles": styles,
    }
