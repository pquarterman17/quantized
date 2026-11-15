"""What an Origin read lost, per book: the fail-closed half of ``qz convert``.

:func:`book_problems` reads the loss markers a book carries itself.
:func:`attribute_losses` takes the losses the readers report only for the
PROJECT and gives each to the book it belongs to wherever the reader's own
record names it; what no recovered book owns comes back as ``unattributed``
-- and ``io/origin_convert.py`` then writes nothing for that project unless
partial output was asked for. ``.opj`` and ``.opju`` are held to the same
rule:

* ``.opj`` (``metadata["origin_data_diagnostics"]["details"]``): a
  ``column`` / ``cells`` / ``sheet`` problem belongs to the book its dataset
  name keys (``opj_sheets.book_key``); a matrix's "coordinates not recovered"
  notice to that matrix book; the legacy-scan notice to every book (each
  carries ``origin_decode``). ``matrix`` / ``other`` / ``unknown`` problems
  are datasets no book holds.
* ``.opju`` (``metadata["origin_worksheet_fidelity"]``): each per-kind loss
  count is compared with the per-book ``origin_worksheet_losses`` the reader
  filed under the books it returned; any excess, and every loose dataset,
  unplaced matrix or header-less record, is unattributed.

Pure ``io``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from quantized.datastruct import DataStruct
from quantized.io.origin_project.opj_sheets import book_key
from quantized.io.origin_project.worksheet_fidelity import worksheet_fidelity_summary

__all__ = ["Attribution", "attribute_losses", "book_notes", "book_problems"]

#: ``origin_worksheet_losses`` kinds that mean data of THIS book is missing or
#: unsure (``io/origin_project/opju_worksheet.py``). Only a note:
#: ``grammar_only`` (read from an older format without a length check) and
#: ``stale_cells`` (cells past Origin's own last used row, never data).
_BLOCKING_LOSSES = {
    "undecoded": "column(s) not decoded",
    "checksum_failed": "column(s) failed their checksum (values may be corrupt)",
    "unread_dataset": "attached dataset(s) not read",
    "text_unresolved": "column(s) with text cells that could not be read",
    "no_header": "column(s) found without a column header",
    "complex_imaginary": "complex column(s): imaginary part not imported",
    "matrix_coordinates": "matrix X/Y coordinates not recovered (axes would be cell indices)",
}
_NOTED_LOSSES = {
    "grammar_only": "column(s) read from an older Origin format without a length check",
    "stale_cells": "column(s) with cells past Origin's last used row dropped",
}
#: ``.opju`` project loss code -> the per-book loss kind that files it.
#: ``None``: never filed under a book. Absent codes are not data losses
#: (``stale_cells_dropped``) or are counted under another code already
#: (``over_decode_budget`` records are also ``columns``/``datasets_not_decoded``).
_OPJU_CODES: dict[str, str | None] = {
    "columns_not_decoded": "undecoded",
    "datasets_not_decoded": "unread_dataset",
    "checksum_failed": "checksum_failed",
    "complex_imaginary_omitted": "complex_imaginary",
    "text_unresolved": "text_unresolved",
    "columns_without_header": "no_header",
    "matrices_not_imported": None,
    "records_without_header": None,
}
_LEGACY_SCAN = (
    "read by the legacy content scan: no worksheet headers, "
    "so values and column types may be unreliable"
)


def _names(entry: object) -> str:
    columns = entry.get("columns") if isinstance(entry, Mapping) else None
    return ", ".join(str(c) for c in columns) if isinstance(columns, list) and columns else ""


def _text_only(ds: DataStruct) -> bool:
    return ds.n_channels == 0 and bool(ds.metadata.get("origin_text_columns"))


def book_problems(ds: DataStruct) -> list[str]:
    """What this book's own metadata says it lost. Any problem means the
    book is incomplete and is not written unless partial output was asked for."""
    meta = ds.metadata
    problems: list[str] = []
    lost = meta.get("origin_columns_lost")
    if isinstance(lost, Mapping):
        problems += [f"column {c} not decoded ({why})" for c, why in lost.items()]
    losses = meta.get("origin_worksheet_losses")
    if isinstance(losses, Mapping):
        for kind, entry in losses.items():
            count = entry.get("count") if isinstance(entry, Mapping) else None
            if not isinstance(count, int) or count <= 0 or kind in _NOTED_LOSSES:
                continue
            names = _names(entry)
            # An unknown kind blocks too: fail closed on what we cannot classify.
            problems.append(
                f"{count} {_BLOCKING_LOSSES.get(kind, kind)}" + (f": {names}" if names else "")
            )
    # A text-only sheet (notes, a sample list) has no X to lose: its text
    # columns are written as they are (``datastruct_table.has_x_column``).
    if meta.get("x_column_recovered") is False and not _text_only(ds):
        reason = meta.get("x_column_unrecovered_reason")
        why = f": {reason}" if isinstance(reason, str) and reason else " (it would be row numbers)"
        problems.append("X column not recovered" + why)
    matrix = meta.get("origin_matrix")
    if (
        isinstance(matrix, Mapping)
        and matrix.get("coordinates_recovered") is False
        and not (isinstance(losses, Mapping) and "matrix_coordinates" in losses)
    ):
        problems.append(_BLOCKING_LOSSES["matrix_coordinates"])
    imag = meta.get("origin_complex_imaginary")
    if isinstance(imag, Mapping) and imag:
        columns = ", ".join(map(str, imag))
        problems.append(f"{len(imag)} complex column(s): imaginary part not exported ({columns})")
    if meta.get("origin_decode") == "content_sniffing":
        problems.append(_LEGACY_SCAN)
    return problems


def book_notes(ds: DataStruct) -> list[str]:
    """Information about a book that is not a loss of its data."""
    meta = ds.metadata
    notes: list[str] = []
    losses = meta.get("origin_worksheet_losses")
    if isinstance(losses, Mapping):
        for kind, label in _NOTED_LOSSES.items():
            entry = losses.get(kind)
            count = entry.get("count") if isinstance(entry, Mapping) else None
            if isinstance(count, int) and count > 0:
                names = _names(entry)
                notes.append(f"{count} {label}" + (f": {names}" if names else ""))
    report = meta.get("origin_report_sheets")
    if isinstance(report, Mapping) and report:
        notes.append(
            f"{len(report)} report-sheet column(s) not exported "
            "(unresolved Origin cell references, not data)"
        )
    return notes


@dataclass
class Attribution:
    """Project-level losses: per book (by ``origin_book``) and unowned."""

    by_book: dict[str, list[str]] = field(default_factory=dict)
    unattributed: list[str] = field(default_factory=list)


def _owner(name: str, keys: Sequence[str]) -> str | None:
    """The returned book a dataset name belongs to, or None."""
    parsed = book_key(name)
    if parsed is None:
        return name if name in keys else None
    book, key, _sheet = parsed
    if key in keys:
        return key
    # The sole sheet of a book is filed under the bare book name.
    sheets = [k for k in keys if k.partition("@")[0] == book]
    return sheets[0] if len(sheets) == 1 else None


def _opj(
    diag: Mapping[str, object], keys: list[str], books: list[DataStruct], out: Attribution
) -> None:
    details = diag.get("details")
    for item in details if isinstance(details, list) else []:
        if not isinstance(item, Mapping):
            continue
        category, name, reason = (str(item.get(k, "")) for k in ("category", "dataset", "reason"))
        if category in ("column", "cells", "sheet"):
            owner = _owner(name, keys) if category != "sheet" else (name if name in keys else None)
            if owner is None:
                out.unattributed.append(f"{name}: {reason}")
                continue
            column = name.partition("@")[0].rpartition("_")[2]
            text = reason if category == "sheet" else f"column {column}: {reason}"
            if category == "column":
                text = f"column {column} not decoded ({reason})"
            out.by_book.setdefault(owner, []).append(text)
        elif category == "notice" and not name:
            continue  # the legacy-scan notice: every book carries origin_decode
        elif category == "notice":
            base = name.partition("@")[0]
            owned = any(
                str(b.metadata.get("origin_book")) in (name, base)
                and isinstance(b.metadata.get("origin_matrix"), Mapping)
                for b in books
            )
            if not owned:
                out.unattributed.append(reason)
        else:  # matrix / other / unknown: a dataset no recovered book holds
            out.unattributed.append(f"{name}: {reason}" if name else reason)


def _opju(fidelity: Mapping[str, object], books: list[DataStruct], out: Attribution) -> None:
    filed: dict[str, int] = {}
    for b in books:
        losses = b.metadata.get("origin_worksheet_losses")
        for kind, entry in losses.items() if isinstance(losses, Mapping) else []:
            count = entry.get("count") if isinstance(entry, Mapping) else 0
            filed[kind] = filed.get(kind, 0) + (count if isinstance(count, int) else 0)
    losses = worksheet_fidelity_summary(fidelity)["losses"]
    for loss in losses if isinstance(losses, list) else []:
        if not isinstance(loss, Mapping) or loss.get("code") not in _OPJU_CODES:
            continue
        code = str(loss.get("code"))
        count = loss.get("count")
        count = count if isinstance(count, int) else 0
        kind = _OPJU_CODES[code]
        excess = count - (filed.get(kind, 0) if kind else 0)
        if excess > 0:
            examples = ", ".join(str(e) for e in loss.get("examples") or [])
            out.unattributed.append(
                f"{excess} {code.replace('_', ' ')} in no recovered book"
                + (f" (e.g. {examples})" if examples else "")
            )


def attribute_losses(books: list[DataStruct]) -> Attribution:
    """Give each project-level loss to its book (module doc)."""
    out = Attribution()
    keys = [str(b.metadata.get("origin_book") or "") for b in books]
    for b in books:
        diag = b.metadata.get("origin_data_diagnostics")
        if isinstance(diag, Mapping):
            _opj(diag, keys, books, out)
            break
    for b in books:
        fidelity = b.metadata.get("origin_worksheet_fidelity")
        if isinstance(fidelity, Mapping):
            _opju(fidelity, books, out)
            break
    return out
