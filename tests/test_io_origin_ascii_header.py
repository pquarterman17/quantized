"""Origin's own ASCII export header, and the tab vote with empty cells.

Origin's "Export ASCII" writes Long Name / Units / Comments rows above the
numbers; the generic layout rules took the Comments row for the names and
left the units empty. Separately, a pasted Excel/TSV block with ONE empty
trailing cell lost its tab to a pre-vote strip, the whitespace vote won, and
"Kerr Signal" fragmented into two columns. Both the direct import
(`import_csv`) and the Import Wizard (`guess_settings`/`parse_import`, which
also backs Paste data) are pinned. Synthetic specimens only.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io._delimited_layout import _detect_delimiter
from quantized.io._delimiter_vote import vote_lines
from quantized.io.delimited import import_csv
from quantized.io.import_preview import guess_settings, parse_import, preview_import

_DATA = "-1{d}-0.99{d}0.05\n0{d}0{d}0.05\n1{d}0.99{d}0.05\n"

ORIGIN_CSV = (
    '"Field","Kerr Signal","Kerr err"\n"Oe","mdeg","mdeg"\n"300 K","sample A",""\n'
    + _DATA.format(d=",")
)
# A tab export whose Comments row has an EMPTY last cell (trailing tab).
ORIGIN_TAB_EMPTY_COMMENT = (
    "Field\tKerr Signal\tKerr err\nT\tmdeg\tmdeg\n300 K\tsample A\t\n" + _DATA.format(d="\t")
)
ORIGIN_TAB_FULL = (
    "Field\tKerr Signal\tKerr err\nT\tmdeg\tmdeg\n300 K\tsample A\tfrom fit\n"
    + _DATA.format(d="\t")
)
ORIGIN_CASES = [ORIGIN_CSV, ORIGIN_TAB_EMPTY_COMMENT, ORIGIN_TAB_FULL]

# Excel copy: CRLF lines, one blank last cell (trailing tab) inside the
# first ten lines the delimiter vote samples.
PASTE_ONE_EMPTY_CELL = (
    "Field\tKerr Signal\tKerr err\r\nOe\tmdeg\tmdeg\r\n"
    "-1000\t-0.9975\t0.05\r\n-900\t-0.9951\t0.05\r\n-800\t-0.9904\t0.05\r\n"
    "-500\t-0.9311\t\r\n-400\t-0.8701\t0.05\r\n0\t0.0\t0.05\r\n400\t0.8701\t0.05\r\n"
    "900\t0.9951\t0.05\r\n"
)


def _write(tmp_path: Path, text: str, name: str = "f.txt") -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8", newline="")
    return path


@pytest.mark.parametrize("text", ORIGIN_CASES)
def test_direct_import_reads_origin_long_name_units_comments(tmp_path: Path, text: str) -> None:
    ds = import_csv(_write(tmp_path, text))
    assert ds.labels == ("Kerr Signal", "Kerr err")
    assert ds.units == ("mdeg", "mdeg")
    assert ds.metadata["x_column_name"] == "Field"
    assert ds.metadata["x_column_unit"] in ("Oe", "T")
    roles = [r["role"] for r in ds.metadata["label_rows"]]
    assert roles == ["header", "units", "comment"]
    comment = ds.metadata["label_rows"][2]
    assert comment["x"] == "300 K" and comment["cells"][0] == "sample A"
    assert ds.values.shape == (3, 2)


@pytest.mark.parametrize("text", ORIGIN_CASES)
def test_wizard_reads_origin_long_name_units_comments(text: str) -> None:
    settings = guess_settings(text)
    assert (settings.header_line, settings.units_line, settings.data_start_line) == (0, 1, 3)
    assert settings.column_names == ["Field", "Kerr Signal", "Kerr err"]
    preview = preview_import(text, settings)
    assert [c["unit"] for c in preview["columns"]][1:] == ["mdeg", "mdeg"]
    ds = parse_import(text, settings)
    assert ds.labels == ("Kerr Signal", "Kerr err")
    assert ds.units == ("mdeg", "mdeg")
    # The Comments row is kept -- as a preamble comment, not a label.
    assert any("sample A" in c for c in ds.metadata["comments"])


def test_title_names_units_file_keeps_the_generic_reading(tmp_path: Path) -> None:
    """Three text rows whose last two are names + units are NOT Origin's
    shape: the names row ``T,M,R`` is unit-like, so is the bottom row."""
    text = "Measured on PPMS,,\nT,M,R\nK,emu,Ohm\n1,2,3\n2,3,4\n"
    ds = import_csv(_write(tmp_path, text, "f.csv"))
    assert ds.labels == ("M", "R") and ds.units == ("emu", "Ohm")
    settings = guess_settings(text)
    assert (settings.header_line, settings.units_line) == (1, 2)


def test_two_row_names_units_file_is_unchanged(tmp_path: Path) -> None:
    text = "Temp,Moment\nK,emu\n1,2\n2,3\n"
    ds = import_csv(_write(tmp_path, text, "f.csv"))
    assert ds.labels == ("Moment",) and ds.units == ("emu",)
    assert [r["role"] for r in ds.metadata["label_rows"]] == ["header", "units"]


def test_paste_with_one_empty_cell_votes_tab() -> None:
    settings = guess_settings(PASTE_ONE_EMPTY_CELL)
    preview = preview_import(PASTE_ONE_EMPTY_CELL, settings)
    assert preview["delimiter"] == "\t"
    assert settings.column_names == ["Field", "Kerr Signal", "Kerr err"]
    ds = parse_import(PASTE_ONE_EMPTY_CELL, settings)
    assert ds.labels == ("Kerr Signal", "Kerr err")


def test_file_with_one_empty_cell_votes_tab(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, PASTE_ONE_EMPTY_CELL))
    assert ds.metadata["delimiter"] == "\t"
    assert ds.labels == ("Kerr Signal", "Kerr err")
    assert ds.units == ("mdeg", "mdeg")


def test_vote_lines_keep_trailing_padding_but_skip_blank_and_comment() -> None:
    assert vote_lines("# c\n\na\tb\t\r\n  \n1\t2\t3") == ["a\tb\t", "1\t2\t3"]


def test_tab_wins_when_header_has_most_tabs_and_rows_drop_trailing_cells() -> None:
    """A TSV writer that drops trailing empty cells leaves FEWER tabs on some
    rows; the header (most tabs) plus a tab on every line still means tab."""
    lines = ["Field\tKerr Signal\tKerr err", "1\t2\t3", "4\t5", "6\t7\t8"]
    assert _detect_delimiter(lines) == "\t"


def test_space_aligned_file_keeps_the_space_vote() -> None:
    lines = ["T    M    R", "1.0  2.0  3.0", "2.0  3.0\t4.0"]  # a stray tab, not tab data
    assert _detect_delimiter(lines) == " "


# -- tab rows keep their empty edge cells (direct import) --------------------


@pytest.mark.parametrize("force_slow", [False, True])
def test_leading_empty_cell_in_a_tab_row_stays_under_its_own_header(
    tmp_path: Path, force_slow: bool
) -> None:
    """Stripping the row whole deleted the leading empty cell, so 5 and 6 sat
    under Field and Kerr -- silently wrong data."""
    text = "Field\tKerr\tErr\n1\t2\t3\n\t5\t6\n7\t8\t9\n"
    ds = import_csv(_write(tmp_path, text), _force_slow=force_slow)
    assert ds.labels == ("Kerr", "Err")
    assert np.isnan(ds.time[1])
    np.testing.assert_array_equal(ds.values[1], [5.0, 6.0])
    np.testing.assert_array_equal(ds.values[2], [8.0, 9.0])


def test_trailing_empty_cell_on_the_first_data_row_keeps_the_last_column(tmp_path: Path) -> None:
    text = "Field\tKerr\tErr\n1\t2\t\n4\t5\t6\n7\t8\t9\n"
    ds = import_csv(_write(tmp_path, text))
    assert ds.labels == ("Kerr", "Err")
    assert np.isnan(ds.values[0, 1]) and ds.values[1, 1] == 6.0


def test_a_trailing_tab_on_every_line_is_still_padding(tmp_path: Path) -> None:
    text = "Field\tKerr\t\n1\t2\t\n4\t5\t\n"
    ds = import_csv(_write(tmp_path, text))
    assert ds.labels == ("Kerr",)
    assert ds.metadata["all_column_names"] == ["Field", "Kerr"]
    # data rows padded, header not: still two columns
    ds = import_csv(_write(tmp_path, "Field\tKerr\n1\t2\t\n4\t5\t\n"))
    assert ds.metadata["all_column_names"] == ["Field", "Kerr"]


# -- an undecidable header says so ------------------------------------------


def test_ambiguous_three_row_header_is_read_conservatively_and_says_so(tmp_path: Path) -> None:
    """A Comments row of short words ("RT", "fit") looks like units, so the
    rules cannot tell Origin's Long Name / Units / Comments from title /
    names / units. The generic reading stands, with a note naming the rows."""
    text = "Field Strength,Kerr Signal,Kerr err\nOe,mdeg,mdeg\nRT,fit,raw\n1,2,3\n2,3,4\n"
    ds = import_csv(_write(tmp_path, text, "f.csv"))
    assert ds.labels == ("mdeg", "mdeg (2)")  # the generic reading: row 2 names, row 3 units
    notes = ds.metadata["notes"]
    assert len(notes) == 1
    assert "Long Name / Units / Comments" in notes[0]
    assert "names on row 2 and units on row 3" in notes[0]
    assert "Import wizard" in notes[0]


@pytest.mark.parametrize("text", [*ORIGIN_CASES, "Temp,Moment\nK,emu\n1,2\n2,3\n"])
def test_a_decidable_header_carries_no_ambiguity_note(tmp_path: Path, text: str) -> None:
    ds = import_csv(_write(tmp_path, text))
    assert not any("Long Name" in n for n in ds.metadata.get("notes", []))


def test_wizard_can_assign_the_three_rows_by_hand() -> None:
    """The user's fix for the ambiguous file: Header line 0, Units line 1 --
    with `column_names` cleared so the names re-read from the header line."""
    import dataclasses

    text = "Field Strength,Kerr Signal,Kerr err\nOe,mdeg,mdeg\nRT,fit,raw\n1,2,3\n2,3,4\n"
    guessed = guess_settings(text)
    fixed = dataclasses.replace(guessed, header_line=0, units_line=1, column_names=None)
    ds = parse_import(text, fixed)
    assert ds.labels == ("Kerr Signal", "Kerr err")
    assert ds.units == ("mdeg", "mdeg")
    assert any("RT" in c for c in ds.metadata["comments"])
