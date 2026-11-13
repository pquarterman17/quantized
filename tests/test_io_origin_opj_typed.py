"""Header-driven ``.opj`` decoding: typed cells, used rows, labels, matrices.

Synthetic fixtures only (``origin_opj_fixtures`` — real block layouts,
constructed values). The specimen-corpus checks live in
``test_io_origin_opj_corpus.py`` (realdata).
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest

from origin_opj_fixtures import (
    COMPLEX,
    DOUBLE,
    FLOAT,
    INT8,
    INT16,
    INT32,
    MISSING,
    TEXT,
    TEXT_NUMERIC,
    block,
    coordinate,
    dataset,
    dataset_header,
    label_block,
    null,
    project,
    prop_block,
    sheet_header,
    text_cell,
    tn_blank_old,
    tn_number,
    tn_text,
    window_header,
)
from quantized.datastruct import DataStruct
from quantized.io.origin_project import (
    OriginProjectError,
    read_origin_books,
    read_origin_project,
)
from quantized.io.origin_project.fidelity import assess_origin_figures, with_data_diagnostics


def _books(tmp_path: Path, blob: bytes) -> dict[str, DataStruct]:
    path = tmp_path / "p.opj"
    path.write_bytes(blob)
    return {str(b.metadata["origin_book"]): b for b in read_origin_books(path)}


def _doubles(values: list[float], total: int) -> bytes:
    return b"".join(struct.pack("<d", v) for v in values) + MISSING * (total - len(values))


def _column(book: DataStruct, short: str) -> np.ndarray:
    if book.metadata["x_column_name"] == short:
        return np.asarray(book.time)
    return np.asarray(book.values[:, book.metadata["origin_column_names"].index(short)])


# ── gap 1: the header states the cell type and width ─────────────────────────


def test_float64_column_is_read_at_8_byte_stride(tmp_path: Path) -> None:
    """A Numeric (double) column is 8 bytes per row. With an allocation
    divisible by 5 its block is also a multiple of 10 bytes, and the old
    reader decoded it as 10-byte records: plausible-looking garbage."""
    blob = project(
        [
            dataset(
                dataset_header("Book1_A", DOUBLE, total=30, used=3), _doubles([3.0, 5.0, 7.5], 30)
            ),
            dataset(
                dataset_header("Book1_B", DOUBLE, total=30, used=3), _doubles([0.25, 1e6, -2.0], 30)
            ),
        ]
    )
    book = _books(tmp_path, blob)["Book1"]
    assert _column(book, "A").tolist() == [3.0, 5.0, 7.5]
    assert _column(book, "B").tolist() == [0.25, 1e6, -2.0]


def test_float64_column_not_divisible_by_ten_is_not_dropped(tmp_path: Path) -> None:
    """32 allocated rows x 8 bytes = 256 bytes: not a multiple of 10, so the
    old walker took the DATA block for a header and lost the column."""
    blob = project(
        [dataset(dataset_header("Book1_A", DOUBLE, total=32, used=2), _doubles([1.5, 2.5], 32))]
    )
    assert _column(_books(tmp_path, blob)["Book1"], "A").tolist() == [1.5, 2.5]


@pytest.mark.parametrize(
    ("kind", "unsigned", "fmt", "values"),
    [
        (FLOAT, False, "<f", [1.5, -0.25, 1024.0]),
        (INT16, False, "<h", [1, -1, 300]),
        (INT16, True, "<H", [1, 65535, 300]),
        (INT32, False, "<i", [1, -1, 70000]),
        (INT32, True, "<I", [1, 4294967295, 70000]),
        (INT8, False, "<b", [1, -1, 100]),
        (INT8, True, "<B", [1, 255, 100]),
    ],
)
def test_narrow_numeric_types_widen_to_float64(
    tmp_path: Path, kind: tuple[int, int, int], unsigned: bool, fmt: str, values: list[float]
) -> None:
    data = b"".join(struct.pack(fmt, v) for v in values) + b"\x00" * (kind[2] * 27)
    blob = project(
        [
            dataset(
                dataset_header("Book1_A", DOUBLE, total=30, used=3), _doubles([1.0, 2.0, 3.0], 30)
            ),
            dataset(dataset_header("Book1_B", kind, total=30, used=3, unsigned=unsigned), data),
        ]
    )
    assert _column(_books(tmp_path, blob)["Book1"], "B").tolist() == [float(v) for v in values]


def test_complex_column_real_part_is_the_channel_imaginary_is_metadata(tmp_path: Path) -> None:
    cells = (
        struct.pack("<dd", 1.5, 0.5)
        + MISSING
        + struct.pack("<d", 0.0)
        + struct.pack("<dd", -2.0, 3.5)
    )
    blob = project(
        [
            dataset(
                dataset_header("Book1_A", DOUBLE, total=3, used=3), _doubles([1.0, 2.0, 3.0], 3)
            ),
            dataset(dataset_header("Book1_B", COMPLEX, total=3, used=3), cells),
        ]
    )
    book = _books(tmp_path, blob)["Book1"]
    np.testing.assert_array_equal(_column(book, "B"), [1.5, np.nan, -2.0])
    assert book.metadata["origin_complex_imaginary"] == {"B": [0.5, 0.0, 3.5]}


def test_text_column_cells_are_strings_never_values(tmp_path: Path) -> None:
    cells = text_cell("alpha") + text_cell("12.5") + text_cell("") * 2
    blob = project(
        [
            dataset(dataset_header("Book1_A", DOUBLE, total=4, used=2), _doubles([1.0, 2.0], 4)),
            dataset(dataset_header("Book1_B", TEXT, total=4, used=2), cells),
        ]
    )
    book = _books(tmp_path, blob)["Book1"]
    assert book.metadata["origin_text_columns"] == {"B": ["alpha", "12.5"]}
    assert book.metadata["origin_column_names"] == []  # B is not a channel


# ── gap 2: allocation is not data ────────────────────────────────────────────


def test_unused_allocated_rows_are_not_returned(tmp_path: Path) -> None:
    """32 rows are allocated, 3 are used; the rest are blank cells (tag 1,
    empty string) whose value bytes are zero — the old reader returned all
    32 rows, the blanks as 0.0."""
    cells = b"".join(tn_number(v) for v in (1.0, 2.0, 3.0)) + tn_text("") * 29
    blob = project(
        [
            dataset(dataset_header("Book1_A", TEXT_NUMERIC, total=32, used=3), cells),
            dataset(dataset_header("Book1_B", TEXT_NUMERIC, total=32, used=3), cells),
        ]
    )
    book = _books(tmp_path, blob)["Book1"]
    assert book.time.tolist() == [1.0, 2.0, 3.0]
    assert book.values.shape == (3, 1)


def test_blank_cells_inside_the_used_range_are_nan_in_both_encodings(tmp_path: Path) -> None:
    """A blank Text & Numeric cell is tag 1 + "" or tag 0 + the
    missing-value double (files of every era use both); each is NaN, never
    0.0."""
    new = tn_text("") * 2 + tn_number(7.0) + tn_text("") + tn_number(9.0)
    old = tn_blank_old() * 2 + tn_number(7.0) + tn_blank_old() + tn_number(9.0)
    blob = project(
        [
            dataset(dataset_header("Book1_A", TEXT_NUMERIC, total=5, used=5), new),
            dataset(dataset_header("Book1_B", TEXT_NUMERIC, total=5, used=5, size=140), old),
        ]
    )
    book = _books(tmp_path, blob)["Book1"]
    for short in ("A", "B"):
        np.testing.assert_array_equal(_column(book, short), [np.nan, np.nan, 7.0, np.nan, 9.0])


def test_rows_before_the_first_used_row_are_blank(tmp_path: Path) -> None:
    """An integer cell has no blank value — an unused row reads 0 — so the
    first-used-row field is what tells a leading 0 from a leading blank."""
    data = b"".join(struct.pack("<i", v) for v in (0, 0, 7, 8))
    blob = project(
        [
            dataset(
                dataset_header("Book1_A", DOUBLE, total=4, used=4),
                _doubles([1.0, 2.0, 3.0, 4.0], 4),
            ),
            dataset(dataset_header("Book1_B", INT32, total=4, used=4, first=2), data),
        ]
    )
    np.testing.assert_array_equal(
        _column(_books(tmp_path, blob)["Book1"], "B"), [np.nan, np.nan, 7.0, 8.0]
    )


def test_empty_dataset_slot_is_an_empty_column(tmp_path: Path) -> None:
    """A column with no data block yet (header, NULL, NULL) is still a
    column of its book, and the next dataset is still paired correctly."""
    blob = project(
        [
            dataset(dataset_header("Book1_A", TEXT_NUMERIC, total=30, used=0), None),
            dataset(dataset_header("Book1_B", DOUBLE, total=2, used=2), _doubles([4.0, 5.0], 2)),
        ]
    )
    book = _books(tmp_path, blob)["Book1"]
    assert book.metadata["x_column_name"] == "A"
    assert np.isnan(book.time).all() and book.values[:, 0].tolist() == [4.0, 5.0]


# ── gap 6: the older, shorter dataset headers ────────────────────────────────


@pytest.mark.parametrize("size", [115, 123, 140, 147])
def test_every_header_size_decodes(tmp_path: Path, size: int) -> None:
    """The four header generations (CPYA 4.2656 / 4.2673 / 4.2878-4.2946 /
    4.3116+) differ in length only. 140 is a multiple of 10, which the old
    walker read as a DATA block — nothing in an Origin 8 project decoded."""
    cells = b"".join(tn_number(v) for v in (1.0, 2.0, 3.0, 4.0, 5.0))
    blob = project(
        [
            dataset(dataset_header("Data1_A", TEXT_NUMERIC, total=5, used=5, size=size), cells),
            dataset(
                dataset_header("Data1_B", DOUBLE, total=5, used=4, size=size),
                _doubles([9.0, 8.0, 7.0, 6.0], 5),
            ),
        ]
    )
    book = _books(tmp_path, blob)["Data1"]
    assert book.time.tolist() == [1.0, 2.0, 3.0, 4.0, 5.0]
    np.testing.assert_array_equal(book.values[:, 0], [9.0, 8.0, 7.0, 6.0, np.nan])


# ── gap 9: Text & Numeric columns that hold text ─────────────────────────────


def _two_text_columns() -> bytes:
    a = tn_text("1,1") + tn_text("2,2") + tn_text("3,3") + tn_text("") * 2
    b = tn_text("4,4") + tn_number(5.5) + tn_text("6,6") + tn_text("") * 2
    windows = (
        window_header("Book2")
        + sheet_header("Sheet1", cols=2, rows=5)
        + prop_block("A", 3)
        + label_block("Conductance", "S", "first note")
        + prop_block("B", 0)
        + label_block("Temp", "K", "second note")
    )
    return project(
        [
            dataset(dataset_header("Book2_A", TEXT_NUMERIC, total=5, used=3), a),
            dataset(dataset_header("Book2_B", TEXT_NUMERIC, total=5, used=3), b),
        ],
        windows,
    )


def test_all_text_book_keeps_its_cells_labels_units_and_comments(tmp_path: Path) -> None:
    """A book whose X column is text had NO numeric X; the old reader
    returned it as an empty (0, 0) shell and dropped every cell and label."""
    book = _books(tmp_path, _two_text_columns())["Book2"]
    meta = book.metadata
    assert meta["origin_text_columns"] == {"A": ["1,1", "2,2", "3,3"], "B": ["4,4", "5.5", "6,6"]}
    assert meta["origin_text_column_labels"] == {
        "A": {"long_name": "Conductance", "unit": "S"},
        "B": {"long_name": "Temp", "unit": "K"},
    }
    assert meta["column_comments"] == {"A": "first note", "B": "second note"}
    # B also holds a number: it stays a channel, its text cells NaN.
    assert book.labels == ("Temp",) and book.units == ("K",)
    np.testing.assert_array_equal(book.values[:, 0], [np.nan, 5.5, np.nan])
    # The X column is text, so `.time` is an honest row index, flagged.
    assert book.time.tolist() == [0.0, 1.0, 2.0]
    assert meta["x_column_recovered"] is False and meta["x_column_unrecovered"] == "Conductance"


def test_text_only_project_parses_instead_of_raising(tmp_path: Path) -> None:
    cells = tn_text("low") + tn_text("high") + tn_text("")
    blob = project([dataset(dataset_header("Book1_A", TEXT_NUMERIC, total=3, used=2), cells)])
    path = tmp_path / "t.opj"
    path.write_bytes(blob)
    ds = read_origin_project(path)
    assert ds.metadata["origin_text_columns"] == {"A": ["low", "high"]}
    assert ds.values.shape == (2, 0)


def test_wide_text_and_numeric_cells_mix_long_labels_and_numbers(tmp_path: Path) -> None:
    """A Text & Numeric column widens past 10 bytes for long strings; a
    column mixing long labels with numbers was the reader's one documented
    still-dropped family."""
    cells = tn_text("As deposited", 20) + tn_number(325.0) + b"\x00" * 10 + tn_text("", 20)
    blob = project(
        [
            dataset(
                dataset_header("Book1_A", DOUBLE, total=3, used=3), _doubles([1.0, 2.0, 3.0], 3)
            ),
            dataset(dataset_header("Book1_B", TEXT_NUMERIC, total=3, used=2, elem=20), cells),
        ]
    )
    book = _books(tmp_path, blob)["Book1"]
    assert book.metadata["origin_text_columns"] == {"B": ["As deposited", "325", ""]}
    np.testing.assert_array_equal(_column(book, "B"), [np.nan, 325.0, np.nan])


def test_report_reference_columns_keep_their_bucket(tmp_path: Path) -> None:
    """A wide column whose every allocated row is a string is the
    FitLinear/NLFit report-sheet family; it stays in origin_report_sheets."""
    refs = ["cell://Parameters.Slope.Value", "cell://Parameters.Slope.Error"]
    cells = b"".join(tn_text(s, 40) for s in refs) + tn_text("", 40)
    blob = project(
        [
            dataset(dataset_header("Book1_A", DOUBLE, total=2, used=2), _doubles([1.0, 2.0], 2)),
            dataset(dataset_header("Book1_B", TEXT_NUMERIC, total=3, used=2, elem=40), cells),
        ]
    )
    book = _books(tmp_path, blob)["Book1"]
    assert book.metadata["origin_report_sheets"] == {"B": refs}
    assert book.metadata["origin_text_columns"] == {}


def test_legacy_inline_text_in_a_number_cell_is_still_text(tmp_path: Path) -> None:
    """The literal ``"NaN"`` an Origin fit writes into a tag-0 cell
    (``4e 61 4e 00 01 00 00 00``) reads as a denormal float64. It stays the
    text column the content-sniffing reader made of it."""
    cell = b"\x00\x00NaN\x00\x01\x00\x00\x00"
    blob = project(
        [
            dataset(
                dataset_header("Book1_A", DOUBLE, total=3, used=3), _doubles([1.0, 2.0, 3.0], 3)
            ),
            dataset(dataset_header("Book1_B", TEXT_NUMERIC, total=3, used=3), cell * 3),
        ]
    )
    book = _books(tmp_path, blob)["Book1"]
    assert book.metadata["origin_text_columns"] == {"B": ["NaN", "NaN", "NaN"]}
    assert book.metadata["origin_column_names"] == []


# ── fail closed: what is not positively identified is omitted and named ──────


def _diagnostics(tmp_path: Path, blob: bytes) -> dict[str, object]:
    book = next(iter(_books(tmp_path, blob).values()))
    return dict(book.metadata["origin_data_diagnostics"])


def _good() -> bytes:
    return dataset(dataset_header("Book1_A", DOUBLE, total=2, used=2), _doubles([1.0, 2.0], 2))


def test_dataset_whose_block_is_not_rows_times_width_is_omitted(tmp_path: Path) -> None:
    """Origin's function datasets carry a header that claims N rows over a
    block holding something else entirely. Never decoded, always named."""
    bad = dataset(dataset_header("Book1_B", DOUBLE, total=100, used=100), b"\x00" * 15)
    books = _books(tmp_path, project([_good(), bad]))
    assert books["Book1"].metadata["origin_column_names"] == []
    diag = books["Book1"].metadata["origin_data_diagnostics"]
    assert diag["omissions"] == ["1 worksheet dataset(s) not decoded"]
    assert diag["details"][0]["dataset"] == "Book1_B"
    assert "15 B" in diag["details"][0]["reason"]


@pytest.mark.parametrize(
    "header",
    [
        dataset_header("Book1_B", (0x01, 0x64, 8), total=2, used=2),  # unknown kind nibble
        dataset_header("Book1_B", (0x01, 0x60, 2), total=8, used=8),  # real kind, 2-byte rows
        dataset_header("Book1_B", (0x01, 0x68, 8), total=2, used=2),  # 8-byte integer
    ],
)
def test_unknown_value_types_are_omitted_not_guessed(tmp_path: Path, header: bytes) -> None:
    diag = _diagnostics(tmp_path, project([_good(), dataset(header, b"\x00" * 16)]))
    assert diag["omissions"] == ["1 worksheet dataset(s) not decoded"]


def test_unknown_text_numeric_tag_omits_the_column(tmp_path: Path) -> None:
    cells = tn_number(1.0) + b"\x07\x00" + b"\x00" * 8
    bad = dataset(dataset_header("Book1_B", TEXT_NUMERIC, total=2, used=2), cells)
    diag = _diagnostics(tmp_path, project([_good(), bad]))
    assert "tag" in diag["details"][0]["reason"]  # type: ignore[index]


def test_implausible_doubles_are_blanked_never_the_column_dropped(tmp_path: Path) -> None:
    """The header declares float64 and the block is the declared size: the
    column is a float64 column whatever a cell holds. Implausible cells are
    blanked and counted; the plausibility test is not a type detector."""
    junk = struct.pack("<d", 5e-310)
    few = _doubles([float(k) for k in range(999)], 999) + junk
    many = junk * 50 + _doubles([1.0] * 50, 50)
    blob = project(
        [
            _good(),
            dataset(dataset_header("Book1_B", DOUBLE, total=1000, used=1000), few),
            dataset(dataset_header("Book1_C", DOUBLE, total=100, used=100), many),
        ]
    )
    book = _books(tmp_path, blob)["Book1"]
    assert book.metadata["origin_column_names"] == ["B", "C"]
    assert np.isnan(_column(book, "B")[-1]) and _column(book, "B")[998] == 998.0
    c = _column(book, "C")[:100]
    assert np.isnan(c[:50]).all() and c[50:].tolist() == [1.0] * 50
    assert book.metadata["origin_data_diagnostics"]["omissions"] == [
        "2 column(s) with implausible cells blanked",
    ]


def test_one_tiny_value_does_not_drop_a_declared_float64_column(tmp_path: Path) -> None:
    """Five rows, one of them 1e-300: four values survive, one cell is
    blanked and reported. (The column used to vanish whole.)"""
    cells = _doubles([1.0, 2.0, 3.0, 4.0], 4) + struct.pack("<d", 1e-300)
    blob = project([_good(), dataset(dataset_header("Book1_B", DOUBLE, total=5, used=5), cells)])
    book = _books(tmp_path, blob)["Book1"]
    assert book.metadata["origin_column_names"] == ["B"]
    b = _column(book, "B")
    assert b[:4].tolist() == [1.0, 2.0, 3.0, 4.0] and np.isnan(b[4])
    assert book.metadata["origin_data_diagnostics"]["omissions"] == [
        "1 column(s) with implausible cells blanked"
    ]


def test_loose_dataset_is_reported_not_imported(tmp_path: Path) -> None:
    loose = dataset(dataset_header("F1", DOUBLE, total=2, used=2), _doubles([1.0, 2.0], 2))
    books = _books(tmp_path, project([_good(), loose]))
    assert set(books) == {"Book1"}
    assert books["Book1"].metadata["origin_data_diagnostics"]["omissions"] == [
        "1 non-worksheet dataset(s) not imported"
    ]


def test_clean_project_carries_no_diagnostics(tmp_path: Path) -> None:
    assert "origin_data_diagnostics" not in _books(tmp_path, project([_good()]))["Book1"].metadata


def test_legacy_fixture_headers_still_take_the_content_sniffing_walk(tmp_path: Path) -> None:
    """A header block with no real fields (the fixtures the older tests
    build: a name 40 bytes in) is not a dataset header; the legacy walk and
    its whole-allocation contract are unchanged."""
    header = block(b"\x00" * 40 + b"Book1_A\x00" + b"\x00" * 6)
    data = block(tn_number(1.0) + tn_number(2.0) + tn_text(""))
    path = tmp_path / "legacy.opj"
    path.write_bytes(b"CPYA 4.3380 188 W64 #\n" + block(b"\x00" * 32) + null() + header + data)
    assert read_origin_project(path).time.tolist() == [1.0, 2.0, 0.0]


# ── gap 8 / 12: window labels and column labels ──────────────────────────────


def _one_column(windows: bytes) -> bytes:
    return project([_good()], windows)


def test_book_without_a_label_is_titled_by_its_short_name(tmp_path: Path) -> None:
    """The window header's timestamps end in the printable bytes ``42 41``;
    the old "last printable run" fallback titled every label-less book "BA"."""
    book = _books(tmp_path, _one_column(window_header("Book1")))["Book1"]
    assert book.metadata["origin_book_long"] == "Book1"


@pytest.mark.parametrize("storage", [b"", b"@${[0|4|Script|11|1]}<OriginStorage>"])
def test_book_label_is_read_from_the_end_of_the_fixed_region(
    tmp_path: Path, storage: bytes
) -> None:
    windows = window_header("Book1", "Sample 7 anneal", storage=storage)
    book = _books(tmp_path, _one_column(windows))["Book1"]
    assert book.metadata["origin_book_long"] == "Sample 7 anneal"


def test_numeric_typed_columns_keep_designation_long_name_unit_comment(tmp_path: Path) -> None:
    """A Numeric column's property block has 0x01 (not 0x21) at 0x25; the old
    detector only knew Text & Numeric blocks, so such a column lost its
    designation and all three label rows."""
    datasets = [
        dataset(dataset_header("Book1_A", DOUBLE, total=2, used=2), _doubles([1.0, 2.0], 2)),
        dataset(dataset_header("Book1_B", DOUBLE, total=2, used=2), _doubles([3.0, 4.0], 2)),
    ]
    windows = (
        window_header("Book1")
        + sheet_header("Sheet1", cols=2, rows=2)
        + prop_block("B", 3, (0x01, 0x50, 8))
        + label_block("Field", "Oe", "swept\nup then down")
        + prop_block("A", 0, (0x01, 0x60, 8))
        + label_block("Moment", "emu")
    )
    book = _books(tmp_path, project(datasets, windows))["Book1"]
    assert book.metadata["x_column_name"] == "B"  # the designated X, not the first column
    assert book.metadata["x_column_long"] == "Field" and book.metadata["x_column_unit"] == "Oe"
    assert book.labels == ("Moment",) and book.units == ("emu",)
    assert book.metadata["column_comments"] == {"B": "swept\nup then down"}


def test_older_property_blocks_and_null_label_slots(tmp_path: Path) -> None:
    """CPYA 4.2878 (Origin 8) property blocks are 489 bytes and an unlabeled column's
    label slot is a NULL. The old reader skipped both: the size gate was
    >= 500, and it carried a pending column across NULLs so the NEXT small
    block — here another record's text — became that column's label."""
    datasets = [
        dataset(
            dataset_header("Book1_A", DOUBLE, total=2, used=2, size=140), _doubles([1.0, 2.0], 2)
        ),
        dataset(
            dataset_header("Book1_B", DOUBLE, total=2, used=2, size=140), _doubles([3.0, 4.0], 2)
        ),
    ]
    windows = (
        window_header("Book1")
        + sheet_header("Sheet1", cols=2, rows=2, size=341)
        + prop_block("A", 3, (0x01, 0x50, 8), size=489)
        + label_block("Angle", "deg")
        + prop_block("B", 0, (0x01, 0x60, 8), size=489)
        + null()
        + null()
        + block(b"not a label\x00")
    )
    book = _books(tmp_path, project(datasets, windows))["Book1"]
    assert book.metadata["x_column_long"] == "Angle"
    assert book.labels == ("B",) and book.units == ("",)


@pytest.mark.parametrize("size", [255, 341, 365, 385, 409])
def test_second_sheet_marker_closes_the_primary_sheet_at_any_size(
    tmp_path: Path, size: int
) -> None:
    """The sheet sub-header's size varies by Origin version; only ``Pd`` at
    0xD0 is constant. The old ``== 365`` test saw no boundary elsewhere."""
    windows = (
        window_header("Book1")
        + sheet_header("Sheet1", size=size)
        + prop_block("A", 3)
        + label_block("Real", "V")
        + sheet_header("Report", size=size)
        + prop_block("B", 1)
        + label_block("Leak", "")
    )
    from quantized.io.origin_project.windows import window_metadata

    columns = window_metadata(_one_column(windows))["Book1"].columns
    assert set(columns) == {"A"} and columns["A"].long_name == "Real"


def test_graph_curve_records_are_not_columns() -> None:
    """Same size as a property block, a short "name" at 0x12 — but 0x11 is
    not a designation code (or 0x06 is zero / has a non-flag bit)."""
    from quantized.io.origin_project.windows import _is_column_block

    def record(flags: int, designation: int) -> bytes:
        p = bytearray(519)
        p[0x06], p[0x11], p[0x12], p[0x26] = flags, designation, ord("n"), 0x40
        return bytes(p)

    assert _is_column_block(record(0x0B, 0x00))
    assert not _is_column_block(record(0x0B, 0x69))  # a curve record's 0x11
    assert not _is_column_block(record(0x00, 0x00))  # a 426/427-style record's 0x06
    assert not _is_column_block(record(0x3A, 0x00))  # a non-flag bit in 0x06


# ── gap 7: matrix books ──────────────────────────────────────────────────────


def _matrix_windows(rows: int, cols: int, *, coords: bool = True) -> bytes:
    out = window_header("MBook1") + sheet_header("MSheet1", matrix=True, cols=cols, rows=rows)
    if coords:
        out += (
            coordinate("Y2", "40")
            + coordinate("X2", "30")
            + coordinate("Y1", "20")
            + coordinate("X1", "10")
        )
    return out


def test_matrix_only_project_decodes_to_a_map(tmp_path: Path) -> None:
    """Cells are row-major: cell [r, c] is at index r * cols + c. X runs
    X1..X2 across the columns, Y runs Y1..Y2 down the rows."""
    cells = _doubles([11.0, 12.0, 13.0, 21.0, 22.0, 23.0], 6)
    blob = project(
        [dataset(dataset_header("MBook1", DOUBLE, total=6, used=6), cells)], _matrix_windows(2, 3)
    )
    path = tmp_path / "m.opj"
    path.write_bytes(blob)
    ds = read_origin_project(path)
    assert ds.labels == ("X", "Y", "Z")
    assert ds.metadata["is2D"] is True and ds.metadata["map_shape"] == [2, 3]
    assert ds.values[:, 0].tolist() == [10.0, 20.0, 30.0, 10.0, 20.0, 30.0]
    assert ds.values[:, 1].tolist() == [20.0, 20.0, 20.0, 40.0, 40.0, 40.0]
    assert ds.values[:, 2].tolist() == [11.0, 12.0, 13.0, 21.0, 22.0, 23.0]
    assert ds.metadata["origin_matrix"]["coordinates_recovered"] is True
    assert "origin_data_diagnostics" not in ds.metadata


def test_matrix_beside_a_worksheet_is_its_own_book(tmp_path: Path) -> None:
    cells = b"".join(struct.pack("<h", v) for v in (1, 2, 3, 4))
    windows = window_header("Book1") + null() * 3 + _matrix_windows(2, 2, coords=False)
    blob = project(
        [_good(), dataset(dataset_header("MBook1", INT16, total=4, used=4), cells)], windows
    )
    books = _books(tmp_path, blob)
    assert list(books) == ["Book1", "MBook1"]
    matrix = books["MBook1"]
    assert matrix.values[:, 2].tolist() == [1.0, 2.0, 3.0, 4.0]
    # No X1..Y2 records: the axes are the 1-based cell index, and say so.
    assert matrix.values[:, 0].tolist() == [1.0, 2.0, 1.0, 2.0]
    assert matrix.metadata["origin_matrix"]["coordinates_recovered"] is False
    inventory = {e["name"]: e for e in matrix.metadata["origin_books"]}
    assert inventory["MBook1"]["matrix"] is True and inventory["MBook1"]["nrows"] == 2


def test_matrix_whose_shape_does_not_match_is_reported_never_reshaped(tmp_path: Path) -> None:
    cells = _doubles([1.0, 2.0, 3.0, 4.0, 5.0], 5)
    blob = project(
        [_good(), dataset(dataset_header("MBook1", DOUBLE, total=5, used=5), cells)],
        window_header("Book1") + null() * 3 + _matrix_windows(2, 3),
    )
    books = _books(tmp_path, blob)
    assert set(books) == {"Book1"}
    diag = books["Book1"].metadata["origin_data_diagnostics"]
    assert diag["omissions"] == ["1 matrix book(s) not imported"]
    assert "2 x 3" in diag["details"][0]["reason"]


def test_undecodable_matrix_only_project_names_the_matrix_in_the_error(tmp_path: Path) -> None:
    """Was: "no worksheet columns could be decoded" — true, and no help."""
    cells = _doubles([1.0, 2.0, 3.0], 3)
    blob = project(
        [dataset(dataset_header("MBook1", DOUBLE, total=3, used=3), cells)], _matrix_windows(2, 3)
    )
    path = tmp_path / "bad.opj"
    path.write_bytes(blob)
    with pytest.raises(OriginProjectError, match=r"1 matrix book\(s\) not imported"):
        read_origin_project(path)


def test_data_diagnostics_join_the_fidelity_manifest() -> None:
    _figs, manifest = assess_origin_figures([], container="opj")
    diagnostics = {
        "omissions": ["1 matrix book(s) not imported"],
        "details": [{"category": "matrix", "dataset": "MBook1", "reason": "shape"}],
    }
    merged = with_data_diagnostics(manifest, diagnostics)
    assert "1 matrix book(s) not imported" in merged["omissions"]
    assert "no_graph_records" in merged["omissions"]  # the graph omissions stay
    assert merged["data_diagnostics"] == diagnostics["details"]
    assert with_data_diagnostics(manifest, None) is manifest
    assert "data_diagnostics" not in manifest


def test_import_route_lists_data_omissions_in_origin_fidelity(tmp_path: Path) -> None:
    """End to end through the import route: the matrix the reader could not
    shape is named in ``origin_fidelity``, next to the graph omissions."""
    from quantized.routes.parsers import _import_with_books

    cells = _doubles([1.0, 2.0, 3.0, 4.0, 5.0], 5)
    blob = project(
        [_good(), dataset(dataset_header("MBook1", DOUBLE, total=5, used=5), cells)],
        window_header("Book1") + null() * 3 + _matrix_windows(2, 3),
    )
    path = tmp_path / "route.opj"
    path.write_bytes(blob)
    payload, _handle = _import_with_books(path)
    fidelity = payload["origin_fidelity"]
    assert "1 matrix book(s) not imported" in fidelity["omissions"]
    assert fidelity["data_diagnostics"][0]["dataset"] == "MBook1"


def test_group_and_subject_designations_are_surfaced(tmp_path: Path) -> None:
    """Designation codes 7 (Group) and 8 (Subject) — the factor columns of
    Origin's statistics tools — are reported as such, not as Y."""
    datasets = [
        dataset(dataset_header("Book1_A", DOUBLE, total=2, used=2), _doubles([1.0, 2.0], 2)),
        dataset(dataset_header("Book1_B", DOUBLE, total=2, used=2), _doubles([3.0, 4.0], 2)),
        dataset(dataset_header("Book1_C", DOUBLE, total=2, used=2), _doubles([5.0, 6.0], 2)),
    ]
    windows = (
        window_header("Book1")
        + sheet_header("Sheet1", cols=3, rows=2)
        + prop_block("A", 3, (0x01, 0x50, 8))
        + null()
        + prop_block("B", 7, (0x01, 0x60, 8))
        + label_block("Cohort", "")
        + prop_block("C", 8, (0x01, 0x60, 8))
        + label_block("Subject id", "")
    )
    book = _books(tmp_path, project(datasets, windows))["Book1"]
    assert book.labels == ("Cohort", "Subject id")
    assert book.metadata["column_designations"] == {"A": "X", "B": "group", "C": "subject"}


