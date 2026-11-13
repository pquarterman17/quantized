"""Quoted cells after a space, and quotes inside unquoted cells.

``1, "1,234.5"`` (a space before the opening quote, as many spreadsheet
exports write) was split into three cells -- csv's default dialect treats
that quote as literal -- so every row gained a column and the header no
longer matched. A quote after the delimiter plus blanks now opens a quoted
cell, in direct import and the Import wizard alike; an unquoted cell keeps
its quotes verbatim (``5" pipe``).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from quantized.io._delimited_layout import split_row
from quantized.io.delimited import import_csv
from quantized.io.import_preview import guess_settings, parse_import


@pytest.mark.parametrize(
    ("line", "delim", "cells"),
    [
        ('1, "1,234.5"', ",", ["1", "1,234.5"]),
        ('1\t "2\t3"\t4', "\t", ["1", "2\t3", "4"]),
        ('5" pipe,2', ",", ['5" pipe', "2"]),
        ('x,"he said ""hi""",3', ",", ["x", 'he said "hi"', "3"]),
        ('a,,""', ",", ["a", "", ""]),
        ("a, b,c", ",", ["a", " b", "c"]),  # no quote: untouched
        ('a, b,"c"', ",", ["a", " b", "c"]),  # an unquoted cell keeps its space
    ],
)
def test_split_row(line: str, delim: str, cells: list[str]) -> None:
    assert split_row(line, delim) == cells


SPACED = 'T, Amount\n1, "1,234.5"\n2, "2,000.0"\n3, "3,500.25"\n'
PIPES = 'Size,Name,M\n1,5" pipe,10\n2,3" pipe,20\n3,1" pipe,30\n'


def test_space_before_opening_quote_keeps_the_header_in_both_paths(tmp_path: Path) -> None:
    p = tmp_path / "q.csv"
    p.write_text(SPACED)
    direct = import_csv(p)
    assert direct.metadata["x_column_name"] == "T"
    assert direct.metadata["all_column_names"] == ["T", "Amount"]
    assert len(direct.time) == 3
    settings = guess_settings(SPACED)
    assert settings.header_line == 0 and settings.column_names == ["T", "Amount"]


def test_quote_inside_an_unquoted_cell_stays_literal(tmp_path: Path) -> None:
    p = tmp_path / "pipes.csv"
    p.write_text(PIPES)
    for ds in (import_csv(p), parse_import(PIPES, guess_settings(PIPES))):
        assert ds.labels == ("M",)
        assert ds.metadata["text_columns"] == {"Name": ['5" pipe', '3" pipe', '1" pipe']}
