"""The Import Wizard and direct import read a file the same way.

Delimiter detection samples the same lines on both paths (stripped, blank and
comment lines skipped -- ``delimited._split_lines``), and the decimal-comma
columns are named the way the resulting dataset names them.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io.delimited import import_csv
from quantized.io.import_preview import (
    ImportSettings,
    guess_settings,
    parse_import,
    preview_import,
)

_LAYOUTS = {
    "us_comma": "Temp,Moment\n300.5,1.25e-3\n301,1.5e-3\n",
    "us_comma_comment_preamble": "# run 3; sample A\n# by: X\nT,M\n300.5,1.2\n301,1.5\n",
    "semicolon_decimal_comma": "Temp;Moment\n300,5;1,25\n301;1,5\n302,5;1,75\n",
    "semicolon_decimal_comma_comment": "# exported\n1,5;2,25\n3,5;4,75\n5,5;6,75\n",
    "semicolon_decimal_comma_comment_header": "# exported by X\nT;V\n1,5;2,25\n3,5;4,75\n",
    "tab_quoted_commas": 'T\tV\tNote\n1\t2.5\t"Smith, J"\n2\t3.5\t"Doe, A"\n',
    "tab_comment_preamble": "# a, b, c\n# d, e\nT\tV\n1\t2\n3\t4\n",
    "indented_tab": "  T\tV\n  1\t2\n  3\t4\n",
}


def _write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "f.csv"
    path.write_text(text, encoding="utf-8")
    return path


@pytest.mark.parametrize("name", list(_LAYOUTS))
def test_wizard_guess_uses_the_direct_import_delimiter(tmp_path: Path, name: str) -> None:
    text = _LAYOUTS[name]
    direct = import_csv(_write(tmp_path, text))
    preview = preview_import(text, guess_settings(text))
    assert preview["delimiter"] == direct.metadata["delimiter"]


def test_commented_headerless_decimal_comma_file_reads_the_same(tmp_path: Path) -> None:
    text = _LAYOUTS["semicolon_decimal_comma_comment"]
    direct = import_csv(_write(tmp_path, text))
    wizard = parse_import(text, guess_settings(text))
    assert wizard.time.tolist() == direct.time.tolist() == [1.5, 3.5, 5.5]
    assert np.array_equal(wizard.values, direct.values)



def _shown(ds: object) -> list[str]:
    """Every column name the dataset shows: the x name, then the channels."""
    return [ds.metadata["x_column_name"], *ds.labels]  # type: ignore[attr-defined]


def test_decimal_comma_columns_use_the_dataset_names(tmp_path: Path) -> None:
    text = "Temp (K);Moment (emu)\n300,5;1,25E-3\n301;1,5E-3\n302,25;1,75E-3\n"
    direct = import_csv(_write(tmp_path, text))
    settings = guess_settings(text)
    wizard = parse_import(text, settings)
    assert _shown(direct) == _shown(wizard) == ["Temp", "Moment"]
    assert direct.metadata["decimal_comma_columns"] == ["Temp", "Moment"]
    assert wizard.metadata["decimal_comma_columns"] == ["Temp", "Moment"]
    assert preview_import(text, settings)["decimal_comma_columns"] == ["Temp", "Moment"]
    assert direct.metadata["notes"] == wizard.metadata["notes"]


def test_wizard_decimal_comma_columns_follow_the_label_row() -> None:
    # A label row renames the channels, not the x column (x_column_name).
    text = "Temp;Moment\nT_sample;M_sample\n300,5;1,25\n301;1,5\n"
    settings = ImportSettings(header_line=0, label_line=1, data_start_line=2, roles=["x", "y"])
    ds = parse_import(text, settings)
    assert _shown(ds) == ["Temp", "M_sample"]
    assert ds.metadata["decimal_comma_columns"] == ["Temp", "M_sample"]
    assert preview_import(text, settings)["decimal_comma_columns"] == ["Temp", "M_sample"]