def test_metadata_naming_no_dataset_does_not_displace_the_real_x(tmp_path: Path) -> None:
    """Origin truncates a property block's short name to 11 characters; the
    datasets keep a numbered suffix. The X-designated metadata entry then
    names no dataset — it must not read as "the X column failed to decode"
    (which swaps the real X for a row index)."""
    datasets = [
        dataset(
            dataset_header("Data1_LongColumnN1", DOUBLE, total=2, used=2), _doubles([1.0, 2.0], 2)
        ),
        dataset(
            dataset_header("Data1_LongColumnN2", DOUBLE, total=2, used=2), _doubles([3.0, 4.0], 2)
        ),
    ]
    windows = (
        window_header("Data1")
        + sheet_header("Sheet1", cols=2, rows=2)
        + prop_block("LongColumnN", 3, (0x01, 0x50, 8))
        + label_block("first", "")
        + prop_block("LongColumnN", 0, (0x01, 0x60, 8))
        + label_block("second", "")
    )
    book = _books(tmp_path, project(datasets, windows))["Data1"]
    assert book.metadata["x_column_recovered"] is True
    assert book.metadata["x_column_name"] == "LongColumnN1"
    assert book.time.tolist() == [1.0, 2.0] and book.values[:, 0].tolist() == [3.0, 4.0]


