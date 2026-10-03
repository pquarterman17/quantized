"""A QD import carries more than Moment (plot audit round 2).

Before: ``import_auto`` on a VSM/MPMS/PPMS ``.dat`` kept only the moment, so a
user could not re-plot it against temperature or time, and its standard error
never became an error bar. The parser's own defaults stay MATLAB's single
column (``test_io_qd.py``'s goldens); the registry asks for the companions."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.qd import import_ppms, import_qd_vsm


def test_vsm_import_carries_error_and_sweep_columns(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "qd_edp124.dat")
    assert ds.labels == ("Moment", "M. Std. Err.", "Temperature", "Time Stamp")
    assert ds.metadata["x_column_name"] == "Magnetic Field"
    assert ds.metadata["default_value_channels"] == [0]  # the first plot is unchanged
    assert ds.metadata["error_roles"] == [
        {"channel": 1, "target": 0, "axis": "y", "side": "both"}
    ]
    assert ds.metadata["technique"] == "magnetometry.mvsh"


def test_the_moment_channel_is_the_parsers_default(fixtures_dir: Path) -> None:
    """Channel 0 is byte-for-byte the golden-pinned single-column import."""
    auto = import_auto(fixtures_dir / "qd_edp124.dat")
    plain = import_qd_vsm(fixtures_dir / "qd_edp124.dat")
    assert plain.labels == ("Moment",)
    assert_allclose(auto.time, plain.time)
    assert_allclose(auto.values[:, 0], plain.values[:, 0])


def test_companion_values_are_the_file_columns(fixtures_dir: Path) -> None:
    auto = import_auto(fixtures_dir / "qd_edp124.dat")
    every = import_qd_vsm(fixtures_dir / "qd_edp124.dat", y_axis="all")
    for k, label in enumerate(auto.labels):
        j = every.labels.index(label)
        assert_allclose(auto.values[:, k], every.values[:, j], equal_nan=True)


def test_mpms3_binds_the_dc_moment_error(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "mpms_mvst.dat")
    assert ds.labels[0] == "DC Moment Free Ctr"
    err = ds.labels.index("DC Moment Err Free Ctr")
    assert ds.metadata["error_roles"][0]["channel"] == err
    assert "Temperature" not in ds.labels  # it is already the x axis
    assert "Magnetic Field" in ds.labels and "Time Stamp" in ds.labels
    assert np.isfinite(ds.values[:, err]).any()


def test_ppms_plain_csv_gets_the_same(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "ppms_synth.dat")
    assert ds.labels == ("Moment", "M. Std. Err.", "Temperature", "Time Stamp")
    assert import_ppms(fixtures_dir / "ppms_synth.dat").labels == ("Moment",)


def test_an_empty_error_column_is_not_bound(tmp_path: Path) -> None:
    text = (
        "Comment,Time Stamp (sec),Temperature (K),Magnetic Field (Oe),Moment (emu),"
        "M. Std. Err. (emu)\n"
        ",1,300,10,1e-4,\n,2,300,20,2e-4,\n,3,300,30,3e-4,\n"
    )
    (tmp_path / "m.dat").write_text(text)
    ds = import_auto(tmp_path / "m.dat")
    assert "M. Std. Err." not in ds.labels
    assert "error_roles" not in ds.metadata
