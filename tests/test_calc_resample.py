"""resampleData: golden parity vs MATLAB +utilities/resampleData."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.resample import resample_data
from quantized.datastruct import DataStruct


def _input_ds(g: dict[str, Any]) -> DataStruct:
    return DataStruct.create(
        np.asarray(g["input"]["time"], dtype=float),
        np.asarray(g["input"]["values"], dtype=float),
    )


@pytest.mark.golden
@pytest.mark.parametrize("method", ["linear", "pchip", "spline", "makima"])
def test_resample_method_matches_matlab(
    method: str,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden(f"calc_resample_{method}.json")
    out = resample_data(_input_ds(g), n_points=int(g["params"]["npoints"]), method=method)
    assert_allclose(out.time, np.asarray(g["output"]["time"], dtype=float), rtol=1e-9, atol=1e-9)
    assert_allclose(
        out.values, np.asarray(g["output"]["values"], dtype=float), rtol=1e-9, atol=1e-9
    )


@pytest.mark.golden
def test_resample_step_grid_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden("calc_resample_step.json")
    out = resample_data(_input_ds(g), step=float(g["params"]["step"]), method="makima")
    assert_allclose(out.time, np.asarray(g["output"]["time"], dtype=float), rtol=1e-9, atol=1e-9)
    assert_allclose(
        out.values, np.asarray(g["output"]["values"], dtype=float), rtol=1e-9, atol=1e-9
    )


def test_resample_default_is_500_points() -> None:
    ds = DataStruct.create(np.linspace(0.0, 10.0, 11), np.sin(np.linspace(0.0, 10.0, 11)))
    out = resample_data(ds)
    assert out.n_points == 500
    assert out.metadata["resampled"] is True
    assert out.metadata["resampleMethod"] == "makima"


def test_resample_multi_mode_raises() -> None:
    ds = DataStruct.create([0.0, 1.0, 2.0], [0.0, 1.0, 2.0])
    with pytest.raises(ValueError, match="only one"):
        resample_data(ds, n_points=10, step=0.5)


def test_resample_too_few_points() -> None:
    ds = DataStruct.create([1.0], [2.0])
    with pytest.raises(ValueError, match="at least 2"):
        resample_data(ds, n_points=10)


def test_resample_match_dataset() -> None:
    src = DataStruct.create(np.linspace(0.0, 10.0, 11), np.linspace(0.0, 20.0, 11))
    ref = DataStruct.create(np.linspace(0.0, 10.0, 7), np.zeros(7))
    out = resample_data(src, match_dataset=ref, method="linear")
    assert_allclose(out.time, ref.time)
    # linear interp of a line is exact.
    assert_allclose(out.values[:, 0], 2.0 * ref.time)


# ── robustness: real-world data the sanitizer must repair (corpus audit) ──────


def test_resample_drops_nan_in_values() -> None:
    """A NaN gap in y is ignored (MATLAB interp1 behaviour), not propagated."""
    x = np.linspace(0.0, 10.0, 11)
    y = 2.0 * x
    y[5] = np.nan  # puncture the middle
    out = resample_data(DataStruct.create(x, y), n_points=21, method="linear")
    # Linear interp across the gap recovers the underlying line exactly.
    assert np.isfinite(out.values).all()
    assert_allclose(out.values[:, 0], 2.0 * out.time, atol=1e-9)


def test_resample_sorts_unsorted_x() -> None:
    """A hysteresis-style non-monotonic x is sorted before interpolation."""
    x = np.array([0.0, 3.0, 1.0, 4.0, 2.0, 5.0])
    y = 10.0 * x
    out = resample_data(DataStruct.create(x, y), n_points=11, method="linear")
    assert_allclose(out.values[:, 0], 10.0 * out.time, atol=1e-9)


def test_resample_averages_duplicate_x() -> None:
    """Repeated x values (step profiles) collapse to their mean y."""
    x = np.array([0.0, 1.0, 1.0, 2.0])
    y = np.array([0.0, 5.0, 15.0, 20.0])  # duplicate x=1 -> mean 10
    out = resample_data(DataStruct.create(x, y), grid=[0.0, 1.0, 2.0], method="linear")
    assert_allclose(out.values[:, 0], [0.0, 10.0, 20.0], atol=1e-9)


def test_resample_too_few_finite_points_is_nan_not_crash() -> None:
    """A channel with <2 finite points yields NaN, never an exception."""
    x = np.linspace(0.0, 5.0, 6)
    y = np.full(6, np.nan)
    y[0] = 1.0  # only one finite point
    out = resample_data(DataStruct.create(x, y), n_points=4, method="pchip")
    assert np.isnan(out.values[:, 0]).all()


def test_resample_nan_in_x_axis_uses_finite_range() -> None:
    """A NaN in the x axis must not collapse the auto-grid to all-NaN."""
    x = np.linspace(0.0, 10.0, 11)
    x[3] = np.nan
    y = 2.0 * np.linspace(0.0, 10.0, 11)
    out = resample_data(DataStruct.create(x, y), n_points=21, method="linear")
    assert np.isfinite(out.time).all()
    assert float(out.time[0]) == 0.0
    assert float(out.time[-1]) == 10.0


def test_resample_clean_data_untouched_by_sanitizer() -> None:
    """The sanitizer is a no-op on clean strictly-increasing finite data."""
    x = np.linspace(0.0, 10.0, 11)
    y = x**2
    out = resample_data(DataStruct.create(x, y), n_points=11, method="linear")
    assert_allclose(out.time, x)
    assert_allclose(out.values[:, 0], y)


@pytest.mark.parametrize("mode", ["default", "n_points", "step", "grid", "match"])
def test_resample_refuses_every_new_grid_mode_when_a_channel_is_categorical(mode: str):
    """BUG-005: no grid entry point may silently interpolate level codes."""
    data = DataStruct.create(
        [0.0, 1.0, 2.0, 3.0],
        [[1.0, 0.0], [2.0, 1.0], [3.0, 0.0], [4.0, 1.0]],
        labels=["Y", "Phase"],
        units=["", ""],
        metadata={"operator": "Ada", "text_columns": {"note": ["a", "b", "c", "d"]}},
        cat_levels={1: ("alpha", "beta")},
        level_order={1: (1, 0)},
    )
    before = data.to_dict()
    kwargs: dict[str, Any]
    if mode == "default":
        kwargs = {}
    elif mode == "n_points":
        kwargs = {"n_points": 7}
    elif mode == "step":
        kwargs = {"step": 0.5}
    elif mode == "grid":
        kwargs = {"grid": [0.5, 1.5, 2.5]}
    else:
        kwargs = {
            "match_dataset": DataStruct.create([0.5, 1.5, 2.5], [[0.0], [0.0], [0.0]])
        }

    with pytest.raises(ValueError, match=r"categorical channel\(s\).*Phase"):
        resample_data(data, method="linear", **kwargs)

    assert data.to_dict() == before, "a refused resample must not mutate its source"


def test_resample_keeps_cat_levels_on_a_coincident_grid():
    """BUG-005: interpolation onto the SAME x grid returns its input, so the
    level codes are untouched and the table still describes the output. The
    unconditional drop discarded it anyway."""
    data = DataStruct.create(
        [0.0, 1.0, 2.0, 3.0],
        [[10.0, 0.0], [20.0, 1.0], [30.0, 0.0], [40.0, 1.0]],
        labels=["Y", "Phase"],
        units=["", ""],
        metadata={"operator": "Ada", "text_columns": {"note": ["a", "b", "c", "d"]}},
        cat_levels={1: ("alpha", "beta")},
        level_order={1: (1, 0)},
    )

    out = resample_data(data, grid=[0.0, 1.0, 2.0, 3.0], method="linear")

    assert out.cat_levels == {1: ("alpha", "beta")}
    assert out.level_order == {1: (1, 0)}
    np.testing.assert_array_equal(out.values[:, 1], [0.0, 1.0, 0.0, 1.0])
    assert out.metadata["operator"] == "Ada"
    assert out.metadata["text_columns"] == {"note": ["a", "b", "c", "d"]}


def test_resample_coincident_grid_is_a_true_identity_even_with_duplicate_x_and_nan():
    data = DataStruct.create(
        [0.0, 1.0, 1.0, 2.0],
        [[10.0, 0.0], [20.0, 1.0], [float("nan"), 0.0], [40.0, 1.0]],
        labels=["Y", "Phase"],
        metadata={"text_columns": {"note": ["a", "b", "c", "d"]}},
        cat_levels={1: ("alpha", "beta")},
    )

    out = resample_data(data, grid=data.time, method="linear")

    np.testing.assert_array_equal(out.values, data.values, strict=True)
    assert out.metadata["text_columns"] == data.metadata["text_columns"]
    assert out.cat_levels == data.cat_levels


def test_resample_refuses_a_new_grid_even_when_interpolation_would_reproduce_codes():
    """Arithmetic coincidence must not bypass the new-grid refusal."""
    # A CONSTANT categorical column: linear interpolation reproduces it exactly.
    constant = DataStruct.create(
        [0.0, 1.0, 2.0],
        [[10.0, 2.0], [20.0, 2.0], [30.0, 2.0]],
        labels=["Y", "Phase"],
        units=["", ""],
        cat_levels={1: ("a", "b", "c")},
    )
    with pytest.raises(ValueError, match="different grid"):
        resample_data(constant, grid=[0.5, 1.0, 1.5], method="linear")

    # A STEP-like column whose new points all land in flat regions.
    stepped = DataStruct.create(
        [0.0, 1.0, 10.0, 11.0],
        [[1.0, 0.0], [2.0, 0.0], [3.0, 1.0], [4.0, 1.0]],
        labels=["Y", "Phase"],
        units=["", ""],
        cat_levels={1: ("a", "b")},
    )
    with pytest.raises(ValueError, match="different grid"):
        resample_data(stepped, grid=[0.5, 0.9, 10.2, 10.8], method="linear")