def test_undecoded_x_column_still_falls_back_to_a_row_index(tmp_path: Path) -> None:
    """The other side of the rule above: the designated X DOES name a
    dataset, and that dataset could not be decoded. The book keeps its
    decoded columns as values over a row index, and says which X was lost."""
    datasets = [
        dataset(dataset_header("Book1_A", (0x01, 0x64, 8), total=2, used=2), b"\x00" * 16),
        dataset(dataset_header("Book1_B", DOUBLE, total=2, used=2), _doubles([3.0, 4.0], 2)),
    ]
    windows = (
        window_header("Book1")
        + sheet_header("Sheet1", cols=2, rows=2)
        + prop_block("A", 3, (0x01, 0x54, 8))
        + label_block("Field", "Oe")
        + prop_block("B", 0, (0x01, 0x60, 8))
        + label_block("Moment", "emu")
    )
    book = _books(tmp_path, project(datasets, windows))["Book1"]
    assert book.metadata["x_column_recovered"] is False
    assert book.metadata["x_column_unrecovered"] == "Field"
    assert book.time.tolist() == [0.0, 1.0] and book.labels == ("Moment",)


# ── the walk keeps its place ─────────────────────────────────────────────────


def test_used_row_end_past_the_allocation_is_clamped(tmp_path: Path) -> None:
    """quantized's own writer leaves the used-row field at a template
    constant (161), so a short column claims more rows than it has. The
    allocation bounds it; the datasets after it are read as usual."""
    odd = dataset(dataset_header("Book1_B", DOUBLE, total=2, used=161), _doubles([9.0, 9.5], 2))
    after = dataset(dataset_header("Book1_C", DOUBLE, total=2, used=2), _doubles([7.0, 8.0], 2))
    book = _books(tmp_path, project([_good(), odd, after]))["Book1"]
    assert _column(book, "B").tolist() == [9.0, 9.5]
    assert _column(book, "C").tolist() == [7.0, 8.0]
    assert "origin_data_diagnostics" not in book.metadata


