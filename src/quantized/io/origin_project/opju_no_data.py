"""``.opju`` projects whose worksheets hold no data: import the rest anyway.

Two real shapes reach "no worksheet columns could be decoded" although the
project is intact (2026-11-20; ``docs/origin_re/opju_no_worksheet_data.md``):

* **Data Connector books saved without their data.** Origin's Data
  Connectors (CSV, Excel, MATLAB, NetCDF, Origin, …) link a workbook to an
  external file. A connector book whose data was not saved in the project
  stores every column with ONE allocated row and ZERO used rows, while its
  window section still names the connector (``CSV_Connector\\0``) and the
  source file's path. Whole public corpus (285 CPYUA files): 87 connector
  books in 41 projects; 83 carry their data (allocated = used > 0, the
  negative controls, e.g. five sibling ``PDOS`` projects of the same author,
  same connector), 4 are exactly 1-allocated / 0-used. The two whole
  projects among them used to fail to import; their graphs show plotted
  data in Origin's own saved page previews (the independent oracle that the
  data existed when the graph was drawn and is simply not in the file).
* **Graph-only projects.** No dataset header at all and no matrix, but a
  graph page (e.g. one whose content is a pasted picture: its page holds a
  compressed RGBA raster, and Origin's saved preview shows that picture).

Instead of failing the whole import, such a project imports its books as
empty, explicitly-labelled placeholder books (``metadata
["origin_worksheet_unavailable"]``), its graphs, and their saved previews.
Curves plotted from a book whose data is not in the file are left out of
their graph with reason ``data_not_saved`` (``omit_unsaved_curves``) — never
drawn from nothing. A project with no data AND no graph still raises.

Pure ``io``: bytes in, plain values out.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Any

from quantized.datastruct import DataStruct
from quantized.io.origin_project.opju_curve_sheets import without_captions, without_positions
from quantized.io.origin_project.opju_figure_curves import opju_pages

__all__ = [
    "DATA_NOT_SAVED",
    "UNAVAILABLE_KEY",
    "connector_books",
    "nothing_left_unread",
    "omit_unsaved_curves",
    "unavailable_reason",
]

DATA_NOT_SAVED = "data_not_saved"
UNAVAILABLE_KEY = "origin_worksheet_unavailable"

# ``<Kind>_Connector\0`` — the connector's class name in the book's window.
_CONNECTOR = re.compile(rb"([A-Za-z][A-Za-z0-9]{1,23})_Connector\x00")
# A source path: a drive-letter or UNC Windows path ending in a file
# extension, of printable bytes (UTF-8 multi-byte allowed). The connector
# window stores it either NUL-terminated or as a one-byte-length-prefixed
# string; only a candidate whose own framing closes exactly is accepted, so
# a path cut by the window's compression is never reported half-read.
_PATH_START = re.compile(rb"[A-Za-z]:\\|\\\\")
_PATH = re.compile(rb"(?:[A-Za-z]:\\|\\\\)[\x20-\x7e\x80-\xff]{1,250}\.[A-Za-z0-9]{1,6}")


def _paths(chunk: bytes) -> list[str]:
    out: list[str] = []
    for m in _PATH_START.finditer(chunk):
        i = m.start()
        nul = chunk.find(b"\x00", i, i + 256)
        framed = [chunk[i:nul]] if nul > i else []
        if i > 0:
            framed.append(chunk[i : i + chunk[i - 1]])  # length-prefixed form
        for cand in framed:
            if _PATH.fullmatch(cand):
                out.append(cand.decode("utf-8", "replace"))
    return out


def _span(pages: list[tuple[int, str]], book: str, size: int) -> tuple[int, int] | None:
    for i, (start, name) in enumerate(pages):
        if name == book:
            end = pages[i + 1][0] if i + 1 < len(pages) else size
            return start, end
    return None


def connector_books(b: bytes, books: Iterable[str]) -> dict[str, dict[str, str]]:
    """``{book: {"connector": kind, "source": path}}`` for each of ``books``
    whose own page span names a Data Connector. ``source`` is the longest
    source-file path in that span (``""`` when none is legible)."""
    wanted = [k for k in dict.fromkeys(books) if "@" not in k]
    if not wanted or b"_Connector\x00" not in b:
        return {}
    pages = opju_pages(b)
    out: dict[str, dict[str, str]] = {}
    for book in wanted:
        span = _span(pages, book, len(b))
        if span is None:
            continue
        chunk = b[span[0] : span[1]]
        kind = _CONNECTOR.search(chunk)
        if kind is None:
            continue
        paths = _paths(chunk)
        source = max(paths, key=len) if paths else ""
        out[book] = {"connector": kind.group(1).decode("ascii"), "source": source}
    return out


def nothing_left_unread(fidelity: Mapping[str, object]) -> bool:
    """True when the worksheet scan found no record it failed to read.

    The placeholder import is only for a project whose worksheets are proven
    to HOLD no data (empty books, no dataset at all). A record that was found
    but not read — an undecoded form, a damaged header, a checksum failure,
    an over-budget column, an unshaped matrix, a report column — means the
    data may be in the file: that keeps failing closed with its census."""

    def _count(key: str) -> int:
        v = fidelity.get(key)
        if isinstance(v, Mapping):
            v = v.get("count", 0)
        if isinstance(v, (list, tuple)):
            return len(v)
        return v if isinstance(v, int) else 0

    keys = (
        "undecoded",
        "records_without_header",
        "checksum_failed",
        "over_decode_budget",
        "matrix_datasets",
        "report_columns",
        "columns_without_header",
    )
    return all(_count(k) == 0 for k in keys)


def unavailable_reason(book: str, connectors: Mapping[str, Mapping[str, str]]) -> dict[str, str]:
    """The ``origin_worksheet_unavailable`` record of one placeholder book."""
    base = book.partition("@")[0]
    conn = connectors.get(base)
    if conn is not None:
        src = conn.get("source", "")
        where = f" ({src})" if src else ""
        return {
            "reason": DATA_NOT_SAVED,
            "connector": conn.get("connector", ""),
            "source": src,
            "detail": (
                f"Book {base} is linked to an external file by Origin's "
                f"{conn.get('connector', '')} Data Connector{where}, and its data was "
                "not saved in the project. Import that file directly to get the data."
            ),
        }
    return {
        "reason": "no_worksheet_data",
        "detail": "This project stores no worksheet data; only its graphs were imported.",
    }


def omit_unsaved_curves(
    figs: list[dict[str, Any]], books: Iterable[DataStruct], connectors: Iterable[str] = ()
) -> list[dict[str, Any]]:
    """``figs`` with every curve of a book whose data is not in the file (a
    placeholder book, ``origin_worksheet_unavailable``) moved to
    ``curve_sheet_omitted`` (reason ``data_not_saved``) and its legend
    caption dropped — a curve is never drawn from a book with no cells.

    ``connectors``: the Data Connector books saved without their data in a
    project that DID import other books (worksheet fidelity
    ``unsaved_books``, the same F-010 rule). They import no book at all, so
    their curves (any sheet) were left for the frontend to drop silently,
    which left a page with no book to open (``稳定性`` Graph9-12)."""
    books = list(books)
    unsaved = {
        str(ds.metadata.get("origin_book", ""))
        for ds in books
        if isinstance(ds.metadata.get(UNAVAILABLE_KEY), Mapping)
    }
    unsaved.discard("")
    imported = {str(ds.metadata.get("origin_book", "")) for ds in books}
    gone = set(connectors)

    def is_unsaved(book: str) -> bool:
        return book in unsaved or (book.partition("@")[0] in gone and book not in imported)

    if not unsaved and not gone:
        return figs
    out: list[dict[str, Any]] = []
    for fig in figs:
        curves = fig.get("curves") or []
        drop = {i for i, c in enumerate(curves) if is_unsaved(str(c.get("book", "")))}
        if not drop:
            out.append(fig)
            continue
        notes = list(fig.get("curve_sheet_omitted") or [])
        for i in sorted(drop):
            c = curves[i]
            notes.append(
                {
                    "book": str(c["book"]).partition("@")[0],
                    "x": str(c.get("x", "")),
                    "y": str(c.get("y", "")),
                    "recorded": str(c["book"]),
                    "reason": DATA_NOT_SAVED,
                }
            )
        out.append(
            {
                **fig,
                "curves": without_positions(curves, drop),
                "legend_labels": without_captions(fig.get("legend_labels") or [], drop),
                "curve_sheet_omitted": notes,
            }
        )
    return out
