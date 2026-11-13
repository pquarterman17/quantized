"""Worksheet data of a CPYUA ``.opju`` project, with a loss-aware report.

One pass over the project's dataset records (``opju_records.scan_records``)
yields the numeric columns, the text columns, and a JSON-serializable
*worksheet fidelity* summary that says what was NOT read and why. The summary
is the fail-closed half of the contract: a record whose form is not positively
identified is omitted from the data and counted here — never guessed at, and
never silent.

Precedence, per dataset record:

1. the **structural** decode (header → record grammar), when it validates;
2. otherwise the frozen **marker** scan (``opju_codec.scan_marked_columns``)
   if it happens to decode a numeric run inside that record — the pre-existing
   behaviour, kept so no column that used to load is lost;
3. otherwise the record is reported as undecoded.

Names come from the dataset header itself. (The marker scan labels a record
with the nearest preceding *length-prefixed* name; a header name that contains
a run of three or more equal characters is run-length coded and so loses its
head there — an invented name such as ``runQQQx_A`` keeps at most the part
after its run — which merged unrelated books. The header name is the whole name.)
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

from quantized.io.origin_project.opju_codec import scan_marked_columns
from quantized.io.origin_project.opju_matrix import MatrixGeometry, matrix_geometry
from quantized.io.origin_project.opju_records import (
    BUDGET_REASON,
    DatasetRecord,
    orphan_records,
    scan_records,
)

__all__ = ["MatrixBook", "WorksheetScan", "scan_worksheet"]

Columns = list[tuple[str, NDArray[np.float64]]]
TextColumns = list[tuple[str, list[str]]]

_MAX_EXAMPLES = 5


@dataclass(frozen=True)
class MatrixBook:
    """One matrix object: ``values`` is ``rows × cols`` (row-major on disk)."""

    name: str
    values: NDArray[np.float64]
    geometry: MatrixGeometry


@dataclass(frozen=True)
class WorksheetScan:
    """Decoded worksheet content of one project plus its fidelity summary.

    ``column_status`` lists every column record of each book in file order
    with what became of it — ``numeric``, ``text``, ``undecoded`` or
    ``report`` — so the book builder can tell whether a numeric column is
    really the first column of its book (see ``opju_book_checks.x_unconfirmed``).
    ``losses`` names, per book, the columns behind each fidelity loss.
    """

    columns: Columns
    text_columns: TextColumns
    matrices: list[MatrixBook] = field(default_factory=list)
    fidelity: dict[str, object] = field(default_factory=dict)
    column_status: dict[str, list[tuple[str, str]]] = field(default_factory=dict)
    losses: dict[str, dict[str, list[str]]] = field(default_factory=dict)


def _book_of(name: str) -> str:
    """The pseudo-book a dataset name groups under (mirrors ``opj._group_named``)."""
    book, _, col = name.rpartition("_")
    _, _, sheet = col.partition("@")
    return f"{book}@{sheet}" if sheet else book


def _owner(records: list[DatasetRecord], size: int, marker: int) -> DatasetRecord | None:
    """The record whose byte range holds ``marker``: from the end of its
    header to its decoded end, or — undecoded — to the next header."""
    lo, hi = 0, len(records)
    while lo < hi:  # last record whose header ends at or before the marker
        mid = (lo + hi) // 2
        if records[mid].header.end <= marker:
            lo = mid + 1
        else:
            hi = mid
    if lo == 0:
        return None
    rec = records[lo - 1]
    if rec.decoded:
        return rec if marker < rec.end else None
    nxt = records[lo].header.start if lo < len(records) else size
    return rec if marker < nxt else None


def _short(name: str) -> str:
    """A dataset name's column short name (``Book_C@2`` -> ``C``)."""
    return name.rpartition("_")[2].partition("@")[0]