@pytest.mark.parametrize(
    ("kind", "cells", "expected"),
    [
        (DOUBLE, b"".join(struct.pack("<d", v) for v in (1.0, 2.0, 3.0, 4.0)) + MISSING, 4),
        (TEXT_NUMERIC, b"".join(tn_number(v) for v in (1.0, 2.0, 3.0, 4.0)) + tn_text(""), 4),
        (INT16, b"".join(struct.pack("<h", v) for v in (1, 2, 3, 4, 0)), 4),
    ],
)
def test_a_value_past_the_used_row_end_is_never_dropped(
    tmp_path: Path, kind: tuple[int, int, int], cells: bytes, expected: int
) -> None:
    """The used-row end may only remove blank cells. A header that
    understates it (the same writer, for a column longer than 161 rows)
    must not cost data: rows run to the last non-blank cell — and the
    blank allocation after THAT is still not returned."""
    blob = project([_good(), dataset(dataset_header("Book1_B", kind, total=5, used=2), cells)])
    column = _column(_books(tmp_path, blob)["Book1"], "B")
    assert column.tolist() == [1.0, 2.0, 3.0, 4.0][:expected]


def test_projects_from_the_native_writer_read_back_in_full(tmp_path: Path) -> None:
    """The regression this guards: a 500-row book written by ``opj_bytes``
    came back as 161 rows (or, under 161, not at all) once the reader
    started honouring the used-row field."""
    from quantized.io.origin_project.writer import opj_bytes

    t = np.arange(500, dtype=float)
    long_book = DataStruct(
        time=t,
        values=np.column_stack([np.sin(t), np.cos(t)]),
        labels=("s", "c"),
        units=("", ""),
        metadata={"origin_book": "Long"},
    )
    short_book = DataStruct(
        time=t[:20],
        values=t[:20, None] * 2.0,
        labels=("d",),
        units=("",),
        metadata={"origin_book": "Short"},
    )
    books = _books(tmp_path, opj_bytes([long_book, short_book]))
    np.testing.assert_array_equal(books["Long"].time, t)
    np.testing.assert_array_equal(books["Long"].values, long_book.values)
    np.testing.assert_array_equal(books["Short"].values, short_book.values)


