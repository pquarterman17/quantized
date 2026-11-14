"""The ``.opj`` writer writes an imported matrix back as an Origin matrix
(``writer_matrix``), read again by the repo's own reader (``opj_matrix``).

Synthetic matrices only, built by the reader's own ``build_matrix_book``;
the Altaxo specimens' round trip is the realdata test in
``test_io_origin_opj_corpus.py``.
"""

from __future__ import annotations

import tempfile
from dataclasses import replace
from pathlib import Path

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.origin_project import read_origin_books
from quantized.io.origin_project.opj_matrix import MatrixSheet, build_matrix_book
from quantized.io.origin_project.writer import opj_bytes
from quantized.io.origin_project.writer_matrix import matrix_fallbacks, matrix_grid

CELLS = np.array([1.5, np.nan, 3.0, -4.0, 5.0, 6.25])  # 2 rows x 3 columns, row-major


def _matrix(name: str = "MBook1", *, coords: bool = True, imag: bool = False) -> DataStruct:
    sheet = MatrixSheet("MSheet1", 2, 3, *((10.0, 30.0, 0.5, 1.5) if coords else ()))
    return build_matrix_book(name, name, sheet, CELLS, CELLS * 2 if imag else None, [])


def _worksheet() -> DataStruct:
    return DataStruct.create(
        [1.0, 2.0], [[5.0], [6.0]], labels=["B"], units=[""],
        metadata={"origin_book": "Book1", "x_column_name": "A"},
    )


def _round_trip(books: list[DataStruct], groups: list[str] | None = None) -> dict[str, DataStruct]:
    out = Path(tempfile.mkdtemp()) / "m.opj"
    out.write_bytes(opj_bytes(books, groups))
    return {str(b.metadata["origin_book"]): b for b in read_origin_books(out)}


def test_a_matrix_comes_back_as_the_same_matrix_beside_a_worksheet() -> None:
    matrix = _matrix()
    back = _round_trip([_worksheet(), matrix])
    again = back["MBook1"]
    assert again.metadata["origin_matrix"] == matrix.metadata["origin_matrix"]
    assert again.metadata["map_shape"] == [2, 3]
    assert np.array_equal(again.values, matrix.values, equal_nan=True)  # blank cell kept
    assert np.array_equal(back["Book1"].values, _worksheet().values)
    assert matrix_fallbacks([_worksheet(), matrix], None) == 0


def test_a_matrix_without_coordinates_stays_on_cell_indices() -> None:
    matrix = _matrix(coords=False)
    again = _round_trip([matrix])["MBook1"]
    assert again.metadata["origin_matrix"]["coordinates_recovered"] is False
    assert np.array_equal(again.values, matrix.values, equal_nan=True)


def test_an_edited_complex_or_grouped_matrix_goes_out_as_worksheet_columns() -> None:
    sorted_rows = _matrix()
    # two points swapped (a sort by Z, say): no longer one row of X per row
    sorted_rows = replace(sorted_rows, values=sorted_rows.values[[1, 0, 2, 3, 4, 5]].copy())
    assert matrix_grid(sorted_rows) is None  # no longer the reader's grid
    assert matrix_grid(_matrix(imag=True)) is None  # no complex matrix window
    back = _round_trip([sorted_rows])
    assert back["MBook1"].metadata.get("origin_matrix") is None
    assert back["MBook1"].values.shape[0] == 6
    two = [_matrix("MBook1"), _matrix("MBook2")]
    assert matrix_fallbacks([sorted_rows, _matrix(imag=True)], None) == 2
    assert matrix_fallbacks(two, ["wb", "wb"]) == 2  # a matrix in a shared workbook
    assert matrix_fallbacks(two, ["", ""]) == 0
    assert matrix_fallbacks([_worksheet()], None) == 0  # not a matrix at all


def test_two_matrices_each_keep_their_window() -> None:
    a, b = _matrix("MBook1"), _matrix("MBook2", coords=False)
    back = _round_trip([a, b])
    assert back["MBook1"].metadata["origin_matrix"]["x_range"] == [10.0, 30.0]
    assert back["MBook2"].metadata["origin_matrix"]["coordinates_recovered"] is False
