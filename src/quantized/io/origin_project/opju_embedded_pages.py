"""Embedded (fit-report) graph page headers inside a ``.opju`` workbook.

An NLFit report embeds small graphs (Origin names them ``Residual<N>``) in
its host workbook. Each one carries a full ``0a``-framed page header
(``tree_opju._OPJU_WIN_HEAD_RE``), so it used to be enumerated as a page and
OPEN A NEW SPAN: every column record after it -- the host book's report
sheet and every later sheet -- was attributed to ``Residual<N>`` instead of
the host. Curves plotting those columns then bound a "book" the importer
never produces, or (where Origin plots ``Book40_B@3``) the wrong one:
``Figure 3 and 4 amplitude - rise time data.opju`` drew ``Residual37_B``,
``Residual64_B`` and ``Residual65_B`` where Origin 2026b COM plots
``Book38_B@3``-family columns of the host book (``%(i,@D)``, 2026-11-15).

**What marks the embedded header** (two independent gates, both required):

* its window ``<type>`` varint is ``01``. Real windows carry a per-window
  serial that counts up through the file (``0x69`` .. ``0x95 01`` in the
  359-file corpus); and
* the byte before its ``0a`` is ``fb`` -- it sits inside the host book's
  report record. A real page header follows a record boundary (zero
  padding, or the ``IEND ae 42 60 82`` of the previous window's thumbnail).

Corpus survey (2026-11-15, 359 ``.opju``, 3,800 page headers): the 21
headers with type ``01`` are exactly the 21 preceded by ``fb``; all 21 are
``Residual*`` pages of the rise-time file, each directly after its host
workbook (``Residual39`` after ``Book40``; consecutive ones, e.g.
``Residual57/58/63`` after ``Book3``, share the host). No other page in the
corpus meets either gate.

Dropping these headers from the span list returns their column records to
the host book; the host's sheet for them is then decided by
``opju_curve_sheets`` like any other column (in the rise-time file the
dataset counts do not align, so those curves are omitted ``sheet_unknown``
rather than drawn from a guessed sheet). The folder tree
(``tree_opju``) still enumerates every header: its window ordinals count
them.
"""

from __future__ import annotations

from collections.abc import Iterable

__all__ = ["is_embedded_page", "span_pages"]

_EMBEDDED_TYPE = 0x01
_EMBEDDED_PRE = 0xFB


def is_embedded_page(b: bytes, offset: int) -> bool:
    """True when the page header at ``offset`` (its ``0a``) is an embedded
    report graph (module docstring: type varint ``01`` AND preceded by ``fb``)."""
    if offset < 1 or b[offset - 1] != _EMBEDDED_PRE:
        return False
    p = offset + 1
    if p < len(b) and b[p] == 0x00:  # the optional 00 after the 0a
        p += 1
    return p + 2 <= len(b) and b[p] == 0x80 and b[p + 1] == _EMBEDDED_TYPE


def span_pages(b: bytes, pages: Iterable[tuple[int, str]]) -> list[tuple[int, str]]:
    """``pages`` minus the embedded report-graph headers: the headers that
    really start a new span (a book's column records or a graph's layers)."""
    return [(off, name) for off, name in pages if not is_embedded_page(b, off)]
