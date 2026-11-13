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

__all__ = ["DatasetScan", "MatrixCells", "Problem", "scan_datasets", "summarize_problems"]

Columns = list[tuple[str, NDArray[np.float64]]]
TextColumns = list[tuple[str, list[str]]]


@dataclass(frozen=True)
class Problem:
    """One dataset (or part of one) that was not imported, and why.

    ``category``: ``column`` (a ``<Book>_<Col>`` dataset that could not be
    decoded), ``matrix``, ``other`` (a dataset that is neither a worksheet
    column nor a matrix — Origin's function plots, loose datasets), or
    ``cells`` (the column WAS imported, with some cells blanked).
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


def _take(
    scan: DatasetScan, h: DatasetHeader, data: bytes, matrix_windows: Collection[str]
) -> None:
    name = h.name
    scan.names.add(name)
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


def scan_datasets(
    blocks: Sequence[tuple[int, bytes]], matrix_windows: Collection[str] = ()
) -> DatasetScan:
    """Decode the datasets section of a walked block stream.

    The section starts at the first block that parses as a dataset header
    and ends at the first block after it that is neither a header nor a
    NULL (the first window header). By the grammar that block follows the
    last dataset's NULL and the section's closing NULL; if it does not, the
    walk lost its place (a header this reader does not recognise) and
    whatever came after was not read — reported, not passed over.
    """
    scan = DatasetScan()
    i, n = 0, len(blocks)
    nulls = 0  # consecutive NULL blocks just before blocks[i]
    while i < n:
        size, payload = blocks[i]
        if size == 0:
            nulls += 1
            i += 1
            continue
        h = parse_dataset_header(payload)
        if h is None:
            if scan.n_headers:
                if nulls < 2:
                    reason = "the datasets section ended at an unrecognised block"
                    scan.problems.append(Problem("other", "(datasets after this point)", reason))
                break
            nulls = 0
            i += 1
            continue
        scan.n_headers += 1
        nulls = 0
        data = blocks[i + 1][1] if i + 1 < n else b""
        if len(data) != h.data_size and parse_dataset_header(data) is not None:
            # The next block is another dataset's header, not this one's
            # data: leave it for the next turn of the loop.
            data = b""
            i -= 1
        _take(scan, h, data, matrix_windows)
        i += 2
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
        "cells": "column(s) with implausible cells blanked",
    }
    omissions: list[str] = []
    for category, label in labels.items():
        count = len({p.dataset for p in problems if p.category == category})
        if count:
            omissions.append(f"{count} {label}")
    return {
        "omissions": omissions,
        "details": [
            {"category": p.category, "dataset": p.dataset, "reason": p.reason} for p in problems
        ],
    }
