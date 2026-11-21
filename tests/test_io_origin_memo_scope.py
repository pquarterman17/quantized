"""The #806 whole-file memos (``opju_blocks._last_scan``, ``column_id_table``'s
``last_call``) hold the project's bytes for their identity key. They must not
outlive the import that filled them (a long-running server would pin the last
``.opju``, tens of MB), and must not change what an import returns."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from opju_fixture import CELLS_END, cell_num, dataset, project
from quantized.io.origin_project import opju_blocks
from quantized.io.origin_project.opju import read_opju_books
from quantized.io.origin_project.opju_figure_curves import column_id_table
from quantized.io.origin_project.opju_memo import import_scope, last_call
from test_io_origin_figures_opju import _opju_page_header


def _col(name: str, *vals: float) -> bytes:
    cells = b"".join(cell_num(v) for v in vals) + CELLS_END
    return dataset(name, cells, kind=0x61, total=len(vals), used=len(vals), size=10)


def _project_file(tmp_path: Path) -> Path:
    blob = project(_col("Data_A", 1.0, 2.0), _col("Data_B", 3.0, 4.0), tail=_opju_page_header("Data"))
    p = tmp_path / "p.opju"
    p.write_bytes(blob)
    return p


def test_an_import_leaves_no_scan_memo_behind(tmp_path: Path) -> None:
    books = read_opju_books(_project_file(tmp_path))
    assert books and opju_blocks._last_scan is None


def test_an_import_that_fails_still_releases_the_memos(tmp_path: Path) -> None:
    bad = tmp_path / "bad.opju"
    bad.write_bytes(b"not an origin project")
    with pytest.raises(Exception):  # noqa: B017, PT011 - any reader failure
        read_opju_books(bad)
    assert opju_blocks._last_scan is None


def test_scope_releases_the_bytes_both_memos_hold() -> None:
    # (a bytes object cannot be weakly referenced: count its references)
    b = bytes(project(_col("Data_A", 1.0, 2.0), tail=_opju_page_header("Data")))
    before = sys.getrefcount(b)
    with import_scope():
        opju_blocks.find_headers(b)
        column_id_table(b, [])
        assert sys.getrefcount(b) >= before + 2  # held by both: the identity key
    assert sys.getrefcount(b) == before  # and released with the import


def test_a_nested_scope_keeps_the_memo_for_the_rest_of_the_import() -> None:
    calls: list[int] = []

    @last_call
    def table(b: bytes, k: int) -> int:
        calls.append(k)
        return k

    b = b"x" * 8
    with import_scope():
        with import_scope():
            table(b, 1)
        table(b, 1)  # inner scope ended: still memoised
        assert calls == [1]
    table(b, 1)  # outermost ended: recomputed, same answer
    assert calls == [1, 1]
