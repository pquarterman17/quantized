"""Worksheet values and column metadata: the import vs the generator's truth.

Plan item 2 of ``plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md``. The truth is the
generator's ``family.json`` (``generate.py``: every planted cell); the import
side is :func:`table_of` over each imported DataStruct's metadata, the same
fields the frontend reads (``origin_book``, ``x_column_name``,
``origin_column_names``, ``column_designations``, ``origin_text_columns``).

Sheets pair by CONTENT, not by name: the import names sheet N ``Book@N`` and
an import that numbers sheets differently from Origin must not turn every
value into a false "wrong". An imported table holding a DELETED sheet's data
is a ``phantom`` (Origin no longer has that sheet).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from import_compare import verdict

__all__ = ["compare_matrix", "compare_sheet", "match_sheets", "table_of", "truth_sheets"]


def truth_sheets(family: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Every planted sheet, in book order: ``{book, sheet, deleted, columns}``."""
    out: list[dict[str, Any]] = []
    for book in family.get("books", []):
        for sheet in book.get("sheets", []):
            out.append(
                {
                    "book": book["name"],
                    "sheet": sheet["name"],
                    "deleted": bool(sheet.get("deleted")),
                    "columns": list(sheet.get("columns", [])),
                }
            )
    return out


def table_of(meta: Mapping[str, Any], time: Any, values: Any, labels: Sequence[str],
             units: Sequence[str]) -> dict[str, Any]:
    """One imported DataStruct as ``{id, matrix, columns: {letter: {...}}}``."""
    letters = [str(x) for x in (meta.get("origin_column_names") or [])]
    xname = str(meta.get("x_column_name") or "")
    desig = meta.get("column_designations") or {}
    text = meta.get("origin_text_columns") or {}
    vals = np.asarray(values, dtype=float)
    if vals.ndim == 1:
        vals = vals.reshape(-1, 1)
    cols: dict[str, dict[str, Any]] = {}
    if xname:
        cols[xname] = {
            "values": np.asarray(time, dtype=float),
            "label": str(meta.get("x_column_long") or xname),
            "units": str(meta.get("x_unit") or meta.get("x_column_unit") or ""),
            "designation": desig.get(xname),
        }
    for i, letter in enumerate(letters):
        if i >= vals.shape[1]:
            break
        cols[letter] = {
            "values": vals[:, i],
            "label": str(labels[i]) if i < len(labels) else letter,
            "units": str(units[i]) if i < len(units) else "",
            "designation": desig.get(letter),
        }
    for letter, cells in text.items():
        cols.setdefault(str(letter), {"label": str(letter), "units": "", "designation":
                                      desig.get(letter)})["text"] = [str(c) for c in cells]
    books = meta.get("origin_books") or []
    is_matrix = any(b.get("matrix") and b.get("name") == meta.get("origin_book") for b in books)
    return {
        "id": str(meta.get("origin_book") or ""),
        "long": str(meta.get("origin_book_long") or ""),
        "matrix": bool(is_matrix),
        "x_column_name": xname,
        "letters": letters,
        "columns": cols,
        "labels": [str(x) for x in labels],
        "time": np.asarray(time, dtype=float),
        "values": vals,
    }


def _truth_array(col: Mapping[str, Any]) -> np.ndarray:
    return np.array([np.nan if v is None else float(v) for v in col["values"]], dtype=float)


def _same(a: np.ndarray, b: np.ndarray) -> bool:
    return a.shape == b.shape and bool(np.array_equal(a, b, equal_nan=True))


def _sheet_content_matches(sheet: Mapping[str, Any], table: Mapping[str, Any]) -> bool:
    numeric = [c for c in sheet["columns"] if c.get("values") is not None]
    if not numeric:
        return False
    for c in numeric:
        got = table["columns"].get(c["short"], {}).get("values")
        if got is None or not _same(np.asarray(got, dtype=float), _truth_array(c)):
            return False
    return True


def match_sheets(
    sheets: Sequence[Mapping[str, Any]], tables: Sequence[Mapping[str, Any]]
) -> tuple[dict[tuple[str, str], str], list[dict[str, Any]]]:
    """``({(book, sheet): imported id}, phantom tables)``.

    A live sheet pairs with the imported table whose every numeric column
    equals it; failing that, with quantized's naming convention (``Book`` for
    the book's first live sheet, ``Book@N`` for the Nth). Unpaired imported
    tables are phantoms; one equal to a deleted sheet says so.
    """
    ids: dict[tuple[str, str], str] = {}
    used: set[int] = set()
    live_index: dict[str, int] = {}
    for s in sheets:
        if s["deleted"]:
            continue
        n = live_index[s["book"]] = live_index.get(s["book"], 0) + 1
        hit = next(
            (i for i, t in enumerate(tables) if i not in used and _sheet_content_matches(s, t)),
            None,
        )
        if hit is None:
            name = s["book"] if n == 1 else f"{s['book']}@{n}"
            hit = next(
                (i for i, t in enumerate(tables) if i not in used and t["id"] == name), None
            )
        if hit is not None:
            used.add(hit)
            ids[(s["book"], s["sheet"])] = str(tables[hit]["id"])
    phantoms: list[dict[str, Any]] = []
    for i, t in enumerate(tables):
        if i in used or t.get("matrix"):
            continue
        dead = next(
            (s for s in sheets if s["deleted"] and _sheet_content_matches(s, t)), None
        )
        phantoms.append(
            verdict(
                "phantom",
                quantized=t["id"],
                reason=(
                    f"holds deleted sheet {dead['book']}!{dead['sheet']}" if dead
                    else "matches no planted sheet"
                ),
            )
        )
    return ids, phantoms


