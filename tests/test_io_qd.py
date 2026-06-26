"""Quantum Design VSM parser: golden parity vs MATLAB + behaviour."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.qd import import_mpms, import_ppms, import_qd_vsm


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
def test_mpms_empty_moment_falls_back_to_dc(
    fixtures_dir: Path,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """mpms_mvst.dat is an MPMS3 file: the legacy "Moment" column is empty, so we
    fall back to "DC Moment Free Ctr" with real data. (MATLAB importMPMS lacks
    this — its frozen golden has an all-null Moment, a latent bug; we keep the
    Temperature/x parity from that golden but assert the corrected y.)"""
    ds = import_mpms(fixtures_dir / "mpms_mvst.dat")
    ref = load_golden("mpms_mvst_default.json")
    # Temperature (x) is read correctly by MATLAB -> keep that parity.
    assert_allclose(ds.time, np.asarray(ref["time"], dtype=float), rtol=1e-9, atol=1e-9)
    # The empty Moment column is replaced by the populated DC-moment column.
    assert ds.labels == ("DC Moment Free Ctr",)
    assert ds.units == ("emu",)
    assert np.isfinite(ds.values[:, 0]).all()


def test_mpms_defaults_temp_dcmoment(fixtures_dir: Path) -> None:
    ds = import_mpms(fixtures_dir / "mpms_mvst.dat")
    assert ds.metadata["parser_name"] == "import_mpms"
    assert ds.metadata["instrument_type"] == "MPMS SQUID"
    assert ds.metadata["x_column_name"] == "Temperature"


@pytest.mark.golden
def test_ppms_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    ds = import_ppms(fixtures_dir / "ppms_synth.dat")
    assert_golden(ds, "ppms_synth_default.json")


def test_ppms_defaults_field_moment(fixtures_dir: Path) -> None:
    ds = import_ppms(fixtures_dir / "ppms_synth.dat")
    assert ds.labels == ("Moment",)
    assert ds.units == ("emu",)
    assert ds.metadata["x_column_name"] == "Magnetic Field"
    assert ds.n_points == 5


def test_registry_routes_ppms_plain_csv(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "ppms_synth.dat")
    assert ds.metadata["parser_name"] == "import_ppms"