def test_header_directly_followed_by_another_header_does_not_eat_it(tmp_path: Path) -> None:
    """A header with neither a data block nor a NULL in its slot: the next
    block is the next dataset's header and must be read as one."""
    orphan = block(dataset_header("Book1_B", DOUBLE, total=2, used=2))
    after = dataset(dataset_header("Book1_C", DOUBLE, total=2, used=2), _doubles([7.0, 8.0], 2))
    book = _books(tmp_path, project([_good(), orphan, after]))["Book1"]
    assert _column(book, "C").tolist() == [7.0, 8.0]
    assert _column(book, "B").size == 2 and np.isnan(_column(book, "B")).all()  # empty slot


def _bad_header(name: str, offset: int) -> bytes:
    """A dataset header this reader does not recognise: a real one with a
    byte set where every known header has zero."""
    raw = bytearray(dataset_header(name, DOUBLE, total=3, used=3))
    raw[offset] = 1
    return bytes(raw)


def test_unrecognised_header_first_in_the_section_is_reported(tmp_path: Path) -> None:
    """The first dataset has a header the reader cannot parse. It used to
    vanish without a word, and the next column became the X axis."""
    lost = dataset(_bad_header("Book1_A", 0x41), _doubles([1.0, 2.0, 3.0], 3))
    kept = dataset(dataset_header("Book1_B", DOUBLE, total=3, used=3), _doubles([4.0, 5.0, 6.0], 3))
    book = _books(tmp_path, project([lost, kept]))["Book1"]
    # B is NOT promoted to X: its X was the column that could not be read.
    assert book.metadata["x_column_recovered"] is False
    assert book.time.tolist() == [0.0, 1.0, 2.0]
    assert book.metadata["origin_column_names"] == ["B"]
    assert _column(book, "B").tolist() == [4.0, 5.0, 6.0]
    diag = book.metadata["origin_data_diagnostics"]
    assert diag["omissions"] == ["1 worksheet dataset(s) not decoded"]
    assert diag["details"][0]["dataset"] == "Book1_A"
    assert "not recognised" in diag["details"][0]["reason"]


