"""Quoted numbers in a comma-delimited file (RFC 4180).

A quoted ``"1,234.5"`` in a CSV is a thousands-grouped number (Excel's US
export). It used to read as text: NaN without a note and, in the first data
row, the whole row and the header above it were taken for preamble and
dropped. No row may disappear silently, and no cell may become NaN silently.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io._delimited_split import split_row, ungroup
from quantized.io.delimited import import_csv
from quantized.io.import_preview import guess_settings, parse_import


def _csv(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "quoted.csv"
    path.write_text(text, encoding="utf-8")
    return path


@pytest.mark.parametrize("first", [True, False])
def test_quoted_grouped_number_is_read_and_reported(tmp_path: Path, first: bool) -> None:
    rows = ['1,"1,234.5"', "2,3.5", "3,4.5"] if first else ["2,3.5", '1,"1,234.5"', "3,4.5"]
    ds = import_csv(_csv(tmp_path, "x,y\n" + "\n".join(rows) + "\n"))
    assert ds.labels == ("y",)
    assert len(ds.time) == 3  # no row dropped
    assert 1234.5 in ds.values[:, 0]
    assert any("thousands separators" in n and "1,234.5" in n for n in ds.metadata["notes"])


@pytest.mark.parametrize(
    ("cell", "kind"), [("1,234", "could be a thousands"), ("1,5", "decimal comma")]
)
def test_ambiguous_or_decimal_comma_quoted_cell_keeps_its_row_and_is_reported(
    tmp_path: Path, cell: str, kind: str
) -> None:
    ds = import_csv(_csv(tmp_path, f'x,y\n1,"{cell}"\n2,3.5\n3,4.5\n'))
    assert ds.labels == ("y",)
    np.testing.assert_array_equal(ds.time, [1, 2, 3])
    assert np.isnan(ds.values[0, 0])
    (note,) = ds.metadata["notes"]
    assert kind in note and "left blank" in note
    assert "Import Wizard" not in note  # a CSV cannot choose a decimal comma


def test_import_wizard_parse_reports_the_same(tmp_path: Path) -> None:
    text = 'x,y\n1,"12,345,678"\n2,"1,234"\n3,4.5\n'
    ds = parse_import(text, guess_settings(text))
    assert ds.values[0, 0] == 12345678
    assert np.isnan(ds.values[1, 0])
    notes = " ".join(ds.metadata["notes"])
    assert "12,345,678" in notes and "1,234" in notes


def test_ungroup_only_takes_unambiguous_shapes() -> None:
    assert ungroup("1,234.5") == "1234.5"
    assert ungroup("12,345,678") == "12345678"
    assert ungroup("-1,234e3") == "-1234e3"
    for keep in ("1,234", "1,5", "12,34.5", "abc, def", "1,2345.0"):
        assert ungroup(keep) == keep
    # Only a comma-delimited QUOTED cell is ungrouped; a semicolon file's
    # commas are decimal commas, handled by `_decimal_comma`.
    assert split_row('1,"1,234.5"', ",") == ["1", "1234.5"]
    assert split_row('1;"1,234.5"', ";") == ["1", "1,234.5"]
