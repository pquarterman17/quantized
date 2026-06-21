"""Quantum Design VSM parser: golden parity vs MATLAB + behaviour."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.qd import import_mpms, import_qd_vsm


@pytest.mark.golden
def test_qd_default_matches_matlab(
    fixtures_dir: Path,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    ref = load_golden("qd_edp124_default.json")
    ds = import_qd_vsm(fixtures_dir / "qd_edp124.dat")  # defaults: field -> moment
    assert list(ds.labels) == list(ref["labels"])
    assert list(ds.units) == list(ref["units"])
    assert_allclose(ds.time, np.asarray(ref["time"], dtype=float), rtol=1e-9, atol=1e-12)
    # MATLAB jsonencode flattens an N×1 column vector to a flat array, so
    # normalize the reference back to the parsed matrix shape before comparing.
    ref_values = np.asarray(ref["values"], dtype=float).reshape(ds.values.shape)
    assert_allclose(ds.values, ref_values, rtol=1e-9, atol=1e-12)


def test_qd_defaults_field_moment(fixtures_dir: Path) -> None:
    ds = import_qd_vsm(fixtures_dir / "qd_edp124.dat")
    assert ds.labels == ("Moment",)
    assert ds.units == ("emu",)
    assert ds.metadata["x_column_name"] == "Magnetic Field"
    assert ds.n_points == 401


def test_qd_all_columns(fixtures_dir: Path) -> None:
    ds = import_qd_vsm(fixtures_dir / "qd_edp124.dat", y_axis="all")
    assert ds.n_channels > 1
    assert "Moment" in ds.labels
    assert "Comment" not in ds.labels  # excluded by the 'all' heuristic


def test_registry_sniffs_qd_dat(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "qd_edp124.dat")
    assert ds.metadata["parser_name"] == "import_qd_vsm"


@pytest.mark.golden
def test_mpms_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    ds = import_mpms(fixtures_dir / "mpms_mvst.dat")
    assert_golden(ds, "mpms_mvst_default.json")


def test_mpms_defaults_temp_dcmoment(fixtures_dir: Path) -> None:
    ds = import_mpms(fixtures_dir / "mpms_mvst.dat")
    assert ds.metadata["parser_name"] == "import_mpms"
    assert ds.metadata["instrument_type"] == "MPMS SQUID"
    assert ds.metadata["x_column_name"] == "Temperature"