def test_unrecognised_header_mid_section_loses_only_itself(tmp_path: Path) -> None:
    """The walk steps over the dataset it cannot read and carries on: every
    later column and book is still imported, and the loss is named."""

    def col(name: str, base: float) -> bytes:
        return dataset(
            dataset_header(name, DOUBLE, total=3, used=3), _doubles([base, base + 1, base + 2], 3)
        )

    lost = dataset(_bad_header("Book1_B", 0x12), _doubles([4.0, 5.0, 6.0], 3))
    books = _books(
        tmp_path, project([col("Book1_A", 1.0), lost, col("Book1_C", 7.0), col("Book2_A", 7.0)])
    )
    assert set(books) == {"Book1", "Book2"}
    book = books["Book1"]
    # A precedes the lost column, so it is still the first column: the X.
    assert book.metadata["x_column_recovered"] is True
    assert book.time.tolist() == [1.0, 2.0, 3.0]
    assert book.metadata["origin_column_names"] == ["C"]
    assert _column(book, "C").tolist() == [7.0, 8.0, 9.0]
    diag = book.metadata["origin_data_diagnostics"]
    assert diag["omissions"] == ["1 worksheet dataset(s) not decoded"]
    assert [d["dataset"] for d in diag["details"]] == ["Book1_B"]


def test_undecodable_first_column_does_not_promote_the_next_to_x(tmp_path: Path) -> None:
    """Same rule for a header that parses but a block that does not decode."""
    bad = dataset(dataset_header("Book1_A", DOUBLE, total=100, used=100), b"\x00" * 15)
    kept = dataset(dataset_header("Book1_B", DOUBLE, total=2, used=2), _doubles([4.0, 5.0], 2))
    book = _books(tmp_path, project([bad, kept]))["Book1"]
    assert book.metadata["x_column_recovered"] is False
    assert book.metadata["origin_column_names"] == ["B"]


def test_unplaceable_block_is_reported_and_the_walk_resynchronises(tmp_path: Path) -> None:
    """A block in a header slot that is nothing like a header, with no data
    block or terminator of its own: it is reported as a dataset the reader
    could not identify, the walk resumes at the next real header, and —
    since nobody knows whose column was lost — no book keeps a guessed X."""
    stray = block(b"\x07" * 64)
    after = dataset(dataset_header("Book1_C", DOUBLE, total=2, used=2), _doubles([7.0, 8.0], 2))
    book = _books(tmp_path, project([_good(), stray, after]))["Book1"]
    assert book.metadata["origin_column_names"] == ["A", "C"]
    assert _column(book, "C").tolist() == [7.0, 8.0]
    assert book.metadata["x_column_recovered"] is False
    diag = book.metadata["origin_data_diagnostics"]
    assert diag["omissions"] == ["1 unrecognised dataset(s) not imported"]
    assert "not recognised" in diag["details"][0]["reason"]


def test_run_of_unplaceable_blocks_is_counted(tmp_path: Path) -> None:
    stray = block(b"\x07" * 64) + block(b"\x08" * 30) + block(b"\x09" * 30)
    after = dataset(dataset_header("Book1_C", DOUBLE, total=2, used=2), _doubles([7.0, 8.0], 2))
    diag = _diagnostics(tmp_path, project([_good(), stray, after]))
    reasons = [d["reason"] for d in diag["details"]]  # type: ignore[index, union-attr]
    assert any("2 block(s) before the next readable dataset" in r for r in reasons)


def test_matrix_is_primary_when_the_worksheets_hold_no_numbers(tmp_path: Path) -> None:
    """Origin's untouched default Book1 (allocated, nothing typed) beside a
    matrix book: the dataset a single-dataset import returns is the matrix."""
    empty = dataset(dataset_header("Book1_A", TEXT_NUMERIC, total=32, used=0), tn_text("") * 32)
    cells = _doubles([1.0, 2.0, 3.0, 4.0], 4)
    blob = project(
        [empty, dataset(dataset_header("MBook1", DOUBLE, total=4, used=4), cells)],
        window_header("Book1") + null() * 3 + _matrix_windows(2, 2),
    )
    path = tmp_path / "default_book.opj"
    path.write_bytes(blob)
    assert read_origin_project(path).metadata["origin_book"] == "MBook1"
    assert [b.metadata["origin_book"] for b in read_origin_books(path)] == ["Book1", "MBook1"]


def test_blank_imaginary_part_is_json_null_not_nan(tmp_path: Path) -> None:
    """Metadata is serialized as strict JSON, which has no NaN."""
    from quantized.routes._payload import DataStructResponse
    from quantized.routes.parsers import _import_with_books

    cells = struct.pack("<dd", 1.0, 2.0) + struct.pack("<d", 3.0) + MISSING
    blob = project([_good(), dataset(dataset_header("Book1_B", COMPLEX, total=2, used=2), cells)])
    book = _books(tmp_path, blob)["Book1"]
    assert book.metadata["origin_complex_imaginary"] == {"B": [2.0, None]}
    payload, _handle = _import_with_books(tmp_path / "p.opj")
    assert b'"origin_complex_imaginary":{"B":[2.0,null]}' in DataStructResponse(payload).body


def test_primary_book_is_one_that_holds_numbers(tmp_path: Path) -> None:
    """An allocated-but-untouched sheet-1 book is zero USED rows long. It
    must not be the project's primary dataset while another book has data."""
    empty = dataset(dataset_header("Book1_A", TEXT_NUMERIC, total=30, used=0), tn_text("") * 30)
    real = dataset(
        dataset_header("Book1_A@2", DOUBLE, total=3, used=3), _doubles([4.0, 5.0, 6.0], 3)
    )
    path = tmp_path / "primary.opj"
    path.write_bytes(project([empty, real]))
    ds = read_origin_project(path)
    assert ds.metadata["origin_book"] == "Book1@2" and ds.time.tolist() == [4.0, 5.0, 6.0]


