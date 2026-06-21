"""refl1d .dat parser: golden parity vs MATLAB + routing."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from quantized.datastruct import DataStruct
from quantized.io import import_auto
from quantized.io.refl1d import import_refl1d_dat


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
