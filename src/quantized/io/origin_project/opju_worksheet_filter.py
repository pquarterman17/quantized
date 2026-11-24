"""The condition of an ``.opju`` worksheet data filter (``__STGCOLFILTER``).

A book page whose span stores a ``__STGCOLFILTER`` block has an Origin data
filter (``opju_sheet_signals.filtered_books``): Origin reads the rows the
condition rejects as missing and leaves them out of every plot. This module
reads WHAT the condition is, so the book can say so
(``metadata["origin_worksheet_filter"]``). It changes no data and draws
nothing: every curve of a filtered book stays omitted (``worksheet_filter``)
until a per-curve row subset exists in the curve model (plan item 43).

The block, after the tag (offsets relative to the byte after the tag)::

    04 01 ?? 02 ?? 00 00 00  f1 0a 5a 11 11 11 01 00 01 00 10 00 00 00
    01 00 00 00 ?? 00 00 00  5c 11 11 11 03 0e 00 ?? 00 00 <op> <bridge>
    <condition text> 00 ff ff ff ff ...  0a <n+2> <n+1> <column name, n bytes> 00

``<op>`` (offset 40): ``04`` keeps rows whose value is below the threshold,
``02`` keeps rows whose value is above it (strictly: rows EQUAL to the
threshold are rejected). Evidence (Origin 2026b COM ``sum()`` counts per
plotted book, recorded 2026-11-15 in ``docs/origin_project_format.md``;
checked against the decoded conditions 2026-11-24):

* ``likelihood_profile.opju``: 5 blocks, op ``04``, column ``error``,
  thresholds 0.07 / 0.1 / 0.1 / 0.1 / 0.2; rows with ``error`` below the
  threshold = 48 / 5 / 2 / 16 / 290 = Origin's counts for those books. The
  unfiltered ``Book4`` (no block) plots all 1000 rows (negative control).
  No value equals its threshold, so whether ``04`` is ``<`` or ``<=`` is NOT
  proven (``inclusive`` is reported as unknown).
* ``simulated-IFN-pretreatment-longer.opju``: 5 blocks, op ``02``, column
  ``time``, threshold 0: 1549 of 1600 rows have ``time > 0`` = Origin's
  count; ``time >= 0`` would keep 1550 (one row is exactly 0), so ``02`` is
  strict.

The corpus (public, 2026-11-24) holds the tag in these 2 files only; every
block matches the fixed bytes above. Anything else -- another op byte, a
fixed byte that differs, a condition that is not one number, a column name
that is not exactly one column of the book, two blocks in one page -- is
left undecoded (``None``), never guessed.
"""

from __future__ import annotations

import dataclasses
import math
import re
from bisect import bisect_right

from quantized.datastruct import DataStruct
from quantized.io.origin_project.opju_embedded_pages import span_pages
from quantized.io.origin_project.tree_opju import iter_opju_windows

__all__ = ["WORKSHEET_FILTER_KEY", "decode_filter_block", "mark_worksheet_filters", "page_filters"]

WORKSHEET_FILTER_KEY = "origin_worksheet_filter"

_TAG = b"__STGCOLFILTER"
# (offset after the tag, bytes) that every COM-checked block carries
_FIXED: tuple[tuple[int, bytes], ...] = (
    (0, b"\x04\x01"),
    (3, b"\x02"),
    (5, b"\x00\x00\x00\xf1\x0a\x5a\x11\x11\x11\x01\x00\x01\x00\x10\x00\x00\x00\x01\x00\x00\x00"),
    (27, b"\x00\x00\x00\x5c\x11\x11\x11\x03\x0e\x00"),
    (38, b"\x00\x00"),
)
_OP_AT = 40
# op byte -> (comparison, whether a row equal to the threshold is kept)
_OPS: dict[int, tuple[str, bool | None]] = {
    0x04: ("<", None),  # strict or not: unproven (no tie in the oracle data)
    0x02: (">", False),  # strict: simulated-IFN keeps 1549, not the 1550 of >=
}
_TEXT_END = b"\x00\xff\xff\xff\xff"
# the bytes between the op and the condition text: exactly one of the three
# forms every checked block carries (uncompressed, and the byte-compressed
# form with 83 / 63). The framing is not decoded, so any other bridge -- one
# ending in a digit would silently lengthen the number -- stays undecoded.
_BRIDGES = (
    b"\x00\x01\x00\xd3\x05\x00\x00\x00",
    b"\x00\x00\x08\x00\x83",
    b"\x00\x00\x08\x00\x63",
)
_NUMBER = re.compile(rb"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\Z")
_NAME = re.compile(rb"\x0a([\x02-\x40])([\x01-\x3f])([\x20-\x7e]+?)\x00")
_TEXT_WINDOW = 48  # condition text ends this close to the op byte
_NAME_WINDOW = 96  # the column name follows the text this closely


