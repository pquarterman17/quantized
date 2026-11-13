"""``.opj`` writer: designations, comments, X fallback, text and book names.

Audit 2026-11 (Origin interchange): the writer wrote every value column as
Y, dropped comments, read X names only from the Origin-subsystem keys,
turned ``μ`` into ``?``, kept spaces in book short names, and gave books
without a long name the junk title ``"BA"``. Every check re-reads the file
through the existing reader (``read_origin_books``).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.origin_project import read_origin_books
from quantized.io.origin_project.writer import write_opj
from quantized.io.origin_project.writer_blocks import encode_text


def _ds(n: int, meta: dict[str, Any], labels: list[str] | None = None,
        units: list[str] | None = None) -> DataStruct:
    labels = labels or [f"c{j}" for j in range(n)]
    return DataStruct(
        time=np.array([1.0, 2.0, 3.0]),
        values=np.arange(3.0 * n).reshape(3, n),
        labels=tuple(labels),
        units=tuple(units or [""] * n),
        metadata=meta,
    )


def _roundtrip(tmp_path: Path, books: list[DataStruct]) -> list[DataStruct]:
    p = tmp_path / "out.opj"
    write_opj(books, p)
    return read_origin_books(p)


def test_declared_designations_roundtrip_including_second_x(tmp_path: Path) -> None:
    meta = {
        "origin_book": "Desig",
        "column_designations": {
            "B": "Y", "C": "Y-error", "D": "X-error", "E": "label",
            "F": "disregard", "G": "X", "H": "Y", "I": "Z",
        },
    }
    (back,) = _roundtrip(tmp_path, [_ds(8, meta)])
    assert back.metadata["column_designations"] == {
        "A": "X", "B": "Y", "C": "Y-error", "D": "X-error", "E": "label",
        "F": "disregard", "G": "X", "H": "Y", "I": "Z",
    }
    np.testing.assert_array_equal(back.values, np.arange(24.0).reshape(3, 8))


def test_live_error_roles_designate_error_columns(tmp_path: Path) -> None:
    meta = {"origin_book": "Err", "error_roles": [
        {"channel": 1, "target": 0, "axis": "y", "side": "both"},
        {"channel": 2, "target": -1, "axis": "x", "side": "both"},
    ]}
    (back,) = _roundtrip(tmp_path, [_ds(3, meta)])
    assert back.metadata["column_designations"] == {
        "A": "X", "B": "Y", "C": "Y-error", "D": "X-error",
    }


def test_designations_keyed_by_origin_column_names(tmp_path: Path) -> None:
    # A re-exported Origin import: channel short names come from the source.
    meta = {
        "origin_book": "Src",
        "origin_column_names": ["Q", "dQ"],
        "column_designations": {"P": "X", "Q": "Y", "dQ": "Y-error"},
        "column_comments": {"P": "x note", "dQ": "1 sigma"},
        "x_column_name": "P",
    }
    (back,) = _roundtrip(tmp_path, [_ds(2, meta)])
    assert back.metadata["column_designations"] == {"A": "X", "B": "Y", "C": "Y-error"}
    assert back.metadata["column_comments"] == {"A": "x note", "C": "1 sigma"}


def test_column_comments_are_written(tmp_path: Path) -> None:
    meta = {"origin_book": "Cm", "column_comments": {"A": "swept", "B": "spin up"}}
    (back,) = _roundtrip(tmp_path, [_ds(1, meta)])
    assert back.metadata["column_comments"] == {"A": "swept", "B": "spin up"}


def test_x_name_and_unit_fall_back_to_canonical_keys(tmp_path: Path) -> None:
    meta = {"origin_book": "Xf", "x_column_name": "Field", "x_column_unit": "Oe"}
    (back,) = _roundtrip(tmp_path, [_ds(1, meta)])
    assert back.metadata["x_column_long"] == "Field"
    assert back.metadata["x_unit"] == "Oe"


def test_non_latin1_text_never_becomes_question_marks(tmp_path: Path) -> None:
    meta = {"origin_book": "Txt", "x_column_long": "2θ", "x_unit": "°",
            "origin_book_long": "Ångström μ-loop"}
    (back,) = _roundtrip(
        tmp_path, [_ds(2, meta, labels=["Moment", "n"], units=["μB", "cm⁻³"])]
    )
    assert back.units == ("µB", "cm⁻³")  # μ (U+03BC) -> its Latin-1 twin µ
    assert back.metadata["x_column_long"] == "2θ"
    assert back.metadata["x_unit"] == "°"
    assert back.metadata["origin_book_long"] == "Ångström µ-loop"
    assert b"?" not in encode_text("μ θ ⁻ Å Ω")


def test_book_short_names_follow_origins_rule(tmp_path: Path) -> None:
    books = [
        _ds(1, {"origin_book": "Wide Book (30 cols)"}),
        _ds(1, {"origin_book": "wide book 30 cols"}),  # case-insensitive clash
        _ds(1, {"origin_book": "2024 run"}),
    ]
    back = _roundtrip(tmp_path, books)
    shorts = [b.metadata["origin_book"] for b in back]
    assert shorts == ["WideBook30cols", "widebook30cols2", "B2024run"]
    assert all(s.isalnum() and s[0].isalpha() for s in shorts)
    # The original text survives as the long name.
    assert [b.metadata["origin_book_long"] for b in back] == [
        "Wide Book (30 cols)", "wide book 30 cols", "2024 run",
    ]


def test_book_without_long_name_reads_back_its_short_name(tmp_path: Path) -> None:
    # Was "BA": the minimal no-marker header sent the reader to its printable-
    # run fallback, which picked template bytes as the title.
    (back,) = _roundtrip(tmp_path, [_ds(1, {"origin_book": "Moke"})])
    assert back.metadata["origin_book_long"] == "Moke"
