"""Origin link tables against the public corpus (``realdata``; skips when absent).

Expectations are computed at run time from the files' own text cells: no
corpus bytes, values or paths are committed. Ledger F-118.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from origin_corpus import has_project, origin_corpus_dir
from quantized.datastruct import DataStruct
from quantized.io.origin_project import OriginProjectError, read_origin_books
from quantized.io.origin_project.link_tables import LINK_TABLE_KEY

pytestmark = pytest.mark.realdata


def _projects() -> list[Path]:
    root = origin_corpus_dir() / "public"
    if not root.is_dir():
        return []
    return sorted(p for p in root.rglob("*.opju") if has_project(p))


def _link_cells(b: DataStruct) -> list[str]:
    cols = b.metadata.get("origin_text_columns") or {}
    return [str(c) for col in cols.values() for c in col if str(c).startswith("cell://")]


def _numeric(b: DataStruct) -> bool:
    return bool(b.values.size) and bool(np.isfinite(b.values).any())


def test_link_tables_in_public_opju_are_flagged_and_nothing_else() -> None:
    projects = _projects()
    if not projects:
        pytest.skip("public Origin corpus not present")
    flagged = 0
    for path in projects:
        try:
            books = read_origin_books(path)
        except OriginProjectError:
            continue  # the corpus holds deliberate non-project / corrupt negatives
        for book in books:
            marked = bool(book.metadata.get(LINK_TABLE_KEY))
            if marked:
                flagged += 1
                # positive: a link, no numbers, nothing dropped
                assert _link_cells(book), (path.name, book.metadata.get("origin_book"))
                assert not _numeric(book)

    if flagged == 0:
        pytest.skip("no link-table book in this corpus")