def decode_filter_block(b: bytes, at: int) -> dict[str, object] | None:
    """``{column, op, value, inclusive}`` of the block whose tag starts at ``at``."""
    p = at + len(_TAG)
    for off, fixed in _FIXED:
        if b[p + off : p + off + len(fixed)] != fixed:
            return None
    op = _OPS.get(b[p + _OP_AT]) if p + _OP_AT < len(b) else None
    if op is None:
        return None
    end = b.find(_TEXT_END, p + _OP_AT + 1, p + _OP_AT + _TEXT_WINDOW)
    if end < 0:
        return None
    body = b[p + _OP_AT + 1 : end]
    bridge = next((x for x in _BRIDGES if body.startswith(x)), None)
    if bridge is None:
        return None
    text = body[len(bridge) :]
    if not _NUMBER.match(text):
        return None
    value = float(text)
    if not math.isfinite(value):
        return None
    m = _NAME.search(b, end + len(_TEXT_END), end + len(_TEXT_END) + _NAME_WINDOW)
    if m is None or m.group(1)[0] != m.group(2)[0] + 1 or len(m.group(3)) + 1 != m.group(2)[0]:
        return None
    return {
        "column": m.group(3).decode("ascii"),
        "op": op[0],
        "value": value,
        "inclusive": op[1],
    }


def page_filters(b: bytes) -> dict[str, dict[str, object] | None]:
    """Each book page holding a filter block -> its condition (``None``: undecoded)."""
    if _TAG not in b:
        return {}
    pages = span_pages(b, iter_opju_windows(b))
    starts = [s for s, _name in pages]
    found: dict[str, list[dict[str, object] | None]] = {}
    at = b.find(_TAG)
    while at >= 0:
        k = bisect_right(starts, at) - 1
        if k >= 0:
            found.setdefault(pages[k][1], []).append(decode_filter_block(b, at))
        at = b.find(_TAG, at + 1)
    # two filters in one page: which sheet each belongs to is not decoded
    return {page: conds[0] if len(conds) == 1 else None for page, conds in found.items()}


def _column_short_name(ds: DataStruct, name: str) -> str | None:
    """The one column of ``ds`` whose short or long name is ``name``, else None."""
    md = ds.metadata
    hits: set[str] = set()
    x_short = str(md.get("x_column_name", "") or "")
    if x_short and name in (x_short, str(md.get("x_column_long", "") or "")):
        hits.add(x_short)
    shorts = list(md.get("origin_column_names") or [])
    for k, label in enumerate(ds.labels):
        if k < len(shorts) and name in (str(shorts[k]), str(label)):
            hits.add(str(shorts[k]))
    return hits.pop() if len(hits) == 1 else None


def mark_worksheet_filters(books: list[DataStruct], raw: bytes) -> list[DataStruct]:
    """Stamp each filtered book's decoded condition (see the module docstring).

    The filter belongs to the page's sheet that holds the named column: a
    page whose condition names a column on no sheet, or on more than one
    sheet, stamps nothing (fail closed). ``value``s and data are untouched.
    """
    filters = page_filters(raw)
    if not filters:
        return books
    by_page: dict[str, list[int]] = {}
    for i, ds in enumerate(books):
        page = str(ds.metadata.get("origin_book", "")).partition("@")[0]
        if page in filters:
            by_page.setdefault(page, []).append(i)
    out = list(books)
    for page, cond in filters.items():
        if cond is None:
            continue
        hits = [
            (i, short)
            for i in by_page.get(page, [])
            if (short := _column_short_name(books[i], str(cond["column"]))) is not None
        ]
        if len(hits) != 1:
            continue
        i, short = hits[0]
        stamp = {**cond, "column_short": short}
        out[i] = dataclasses.replace(
            books[i], metadata={**books[i].metadata, WORKSHEET_FILTER_KEY: stamp}
        )
    return out
