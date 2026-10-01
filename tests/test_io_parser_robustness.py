"""Edge-case robustness of the registered text parsers (2026-10-01 audit).

Each test pins one input shape that used to import as SILENTLY WRONG data --
shifted columns, numbers replaced by categorical level codes, leading data
rows dropped, mojibake units -- or that a valid file was rejected over. The
rule throughout: parse it correctly when the format is unambiguous, otherwise
fail closed with a clear ``ValueError`` (the route turns that into a 422).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io import import_auto
from quantized.io._delimited_fast import try_fast_parse_matrix
from quantized.io.delimited import import_csv
from quantized.io.ncnr import import_ncnr_refl
from quantized.io.refl1d import import_refl1d_dat

_BOM = b"\xef\xbb\xbf"


def _write(tmp_path: Path, name: str, data: bytes) -> Path:
    path = tmp_path / name
    path.write_bytes(data)
    return path


# --- whitespace-aligned columns ---------------------------------------------


def test_space_aligned_columns_split_on_whitespace_runs(tmp_path: Path) -> None:
    # Fixed-width text exports pad with a VARIABLE number of spaces. Splitting
    # on a single space made "1.5  2" three cells and "10.5 3" two, so the
    # second column's values landed in different columns row to row.
    path = _write(tmp_path, "aligned.csv", b"x y\n1.5  2\n10.5 3\n100.25 4\n")
    ds = import_csv(path)
    assert ds.time.tolist() == [1.5, 10.5, 100.25]
    assert ds.labels == ("y",)
    assert ds.values[:, 0].tolist() == [2.0, 3.0, 4.0]


def test_space_aligned_padded_header_and_rows(tmp_path: Path) -> None:
    text = b"   T        M\n 1.5    2.0\n10.5    3.0\n100.5   4.0\n"
    ds = import_csv(_write(tmp_path, "padded.csv", text))
    assert ds.metadata["x_column_name"] == "T"
    assert ds.labels == ("M",)
    assert ds.time.tolist() == [1.5, 10.5, 100.5]
    assert ds.values[:, 0].tolist() == [2.0, 3.0, 4.0]


def test_space_aligned_large_file_fast_path_matches_slow(tmp_path: Path) -> None:
    rows = [f"{i * 0.5:<10g} {i * i:>12d}" for i in range(3000)]
    path = _write(tmp_path, "big.csv", ("x y\n" + "\n".join(rows) + "\n").encode())
    # The bulk np.loadtxt path must actually accept the whitespace layout.
    assert try_fast_parse_matrix(["x y", *rows], 1, 2, " ") is not None
    fast = import_csv(path)
    slow = import_csv(path, _force_slow=True)
    assert fast.values.shape == (3000, 1)
    assert np.array_equal(fast.time, slow.time)
    assert np.array_equal(fast.values, slow.values)
    assert fast.values[-1, 0] == 2999.0**2


# --- quoted fields -----------------------------------------------------------


def test_quoted_numeric_fields_are_numbers_not_category_codes(tmp_path: Path) -> None:
    # Excel / pandas QUOTE_ALL exports quote every cell. The quotes made every
    # number fail float(), so the data came back as categorical level codes.
    path = _write(tmp_path, "quoted.csv", b'"a","b"\n"1","2"\n"3","4"\n')
    ds = import_csv(path)
    assert ds.metadata["x_column_name"] == "a"
    assert ds.labels == ("b",)
    assert ds.time.tolist() == [1.0, 3.0]
    assert ds.values[:, 0].tolist() == [2.0, 4.0]
    assert not ds.cat_levels


def test_quoted_field_with_embedded_delimiter_does_not_shift(tmp_path: Path) -> None:
    path = _write(tmp_path, "names.csv", b'T,name,val\n1,"x, y",2\n2,"z",3\n')
    ds = import_csv(path)
    assert ds.time.tolist() == [1.0, 2.0]
    assert ds.labels == ("val",)
    assert ds.values[:, 0].tolist() == [2.0, 3.0]
    assert ds.metadata["text_columns"] == {"name": ["x, y", "z"]}


# --- leading data rows with a missing cell -------------------------------------


@pytest.mark.parametrize("missing", ["n/a", "", "-", "NA"])
def test_leading_rows_with_missing_cell_are_kept(tmp_path: Path, missing: str) -> None:
    # A 2-column row with one missing cell scores exactly 0.5 numeric, so the
    # layout scan skipped it as "not data" -- dropping every such leading row
    # AND the header above them (the labels fell back to Col1/Col2).
    text = f"Temp,Moment\n1,{missing}\n2,{missing}\n3,5\n4,6\n"
    ds = import_csv(_write(tmp_path, "gaps.csv", text.encode()))
    assert ds.time.tolist() == [1.0, 2.0, 3.0, 4.0]
    assert ds.metadata["x_column_name"] == "Temp"
    assert ds.labels == ("Moment",)
    assert np.isnan(ds.values[:2, 0]).all()
    assert ds.values[2:, 0].tolist() == [5.0, 6.0]


def test_leading_row_with_missing_cell_beside_a_text_column(tmp_path: Path) -> None:
    text = b"T,M,Sample\n1,n/a,A\n2,3,B\n3,4,B\n"
    ds = import_csv(_write(tmp_path, "mixed.csv", text))
    assert ds.time.tolist() == [1.0, 2.0, 3.0]
    assert ds.labels == ("M",)
    assert ds.metadata["text_columns"] == {"Sample": ["A", "B", "B"]}


def test_preamble_row_is_not_mistaken_for_data(tmp_path: Path) -> None:
    # The walk-back must stop at a text cell in a numeric column.
    text = b"Sample,5\nT,M\n1,2\n3,4\n"
    ds = import_csv(_write(tmp_path, "pre.csv", text))
    assert ds.time.tolist() == [1.0, 3.0]
    assert ds.metadata["x_column_name"] == "T"


# --- encodings / BOM -----------------------------------------------------------


def test_utf8_bom_headerless_file_keeps_first_row(tmp_path: Path) -> None:
    path = _write(tmp_path, "bom.csv", _BOM + b"1,2\n3,4\n5,6\n")
    ds = import_csv(path)
    assert ds.time.tolist() == [1.0, 3.0, 5.0]
    assert ds.values[:, 0].tolist() == [2.0, 4.0, 6.0]


def test_utf8_bom_does_not_leak_into_first_header(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "bomh.csv", _BOM + b"Time,Value\n1,2\n3,4\n"))
    assert ds.metadata["x_column_name"] == "Time"
    assert ds.metadata["all_column_names"] == ["Time", "Value"]


def test_utf8_units_are_not_mojibake(tmp_path: Path) -> None:
    text = "Temp (°C),M (µemu)\n1,2\n3,4\n".encode()
    ds = import_csv(_write(tmp_path, "utf8.csv", text))
    assert ds.metadata["x_column_unit"] == "°C"
    assert ds.units == ("µemu",)


def test_latin1_units_still_decode(tmp_path: Path) -> None:
    text = "Temp (°C),M (µemu)\n1,2\n3,4\n".encode("latin-1")
    ds = import_csv(_write(tmp_path, "latin1.csv", text))
    assert ds.metadata["x_column_unit"] == "°C"
    assert ds.units == ("µemu",)


def test_utf16_bom_file_parses(tmp_path: Path) -> None:
    # Excel's "Unicode Text" export: UTF-16LE with a BOM, tab-delimited.
    text = "T\tM\n1\t2\n3\t4\n".encode("utf-16")
    ds = import_csv(_write(tmp_path, "u16.tsv", text))
    assert ds.time.tolist() == [1.0, 3.0]
    assert ds.labels == ("M",)


def test_refl1d_with_bom_keeps_column_labels(fixtures_dir: Path, tmp_path: Path) -> None:
    src = (fixtures_dir / "refl1d_refl_fit.dat").read_bytes()
    ds = import_refl1d_dat(_write(tmp_path, "fit.dat", _BOM + src))
    assert ds.labels == ("dQ", "R", "dR", "theory", "fresnel")


def test_refl1d_profile_with_bom_is_still_sniffed(fixtures_dir: Path, tmp_path: Path) -> None:
    src = (fixtures_dir / "refl1d_nbau_profile.dat").read_bytes()
    ds = import_auto(_write(tmp_path, "profile.dat", _BOM + src))
    assert ds.metadata["parser_name"] == "import_refl1d_dat"


def test_ncnr_refl_with_bom_parses(fixtures_dir: Path, tmp_path: Path) -> None:
    src = (fixtures_dir / "ncnr_j395.refl").read_bytes()
    path = _write(tmp_path, "j395.refl", _BOM + src)
    ds = import_auto(path)
    reference = import_ncnr_refl(fixtures_dir / "ncnr_j395.refl")
    assert ds.labels == reference.labels
    assert np.array_equal(ds.values, reference.values)


# --- comma decimal separators fail closed --------------------------------------


@pytest.mark.parametrize("delim", [";", "\t"])
def test_comma_decimal_numbers_fail_closed(tmp_path: Path, delim: str) -> None:
    # "1,5" is one-and-a-half in a European export -- or 15 / 1,500 with a
    # thousands separator. Either way it is not text: importing the column as
    # categorical level codes 0,1,2 replaced every number with its row rank.
    rows = ["Time", "Value"], ["1,5", "2,25"], ["3,5", "4,75"], ["5,5", "6,75"]
    text = "\n".join(delim.join(r) for r in rows) + "\n"
    with pytest.raises(ValueError, match="comma"):
        import_csv(_write(tmp_path, "eu.csv", text.encode()))


def test_text_column_in_semicolon_file_is_still_categorical(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "tags.csv", b"T;Tag\n1;a,b\n2;c\n3;a,b\n"))
    assert ds.time.tolist() == [1.0, 2.0, 3.0]
    assert ds.cat_levels
