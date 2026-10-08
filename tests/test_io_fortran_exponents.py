"""Fortran double-precision exponents (``1.0D+00``) in text imports.

Fortran's ``D`` edit descriptor writes ``0.1234D+01``; ``float()`` rejects it,
so such a column used to import as text. Only a token matching the whole float
grammar with ``D`` in the exponent position counts -- "D", "Dec", "ID", "3D",
hex strings and header/units cells never do.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io._delimited_layout import _is_numeric, _is_numeric_like, _to_float
from quantized.io._fortran_float import is_fortran_float, parse_float
from quantized.io.delimited import import_csv
from quantized.io.import_preview import guess_settings, parse_import
from quantized.io.lakeshore import import_lake_shore
from quantized.io.ncnr import import_ncnr_dat, import_ncnr_pnr
from quantized.io.qd import import_qd_vsm
from quantized.io.refl1d import import_refl1d_dat

ACCEPTED = {
    "1.0D+00": 1.0,
    "-2.5d-3": -2.5e-3,
    "3.D4": 3.0e4,
    ".5D1": 5.0,
    "+0.1234D+01": 1.234,
    "1D+02": 100.0,
    "7d-1": 0.7,
    "  2.0D0 ": 2.0,
}

# Text that must never read as a number.
REJECTED = [
    "D", "d", "Dec", "ID", "3D", "1D2", "12D4", "1D2F", "0x1D", "D+02", "1.0D",
    "1.0D+", "--1D+2", "1.0E+00D", "1.0D+00x", "1.0 D+00", "D3.0", "1_0D+0",
]


@pytest.mark.parametrize(("token", "expected"), ACCEPTED.items())
def test_parse_float_accepts_fortran_exponents(token: str, expected: float) -> None:
    assert parse_float(token) == pytest.approx(expected, rel=1e-15)
    assert is_fortran_float(token)
    assert _to_float(token) == pytest.approx(expected, rel=1e-15)
    assert _is_numeric(token.strip())
    assert _is_numeric_like(token.strip())


@pytest.mark.parametrize("token", REJECTED)
def test_parse_float_rejects_d_text(token: str) -> None:
    assert not is_fortran_float(token)
    with pytest.raises(ValueError):
        parse_float(token)
    assert np.isnan(_to_float(token))
    assert not _is_numeric(token)


@pytest.mark.parametrize("token", ["1.5", "-2e-3", "nan", "inf", "1_000", " 4 "])
def test_parse_float_is_float_everywhere_else(token: str) -> None:
    assert parse_float(token) == pytest.approx(float(token), nan_ok=True)


def _write(tmp_path: Path, name: str, text: str) -> Path:
    p = tmp_path / name
    p.write_text(text, encoding="utf-8")
    return p


@pytest.mark.parametrize("force_slow", [False, True])
def test_csv_fortran_columns_import_as_numeric(tmp_path: Path, force_slow: bool) -> None:
    p = _write(
        tmp_path,
        "fortran.csv",
        "T (K),M (emu),H (Oe)\n"
        "1.0D+00,-2.5d-3,3.D4\n"
        "2.0D+00,-2.6d-3,3.1D4\n"
        "3.0D+00,-2.7d-3,3.2D4\n",
    )
    ds = import_csv(p, _force_slow=force_slow)
    assert_allclose(ds.time, [1.0, 2.0, 3.0])
    assert ds.labels == ("M", "H")
    assert ds.units == ("emu", "Oe")
    assert_allclose(ds.values, [[-2.5e-3, 3.0e4], [-2.6e-3, 3.1e4], [-2.7e-3, 3.2e4]])
    assert "text_columns" not in ds.metadata
    assert "categorical_levels" not in ds.metadata


def test_mostly_fortran_column_with_one_na_is_numeric(tmp_path: Path) -> None:
    p = _write(
        tmp_path,
        "mixed.dat",
        "x\ty\n1\t1.0D+00\n2\tn/a\n3\t3.0D+00\n4\t4.0D-01\n",
    )
    ds = import_csv(p)
    assert ds.labels == ("y",)
    assert_allclose(ds.values[:, 0], [1.0, np.nan, 3.0, 0.4], equal_nan=True)
    assert "text_columns" not in ds.metadata


def test_units_row_with_d_and_text_id_column_stay_text(tmp_path: Path) -> None:
    """A units cell "D" and an ID column of D-ish strings are not numbers."""
    p = _write(
        tmp_path,
        "ids.csv",
        "Time,Value,Well\ns,D,\n1.0D+00,2.0D+00,1D2\n2.0D+00,4.0D+00,3D\n3.0D+00,6.0D+00,ID7\n",
    )
    ds = import_csv(p)
    assert_allclose(ds.time, [1.0, 2.0, 3.0])
    assert ds.labels == ("Value",)
    assert ds.units == ("D",)
    assert_allclose(ds.values[:, 0], [2.0, 4.0, 6.0])
    assert ds.metadata["text_columns"] == {"Well": ["1D2", "3D", "ID7"]}


def test_import_wizard_parse_reads_fortran_exponents() -> None:
    text = "a,b\n1.0D+00,5.0D-01\n2.0D+00,2.5D-01\n"
    ds = parse_import(text, guess_settings(text))
    assert_allclose(ds.time, [1.0, 2.0])
    assert_allclose(ds.values[:, 0], [0.5, 0.25])


def test_refl1d_dat_reads_fortran_rows(tmp_path: Path) -> None:
    p = _write(
        tmp_path,
        "profile.dat",
        "# scale: 1.0D+00\n# z (A)  rho (1e-6/A2)\n0.0D+00 2.07D+00\n1.0D+01 4.66D+00\n",
    )
    ds = import_refl1d_dat(p)
    assert_allclose(ds.time, [0.0, 10.0])
    assert_allclose(ds.values[:, 0], [2.07, 4.66])
    assert ds.metadata["scale"] == 1.0


def test_ncnr_pnr_and_dat_read_fortran_rows(tmp_path: Path) -> None:
    pnr = _write(
        tmp_path,
        "s.pnr",
        "Q\tR++\tdR++\n1/A\t\t\n1.0D-02\t9.0D-01\t1.0D-02\n2.0D-02\t5.0D-01\t2.0D-02\n",
    )
    ds = import_ncnr_pnr(pnr)
    assert_allclose(ds.time, [0.01, 0.02])
    assert_allclose(ds.values[:, 0], [0.9, 0.5])

    dat = _write(
        tmp_path,
        "fit.datA",
        "# intensity: 1.0D+00\n# Q (1/A) dQ R dR theory fresnel\n"
        "1.0D-02 1.0D-04 9.0D-01 1.0D-02 9.1D-01 1.0D+00\n"
        "2.0D-02 2.0D-04 5.0D-01 2.0D-02 5.1D-01 1.0D+00\n",
    )
    fit = import_ncnr_dat(dat)
    assert_allclose(fit.time, [0.01, 0.02])
    assert_allclose(fit.values[:, 1], [0.9, 0.5])
    assert fit.metadata["intensity"] == 1.0


def test_lakeshore_fortran_data_row_is_not_the_header(tmp_path: Path) -> None:
    p = _write(
        tmp_path,
        "ls.csv",
        "Lake Shore VSM Measurement\nSample: f\n"
        "Temperature (K),Magnetic Field (Oe),Moment (emu)\n"
        "3.0D+02,5.0D+03,1.5D-04\n2.9D+02,5.0D+03,1.4D-04\n",
    )
    ds = import_lake_shore(p)
    assert ds.metadata["x_column_name"] == "Temperature"
    assert_allclose(ds.time, [300.0, 290.0])
    assert_allclose(ds.values[:, 0], [1.5e-4, 1.4e-4])


def test_qd_data_reads_fortran_cells(tmp_path: Path) -> None:
    p = _write(
        tmp_path,
        "run.dat",
        "[Header]\nTITLE,x\n[Data]\n"
        "Comment,Time Stamp (sec),Temperature (K),Magnetic Field (Oe),Moment (emu)\n"
        ",1.0D+00,3.0D+02,1.0D+03,1.5D-03\n,2.0D+00,2.9D+02,2.0D+03,1.4D-03\n",
    )
    ds = import_qd_vsm(p)
    assert_allclose(ds.time, [1000.0, 2000.0])
    assert_allclose(ds.values[:, 0], [1.5e-3, 1.4e-3])