def test_calendar_columns_carry_a_format_hint_and_keep_their_numbers(tmp_path: Path) -> None:
    """A Date / Time / Month / Day-of-week column is float64 like any
    Numeric column; only its property block says the numbers are a
    calendar quantity. The hint says how to read them — the values are
    not converted."""
    from quantized.io.origin_project.opj_books import ORIGIN_DAY_NUMBER_OF_UNIX_EPOCH

    # 2000-01-01 12:00 UTC is 10957.5 days after the Unix epoch.
    stamp = ORIGIN_DAY_NUMBER_OF_UNIX_EPOCH + 10957.5
    names = "ABCDE"
    cells = ([1.0], [stamp], [0.25], [7.0], [3.0])
    datasets = [
        dataset(dataset_header(f"Book1_{n}", DOUBLE, total=1, used=1), _doubles(v, 1))
        for n, v in zip(names, cells, strict=True)
    ]
    windows = window_header("Book1") + sheet_header("Sheet1", cols=5, rows=1)
    for n, fmt in zip(names, (0, 3, 2, 4, 5), strict=True):
        windows += prop_block(n, 3 if n == "A" else 0, (0x01, 0x60, 8), value_format=fmt) + null()
    book = _books(tmp_path, project(datasets, windows))["Book1"]
    assert book.values[0].tolist() == [stamp, 0.25, 7.0, 3.0]  # untouched
    assert book.metadata["origin_column_formats"] == {
        "B": {"kind": "datetime", "unit": "origin_day_number", "unix_epoch_day": 2440587.0},
        "C": {"kind": "time", "unit": "days"},
        "D": {"kind": "month"},
        "E": {"kind": "day_of_week"},
    }
    seconds = (book.values[0, 0] - 2440587.0) * 86400.0
    assert seconds == 946728000.0  # 2000-01-01T12:00:00Z


def test_plain_numeric_book_has_no_format_hints(tmp_path: Path) -> None:
    windows = (
        window_header("Book1")
        + sheet_header("Sheet1", cols=1, rows=2)
        + prop_block("A", 3, (0x01, 0x50, 8), value_format=0)
        + null()
    )
    assert "origin_column_formats" not in _books(tmp_path, _one_column(windows))["Book1"].metadata


# ── review round: sheet ids, report marker, sidecars, notices ────────────────


def _xy(book: str, sheet: str, x: list[float], y: list[float], *, x_id: int = 0) -> list[bytes]:
    """Datasets ``<book>_A<sheet>`` and ``<book>_B<sheet>``; B names its X
    by object id when ``x_id`` is given."""
    n = len(x)
    return [
        dataset(dataset_header(f"{book}_A{sheet}", DOUBLE, total=n, used=n), _doubles(x, n)),
        dataset(
            dataset_header(f"{book}_B{sheet}", DOUBLE, total=n, used=n, x_ref=x_id),
            _doubles(y, n),
        ),
    ]


def _sheet(name: str, x_long: str, y_long: str, first_id: int, *, x_first: bool = True) -> bytes:
    """A worksheet sheet with columns A and B (object ids ``first_id``,
    ``first_id + 1``). ``x_first=False`` makes B the X column."""
    a, b = (3, 0) if x_first else (0, 3)
    return (
        sheet_header(name, cols=2, rows=2)
        + prop_block("A", a, (0x01, 0x50, 8), value_format=0, object_id=first_id)
        + label_block(x_long, "s")
        + prop_block("B", b, (0x01, 0x60, 8), value_format=0, object_id=first_id + 1)
        + label_block(y_long, "V")
    )


def test_single_sheet_whose_id_is_not_1_keeps_its_column_metadata(tmp_path: Path) -> None:
    """A book whose only sheet has id 3 (sheets 1 and 2 were deleted): its
    datasets are ``Book1_A@3``. One id, one sheet — it can be no other, and
    its long names, units and X designation must arrive."""
    windows = window_header("Book1") + _sheet("Data", "Time", "Signal", 2, x_first=False)
    blob = project(_xy("Book1", "@3", [1.0, 2.0], [5.0, 6.0]), windows)
    books = _books(tmp_path, blob)
    # One sheet in the window, one id in the datasets: that sheet IS the
    # book, and takes the book's name (the name a graph curve refers to).
    assert set(books) == {"Book1"}
    book = books["Book1"]
    assert book.metadata["origin_book_long"] == "Book1"
    assert book.metadata["origin_sheet_id"] == "3"  # the datasets are still `@3`
    assert book.metadata["column_designations"] == {"A": "Y", "B": "X"}
    assert book.time.tolist() == [5.0, 6.0]  # B is the designated X, not column 1
    assert book.metadata["x_column_long"] == "Signal"
    assert book.labels == ("Time",) and book.units == ("s",)
    assert "origin_data_diagnostics" not in book.metadata


def test_sheet_ids_bind_by_column_reference_not_by_position(tmp_path: Path) -> None:
    """Two sheets with ids 6 and 7, stored in the window in the OTHER order
    (the user dragged a tab). Each id's Y column names its X by object id;
    that reference, not the position, says which sheet is which."""
    windows = (
        window_header("Book1")
        + _sheet("Second", "Depth", "Count", 10)  # holds id 7's columns
        + _sheet("First", "Time", "Signal", 2)  # holds id 6's columns
    )
    datasets = _xy("Book1", "@6", [1.0, 2.0], [5.0, 6.0], x_id=2) + _xy(
        "Book1", "@7", [3.0, 4.0], [7.0, 8.0], x_id=10
    )
    books = _books(tmp_path, project(datasets, windows))
    assert books["Book1@6"].metadata["x_column_long"] == "Time"
    assert books["Book1@6"].labels == ("Signal",)
    assert books["Book1@7"].metadata["x_column_long"] == "Depth"
    assert books["Book1@7"].labels == ("Count",)
    assert "origin_data_diagnostics" not in books["Book1@6"].metadata


def test_one_reference_and_elimination_bind_the_other_sheet(tmp_path: Path) -> None:
    windows = (
        window_header("Book1")
        + _sheet("Second", "Depth", "Count", 10)
        + _sheet("First", "Time", "Signal", 2)
    )
    datasets = _xy("Book1", "@6", [1.0, 2.0], [5.0, 6.0], x_id=2) + _xy(
        "Book1", "@7", [3.0, 4.0], [7.0, 8.0]
    )
    books = _books(tmp_path, project(datasets, windows))
    assert books["Book1@6"].labels == ("Signal",)
    assert books["Book1@7"].labels == ("Count",)


def test_sheet_ids_that_cannot_be_resolved_get_no_metadata_and_say_so(tmp_path: Path) -> None:
    """Ids 6 and 7, two sheets, no reference: nothing says which is which.
    The numbers are imported; the column names, units and designations of
    EITHER sheet are not applied to them (a positional guess would give
    half of all such books another sheet's names), and the loss is listed."""
    windows = (
        window_header("Book1")
        + _sheet("Second", "Depth", "Count", 10)
        + _sheet("First", "Time", "Signal", 2)
    )
    datasets = _xy("Book1", "@6", [1.0, 2.0], [5.0, 6.0]) + _xy(
        "Book1", "@7", [3.0, 4.0], [7.0, 8.0]
    )
    books = _books(tmp_path, project(datasets, windows))
    for key in ("Book1@6", "Book1@7"):
        assert books[key].labels == ("B",)
        assert books[key].metadata["column_designations"] == {}
    assert books["Book1@6"].values[:, 0].tolist() == [5.0, 6.0]
    diag = books["Book1@6"].metadata["origin_data_diagnostics"]
    assert diag["omissions"] == ["2 sheet(s) imported without column names, units or designations"]
    assert {d["dataset"] for d in diag["details"]} == {"Book1@6", "Book1@7"}


def test_dense_sheet_ids_keep_their_position(tmp_path: Path) -> None:
    """Ids 1..n on an n-sheet book: id k is sheet k — the case Altaxo's and
    LabPlot's multi-sheet oracles cover. Sheet 2 now gets its metadata too."""
    windows = (
        window_header("Book1")
        + _sheet("One", "Time", "Signal", 2)
        + _sheet("Two", "Depth", "Count", 10)
    )
    datasets = _xy("Book1", "", [1.0, 2.0], [5.0, 6.0]) + _xy("Book1", "@2", [3.0, 4.0], [7.0, 8.0])
    books = _books(tmp_path, project(datasets, windows))
    assert books["Book1"].labels == ("Signal",)
    assert books["Book1@2"].labels == ("Count",)
    assert books["Book1@2"].metadata["x_column_long"] == "Depth"
    # Two sheets: neither is renamed, so neither carries a sole-sheet id.
    assert not any("origin_sheet_id" in b.metadata for b in books.values())


