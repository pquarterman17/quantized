"""Rigaku SmartLab .raw binary parser: golden parity vs MATLAB + routing."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.rigaku import import_rigaku_raw


@pytest.mark.golden
def test_rigaku_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    ds = import_rigaku_raw(fixtures_dir / "rigaku_yig.raw")
    assert_golden(ds, "rigaku_yig_default.json")


def test_rigaku_structure(fixtures_dir: Path) -> None:
    ds = import_rigaku_raw(fixtures_dir / "rigaku_yig.raw")
    assert ds.labels == ("Intensity",)
    assert ds.units == ("counts",)
    assert ds.metadata["x_column_name"] == "2-Theta"
    assert ds.n_points == 15385
    assert ds.time[0] < ds.time[-1]  # ascending 2theta


def test_rigaku_counts_per_sec(fixtures_dir: Path) -> None:
    counts = import_rigaku_raw(fixtures_dir / "rigaku_yig.raw")
    cps = import_rigaku_raw(fixtures_dir / "rigaku_yig.raw", use_counts_per_sec=True)
    ct = counts.metadata["counting_time"]
    assert cps.units == ("counts/s",)
    assert_allclose(cps.values, counts.values / ct, rtol=1e-12)


def test_registry_routes_raw(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "rigaku_yig.raw")
    assert ds.metadata["parser_name"] == "import_rigaku_raw"
