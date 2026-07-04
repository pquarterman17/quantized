"""Read Origin ``.opju`` (CPYUA, 2018+) projects: worksheet data → DataStruct.

The worksheet-column codec is solved (``opju_codec.py``): each column is an
FPC-compressed float64 stream, located by its LEB128-varint record header and
labelled by the nearest preceding ``<Book>_<Col>`` dataset name. Books are
grouped and assembled exactly like the ``.opj`` reader (shared ``_group`` /
``_build_book`` / ``_inventory``); the only ``.opju`` delta handled here is the
different container encoding, so column long-names/units (which live in the
Unicode windows section — a separate decode) fall back to the Origin short
designations A, B, C… for now.
"""

from __future__ import annotations

from collections import OrderedDict
from pathlib import Path

from quantized.datastruct import DataStruct
from quantized.io.origin_project.container import fallback
from quantized.io.origin_project.opj import Columns, _build_book, _group, _inventory
from quantized.io.origin_project.opju_codec import scan_columns

__all__ = ["read_opju", "read_opju_books"]


def _parse(path: Path) -> tuple[OrderedDict[str, Columns], list[dict[str, object]]]:
    b = path.read_bytes()
    if not b.startswith(b"CPYUA"):
        raise fallback(path, f"'{path.name}' does not look like a CPYUA .opju (bad header).")
    columns = scan_columns(b)
    if not columns:
        raise fallback(path, f"no worksheet columns could be decoded from '{path.name}'.")
    books = _group(columns)
    return books, _inventory(books, {})


def read_opju(path: Path) -> DataStruct:
    """The single-DataStruct contract: the largest workbook (inventory in metadata)."""
    books, inventory = _parse(path)
    primary_pool = [k for k in books if "@" not in k] or list(books)
    primary = max(primary_pool, key=lambda k: sum(len(v) for _, v in books[k]))
    return _build_book(primary, books[primary], {}, inventory, source_format="origin_opju")


def read_opju_books(path: Path) -> list[DataStruct]:
    """Every workbook in the project as its own DataStruct (plan item 3/16)."""
    books, inventory = _parse(path)
    return [
        _build_book(k, v, {}, inventory, source_format="origin_opju")
        for k, v in books.items()
        if v
    ]
