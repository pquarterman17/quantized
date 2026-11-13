"""Walk an ``.opj`` datasets section and sort every dataset into its bucket.

The section is ``[header][data][NULL]`` per dataset, closed by one more
NULL; an empty dataset keeps the slot with a NULL in place of its data
block (``[header][NULL][NULL]``). ``opj_datasets`` reads one header + data
pair; this module walks the run and decides what each dataset IS:

* a **matrix** — its name (less any ``@N``) is a window that owns a matrix
  sheet (``opj_matrix.matrix_sheets``);
* a **worksheet column** — ``<Book>_<Col>[@N]``;
* anything else (Origin's function datasets, loose datasets) — not
  imported, and said so.

Nothing here guesses. A dataset whose header parses but whose data cannot
be decoded as that header describes is omitted and recorded in
``problems``; the caller turns those into the project's fidelity manifest.

A file with no parseable dataset header at all (the synthetic fixtures the
older tests build, or a header layout no specimen covers) reports
``n_headers == 0`` and the caller falls back to the legacy content-sniffing
walk in ``opj._columns``, unchanged.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

from quantized.io.origin_project.opj_datasets import (
    DatasetHeader,
    decode_dataset,
    parse_dataset_header,
)
from quantized.io.origin_project.windows import _is_window_header

_NAME_OFFSET = 0x58

__all__ = ["DatasetScan", "MatrixCells", "Problem", "scan_datasets", "summarize_problems"]

Columns = list[tuple[str, NDArray[np.float64]]]
TextColumns = list[tuple[str, list[str]]]


@dataclass(frozen=True)
class Problem:
    """One dataset (or part of one) that was not imported, and why.

    ``category``: ``column`` (a ``<Book>_<Col>`` dataset that could not be
    decoded), ``matrix``, ``other`` (a dataset that is neither a worksheet
    column nor a matrix — Origin's function plots, loose datasets),
    ``unknown`` (a dataset whose header was not recognised, or a run of
    blocks that could not be placed), ``sheet`` (the data WAS imported but
    its sheet could not be identified, so its column names, units and
    designations were not applied), ``cells`` (the column WAS imported,
    with some cells blanked), or ``notice`` (a caveat on data that was
    imported; ``reason`` is the whole user-facing line).
    """

    category: str
    dataset: str
    reason: str


@dataclass(frozen=True)
class MatrixCells:
    """A matrix-window dataset as decoded: flat cells, awaiting its shape."""

    name: str
    header: DatasetHeader
    cells: NDArray[np.float64] | None
    imag: NDArray[np.float64] | None
    problem: str | None


@dataclass
class DatasetScan:
    n_headers: int = 0
    numeric: Columns = field(default_factory=list)
    text: TextColumns = field(default_factory=list)
    report: TextColumns = field(default_factory=list)
    imag: Columns = field(default_factory=list)
    matrices: list[MatrixCells] = field(default_factory=list)
    problems: list[Problem] = field(default_factory=list)
    # Every dataset name in the section, decoded or not.
    names: set[str] = field(default_factory=set)
    # The same names in file order (a book's columns are in this order).
    order: list[str] = field(default_factory=list)
    # The header of every worksheet-column dataset (``opj_sheets`` binds a
    # sheet id to its sheet from them).
    headers: list[DatasetHeader] = field(default_factory=list)
    # Datasets lost with no name to say whose they were. Non-zero means any
    # book of the project may be missing a column.
    unowned_losses: int = 0


def _take(
    scan: DatasetScan, h: DatasetHeader, data: bytes, matrix_windows: Collection[str]
) -> None:
    name = h.name
    scan.names.add(name)
    scan.order.append(name)
    if name.partition("@")[0] in matrix_windows:
        got = decode_dataset(h, data)
        # A matrix is every allocated cell; one with unused rows is not a
        # shape this reader has an oracle for.
        problem = got.problem
        if problem is None and (got.numeric is None or got.numeric.size != h.total_rows):
            problem = "not a fully-populated numeric dataset"
        scan.matrices.append(
            MatrixCells(name, h, None if problem else got.numeric, got.imag, problem)
        )
        return
    book, _, column = name.rpartition("_")
    if not book or not column:
        scan.problems.append(Problem("other", name, "not a worksheet column or a matrix"))
        return
    scan.headers.append(h)
    if not data and h.total_rows:
        # The slot of a column that holds no data yet: an empty column.
        scan.numeric.append((name, np.empty(0, dtype=np.float64)))
        return
    got = decode_dataset(h, data)
    if got.problem is not None:
        scan.problems.append(Problem("column", name, got.problem))
        return
    scan.problems.extend(Problem("cells", name, note) for note in got.notes)
    if got.numeric is not None:
        scan.numeric.append((name, got.numeric))
    if got.text is not None:
        scan.text.append((name, got.text))
    if got.report is not None:
        scan.report.append((name, got.report))
    if got.imag is not None:
        scan.imag.append((name, got.imag))


def _starts_windows(payload: bytes) -> bool:
    """A real window header (fixed region 195 B, stated at 0x6F) — the one
    block that ends the section without its closing NULL. Dataset headers
    are shorter in every CPYA version, so one cannot be taken for it."""
    return (
        len(payload) >= 0xC3 and payload[0x6F] == 0xC3 and _is_window_header(payload) is not None
    )


def _unrecognised(scan: DatasetScan, payload: bytes) -> None:
    """Record a dataset whose header this reader does not recognise.

    The block sits in a dataset-header slot, so it IS a dataset; all that
    is trusted of it is a printable name at the usual offset. A named
    worksheet column is reported as that column (and stays in ``names``, so
    its book knows a column is missing); anything else is a loss with no
    owner, which every book of the project has to allow for.
    """
    end = payload.find(b"\x00", _NAME_OFFSET)
    raw = payload[_NAME_OFFSET:end] if end > _NAME_OFFSET else b""
    name = raw.decode("latin1") if raw and all(0x20 <= c < 0x7F for c in raw) else ""
    reason = f"dataset header not recognised ({len(payload)} B)"
    if name and name.rpartition("_")[0]:
        scan.names.add(name)
        scan.order.append(name)
        scan.problems.append(Problem("column", name, reason))
        return
    scan.unowned_losses += 1
    label = name or f"(unnamed dataset {scan.unowned_losses})"
    scan.problems.append(Problem("unknown", label, reason))


def scan_datasets(
    blocks: Sequence[tuple[int, bytes]], matrix_windows: Collection[str] = ()
) -> DatasetScan:
    """Decode the datasets section of a walked block stream.

    Grammar (every one of the 48 real ``.opj`` files in the public corpus,
    no exception): block 0 is the file header, block 1 a NULL, and from
    block 2 on the section is ``[header][data | NULL][NULL]`` per dataset,
    closed by one more NULL; the windows section follows. So a non-NULL
    block in a header slot IS a dataset header whether or not this reader
    recognises it, and a NULL in a header slot is the end of the section.

    An unrecognised header is therefore never passed over in silence: it is
    recorded (:func:`_unrecognised`), its data block and terminator are
    stepped over, and the walk carries on at the next slot. If the blocks
    after it do not fit the grammar the walk resynchronises at the next
    block that parses as a header, and says how much it skipped.

    A stream with no recognisable header anywhere (older synthetic
    fixtures) returns ``n_headers == 0``, untouched, for the legacy walk.
    """
    scan = DatasetScan()
    n = len(blocks)
    parsed = [parse_dataset_header(p) if size else None for size, p in blocks]
    first = next((k for k, h in enumerate(parsed) if h is not None), None)
    if first is None:
        return scan
    # The section starts at block 2 when the stream opens as the grammar
    # says; otherwise at the first header (nothing before it can be placed).
    i = 2 if first >= 2 and n > 2 and blocks[0][0] and not blocks[1][0] else first
    closed = False  # a NULL has been seen in a header slot
    while i < n:
        size, payload = blocks[i]
        if size == 0:
            closed = True
            i += 1
            continue
        h = parsed[i]
        if h is None:
            if closed or _starts_windows(payload):
                break  # the windows section
            _unrecognised(scan, payload)
            if i + 2 < n and blocks[i + 2][0] == 0 and parsed[i + 1] is None:
                i += 3  # its data block (or NULL) and its terminator
                continue
            resume = next((k for k in range(i + 1, n) if parsed[k] is not None), None)
            skipped = sum(1 for k in range(i + 1, resume or n) if blocks[k][0])
            if skipped:
                where = "before the next readable dataset" if resume else "to the end"
                reason = f"{skipped} block(s) {where} could not be placed"
                scan.unowned_losses += 1
                scan.problems.append(Problem("unknown", "(unreadable region)", reason))
            if resume is None:
                break
            i = resume
            continue
        closed = False
        scan.n_headers += 1
        data = blocks[i + 1][1] if i + 1 < n else b""
        if len(data) != h.data_size and i + 1 < n and parsed[i + 1] is not None:
            # The next block is another dataset's header, not this one's
            # data: leave it for the next turn of the loop.
            data = b""
            i -= 1
        _take(scan, h, data, matrix_windows)
        i += 2
        if i < n and blocks[i][0] == 0:
            i += 1  # the dataset's terminating NULL
    return scan


def summarize_problems(problems: Sequence[Problem]) -> dict[str, object] | None:
    """The ``origin_data_diagnostics`` metadata value, or None when clean.

    ``omissions`` are the one-line summaries the import route merges into
    the project fidelity manifest; ``details`` name each dataset.
    """
    if not problems:
        return None
    labels = {
        "column": "worksheet dataset(s) not decoded",
        "matrix": "matrix book(s) not imported",
        "other": "non-worksheet dataset(s) not imported",
        "unknown": "unrecognised dataset(s) not imported",
        "sheet": "sheet(s) imported without column names, units or designations",
        "cells": "column(s) with implausible cells blanked",
    }
    omissions: list[str] = []
    for category, label in labels.items():
        count = len({p.dataset for p in problems if p.category == category})
        if count:
            omissions.append(f"{count} {label}")
    for p in problems:
        if p.category == "notice" and p.reason not in omissions:
            omissions.append(p.reason)
    return {
        "omissions": omissions,
        "details": [
            {"category": p.category, "dataset": p.dataset, "reason": p.reason} for p in problems
        ],
    }
