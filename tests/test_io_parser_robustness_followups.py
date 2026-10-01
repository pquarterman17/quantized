"""Parser robustness follow-ups to the 2026-10-01 audit (``test_io_parser_robustness``).

Same rule: parse correctly when the format is unambiguous, otherwise fail
closed with a clear ``ValueError``. Where a parser drops rows it now says so:
``metadata["dropped_rows"]`` carries the count and ``metadata["notes"]`` a
sentence (the ``notes`` convention ``import_csv`` already uses).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import openpyxl
import pytest

from quantized.io.delimited import import_csv
from quantized.io.excel import import_excel
from quantized.io.import_preview import guess_settings, parse_import, preview_import
from quantized.io.ncnr import import_ncnr_dat, import_ncnr_refl


def _xlsx(tmp_path: Path, rows: list[tuple[Any, ...]]) -> Path:
    wb = openpyxl.Workbook()
    ws = wb.active
    assert ws is not None
    for row in rows:
        ws.append(list(row))
    path = tmp_path / "sheet.xlsx"
    wb.save(path)
    return path


# --- 1. Excel: leading rows with a blank cell ----------------------------------


@pytest.mark.parametrize("missing", [None, "n/a"])
def test_excel_leading_rows_with_missing_cell_are_kept(tmp_path: Path, missing: Any) -> None:
    path = _xlsx(tmp_path, [("Temp", "Moment"), (1, missing), (2, missing), (3, 5), (4, 6)])
    ds = import_excel(path)
    assert ds.time.tolist() == [1.0, 2.0, 3.0, 4.0]
    assert ds.metadata["x_column_name"] == "Temp"
    assert ds.labels == ("Moment",)
    assert np.isnan(ds.values[:2, 0]).all()
    assert ds.values[2:, 0].tolist() == [5.0, 6.0]


def test_excel_walk_back_stops_at_preamble(tmp_path: Path) -> None:
    ds = import_excel(_xlsx(tmp_path, [("Sample", 5), ("T", "M"), (1, 2), (3, 4)]))
    assert ds.time.tolist() == [1.0, 3.0]
    assert ds.metadata["x_column_name"] == "T"


def test_excel_numeric_text_header_is_not_data(tmp_path: Path) -> None:
    # A typed sheet knows "2019" is TEXT; the walk-back must not eat it.
    ds = import_excel(_xlsx(tmp_path, [("2019", "2020"), (1, None), (3, 4)]))
    assert ds.time.tolist() == [1.0, 3.0]
    assert ds.metadata["x_column_name"] == "2019"


# --- 2. NCNR .datA-D: a truncated first data row --------------------------------


def _dat_lines(fixtures_dir: Path) -> list[str]:
    return (fixtures_dir / "ncnr_s3.datA").read_text().splitlines()


def _first_data_index(lines: list[str]) -> int:
    return next(i for i, ln in enumerate(lines) if ln.strip() and not ln.startswith("#"))


def test_ncnr_dat_truncated_first_row_keeps_full_rows(
    fixtures_dir: Path, tmp_path: Path
) -> None:
    lines = _dat_lines(fixtures_dir)
    reference = import_ncnr_dat(fixtures_dir / "ncnr_s3.datA")
    i = _first_data_index(lines)
    lines[i] = " ".join(lines[i].split()[:3])
    path = tmp_path / "cut.datA"
    path.write_text("\n".join(lines) + "\n")
    ds = import_ncnr_dat(path)
    assert ds.labels == reference.labels
    assert ds.n_points == reference.n_points - 1
    assert np.array_equal(ds.values, reference.values[1:])
    assert ds.metadata["dropped_rows"] == 1
    assert any("1 row" in note for note in ds.metadata["notes"])


def test_ncnr_dat_clean_file_reports_nothing(fixtures_dir: Path) -> None:
    ds = import_ncnr_dat(fixtures_dir / "ncnr_s3.datA")
    assert "dropped_rows" not in ds.metadata
    assert "notes" not in ds.metadata


# --- 3. NCNR .refl: a cut-off last line / an over-wide row ----------------------


def test_ncnr_refl_truncated_last_line_is_dropped(fixtures_dir: Path, tmp_path: Path) -> None:
    text = (fixtures_dir / "ncnr_j395.refl").read_text().rstrip("\n")
    last = text.rsplit("\n", 1)[1]
    cut = text[: len(text) - len(last)] + " ".join(last.split()[:2])
    path = tmp_path / "cut.refl"
    path.write_text(cut + "\n")
    reference = import_ncnr_refl(fixtures_dir / "ncnr_j395.refl")
    ds = import_ncnr_refl(path)
    assert ds.n_points == reference.n_points - 1
    assert np.array_equal(ds.values, reference.values[:-1])
    assert ds.metadata["dropped_rows"] == 1
    assert ds.metadata["notes"]


def test_ncnr_refl_wider_row_is_truncated_with_a_note(fixtures_dir: Path, tmp_path: Path) -> None:
    lines = (fixtures_dir / "ncnr_j395.refl").read_text().splitlines()
    i = _first_data_index(lines)
    lines[i] += " 9.9"
    path = tmp_path / "wide.refl"
    path.write_text("\n".join(lines) + "\n")
    reference = import_ncnr_refl(fixtures_dir / "ncnr_j395.refl")
    ds = import_ncnr_refl(path)
    assert np.array_equal(ds.values, reference.values)
    assert "dropped_rows" not in ds.metadata
    assert any("more values" in note for note in ds.metadata["notes"])


def test_ncnr_refl_rows_narrower_than_header_fail_clearly(tmp_path: Path) -> None:
    text = '# "columns": ["Qz", "R", "dR", "dQ"]\n0.01 1.0 0.1\n0.02 0.9 0.1\n'
    path = tmp_path / "narrow.refl"
    path.write_text(text)
    with pytest.raises(ValueError, match="fewer values than"):
        import_ncnr_refl(path)


def test_ncnr_refl_clean_file_reports_nothing(fixtures_dir: Path) -> None:
    ds = import_ncnr_refl(fixtures_dir / "ncnr_j395.refl")
    assert "dropped_rows" not in ds.metadata
    assert "notes" not in ds.metadata


# --- 4. A header-only delimited file -------------------------------------------


@pytest.mark.parametrize("text", ["Time,Value\n", "Time,Value\nK,emu\n", "Time (K),M (emu)\n"])
def test_header_only_csv_fails_with_no_data_rows(tmp_path: Path, text: str) -> None:
    path = tmp_path / "header.csv"
    path.write_text(text)
    with pytest.raises(ValueError, match="no data rows"):
        import_csv(path)


def test_all_text_table_still_imports_as_categorical(tmp_path: Path) -> None:
    path = tmp_path / "tags.csv"
    path.write_text("Sample,Operator\nfilm one,Alice\nfilm two,Bob\nfilm three,Alice\n")
    ds = import_csv(path)
    assert ds.cat_levels


# --- 5. Import Wizard splits quoted cells like import_csv ------------------------


def test_wizard_quoted_numbers_match_import_csv(tmp_path: Path) -> None:
    text = '"a","b"\n"1","2"\n"3","4"\n'
    path = tmp_path / "quoted.csv"
    path.write_text(text)
    csv_ds = import_csv(path)
    g = guess_settings(text)
    assert g.column_names == ["a", "b"]
    ds = parse_import(text, g)
    assert ds.time.tolist() == csv_ds.time.tolist() == [1.0, 3.0]
    assert ds.values[:, 0].tolist() == csv_ds.values[:, 0].tolist() == [2.0, 4.0]


def test_wizard_quoted_cell_with_embedded_delimiter_does_not_shift() -> None:
    text = 'T,name,val\n1,"x, y",2\n2,"z",3\n'
    pv = preview_import(text, guess_settings(text))
    assert [c["name"] for c in pv["columns"]] == ["T", "name", "val"]
    assert [row[2] for row in pv["rows"]] == [2.0, 3.0]
