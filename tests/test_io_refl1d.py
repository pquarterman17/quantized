"""refl1d .dat parser: golden parity vs MATLAB + routing."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from quantized.datastruct import DataStruct
from quantized.io import import_auto
from quantized.io.refl1d import import_refl1d_dat, is_refl1d_dat


@pytest.mark.golden
def test_refl1d_profile_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    ds = import_refl1d_dat(fixtures_dir / "refl1d_nbau_profile.dat")
    assert_golden(ds, "refl1d_nbau_profile_default.json")


def test_refl1d_profile_structure(fixtures_dir: Path) -> None:
    ds = import_refl1d_dat(fixtures_dir / "refl1d_nbau_profile.dat")
    assert ds.metadata["x_column_name"] == "z"
    assert ds.labels == ("rho", "irho", "rhoM", "theta")


def test_registry_routes_refl1d_dat(fixtures_dir: Path) -> None:
    ds: DataStruct = import_auto(fixtures_dir / "refl1d_nbau_profile.dat")
    assert ds.metadata["parser_name"] == "import_refl1d_dat"


# ── sniffer: refl-fit exports whose column header follows # metadata lines ────


def test_sniffer_detects_refl_fit_below_preamble(fixtures_dir: Path) -> None:
    """The Q/R column header sits below '# intensity:' / '# background:' lines;
    the sniffer must scan every comment line, not just the first one."""
    assert is_refl1d_dat(fixtures_dir / "refl1d_refl_fit.dat") is True


def test_refl_fit_parses_q_r_columns(fixtures_dir: Path) -> None:
    ds = import_refl1d_dat(fixtures_dir / "refl1d_refl_fit.dat")
    assert ds.metadata["x_column_name"] == "Q"
    assert ds.metadata["x_column_unit"] == "1/A"
    assert ds.labels == ("dQ", "R", "dR", "theory", "fresnel")
    # Header key/value preamble is captured as float metadata.
    assert ds.metadata["intensity"] == pytest.approx(1.04776102038159)
    assert ds.metadata["background"] == pytest.approx(0.0)
    assert ds.n_points == 5


def test_refl_fit_routes_through_registry(fixtures_dir: Path) -> None:
    ds: DataStruct = import_auto(fixtures_dir / "refl1d_refl_fit.dat")
    assert ds.metadata["parser_name"] == "import_refl1d_dat"


def test_sniffer_rejects_qd_header_dat(fixtures_dir: Path) -> None:
    """A QD '[Header]' .dat must never be claimed by the refl1d sniffer."""
    qd = fixtures_dir / "_sniffer_qd_probe.dat"
    qd.write_text("[Header]\nTITLE,foo\n[Data]\n1,2,3\n", encoding="latin-1")
    try:
        assert is_refl1d_dat(qd) is False
    finally:
        qd.unlink()
