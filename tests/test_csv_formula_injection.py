"""CSV formula injection (security hardening, 2026-10-01).

Exported CSVs carry labels, units, and names taken from imported files. A
label such as ``=HYPERLINK("http://evil","x")`` becomes a live formula when
the CSV is opened in a spreadsheet. Every CSV writer applies the OWASP rule
to its TEXT cells and headers: a cell starting with ``=``, ``+``, ``-``,
``@``, tab, or CR gets a leading ``'``. Numeric cells are never altered, and a
numeric literal such as ``-1.5`` stays numeric even where it is a text cell.
"""

from __future__ import annotations

import csv
import io

import numpy as np
import pytest

from quantized.calc.sims_region import region_measures, region_summary_csv
from quantized.csv_safe import csv_text_cell, neutralize_formula, safe_comment_line
from quantized.datastruct import DataStruct
from quantized.io.consolidated import consolidate_csv
from quantized.io.origin import format_origin_script
from quantized.io.xrd_csv import format_xrd_csv

EVIL = '=HYPERLINK("http://evil.invalid","click")'


# -- the helper ------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [EVIL, "+SUM(A1)", "-2+3+cmd|' /C calc'!A0", "@SUM(1)", "\t=1", "\r=1", "-", "-inf"],
)
def test_neutralize_prefixes_formula_triggers(text: str) -> None:
    assert neutralize_formula(text) == "'" + text


@pytest.mark.parametrize(
    "text", ["-1.5", "+2", "-3e-4", "-.5", "1.0", "Moment", "T (K)", "", "'=already"]
)
def test_neutralize_leaves_numbers_and_plain_text(text: str) -> None:
    assert neutralize_formula(text) == text


def test_text_cell_quotes_after_neutralizing() -> None:
    assert csv_text_cell("=1,2") == "\"'=1,2\""
    assert csv_text_cell("a\tb", sep="\t") == '"a\tb"'
    assert csv_text_cell("Moment") == "Moment"


def test_comment_line_cannot_smuggle_a_cell_or_row() -> None:
    line = safe_comment_line('# Sample: a,=1+1,"=2+2"\n=3+3')
    cells = next(csv.reader([line]))
    assert "\n" not in line
    assert all(not c.startswith(("=", "+", "-", "@")) for c in cells)


# -- every writer --------------------------------------------------------


def _ds(label: str = EVIL, unit: str = "@unit", x_name: str = "-x") -> DataStruct:
    return DataStruct.create(
        [1.0, 2.0],
        np.array([[-1.5, 7.0], [2.0, -3.25]]),
        labels=[label, "Plain"],
        units=[unit, "emu"],
        metadata={"x_column_name": x_name, "x_column_unit": "K", "source": "/d/=evil.csv"},
    )


def test_origin_csv_escapes_headers_and_keeps_numbers() -> None:
    csv_text, _ogs = format_origin_script(_ds(), make_graph=False)
    rows = list(csv.reader(io.StringIO(csv_text)))
    assert rows[0] == ["'-x", "'" + EVIL, "Plain"]
    assert rows[1] == ["K", "'@unit", "emu"]
    assert rows[2] == ["1", "-1.5", "7"]
    assert rows[3] == ["2", "2", "-3.25"]


def test_origin_csv_plain_labels_are_untouched() -> None:
    csv_text, _ogs = format_origin_script(_ds("Moment", "emu", "T"), make_graph=False)
    assert csv_text.splitlines()[:2] == ["T,Moment,Plain", "K,emu,emu"]


@pytest.mark.parametrize("fmt", ["standard", "origin"])
def test_consolidated_csv_escapes_headers_and_keeps_numbers(fmt: str) -> None:
    text = consolidate_csv([(_ds(), "=name")], fmt=fmt)
    rows = list(csv.reader(io.StringIO(text)))
    header_cells = [c for r in rows[: (4 if fmt == "origin" else 1)] for c in r]
    assert all(not c.startswith(("=", "+", "-", "@")) for c in header_cells), header_cells
    assert any(c.startswith("'=HYPERLINK") for c in header_cells)
    assert "-1.5" in rows[-2] and "-3.25" in rows[-1]


@pytest.mark.parametrize(("fmt", "sep"), [("standard", ","), ("origin", "\t")])
def test_xrd_csv_escapes_headers_and_metadata(fmt: str, sep: str) -> None:
    ds = DataStruct.create(
        [10.0, 20.0],
        [[-1.5], [200.0]],
        labels=["Intensity"],
        units=["counts"],
        metadata={
            "x_column_name": "=evil",
            "x_column_unit": "@deg",
            "sample_name": "s,=1+1",
            "source": "a\n=2+2",
        },
    )
    text = format_xrd_csv(ds, fmt=fmt, intensity="counts")
    rows = list(csv.reader(io.StringIO(text), delimiter=sep))
    cells = [c for r in rows for c in r]
    assert all(not c.startswith(("=", "+", "@")) for c in cells), cells
    assert rows[-2][1] == "-1.5"  # numeric data cell unchanged


def test_xrd_csv_plain_header_untouched() -> None:
    ds = DataStruct.create(
        [10.0], [[1.0]], labels=["Intensity"], units=["counts"],
        metadata={"x_column_name": "2-Theta", "x_column_unit": "deg"},
    )
    text = format_xrd_csv(ds, intensity="counts", include_metadata=False)
    assert text.splitlines()[0] == "2-Theta (deg),Intensity (counts)"


def test_sims_region_csv_escapes_species_and_provenance() -> None:
    ds = DataStruct.create(
        [0.0, 10.0, 20.0, 30.0, 40.0],
        np.array([[1e18, 3e18, 5e18, 3e18, 1e18]]).T,
        labels=[EVIL],
        units=["atoms/cm3"],
        metadata={"x_column_name": "Depth", "x_column_unit": "nm"},
    )
    text = region_summary_csv(region_measures(ds, lo=0, hi=40), dataset="x,=1+1")
    rows = list(csv.reader(io.StringIO(text)))
    cells = [c for r in rows for c in r]
    assert all(not c.startswith(("=", "+", "@")) for c in cells), cells
    data = [r for r in rows if r and r[0].startswith("'=HYPERLINK")]
    assert len(data) == 1
