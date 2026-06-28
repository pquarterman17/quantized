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


def test_mvsh_keeps_field_when_it_varies(fixtures_dir: Path) -> None:
    # qd_edp124 is an M-vs-H loop: field sweeps, so the field default must stand
    # (the auto-x swap only triggers on a *constant* x). Guards the parity case.
    ds = import_qd_vsm(fixtures_dir / "qd_edp124.dat")
    assert ds.metadata["x_column_name"] == "Magnetic Field"


def test_classic_mpms_imports_and_swaps_constant_field_to_temperature(
    fixtures_dir: Path,
) -> None:
    """MPMS-classic ZFC file: the column is literally "Field" (resolved via the
    literal-spec fallback) and is held constant, so the default x auto-swaps to
    the varying Temperature sweep — otherwise the plot is a single vertical line."""
    ds = import_auto(fixtures_dir / "mpms_zfc_classic.dat")
    assert ds.metadata["parser_name"] == "import_qd_vsm"
    assert ds.metadata["x_column_name"] == "Temperature"
    assert ds.labels == ("Long Moment",)
    # x must actually vary so the data is plottable by default.
    assert float(np.ptp(ds.time)) > 0
    assert np.isfinite(ds.values[:, 0]).all()


def test_ppms_resistance_vs_temperature_no_field_column(tmp_path: Path) -> None:
    """The PPMS sniffer accepts an R-vs-T plain CSV that lacks Field/Moment; the
    parser must degrade to auto-detected x/y rather than KeyError on 'field'."""
    f = tmp_path / "rvt.dat"
    f.write_text(
        "Temperature (K),Resistance (Ohm)\n"
        "100,150\n150,155\n200,160\n250,165\n300,170\n",
        encoding="latin-1",
    )
    ds = import_ppms(f)
    assert ds.metadata["x_column_name"] == "Temperature"
    assert ds.labels == ("Resistance",)
    assert ds.n_points == 5
    # routes cleanly through import_auto too
    assert import_auto(f).metadata["parser_name"] == "import_ppms"
