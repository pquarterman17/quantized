"""SIMS depth-profile processing (audit P2.3): calibration, background,
reference normalization, smoothing, and the chained ``process_sims``.

There is no MATLAB reference for these stages (``quantized_matlab`` only
imports SIMS profiles), so every expected value here is hand-computed from the
documented formula, not frozen.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pytest

from quantized.calc.processing import smooth_data
from quantized.calc.sims_correct import normalize_to_reference, smooth_profiles, subtract_background
from quantized.calc.sims_depth import calibrate_depth, rate_factor
from quantized.calc.sims_process import (
    BackgroundSpec,
    CalibrationSpec,
    NormalizationSpec,
    SmoothingSpec,
    process_sims,
)
from quantized.datastruct import DataStruct
from quantized.io.sims import import_sims
from quantized.x_units import x_unit_of

T = np.array([0.0, 10.0, 20.0, 30.0, 40.0])


def _codes(ws: list[dict[str, object]]) -> list[object]:
    return [w["code"] for w in ws]


# ── calibration ─────────────────────────────────────────────────────────────


def test_rate_calibration_is_rate_times_time() -> None:
    depth, prov, ws = calibrate_depth(T, x_unit="s", method="rate", sputter_rate=0.5)
    np.testing.assert_allclose(depth, [0.0, 5.0, 10.0, 15.0, 20.0])
    assert prov["sputter_rate_nm_per_s"] == pytest.approx(0.5)
    assert prov["depth_unit"] == "nm" and prov["time_unit"] == "s"
    assert prov["time_unit_source"] == "recorded"
    assert ws == []


def test_rate_units_convert() -> None:
    # 3 A/s for 1 min = 180 A = 18 nm = 0.018 um.
    depth, prov, _ = calibrate_depth(
        np.array([0.0, 1.0]),
        x_unit="min",
        method="rate",
        sputter_rate=3.0,
        rate_unit="A/s",
        depth_unit="um",
    )
    np.testing.assert_allclose(depth, [0.0, 0.018])
    assert prov["sputter_rate_nm_per_s"] == pytest.approx(0.3)
    assert rate_factor("um/h") == pytest.approx(1e-6 / 3600)
    assert prov["depth_unit"] == "um"


def test_crater_calibration_defaults_total_time_to_last_point_and_says_so() -> None:
    depth, prov, ws = calibrate_depth(
        T, x_unit="s", method="crater", crater_depth=1.0, crater_unit="um"
    )
    # 1000 nm over 40 s = 25 nm/s.
    np.testing.assert_allclose(depth, [0.0, 250.0, 500.0, 750.0, 1000.0])
    assert prov["sputter_rate_nm_per_s"] == pytest.approx(25.0)
    assert prov["total_time_assumed"] is True
    assert _codes(ws) == ["assumed-total-time"]
    assert ws[0]["info"] is True


def test_crater_with_explicit_total_time_reports_points_past_the_crater() -> None:
    depth, prov, ws = calibrate_depth(
        T, x_unit="s", method="crater", crater_depth=300.0, total_time=30.0
    )
    np.testing.assert_allclose(depth, [0.0, 100.0, 200.0, 300.0, 400.0])
    assert prov["total_time_assumed"] is False
    beyond = [w for w in ws if w["code"] == "beyond-crater"]
    assert beyond and beyond[0]["count"] == 1


@pytest.mark.parametrize("unit", ["", "nm", "K"])
def test_calibration_refuses_a_non_time_axis(unit: str) -> None:
    with pytest.raises(ValueError, match="time"):
        calibrate_depth(T, x_unit=unit, method="rate", sputter_rate=1.0)


def test_stated_time_unit_overrides_the_recorded_one_with_a_confirm_warning() -> None:
    depth, prov, ws = calibrate_depth(
        T, x_unit="nm", time_unit="s", method="rate", sputter_rate=1.0
    )
    np.testing.assert_allclose(depth, T)
    assert ws[0]["code"] == "unit-override" and ws[0]["confirm"] is True
    assert prov["time_unit"] == "s" and prov["time_unit_source"] == "stated"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"method": "rate"},
        {"method": "rate", "sputter_rate": -1.0},
        {"method": "rate", "sputter_rate": math.nan},
        {"method": "crater"},
        {"method": "crater", "crater_depth": 0.0},
        {"method": "crater", "crater_depth": 5.0, "total_time": 0.0},
        {"method": "rate", "sputter_rate": 1.0, "rate_unit": "nm"},
        {"method": "rate", "sputter_rate": 1.0, "depth_unit": "furlong"},
        {"method": "magic"},
    ],
)
def test_calibration_refusals(kwargs: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        calibrate_depth(T, x_unit="s", **kwargs)  # type: ignore[arg-type]


def test_non_monotonic_and_negative_time_are_reported() -> None:
    _, _, ws = calibrate_depth(
        np.array([-1.0, 2.0, 1.0]), x_unit="s", method="rate", sputter_rate=1.0
    )
    assert set(_codes(ws)) == {"negative-time", "reordered"}


# ── background ──────────────────────────────────────────────────────────────


def test_background_subtracts_each_species_region_mean_and_skips_the_reference() -> None:
    x = np.array([0.0, 1.0, 2.0, 3.0])
    v = np.array([[10.0, 100.0], [8.0, 100.0], [3.0, 200.0], [5.0, 200.0]])
    out, prov, ws = subtract_background(x, v, lo=3.0, hi=2.0, labels=["B", "Si"], skip=[1])
    np.testing.assert_allclose(out[:, 0], [6.0, 4.0, -1.0, 1.0])  # mean(3, 5) = 4
    np.testing.assert_allclose(out[:, 1], v[:, 1])
    assert prov["levels"] == {"B": 4.0} and prov["region"] == [2.0, 3.0]
    assert ws == []


def test_background_ignores_blanks_and_reports_a_species_with_none_in_region() -> None:
    x = np.array([0.0, 1.0, 2.0])
    v = np.array([[1.0, 5.0], [np.nan, np.nan], [3.0, np.nan]])
    out, prov, ws = subtract_background(x, v, lo=1.0, hi=2.0, labels=["B", "P"])
    np.testing.assert_allclose(out[:, 0], [-2.0, np.nan, 0.0])
    np.testing.assert_allclose(out[:, 1], v[:, 1])
    assert prov["levels"]["P"] is None
    assert ws[0]["code"] == "no-background" and ws[0]["columns"] == ["P"]


def test_background_refuses_an_empty_region() -> None:
    with pytest.raises(ValueError, match="no rows"):
        subtract_background(T, np.ones((5, 1)), lo=100.0, hi=200.0, labels=["B"])
    with pytest.raises(ValueError, match="out of range"):
        subtract_background(T, np.ones((5, 1)), lo=0.0, hi=20.0, labels=["B"], skip=[3])


def test_process_background_leaves_kept_columns_and_the_reference_alone() -> None:
    # Without normalization, the matrix signal is kept only when asked --
    # its region mean is the matrix level, not a floor.
    res = process_sims(_profile(), background=BackgroundSpec(lo=30.0, hi=40.0, keep=(1,)))
    np.testing.assert_allclose(res.data.values[:, 1], _profile().values[:, 1])
    np.testing.assert_allclose(res.data.values[:, 0], [47.0, 17.0, 7.0, -1.0, 1.0])
    assert res.stages[0]["unchanged"] == ["Si"]
    both = process_sims(
        _profile(),
        background=BackgroundSpec(lo=30.0, hi=40.0, keep=(1,)),
        normalization=NormalizationSpec(reference=1),
    )
    assert both.stages[0]["unchanged"] == ["Si"]  # listed once


# ── normalization ───────────────────────────────────────────────────────────


def test_normalization_is_rsf_times_ratio_and_keeps_the_reference_raw() -> None:
    v = np.array([[2.0, 4.0, 10.0], [3.0, 0.0, 30.0], [1.0, 1.0, 0.0]])
    out, units, prov, ws = normalize_to_reference(
        v,
        2,
        labels=["B", "P", "Si"],
        units=["c/s"] * 3,
        rsf=[1e20, None, None],
        rsf_unit="atoms/cm3",
    )
    np.testing.assert_allclose(out[:, 0], [2e19, 1e19, np.nan])  # 2/10, 3/30 x 1e20
    np.testing.assert_allclose(out[:, 1], [0.4, 0.0, np.nan])
    np.testing.assert_allclose(out[:, 2], v[:, 2])
    assert units == ["atoms/cm3", "ratio to Si", "c/s"]
    assert prov["rsf"] == {"B": 1e20, "P": None} and prov["reference"] == "Si"
    assert ws[0]["code"] == "blank-output" and ws[0]["count"] == 1


@pytest.mark.parametrize(
    "kwargs",
    [
        {"ref": 3},
        {"ref": 0, "rsf": [1.0]},
        {"ref": 0, "rsf": [None, -2.0], "rsf_unit": "x"},
        {"ref": 0, "rsf": [None, 2.0]},  # an RSF needs its output unit
    ],
)
def test_normalization_refusals(kwargs: dict[str, object]) -> None:
    ref = kwargs.pop("ref")
    with pytest.raises(ValueError):
        normalize_to_reference(np.ones((3, 2)), ref, labels=["a", "b"], units=["", ""], **kwargs)  # type: ignore[arg-type]


# ── smoothing ───────────────────────────────────────────────────────────────


def test_smoothing_never_smears_a_blank_and_matches_smooth_data_per_run() -> None:
    col = np.array([1.0, 5.0, 3.0, np.nan, 2.0, 8.0, 4.0, 6.0])
    x = np.arange(col.size, dtype=float)
    out, prov, ws = smooth_profiles(x, col.reshape(-1, 1), method="moving", window=1)
    assert np.isnan(out[3, 0])
    np.testing.assert_allclose(out[:3, 0], smooth_data(col[:3], method="moving", window=1))
    np.testing.assert_allclose(out[4:, 0], smooth_data(col[4:], method="moving", window=1))
    assert prov == {"stage": "smoothing", "method": "moving", "half_width": 1}
    assert ws == []


def test_smoothing_reports_a_non_uniform_grid() -> None:
    x = np.array([0.0, 1.0, 2.0, 5.0, 6.0])
    _, _, ws = smooth_profiles(x, np.ones((5, 1)), method="gaussian", window=1)
    assert _codes(ws) == ["non-uniform-grid"]


# ── the chained process ─────────────────────────────────────────────────────


def _profile() -> DataStruct:
    return DataStruct.create(
        T,
        np.array([[50.0, 1000.0], [20.0, 1000.0], [10.0, 2000.0], [2.0, 2000.0], [4.0, 2000.0]]),
        labels=["B", "Si"],
        units=["c/s", "c/s"],
        metadata={
            "x_column_name": "Time",
            "x_column_unit": "s",
            "sims_processing": [{"stage": "older"}],
        },
    )


def test_process_chains_stages_in_order_with_provenance() -> None:
    res = process_sims(
        _profile(),
        calibration=CalibrationSpec(method="rate", sputter_rate=2.0),
        # Region in DEPTH (after calibration): 60..80 nm = the last two rows.
        background=BackgroundSpec(lo=60.0, hi=80.0),
        normalization=NormalizationSpec(reference=1, rsf=[5e22, None], rsf_unit="atoms/cm3"),
    )
    d = res.data
    np.testing.assert_allclose(d.time, [0.0, 20.0, 40.0, 60.0, 80.0])
    # B - 3 (mean of 2, 4), then / Si * 5e22.
    expect = (
        (np.array([50.0, 20.0, 10.0, 2.0, 4.0]) - 3.0)
        / np.array([1000, 1000, 2000, 2000, 2000])
        * 5e22
    )
    np.testing.assert_allclose(d.values[:, 0], expect)
    np.testing.assert_allclose(
        d.values[:, 1], [1000, 1000, 2000, 2000, 2000]
    )  # reference untouched
    assert d.units == ("atoms/cm3", "c/s")
    assert x_unit_of(d) == "nm" and d.metadata["x_column_name"] == "Depth"
    stages = [s["stage"] for s in d.metadata["sims_processing"]]
    assert stages == ["older", "calibration", "background", "normalization"]
    assert _codes(res.warnings) == ["non-positive"]  # B(60 nm) = -1 after background


def test_process_refuses_nothing_to_do_and_categorical_input() -> None:
    with pytest.raises(ValueError, match="at least one"):
        process_sims(_profile())
    cat = DataStruct.create([0, 1], [[0.0], [1.0]], labels=["phase"], cat_levels={0: ("a", "b")})
    with pytest.raises(ValueError, match="categorical"):
        process_sims(cat, smoothing=SmoothingSpec())


def test_process_leaves_the_source_unchanged() -> None:
    src = _profile()
    before = src.values.copy()
    process_sims(src, background=BackgroundSpec(lo=0.0, hi=10.0), smoothing=SmoothingSpec(window=1))
    np.testing.assert_array_equal(src.values, before)
    assert src.metadata["sims_processing"] == [{"stage": "older"}]


# ── parser: a raw sputter-TIME export is labelled as time ──────────────────


@pytest.mark.parametrize(
    ("header", "name", "unit"),
    [
        ("Time (s)", "Time", "s"),
        ("Sputter time [min]", "Time", "min"),
        ("Time", "Time", ""),
        ("Depth (nm)", "Depth", "nm"),
    ],
)
def test_import_sims_labels_a_time_axis(tmp_path: Path, header: str, name: str, unit: str) -> None:
    f = tmp_path / "sims_time.csv"
    f.write_text(f"SIMS raw counts\n{header},B (c/s),Si (c/s)\n0,10,1000\n1,12,1000\n2,9,1000\n")
    ds = import_sims(f)
    assert ds.metadata["x_column_name"] == name
    assert ds.metadata["x_column_unit"] == unit
