"""Quoted numbers in a comma-delimited file (RFC 4180), and skipped rows.

A quoted ``"1,234.5"`` in a CSV is a thousands-grouped number (Excel's US
export). It used to read as text: NaN without a note and, in the first data
row, the whole row and the header above it were dropped. The fix decides per
column (``io/_quoted_numbers.py``): no row may disappear silently, no cell may
become NaN silently, and a text column must stay text.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io._quoted_numbers import grouped_value
from quantized.io.delimited import import_csv
from quantized.io.import_preview import guess_settings, parse_import


def _csv(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "quoted.csv"
    path.write_text(text, encoding="utf-8")
    return path


def _notes(ds: object) -> str:
    return " ".join(getattr(ds, "metadata", {}).get("notes", []))


@pytest.mark.parametrize("first", [True, False])
def test_quoted_grouped_number_is_read_and_reported(tmp_path: Path, first: bool) -> None:
    rows = ['1,"1,234.5"', "2,3.5", "3,4.5"] if first else ["2,3.5", '1,"1,234.5"', "3,4.5"]
    ds = import_csv(_csv(tmp_path, "x,y\n" + "\n".join(rows) + "\n"))
    assert ds.labels == ("y",)
    assert len(ds.time) == 3  # no row dropped
    assert 1234.5 in ds.values[:, 0]
    assert "thousands separators" in _notes(ds) and "1,234.5" in _notes(ds)


@pytest.mark.parametrize(
    ("cell", "value"),
    [
        ("1,234,567.891", 1234567.891),  # review #2 item 2: groups AND a fraction
        ("12,345,678,901", 12345678901),
        ("2,000", 2000),  # in a CSV the quoted comma can only be a separator
        ("-1,234.5", -1234.5),
        ("(1,234.5)", -1234.5),  # accounting negative (item 4)
        ("$1,234.50", 1234.5),  # currency (item 4)
    ],
)
def test_grouped_shapes_are_read_with_a_note(tmp_path: Path, cell: str, value: float) -> None:
    ds = import_csv(_csv(tmp_path, f'x,y\n1,"{cell}"\n2,5.5\n3,6.5\n'))
    assert ds.labels == ("y",)
    np.testing.assert_array_equal(ds.time, [1, 2, 3])
    assert ds.values[0, 0] == pytest.approx(value)
    assert cell in _notes(ds)
    if cell[0] in "($":
        assert "accounting form" in _notes(ds)


def test_a_text_column_stays_text(tmp_path: Path) -> None:
    """Review #2 item 1: a grouped cell in a TEXT column is not converted, and
    the comma-aware layout does not take the header for data."""
    ds = import_csv(_csv(tmp_path, 'x,lbl\n1,abc\n2,"1,234.5"\n3,def\n'))
    np.testing.assert_array_equal(ds.time, [1, 2, 3])
    assert ds.labels == ("lbl",)
    levels = ds.cat_levels[0]
    assert {"abc", "1,234.5", "def"} <= set(levels)


@pytest.mark.parametrize(
    "cells",
    [
        ("001,002,003", "004,005,006", "007,008,009"),  # IDs with leading zeros (item 3)
        ("555,123,4567", "555,123,4568", "555,123,4569"),  # phone-like
        ("Jan 5, 2024", "Feb 6, 2024", "Mar 7, 2024"),  # dates
    ],
)
def test_identifiers_phones_and_dates_are_never_numbers(
    tmp_path: Path, cells: tuple[str, ...]
) -> None:
    body = "\n".join(f'{i},"{c}"' for i, c in enumerate(cells, 1))
    ds = import_csv(_csv(tmp_path, f"x,id\n{body}\n"))
    np.testing.assert_array_equal(ds.time, [1, 2, 3])
    assert list(ds.cat_levels[0]) == list(cells)
    assert "thousands separators" not in _notes(ds)


@pytest.mark.parametrize(
    ("cell", "kind"), [("01,234.5", "no number it reads as"), ("1,5", "decimal comma")]
)
def test_other_comma_cells_keep_their_row_and_are_reported(
    tmp_path: Path, cell: str, kind: str
) -> None:
    ds = import_csv(_csv(tmp_path, f'x,y\n1,"{cell}"\n2,3.5\n3,4.5\n'))
    assert ds.labels == ("y",)
    np.testing.assert_array_equal(ds.time, [1, 2, 3])
    assert np.isnan(ds.values[0, 0])
    assert kind in _notes(ds) and "left blank" in _notes(ds)
    assert "Import Wizard" not in _notes(ds)  # a CSV cannot choose a decimal comma


def test_rows_the_layout_skips_are_named(tmp_path: Path) -> None:
    """Item 4: whatever the scorer discards above the data (here the header
    and two text rows) is reported, never dropped silently."""
    ds = import_csv(_csv(tmp_path, "x,y\n1,abc\n2,def\n3,5\n4,6\n5,7\n"))
    np.testing.assert_array_equal(ds.time, [3, 4, 5])
    assert "3 rows above the data were not read as data or as the header" in _notes(ds)
    assert "'1,abc'" in _notes(ds)


def test_import_wizard_parse_reports_the_same() -> None:
    text = 'x,y\n1,"12,345,678"\n2,"01,234"\n3,4.5\n'
    ds = parse_import(text, guess_settings(text))
    assert ds.values[0, 0] == 12345678
    assert np.isnan(ds.values[1, 0])
    notes = _notes(ds)
    assert "12,345,678" in notes and "01,234" in notes


def test_grouped_value_shapes() -> None:
    assert grouped_value("1,234.5") == 1234.5
    assert grouped_value("1,234,567.891") == 1234567.891
    assert grouped_value("(1,234)") == -1234
    for no in ("1,5", "01,234.5", "001,002,003", "555,123,4567", "1,2345.0", "abc, def", "($1,234"):
        assert grouped_value(no) is None, no


_COMBINED = 'T, Amount, Sample\n1, "1,234.5", a\n2, "2,000", b\n3,7,c\n'


def test_quoted_numbers_compose_with_text_columns_and_quote_after_space(tmp_path: Path) -> None:
    """The per-column quoted-number rule composes with #641's tokenizing of a
    quote after a space and its kept text columns, in both import paths."""
    direct = import_csv(_csv(tmp_path, _COMBINED))
    wizard = parse_import(_COMBINED, guess_settings(_COMBINED))
    for ds in (direct, wizard):
        np.testing.assert_array_equal(ds.time, [1, 2, 3])
        assert ds.labels == ("Amount",)
        np.testing.assert_array_equal(ds.values[:, 0], [1234.5, 2000, 7])
        assert ds.metadata["text_columns"] == {"Sample": ["a", "b", "c"]}
        assert "Column 'Amount' has 2 quoted cells written with thousands separators" in _notes(ds)
