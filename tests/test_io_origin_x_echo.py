"""``.ogs`` export of an Origin matrix book read as X/Y/Z: its X channel only
repeats worksheet column 1, so it is written once (``io/origin_x_echo``).

The MATLAB-golden case (an XRDML scan, ``test_golden_export``) has no Origin
metadata and is untouched; so is any real column that merely holds the same
numbers as X under another name.
"""

from __future__ import annotations

from typing import Any

from quantized.datastruct import DataStruct
from quantized.io.origin import GraphSpec, format_origin_project_script, format_origin_script

X = [1.0, 2.0, 3.0]


def _matrix_book(**meta: Any) -> DataStruct:
    """The reader's shape for a matrix book: time = X, channels X/Y/Z."""
    return DataStruct.create(
        X,
        [[1.0, 7.0, 0.5], [2.0, 7.0, 0.6], [3.0, 7.0, 0.7]],
        labels=["X", "Y", "Z"],
        units=["", "", ""],
        metadata={"origin_book": "MBook1", "x_column_name": "X", **meta},
    )


def test_a_matrix_books_x_channel_is_written_once() -> None:
    csv, ogs = format_origin_script(_matrix_book(), make_graph=False)
    lines = csv.splitlines()
    assert lines[0] == "X,Y,Z"
    assert lines[2] == "1,7,0.5"
    assert 'wks.col2.lname$ = "Y";' in ogs
    assert 'wks.col3.lname$ = "Z";' in ogs
    assert "wks.col4" not in ogs


def test_the_graph_keys_follow_the_dropped_channel() -> None:
    # Z (channel 2) against the X channel (0): X becomes worksheet column 1,
    # Z column 3 — not the stale "column 4".
    _, ogs = format_origin_script(
        _matrix_book(), make_graph=True, graph=GraphSpec(y_keys=(2,), x_key=0)
    )
    assert "plotxy iy:=(1,3) " in ogs
    assert "(1,4)" not in ogs and "(2,4)" not in ogs


def test_a_real_column_equal_to_x_under_another_name_stays() -> None:
    ds = DataStruct.create(
        X, [[1.0, 5.0], [2.0, 6.0], [3.0, 7.0]], labels=["H", "B"], units=["", ""],
        metadata={"origin_book": "Book1", "x_column_name": "A"},
    )
    csv, _ = format_origin_script(ds, make_graph=False)
    assert csv.splitlines()[0] == "A,H,B"


def test_without_origin_metadata_every_channel_is_written() -> None:
    ds = DataStruct.create(
        X, [[1.0, 5.0], [2.0, 6.0], [3.0, 7.0]], labels=["X", "B"], units=["", ""],
        metadata={"x_column_name": "X"},
    )
    csv, _ = format_origin_script(ds, make_graph=False)
    assert csv.splitlines()[0] == "X,X,B"


def test_an_x_named_channel_with_other_values_stays() -> None:
    ds = DataStruct.create(
        X, [[9.0, 5.0], [8.0, 6.0], [7.0, 7.0]], labels=["X", "B"], units=["", ""],
        metadata={"origin_book": "Book1", "x_column_name": "X"},
    )
    assert format_origin_script(ds, make_graph=False)[0].splitlines()[0] == "X,X,B"


def test_the_multi_book_project_script_dedupes_too() -> None:
    csvs, ogs = format_origin_project_script([(_matrix_book(), "")])
    assert csvs[0][1].splitlines()[0] == "X,Y,Z"
    assert "wks.col4" not in ogs
