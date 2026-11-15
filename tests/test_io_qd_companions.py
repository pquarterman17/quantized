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
    assert ds.labels[:4] == ("Moment", "M. Std. Err.", "Temperature", "Time Stamp")
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
    every = import_qd_vsm(fixtures_dir / "qd_edp124.dat", y_axis="all", include_raw=True)
    for k, label in enumerate(auto.labels):
        if label in every.labels:  # (y_axis="all" itself skips Comment/Map*)
            j = every.labels.index(label)
            assert_allclose(auto.values[:, k], every.values[:, j], equal_nan=True)


def test_every_column_with_data_is_importable(fixtures_dir: Path) -> None:
    """Worksheet audit #10: Origin's QD import shows the whole file; ours kept
    four columns of a VSM file's ~30 filled ones. Every column holding a
    number is now a worksheet column, in file order after the companions,
    with its unit -- and the first plot is still just the moment."""
    ds = import_auto(fixtures_dir / "qd_edp124.dat")
    names = ds.metadata["all_column_names"]
    units = ds.metadata["all_column_units"]
    raw = import_qd_vsm(fixtures_dir / "qd_edp124.dat", y_axis=list(range(len(names))))
    filled = [
        n for k, n in enumerate(names)
        if n != ds.metadata["x_column_name"] and np.isfinite(raw.values[:, k]).any()
    ]
    assert sorted(ds.labels) == sorted(filled)
    assert len(ds.labels) > 20
    assert "Coil Signal'" in ds.labels and "M. Raw'" in ds.labels
    for label, unit in zip(ds.labels, ds.units, strict=True):
        assert unit == units[names.index(label)] or label == "Time"
    assert ds.metadata["default_value_channels"] == [0]


def test_a_unitless_std_dev_is_bound_and_time_gets_seconds(tmp_path: Path) -> None:
    """PPMS writes "Long Scan Std Dev" with no unit beside "Long Moment (emu)",
    and "Time" with none at all (epoch seconds): the std dev was left unbound
    and both columns showed no unit."""
    text = (
        "Time,Comment,Field (Oe),Temperature (K),Long Moment (emu),Long Scan Std Dev,"
        "Long Reg Fit\n"
        "1000.5,,0,300,1e-5,1e-7,9.5\n1500.5,,0,290,2e-5,1e-7,9.6\n"
        "2000.5,,0,280,3e-5,2e-7,9.7\n"
    )
    (tmp_path / "p.dat").write_text(text)
    ds = import_auto(tmp_path / "p.dat")
    err = ds.labels.index("Long Scan Std Dev")
    assert ds.metadata["error_roles"] == [
        {"channel": err, "target": 0, "axis": "y", "side": "both"}
    ]
    assert ds.units[err] == "emu"
    assert ds.units[ds.labels.index("Time")] == "s"
    assert "Long Reg Fit" in ds.labels


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
    assert ds.labels == ("Moment", "M. Std. Err.", "Temperature", "Time Stamp")  # all filled
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
