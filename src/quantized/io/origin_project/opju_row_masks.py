"""Masked rows of an ``.opju`` worksheet column (plan item 71, row masks).

Origin can MASK a cell: the value stays stored, but Origin reads it as
missing (``sum()`` skips it) and draws it per its mask display setting. A
masked column stores the mask after its value record, before the next
dataset header::

    <len> 06 <5 bytes> <rle stream, len - 6 bytes>

The stream (``opju_blocks.rle_expand``) expands to ``81 <u16>``, 28 zero
bytes, then one byte per allocated row plus 4, ``01`` on a masked row and
``00`` elsewhere.

Evidence (``docs/origin_project_format.md`` "Row masks"; Origin 2026b COM
``ismasked(row, range)``, 2026-11-15): in ``PerceivedRiskandPrediction``
the block is present on all 12 swept masked columns and on none of 788
others, and the flagged rows equal Origin's masked rows (rows 1 / 1 and 61,
1-based). Public corpus sweep (2026-11-24): the gate below accepts 61 columns
in each of the two ``PerceivedRiskandPrediction`` copies and nothing in any
other file; every accepted mask flags row 1 and some also row 61.

``metadata["origin_masked_rows"]`` maps a column's short name to its masked
rows (0-based storage rows); the cells keep their stored values. Owner
decision 2026-11-24 (ledger B-38): masked rows become quantized's own row
EXCLUSIONS (``Dataset.excludedRows``: hidden from plots and fits, kept in the
worksheet, the user can un-exclude). quantized excludes whole rows while an
Origin mask is per CELL, so only a row the decoder proves masked in EVERY
column that holds a value there (X, value and text columns alike) is
stamped, as ``metadata["origin_excluded_rows"]`` (``fully_masked_rows``); the
frontend import turns it into ``excludedRows``. A row masked in only some of
its columns stays as it is (excluding it would also hide the unmasked cells;
how to show a per-cell mask is open, provisional, owner to confirm). A book
with a recorded worksheet loss (``origin_worksheet_losses``: a column that
did not import may hold a value) stamps nothing. Public corpus
(2026-11-24): every mask is partial (2 or 3 of 16 columns), so nothing is
excluded there.

Fail closed: a block whose expansion has another lead byte, a non-zero byte
in the 28-byte pad, a length other than rows + 4, a byte other than 00 / 01,
or no flagged row is not a mask; two candidate blocks for one dataset, a
dataset name that does not split into a book and a column, or a column the
book does not hold stamp nothing. (One near form, ``Sample_OriginPro_
ResonatorData`` ``RawNbAl36Res1_A@11``, has a non-zero pad and a different
length: undecoded.)
"""

from __future__ import annotations

import dataclasses
import math
import re
from bisect import bisect_right
from collections.abc import Mapping

from quantized.datastruct import DataStruct
from quantized.io.origin_project.opju_blocks import find_headers, rle_expand

__all__ = [
    "EXCLUDED_ROWS_KEY",
    "MASKED_ROWS_KEY",
    "dataset_masks",
    "fully_masked_rows",
    "mark_row_masks",
    "mask_rows",
]

MASKED_ROWS_KEY = "origin_masked_rows"
EXCLUDED_ROWS_KEY = "origin_excluded_rows"

# <len> 06 <5 bytes> then a literal token whose first byte is the 0x81 lead
_CANDIDATE = re.compile(rb"(?=([\x07-\xff])\x06.{5}[\x01-\x7f]\x81)", re.DOTALL)
_PAD = 28
_PREFIX = 3 + _PAD  # 81 <u16> + pad
_EXTRA_ROWS = 4


def mask_rows(b: bytes, s: int, total_rows: int) -> list[int] | None:
    """Masked rows of the block whose ``<len>`` byte is at ``s``, else None."""
    ln = b[s]
    ex = rle_expand(b, s + 7, ln - 6)
    if ex is None or len(ex) != _PREFIX + total_rows + _EXTRA_ROWS:
        return None
    if ex[0] != 0x81 or any(ex[3:_PREFIX]):
        return None
    body = ex[_PREFIX:]
    if not set(body) <= {0, 1}:
        return None
    rows = [k for k, v in enumerate(body) if v and k < total_rows]
    return rows or None


