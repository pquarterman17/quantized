"""Column long names / units / designations from the ``.opju`` column records.

``windows_opju`` finds a book's labels by scanning the raw bytes for the
designation markers ``21 51`` / ``21 61`` / ``30 61`` ... -- the marker bytes
of a **Text & Numeric** column (``opju_column_fixed``). A Numeric, Text or
Date column writes ``01 50`` / ``01 60`` / ``10 60`` instead, so a book of
them (every book filled over COM or LabTalk, 617 records in 50 real corpus
files) got no labels, units or designations at all.

This reader starts from the column records themselves, which
``opju_curve_token.column_id_records`` locates structurally in every form:

* the **designation** is record offset 17 (``opju_column_fixed``), read for
  every column (codes 0-8: Y, disregard, Y-error, X, label, Z, X-error,
  group, subject -- each COM-proven on a specimen book, decode-plan item
  72); any other code leaves the sheet unlabelled;
* the **label** (long name / unit / comment) is the first label record after
  the column record and before the next one -- the same
  ``<LEB128 len><chunks><text><NUL>`` record and filters ``windows_opju``
  uses (``_find_label``);
* the **sheet**: records are grouped by the window's sheet headers
  (``opju_sheet_segments.SHEET_MARK``; none = one sheet) and a group belongs
  to the sheet that every id of it the id table places agrees on
  (``off_sheet``: absent = the book's first sheet). A group with no placed
  id, or two groups claiming one sheet, label nothing.

Fail closed: a sheet is labelled only when every column the worksheet scan
decoded for it has a record in its group, each column name has exactly one
record, and every designation code is known. Such a sheet takes these
by-name labels OVER ``windows_opju``'s positional reading, which marker
bytes inside label text shift (decode-plan item 73,
``opju._bind_by_record``); a positional reading that a record of the book's
own window contradicts (``contradicted_books``) is dropped.

**Evidence (Origin 2026b Student COM, 2026-11-15).** ``wks.col.type`` /
``lname$`` / ``unit$`` of the matched-pair book (8 columns, every
designation, numeric and Text & Numeric formats), Altaxo
``WksDifferentDiagramAssoc.opju`` (36 columns) and the plot-corpus
``error_columns`` specimen: every designation code and label agrees.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence

from quantized.io.origin_project.opju_column_fixed import (
    DESIGNATION_CODES,
    record_name,
    record_prefix,
)
from quantized.io.origin_project.opju_curve_token import column_id_records
from quantized.io.origin_project.opju_figure_curves import ColumnIdTable
from quantized.io.origin_project.opju_sheet_segments import SHEET_MARK
from quantized.io.origin_project.windows import BookMeta, ColumnMeta
from quantized.io.origin_project.windows_opju import _find_label

__all__ = ["contradicted_books", "record_column_metadata"]

_LABELLED = frozenset(DESIGNATION_CODES.values())  # every code COM proves (item 72)
_LABEL_REACH = 600  # bytes past the last column record searched for its label


def _record(b: bytes, off: int) -> tuple[str, str] | None:
    """``(short name, designation)`` of the column record at ``off``."""
    got = record_prefix(b, off)
    if got is None:
        return None
    buf, lit = got
    name = record_name(buf, lit)
    return None if name is None else (name, DESIGNATION_CODES.get(buf[17], ""))


def _groups(b: bytes, start: int, end: int) -> list[list[tuple[int, int, str, str]]]:
    """The page span's column records ``(offset, id, name, designation)``,
    one list per sheet header (``SHEET_MARK``); ``[]`` when a record falls
    before the first header or does not decode."""
    marks = [m.start() for m in SHEET_MARK.finditer(b, start, end)]
    groups: list[list[tuple[int, int, str, str]]] = [[] for _ in marks] or [[]]
    for off, cid, _fields in sorted(column_id_records(b, start, end)):
        rec = _record(b, off)
        if rec is None:
            continue
        k = sum(1 for m in marks if m < off) - 1 if marks else 0
        if k < 0:
            return []
        groups[k].append((off, cid, *rec))
    return [g for g in groups if g]


def _group_sheet(
    group: Sequence[tuple[int, int, str, str]],
    book: str,
    table: ColumnIdTable,
    off_sheet: Mapping[int, str],
) -> str:
    """The sheet key every placed id of ``group`` agrees on, else ``""``."""
    sheets = {
        off_sheet.get(cid, book)
        for _off, cid, _name, _d in group
        if table.ids.get(cid, ("", ""))[0] == book
    }
    return sheets.pop() if len(sheets) == 1 else ""


def record_column_metadata(
    b: bytes,
    pages: Sequence[tuple[int, str]],
    table: ColumnIdTable,
    off_sheet: Mapping[int, str],
    wanted: Mapping[str, Sequence[str]],
) -> dict[str, BookMeta]:
    """``{sheet key: BookMeta}`` for the sheets of ``wanted`` (sheet key ->
    decoded column names) whose column records label every column (module
    docstring)."""
    bounds = [*pages, (len(b), "")]
    claims: dict[str, list[list[tuple[int, int, str, str]]]] = defaultdict(list)
    span_end: dict[str, int] = {}
    for (start, book), (end, _next) in zip(bounds, bounds[1:], strict=False):
        if not any(k == book or k.startswith(book + "@") for k in wanted):
            continue
        for group in _groups(b, start, end):
            sheet = _group_sheet(group, book, table, off_sheet)
            if sheet:
                claims[sheet].append(group)
                span_end[sheet] = end
    out: dict[str, BookMeta] = {}
    for sheet, cols in wanted.items():
        groups = claims.get(sheet, [])
        if len(groups) != 1:
            continue
        group = groups[0]
        names = [name for _o, _c, name, _d in group]
        if len(set(names)) != len(names) or not set(cols) <= set(names):
            continue
        if any(d not in _LABELLED for _o, _c, name, d in group if name in cols):
            continue
        meta: dict[str, ColumnMeta] = {}
        for i, (off, _cid, name, desig) in enumerate(group):
            if name not in cols:
                continue
            last = min(span_end[sheet], off + _LABEL_REACH)
            nxt = group[i + 1][0] if i + 1 < len(group) else last
            label = _find_label(b, off, nxt)
            rows = (label.split("\r\n") if label else []) + ["", "", ""]
            meta[name] = ColumnMeta(name, desig, rows[0], rows[1], rows[2])
        base = sheet.partition("@")[0]
        out[sheet] = BookMeta(base, base, {c: meta[c] for c in cols})
    return out


def contradicted_books(
    b: bytes, pages: Sequence[tuple[int, str]], metas: Mapping[str, BookMeta]
) -> set[str]:
    """The books of ``metas`` (``windows_opju``'s positional reading) that a
    column record in the book's OWN window span contradicts: a column name
    with exactly one record in the span whose designation, or whose label
    when both carry one, differs from what the positional run attached."""
    bounds = [*pages, (len(b), "")]
    out: set[str] = set()
    for book, meta in metas.items():
        records: dict[str, list[tuple[str, str | None]]] = defaultdict(list)
        for (start, name), (end, _next) in zip(bounds, bounds[1:], strict=False):
            if name != book.partition("@")[0]:
                continue
            for group in _groups(b, start, end):
                for i, (off, _cid, col, desig) in enumerate(group):
                    nxt = group[i + 1][0] if i + 1 < len(group) else min(end, off + _LABEL_REACH)
                    records[col].append((desig, _find_label(b, off, nxt)))
        for col, cm in meta.columns.items():
            recs = records.get(col, [])
            if len(recs) != 1:
                continue
            desig, label = recs[0]
            long_name = label.split("\r\n")[0] if label else None
            if (cm.designation and desig and cm.designation != desig) or (
                long_name and cm.long_name and long_name != cm.long_name
            ):
                out.add(book)
                break
    return out
