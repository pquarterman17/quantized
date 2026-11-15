"""Loose datasets (no worksheet window) are not Library books
(``opju_loose_books``; ``ORIGIN_PLOT_TYPE_PARITY_PLAN`` items 5 and 6).

Synthetic bytes only (invented names) except the ``realdata`` anchors, whose
expected book lists Origin 2026b reported over COM (``WorksheetPages``,
``doc -e S``) on 2026-11-15.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from opju_fixture import CELLS_END, cell_num, dataset, project
from quantized.io.origin_project import drop_empty_library_books, read_origin_project_all
from quantized.io.origin_project.opju import parse_opju, read_opju_books
from quantized.io.origin_project.opju_loose_books import loose_books
from test_io_origin_figures_opju import _opju_page_header

TN = 0x61


def _col(name: str, *vals: float) -> bytes:
    cells = b"".join(cell_num(v) for v in vals) + CELLS_END
    n = len(vals)
    return dataset(name, cells, kind=TN, total=n, used=n, size=10)


def _write(tmp_path: Path, blob: bytes) -> Path:
    p = tmp_path / "loose.opju"
    p.write_bytes(blob)
    return p


def test_loose_books_are_the_books_no_window_owns() -> None:
    b = _opju_page_header("Data") + _opju_page_header("Graph1")
    assert loose_books(b, ["Data", "Data@3", "DataA@2", "CS"]) == ["DataA@2", "CS"]


def test_loose_books_compares_names_case_insensitively() -> None:
    """A book renamed only in case keeps its datasets' old spelling; Origin
    names are case-insensitive, so window ``CuS`` still owns ``Cus_B@2``."""
    b = _opju_page_header("CuS") + _opju_page_header("Graph1")
    assert loose_books(b, ["Cus", "Cus@2", "CusA@2"]) == ["CusA@2"]


def test_loose_books_fails_closed() -> None:
    # no window header at all: nothing to test against
    assert loose_books(b"\x00" * 64, ["CS", "Data"]) == []
    # every book loose (a graph-only project): the loose data is all there is
    assert loose_books(_opju_page_header("Graph1"), ["Book2A", "CS"]) == []


def test_reader_drops_loose_books_and_reports_them(tmp_path: Path) -> None:
    """A stacked plot's ``CS_n`` helper and a deleted sheet's renamed
    ``DataA_*@2`` datasets have no window; the live sheets keep theirs."""
    blob = project(
        _col("Data_A", 1.0, 2.0),
        _col("Data_B", 3.0, 4.0),
        _col("DataA_A@2", 5.0, 6.0),
        _col("Data_A@3", 7.0, 8.0),
        _col("CS_1", 9.0, 10.0),
        tail=_opju_page_header("Data") + _opju_page_header("Graph1"),
    )
    path = _write(tmp_path, blob)
    books = [str(d.metadata["origin_book"]) for d in read_opju_books(path)]
    assert books == ["Data", "Data@3"]
    parsed = parse_opju(path)
    assert parsed.fidelity["loose_books_omitted"] == ["DataA@2", "CS"]
    assert [i["name"] for i in parsed.inventory] == ["Data", "Data@3"]


def test_reader_keeps_a_project_of_loose_datasets_only(tmp_path: Path) -> None:
    blob = project(
        _col("Book2A_A", 1.0, 2.0),
        _col("Book2A_B", 3.0, 4.0),
        tail=_opju_page_header("Graph1"),
    )
    books = [str(d.metadata["origin_book"]) for d in read_opju_books(_write(tmp_path, blob))]
    assert books == ["Book2A"]


# ---- realdata anchors (Origin 2026b COM, 2026-11-15) ----

_SOP = "origin/public/Techboyjohnny-98_SOP_measurement_SHAP/OriginPro file/SOP_meas.opju"
_ABS = "origin/public/Since-Ufa_Diplom/paper/pictures/Absorption-D3.opju"
_TEA = "origin/public/niloofarcrno_Techno-Economic-Model/TEA_ExcelGraphs.opju"


def _books(corpus_dir: Path, rel: str) -> list[str]:
    p = corpus_dir / rel
    if not p.is_file():
        pytest.skip(f"{rel} not present")
    _primary, books = read_origin_project_all(p)
    return [str(b.metadata.get("origin_book")) for b in drop_empty_library_books(books)]


@pytest.mark.realdata
def test_realdata_sop_meas_loose_datasets_are_not_books(corpus_dir: Path) -> None:
    """COM ``WorksheetPages`` holds no ``CS`` and no ``SOP25degC2A``; those
    names exist only as loose datasets (``doc -e S``)."""
    books = _books(corpus_dir, _SOP)
    assert "CS" not in books
    assert not any(b.startswith("SOP25degC2A") for b in books)
    assert books  # the project's real books are still there


@pytest.mark.realdata
def test_realdata_case_renamed_book_keeps_its_sheets(corpus_dir: Path) -> None:
    """COM: window ``CuSCH3vac`` has 6 sheets whose datasets are
    ``Cusch3vac_B`` .. ``Cusch3vac_B@5`` and ``CuSCH3vac_B@6`` (all plotted
    in ``Graph1``); ``Cusch3vacA*`` is a window-less leftover."""
    books = _books(corpus_dir, _ABS)
    assert {"Cusch3vac", "Cusch3vac@2", "Cusch3vac@5", "CuSCH3vac@6"} <= set(books)
    assert not any(b.startswith("Cusch3vacA") for b in books)


@pytest.mark.realdata
def test_realdata_tea_stacked_helper_is_not_a_book(corpus_dir: Path) -> None:
    books = _books(corpus_dir, _TEA)
    assert "CS" not in books and "Table2" not in books
    assert books