def _two_matrix_sheets() -> bytes:
    return (
        window_header("MBook1")
        + sheet_header("MSheet1", matrix=True, cols=2, rows=1)
        + sheet_header("MSheet2", matrix=True, cols=1, rows=2)
    )


def test_matrix_sheet_id_is_not_an_ordinal(tmp_path: Path) -> None:
    """A two-sheet matrix window whose datasets are ids 6 and 7. Read as
    positions they are "sheets 6 and 7 of 2"; read as the 1st and 2nd they
    are a guess. Neither: both are omitted and named."""
    cells = _doubles([1.0, 2.0], 2)
    datasets = [
        dataset(dataset_header("MBook1@6", DOUBLE, total=2, used=2), cells),
        dataset(dataset_header("MBook1@7", DOUBLE, total=2, used=2), cells),
        _good(),
    ]
    books = _books(tmp_path, project(datasets, _two_matrix_sheets()))
    assert set(books) == {"Book1"}
    diag = books["Book1"].metadata["origin_data_diagnostics"]
    assert diag["omissions"] == ["2 matrix book(s) not imported"]
    assert all("sheet id" in d["reason"] for d in diag["details"])


def test_single_matrix_sheet_with_a_high_id_is_bound(tmp_path: Path) -> None:
    """One matrix sheet, one dataset, id 3: it can be no other sheet."""
    cells = _doubles([1.0, 2.0, 3.0, 4.0], 4)
    blob = project(
        [dataset(dataset_header("MBook1@3", DOUBLE, total=4, used=4), cells)],
        _matrix_windows(2, 2),
    )
    book = _books(tmp_path, blob)["MBook1"]
    assert book.metadata["map_shape"] == [2, 2]
    assert book.values[:, 2].tolist() == [1.0, 2.0, 3.0, 4.0]


def test_dense_matrix_sheet_ids_bind_in_order(tmp_path: Path) -> None:
    datasets = [
        dataset(dataset_header("MBook1", DOUBLE, total=2, used=2), _doubles([1.0, 2.0], 2)),
        dataset(dataset_header("MBook1@2", DOUBLE, total=2, used=2), _doubles([3.0, 4.0], 2)),
    ]
    books = _books(tmp_path, project(datasets, _two_matrix_sheets()))
    assert books["MBook1"].metadata["map_shape"] == [1, 2]
    assert books["MBook1@2"].metadata["map_shape"] == [2, 1]


def test_matrix_without_coordinates_says_its_axes_are_cell_indices(tmp_path: Path) -> None:
    cells = _doubles([1.0, 2.0, 3.0, 4.0], 4)
    blob = project(
        [dataset(dataset_header("MBook1", DOUBLE, total=4, used=4), cells)],
        _matrix_windows(2, 2, coords=False),
    )
    book = _books(tmp_path, blob)["MBook1"]
    assert book.metadata["origin_matrix"]["coordinates_recovered"] is False
    (line,) = book.metadata["origin_data_diagnostics"]["omissions"]
    assert "MBook1" in line and "coordinates not recovered" in line
    manifest = with_data_diagnostics(
        assess_origin_figures([], container="opj")[1], book.metadata["origin_data_diagnostics"]
    )
    assert line in manifest["omissions"]


def test_empty_matrix_is_not_a_library_book(tmp_path: Path) -> None:
    """Origin's untouched default matrix: every cell blank. Its generated
    X/Y coordinates are finite, and counting them as data listed it as a
    populated book."""
    from quantized.io.origin_project import drop_empty_library_books

    blank = dataset(dataset_header("MBook1", DOUBLE, total=4, used=4), MISSING * 4)
    blob = project([blank, *_xy("Book1", "", [1.0, 2.0], [5.0, 6.0])], _matrix_windows(2, 2))
    books = _books(tmp_path, blob)
    assert set(books) == {"Book1", "MBook1"}  # the reader still returns it
    kept = drop_empty_library_books(list(books.values()))
    assert [b.metadata["origin_book"] for b in kept] == ["Book1"]
    full = dataset(dataset_header("MBook1", DOUBLE, total=4, used=4), _doubles([1.0] * 4, 4))
    blob = project([full, *_xy("Book1", "", [1.0, 2.0], [5.0, 6.0])], _matrix_windows(2, 2))
    books = _books(tmp_path, blob)
    assert len(drop_empty_library_books(list(books.values()))) == 2


def test_wide_all_text_column_of_user_labels_is_a_text_column(tmp_path: Path) -> None:
    """A Text & Numeric column wider than 10 bytes whose every row is text
    is the user's labels unless it holds a ``cell://`` report reference."""
    wide = (0x21, 0x61, 20)
    labels = b"".join(tn_text(t, 20) for t in ("sample one", "sample two", "sample three"))
    refs = b"".join(tn_text(t, 20) for t in ("cell://P.S.V", "Plot", ""))
    blob = project(
        [
            dataset(dataset_header("Book1_A", wide, total=3, used=3), labels),
            dataset(
                dataset_header("Book1_B", DOUBLE, total=3, used=3), _doubles([1.0, 2.0, 3.0], 3)
            ),
            dataset(dataset_header("Book1_C", wide, total=3, used=3), refs),
        ]
    )
    meta = _books(tmp_path, blob)["Book1"].metadata
    assert meta["origin_text_columns"] == {"A": ["sample one", "sample two", "sample three"]}
    assert meta["origin_report_sheets"] == {"C": ["cell://P.S.V", "Plot", ""]}


def test_window_label_typed_on_two_lines_is_one_title(tmp_path: Path) -> None:
    windows = window_header("Book1", "Run 7\r\nafter anneal") + sheet_header("Sheet1")
    book = _books(tmp_path, _one_column(windows))["Book1"]
    assert book.metadata["origin_book_long"] == "Run 7 after anneal"


def test_legacy_content_sniffing_walk_says_values_may_be_unreliable(tmp_path: Path) -> None:
    """A file with no parseable dataset header is read by guessing each
    column's type from its bytes. Every book says so, and the project's
    fidelity manifest carries a plain-language line."""
    header = block(b"\x00" * 40 + b"Book1_A\x00" + b"\x00" * 6)
    data = block(tn_number(1.0) + tn_number(2.0) + tn_text(""))
    path = tmp_path / "legacy.opj"
    path.write_bytes(b"CPYA 4.3380 188 W64 #\n" + block(b"\x00" * 32) + null() + header + data)
    books = read_origin_books(path)
    assert all(b.metadata["origin_decode"] == "content_sniffing" for b in books)
    (line,) = books[0].metadata["origin_data_diagnostics"]["omissions"]
    assert "may be unreliable" in line
    manifest = with_data_diagnostics(
        assess_origin_figures([], container="opj")[1], books[0].metadata["origin_data_diagnostics"]
    )
    assert line in manifest["omissions"]


def test_header_driven_books_are_not_marked_as_sniffed(tmp_path: Path) -> None:
    book = _books(tmp_path, project([_good()]))["Book1"]
    assert "origin_decode" not in book.metadata
    assert "origin_data_diagnostics" not in book.metadata


def test_stray_block_does_not_swallow_the_empty_dataset_after_it(tmp_path: Path) -> None:
    """Stepping over an unrecognised dataset means its data block and its
    terminator — never a real header that happens to sit where the data
    block would be (here an empty column: header, NULL, NULL)."""
    stray = block(b"\x07" * 64)
    empty = dataset(dataset_header("Book1_C", DOUBLE, total=4, used=0), None)
    after = dataset(dataset_header("Book1_D", DOUBLE, total=2, used=2), _doubles([7.0, 8.0], 2))
    book = _books(tmp_path, project([_good(), stray, empty, after]))["Book1"]
    assert book.metadata["origin_column_names"] == ["A", "C", "D"]

