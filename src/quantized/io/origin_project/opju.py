"""Read Origin ``.opju`` (CPYUA, 2018+) projects: worksheet data → DataStruct.

The worksheet-column codec is solved (``opju_codec.py``): each column is an
FPC-compressed float64 stream, located by its LEB128-varint record header and
labelled by the nearest preceding ``<Book>_<Col>`` dataset name. Books are
grouped and assembled exactly like the ``.opj`` reader (shared ``_group`` /
``_build_book`` / ``_inventory``). Column long-names/units/comments come from
the CPYUA windows section (``windows_opju.py``, plan item 10) the same way
`.opj`'s windows-section metadata feeds ``_build_book`` — designation-X
becomes the x axis, real labels/units/comments attach where a book's window
section can be structurally confirmed, and book display titles recover from
the embedded import filename where available. Columns/books that can't be
confirmed keep the Origin short-designation fallback (A, B, C…) rather than
being guessed at.
"""

from __future__ import annotations

from collections import OrderedDict
from pathlib import Path

from quantized.datastruct import DataStruct
from quantized.io.origin_project.container import fallback
from quantized.io.origin_project.opj import Columns, _build_book, _group, _inventory
from quantized.io.origin_project.opju_codec import scan_columns
from quantized.io.origin_project.windows import BookMeta
from quantized.io.origin_project.windows_opju import opju_window_metadata

__all__ = ["read_opju", "read_opju_books"]


def _parse(
    path: Path,
) -> tuple[OrderedDict[str, Columns], dict[str, BookMeta], list[dict[str, object]]]:
    b = path.read_bytes()
    if not b.startswith(b"CPYUA"):
        raise fallback(path, f"'{path.name}' does not look like a CPYUA .opju (bad header).")
    columns = scan_columns(b)
    if not columns:
        raise fallback(path, f"no worksheet columns could be decoded from '{path.name}'.")
    books = _group(columns)
    books_meta = opju_window_metadata(b, {k: [c for c, _ in v] for k, v in books.items()})
    return books, books_meta, _inventory(books, books_meta)


def read_opju(path: Path) -> DataStruct:
    """The single-DataStruct contract: the largest workbook (inventory in metadata)."""
    books, books_meta, inventory = _parse(path)
    primary_pool = [k for k in books if "@" not in k] or list(books)
    primary = max(primary_pool, key=lambda k: sum(len(v) for _, v in books[k]))
    return _build_book(primary, books[primary], books_meta, inventory, source_format="origin_opju")


def read_opju_books(path: Path) -> list[DataStruct]:
    """Every workbook in the project as its own DataStruct (plan item 3/16)."""
    books, books_meta, inventory = _parse(path)
    return [
        _build_book(k, v, books_meta, inventory, source_format="origin_opju")
        for k, v in books.items()
        if v
    ]
