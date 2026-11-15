"""Synthetic Origin projects for the ``qz convert`` tests.

Not a test module (the name never matches ``python_files``). Every project is
built at test time by the committed builders -- the ``.opj`` writer
(``io/origin_project/writer.py``) and ``tests/opju_fixture.py`` -- never read
from the private corpus.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from opju_fixture import CELLS_END, cell_num, dataset, project, spec
from quantized.datastruct import DataStruct
from quantized.io.origin_project.opj_matrix import MatrixSheet, build_matrix_book
from quantized.io.origin_project.writer import opj_bytes

CELLS = np.array([1.5, np.nan, 3.0, -4.0, 5.0, 6.25])  # a 2 x 3 matrix, row-major


def book(name: str, n: int = 4, long: str = "") -> DataStruct:
    """X, Y and a Y-error, designated as such (Origin's error-bar roles)."""
    return DataStruct(
        time=np.arange(1.0, n + 1),
        values=np.column_stack([np.arange(n) * 10.0, np.arange(n) * 0.5]),
        labels=("Moment", "Error"),
        units=("emu", "emu"),
        metadata={
            "origin_book": name,
            "origin_book_long": long,
            "x_column_long": "Field",
            "x_unit": "Oe",
            "column_designations": {"A": "X", "B": "Y", "C": "Y-error"},
        },
    )


def loops_opj(path: Path) -> Path:
    """Two workbooks: Loop1 with two sheets, Scan2 with one."""
    books = [book("Loop1", long="30 nm µ"), book("Loop1@2", 3), book("Scan2", 5)]
    path.write_bytes(opj_bytes(books, ["a", "a", ""]))
    return path


def multi_x_opj(path: Path) -> Path:
    """One book laid out X, Y, X, Y with a non-monotonic X and a comment."""
    ds = DataStruct.create(
        [3.0, 1.0, 2.0],
        [[1.0, 30.0, 4.0], [2.0, 10.0, 5.0], [3.0, 20.0, 6.0]],
        labels=["Y1", "X2", "Y2"],
        units=["V", "s", "V"],
        metadata={
            "origin_book": "Multi",
            "x_column_long": "X1",
            "x_unit": "s",
            "column_designations": {"A": "X", "B": "Y", "C": "X", "D": "Y"},
            "column_comments": {"B": 'first run, "cold"'},
        },
    )
    path.write_bytes(opj_bytes([ds]))
    return path


def matrix_opj(path: Path, *, coords: bool) -> Path:
    """A worksheet plus a matrix with (or without) Origin's X/Y coordinates."""
    sheet = MatrixSheet("MSheet1", 2, 3, *((10.0, 30.0, 0.5, 1.5) if coords else ()))
    matrix = build_matrix_book("MBook1", "MBook1", sheet, CELLS, None, [])
    worksheet = DataStruct.create(
        [1.0, 2.0], [[5.0], [6.0]], labels=["B"], units=[""],
        metadata={"origin_book": "Book1", "x_column_name": "A"},
    )  # fmt: skip
    path.write_bytes(opj_bytes([worksheet, matrix], None, matrices=True))
    return path


def _tn(name: str, cells: bytes, total: int, used: int) -> bytes:
    return dataset(name, cells + CELLS_END, kind=0x61, total=total, used=used, size=10)


def undecodable_column_opju(path: Path) -> Path:
    """One book whose column B is a record form the reader cannot identify."""
    path.write_bytes(
        project(
            _tn("Book1_A", cell_num(1.0) + cell_num(2.0), 2, 2),
            _tn("Book1_B", b"\x07\x00" + spec(1.0) + cell_num(2.0), 2, 2),
        )
    )
    return path


def loose_dataset_opju(path: Path) -> Path:
    """A good book, plus a dataset that is no worksheet column (no owner)."""
    path.write_bytes(
        project(
            _tn("Book1_A", cell_num(1.0) + cell_num(2.0), 2, 2),
            _tn("Book1_B", cell_num(3.0) + cell_num(4.0), 2, 2),
            _tn("Loose", b"\x07\x00" + spec(1.0) + cell_num(2.0), 2, 2),
        )
    )
    return path