def _meta_verdicts(col: Mapping[str, Any], got: Mapping[str, Any] | None,
                   display_units: str) -> dict[str, dict[str, Any]]:
    if got is None:
        return {
            k: verdict("omitted", origin=col.get(k2), reason="column_not_imported")
            for k, k2 in (("designation", "designation"), ("long_name", "long"), ("units", "units"))
        }
    out: dict[str, dict[str, Any]] = {}
    d = got.get("designation")
    out["designation"] = (
        verdict("omitted", origin=col["designation"], reason="no_designation_decoded")
        if not d
        else verdict("match" if d == col["designation"] else "wrong",
                     origin=col["designation"], quantized=d)
    )
    label = str(got.get("label") or "")
    if not col.get("long"):
        pass
    elif not label or label == col["short"]:
        out["long_name"] = verdict("omitted", origin=col["long"], reason="label_is_short_name")
    else:
        out["long_name"] = verdict("match" if label == col["long"] else "wrong",
                                   origin=col["long"], quantized=label)
    units = str(got.get("units") or "")
    if col.get("units"):
        if not units:
            out["units"] = verdict("omitted", origin=col["units"], reason="no_units_decoded")
        else:
            ok = units in (col["units"], display_units)
            out["units"] = verdict("match" if ok else "wrong", origin=col["units"], quantized=units)
    return out


def compare_sheet(
    sheet: Mapping[str, Any],
    table: Mapping[str, Any] | None,
    truth_units: Mapping[str, str] | None = None,
) -> dict[str, dict[str, Any]]:
    """Per column ``{"values": verdict, "designation"/"long_name"/"units": verdict}``.

    ``truth_units`` (``.truth.json``, short -> display unit) is the spelling
    quantized's axis title shows; either spelling matches.
    """
    out: dict[str, dict[str, Any]] = {}
    for col in sheet["columns"]:
        got = None if table is None else table["columns"].get(col["short"])
        disp = (truth_units or {}).get(col["short"], col.get("units", ""))
        res: dict[str, Any] = {}
        if got is None:
            res["values"] = verdict(
                "omitted", reason="sheet_not_imported" if table is None else "column_not_imported"
            )
        elif col.get("text") is not None:
            cells = got.get("text")
            if cells is None:
                res["values"] = verdict("omitted", reason="text_column_not_imported")
            else:
                same = list(cells) == [str(c) for c in col["text"]]
                res["values"] = verdict("match" if same else "wrong", n=len(col["text"]))
        else:
            want = _truth_array(col)
            have = got.get("values")
            if have is None:
                res["values"] = verdict("omitted", reason="numeric_column_not_imported")
            else:
                have = np.asarray(have, dtype=float)
                if _same(have, want):
                    res["values"] = verdict("match", n=int(want.size))
                elif have.shape != want.shape:
                    res["values"] = verdict("wrong", n=int(want.size), n_imported=int(have.size))
                else:
                    diff = ~((have == want) | (np.isnan(have) & np.isnan(want)))
                    fin = diff & np.isfinite(have) & np.isfinite(want)
                    res["values"] = verdict(
                        "wrong",
                        n=int(want.size),
                        n_diff=int(diff.sum()),
                        first_row=int(np.argmax(diff)),
                        max_abs=float(np.max(np.abs(have[fin] - want[fin]))) if fin.any() else None,
                    )
        res.update(_meta_verdicts(col, got, disp))
        out[col["short"]] = res
    return out


def compare_matrix(matrix: Mapping[str, Any], table: Mapping[str, Any] | None) -> dict[str, Any]:
    """A planted matrix (``values`` nrows x ncols) vs an imported long-form
    X/Y/Z table (the value channel labelled ``Z``, else the last one)."""
    want = np.array([[np.nan if v is None else v for v in row] for row in matrix["values"]],
                    dtype=float)
    if table is None:
        return verdict("omitted", reason="matrix_not_imported")
    vals = np.asarray(table["values"], dtype=float)
    if vals.ndim != 2 or vals.shape[0] != want.size:
        return verdict("wrong", n=int(want.size), shape=list(vals.shape))
    labels = list(table.get("labels") or [])
    z = vals[:, labels.index("Z") if "Z" in labels else vals.shape[1] - 1]
    if _same(z.reshape(want.shape), want):
        return verdict("match", n=int(want.size), layout="row_major")
    if _same(z.reshape(want.shape[::-1]).T, want):
        return verdict("match", n=int(want.size), layout="column_major")
    return verdict("wrong", n=int(want.size))
