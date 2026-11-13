"""Text columns in a CSV are kept, wherever they sit (integration live check).

A text column that was not the first lost its data: with "number-looking"
cells (a run id "7") it became a mostly-NaN numeric channel, and rows whose
text cells outnumbered their numbers were taken for preamble -- dropping the
header and the first data rows. Every text column is now a ``text_columns``
sidecar, named in the import notes, and the header/data split judges each
column by its type over the data rows.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io.delimited import import_csv
from quantized.io.import_preview import guess_settings, parse_import

# Text in column 1 (the would-be X), column 3 and the last column; the last
# one carries a number-looking cell.
TEXT_1_3_LAST = "Sample,T,Op,M,Run\nA,1,x,10,r1\nB,2,y,20,r2\nA,3,x,30,7\nC,4,y,40,r4\n"


def _write(tmp_path: Path, text: str) -> Path:
    p = tmp_path / "t.csv"
    p.write_text(text)
    return p


def test_text_in_columns_1_3_and_last_is_kept_with_every_row(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, TEXT_1_3_LAST))
    assert len(ds.time) == 4  # no data row taken for a header
    assert ds.labels == ("T", "M", "Sample")  # Sample: the categorical X fallback
    np.testing.assert_array_equal(ds.values[:, 1], [10, 20, 30, 40])
    assert ds.metadata["text_columns"] == {
        "Op": ["x", "y", "x", "y"],
        "Run": ["r1", "r2", "7", "r4"],
    }
    notes = ds.metadata["notes"]
    assert any("'Op', 'Run' kept as text" in n for n in notes)


def test_text_column_with_number_looking_cells_is_text_not_a_nan_channel(tmp_path: Path) -> None:
    text = "T,Sample,M,Batch\n1,s1,10,b1\n2,s2,20,12\n3,s3,30,b3\n4,4,40,b4\n"
    ds = import_csv(_write(tmp_path, text))
    assert ds.metadata.get("x_column_name") == "T"
    assert ds.labels == ("M",)
    np.testing.assert_array_equal(ds.time, [1, 2, 3, 4])
    assert ds.metadata["text_columns"] == {
        "Sample": ["s1", "s2", "s3", "4"],
        "Batch": ["b1", "12", "b3", "b4"],
    }


@pytest.mark.parametrize("text", [TEXT_1_3_LAST, "T,Sample,M,Op\n1,a,10,x\n2,b,20,y\n3,a,30,x\n"])
def test_wizard_finds_the_same_header_and_rows(text: str) -> None:
    settings = guess_settings(text)
    assert settings.header_line == 0 and settings.data_start_line == 1
    assert len(parse_import(text, settings).time) == text.count("\n") - 1


def test_a_numeric_column_with_a_few_text_cells_stays_numeric(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "T,M\n1,10\n2,n/a\n3,30\n4,40\n"))
    assert ds.labels == ("M",)
    assert "text_columns" not in ds.metadata