def dataset_masks(b: bytes) -> dict[str, list[int]]:
    """Dataset name -> its masked rows, for every column carrying a mask."""
    if b"\x06" not in b:
        return {}
    headers = find_headers(b)
    if not headers:
        return {}
    starts = [h.start for h in headers]
    found: dict[int, list[list[int] | None]] = {}
    for m in _CANDIDATE.finditer(b):
        s = m.start()
        i = bisect_right(starts, s) - 1
        if i < 0:
            continue
        h = headers[i]
        nxt = starts[i + 1] if i + 1 < len(starts) else len(b)
        if s < h.end or s + 1 + b[s] > nxt:
            continue  # the block must sit between its record and the next header
        rows = mask_rows(b, s, h.total_rows)
        if rows is not None:
            found.setdefault(i, []).append(rows)
    # two candidate masks for one dataset: which is real is not decoded
    return {headers[i].name: v[0] for i, v in found.items() if len(v) == 1 and v[0]}


def _book_and_column(dataset: str) -> tuple[str, str] | None:
    base, at, sheet = dataset.partition("@")
    book, sep, col = base.rpartition("_")
    if not sep or not book or not col:
        return None
    return (f"{book}@{sheet}" if at else book), col


def _has_column(ds: DataStruct, col: str) -> bool:
    md = ds.metadata
    shorts = [str(c) for c in md.get("origin_column_names") or []]
    return col == str(md.get("x_column_name", "") or "") or col in shorts


def _filled(v: object) -> bool:
    if isinstance(v, str):
        return v != ""
    try:
        return math.isfinite(float(v))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return v is not None


def fully_masked_rows(ds: DataStruct, masks: Mapping[str, list[int]]) -> list[int]:
    """Rows of ``ds`` masked in every column that holds a value there (at
    least one), the only rows a whole-row exclusion leaves exactly as Origin
    masked them; ``[]`` when the book recorded a worksheet loss."""
    md = ds.metadata
    if md.get("origin_worksheet_losses"):
        return []
    n = len(ds.time)
    columns: list[tuple[str, list[object]]] = []
    x = str(md.get("x_column_name", "") or "")
    if x:
        columns.append((x, list(ds.time)))
    shorts = [str(c) for c in md.get("origin_column_names") or []]
    if len(shorts) != len(ds.labels):
        return []  # a value channel whose column name is unknown
    columns += [(c, [row[k] for row in ds.values]) for k, c in enumerate(shorts)]
    text = md.get("origin_text_columns")
    if isinstance(text, Mapping):
        columns += [(str(c), list(cells)) for c, cells in text.items() if isinstance(cells, list)]
    sets = {c: set(rows) for c, rows in masks.items()}
    out: list[int] = []
    for r in sorted({r for rows in masks.values() for r in rows}):
        if r >= n:
            continue
        held = [c for c, cells in columns if r < len(cells) and _filled(cells[r])]
        if held and all(r in sets.get(c, ()) for c in held):
            out.append(r)
    return out


def mark_row_masks(books: list[DataStruct], raw: bytes) -> list[DataStruct]:
    """Stamp ``origin_masked_rows`` on each book holding a masked column, and
    ``origin_excluded_rows`` where ``fully_masked_rows`` finds any."""
    masks = dataset_masks(raw)
    if not masks:
        return books
    index: dict[str, list[int]] = {}
    for i, ds in enumerate(books):
        index.setdefault(str(ds.metadata.get("origin_book", "")), []).append(i)
    per_book: dict[int, dict[str, list[int]]] = {}
    for dataset, rows in masks.items():
        split = _book_and_column(dataset)
        if split is None:
            continue
        book, col = split
        hits = [i for i in index.get(book, []) if _has_column(books[i], col)]
        if len(hits) == 1:
            per_book.setdefault(hits[0], {})[col] = rows
    out = list(books)
    for i, cols in per_book.items():
        stamp: dict[str, object] = {MASKED_ROWS_KEY: dict(sorted(cols.items()))}
        if excluded := fully_masked_rows(books[i], cols):
            stamp[EXCLUDED_ROWS_KEY] = excluded
        out[i] = dataclasses.replace(books[i], metadata={**books[i].metadata, **stamp})
    return out