def scan_worksheet(
    b: bytes,
    marked: list[tuple[int, str, NDArray[np.float64]]] | None = None,
    report_markers: list[int] | None = None,
) -> WorksheetScan:
    """Decode every worksheet column of ``b`` and summarize what was lost.

    ``marked`` is the frozen marker scan's result for ``b`` when the caller
    already has it (``opju`` needs it anyway); it is computed otherwise.
    ``report_markers`` are the record offsets ``opju_reports`` read; with
    them, a report-form record that pass did not read is reported as
    undecoded instead of being counted as read.
    """
    unread: list[tuple[str, int]] = []
    records = scan_records(b, unread)
    orphans = orphan_records(b, {r.header.end for r in records} | {end for _, end in unread})
    fallback: dict[int, NDArray[np.float64]] = {}  # header start -> marker-scan values
    unanchored: list[tuple[int, str, NDArray[np.float64]]] = []
    # The marker scan always runs: it is the safety net for a record whose
    # header the structural path never found (an unrecognized header leaves
    # no record to report as undecoded — without this pass its column would
    # vanish without a trace). Its FPC decodes are shared with the
    # structural pass (``opju_codec.shared_fpc_decodes``).
    for marker, name, vals in scan_marked_columns(b) if marked is None else marked:
        owner = _owner(records, len(b), marker)
        if owner is None:
            unanchored.append((marker, name, vals))
        elif not owner.decoded:
            fallback.setdefault(owner.header.start, vals)

    # header starts of the records ``opju_reports`` read (None: not asked)
    report_read = (
        None
        if report_markers is None
        else {o.header.start for m in report_markers if (o := _owner(records, len(b), m))}
    )
    numeric: list[tuple[int, str, NDArray[np.float64]]] = []
    text: list[tuple[int, str, list[str]]] = []
    confidence: Counter[str] = Counter()
    undecoded: dict[tuple[str, str], list[str]] = {}
    matrices: list[MatrixBook] = []
    matrix_report: list[dict[str, object]] = []
    datasets_end = max((r.end for r in records), default=0)
    book_names = tuple(dict.fromkeys(_book_of(r.header.name) or r.header.name for r in records))
    complex_cols: list[str] = []
    stale_cols: list[str] = []
    text_unresolved: list[str] = []
    over_budget: list[str] = []
    bad_checksum: list[str] = []  # read, but the stored checksum disagrees
    report_columns = 0
    status: dict[str, list[tuple[str, str]]] = {}
    losses: dict[str, dict[str, list[str]]] = {}

    def lose(kind: str, name: str) -> None:
        losses.setdefault(_book_of(name), {}).setdefault(kind, []).append(_short(name))

    for rec in records:
        h = rec.header
        pos = h.start
        if rec.checksum_ok is False and (rec.decoded or pos in fallback):
            bad_checksum.append(h.name)
            if h.is_column:
                lose("checksum_failed", h.name)
            else:
                losses.setdefault(h.name, {}).setdefault("checksum_failed", []).append(h.name)
        if not h.is_column:
            if rec.decoded and rec.values is not None:
                cells = h.total_rows
                geo = (
                    matrix_geometry(b, h.name, cells, start=datasets_end, other_books=book_names)
                    if rec.values.size == cells
                    else None
                )
                entry: dict[str, object] = {
                    "name": h.name,
                    "cells": cells,
                    "imported": geo is not None,
                }
                if geo is None:
                    entry["reason"] = "matrix shape not located in the windows section"
                else:
                    entry.update(rows=geo.rows, cols=geo.cols, ranges_known=geo.x_range is not None)
                    matrices.append(MatrixBook(h.name, rec.values.reshape(geo.rows, geo.cols), geo))
                    if rec.form == "complex":
                        complex_cols.append(h.name)
                        # a matrix is its own book; its "column" is the whole matrix
                        matrix_losses = losses.setdefault(h.name, {})
                        matrix_losses.setdefault("complex_imaginary", []).append(h.name)
                matrix_report.append(entry)
            else:
                undecoded.setdefault(
                    ("dataset", rec.reason or "not a worksheet column"), []
                ).append(h.name)
                if rec.reason == BUDGET_REASON:
                    over_budget.append(h.name)
            continue
        book_status = status.setdefault(_book_of(h.name), [])
        if not rec.decoded:
            if pos in fallback:
                numeric.append((pos, h.name, fallback[pos]))
                confidence["marker_fallback"] += 1
                book_status.append((_short(h.name), "numeric"))
            elif rec.form == "report" and (report_read is None or h.start in report_read):
                report_columns += 1  # opju_reports reads this family
                book_status.append((_short(h.name), "report"))
            elif rec.form == "report":
                reason = "report-sheet record not read"
                undecoded.setdefault((rec.form, reason), []).append(h.name)
                book_status.append((_short(h.name), "undecoded"))
                lose("undecoded", h.name)
            else:
                undecoded.setdefault((rec.form, rec.reason or "undecoded"), []).append(h.name)
                book_status.append((_short(h.name), "undecoded"))
                lose("undecoded", h.name)
                if rec.reason == BUDGET_REASON:
                    over_budget.append(h.name)
            continue
        confidence[rec.confidence] += 1
        if rec.confidence == "grammar_only":
            lose("grammar_only", h.name)
        if "stale_cells" in rec.extra:
            stale_cols.append(h.name)
            lose("stale_cells", h.name)
        if "text_unresolved" in rec.extra:
            text_unresolved.append(h.name)
            lose("text_unresolved", h.name)
        if rec.form == "complex":
            complex_cols.append(h.name)
            lose("complex_imaginary", h.name)
        has_text = rec.text is not None and any(rec.text)
        has_numbers = rec.values is not None and bool(np.isfinite(rec.values).any())
        kept_numeric = rec.values is not None and (has_numbers or not has_text)
        if kept_numeric and rec.values is not None:
            numeric.append((pos, h.name, rec.values))
        if rec.text is not None and (has_text or rec.values is None):
            text.append((pos, h.name, rec.text))
        # A column of unreadable text cells stays (all NaN) beside its book's
        # data, but it is text, not a number column, for the X check.
        is_numbers = kept_numeric and (has_numbers or "text_unresolved" not in rec.extra)
        book_status.append((_short(h.name), "numeric" if is_numbers else "text"))
    for name, _ in unread:
        undecoded.setdefault(("dataset", "name is not a worksheet column name"), []).append(name)
        lose("unread_dataset", name)
    unanchored_names: list[str] = []
    for marker, name, vals in unanchored:
        numeric.append((marker, name, vals))
        confidence["marker_unanchored"] += 1
        unanchored_names.append(name)
        lose("no_header", name)

    # An allocated-but-never-filled book (Origin's default empty "Book1") is
    # not data: keep an empty column only alongside a filled one.
    filled = {_book_of(n) for _, n, v in numeric if v.size and np.isfinite(v).any()}
    filled |= {_book_of(n) for _, n, rows in text if any(rows)}
    empty_books = sorted({_book_of(n) for _, n, _ in numeric} - filled)
    numeric = [c for c in numeric if _book_of(c[1]) in filled]
    text = [c for c in text if _book_of(c[1]) in filled]
    numeric.sort(key=lambda c: c[0])
    text.sort(key=lambda c: c[0])

    def _names(names: list[str]) -> dict[str, object]:
        return {"count": len(names), "examples": names[:_MAX_EXAMPLES]}

    fidelity: dict[str, object] = {
        "version": 1,
        "datasets_total": len(records),
        "columns_numeric": len(numeric),
        "columns_text": len(text),
        "confidence": dict(sorted(confidence.items())),
        "report_columns": report_columns,
        "undecoded": [
            {"form": form, "reason": reason, **_names(names)}
            for (form, reason), names in sorted(undecoded.items())
        ],
        "matrix_datasets": matrix_report,
        "complex_imaginary_omitted": _names(complex_cols),
        "stale_cells_beyond_extent": _names(stale_cols),
        "text_unresolved": _names(text_unresolved),
        "columns_without_header": _names(unanchored_names),
        "over_decode_budget": _names(over_budget),
        "checksum_failed": _names(bad_checksum),
        "records_without_header": orphans,
        "empty_books_omitted": empty_books,
    }
    return WorksheetScan(
        columns=[(n, v) for _, n, v in numeric],
        text_columns=[(n, rows) for _, n, rows in text],
        matrices=matrices,
        fidelity=fidelity,
        column_status=status,
        losses=losses,
    )
