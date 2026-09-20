"""Correction pipeline: golden parity vs MATLAB bosonPlotter.applyCorrections."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.corrections import apply_corrections
from quantized.datastruct import DataStruct, level_of


def _raw(g: dict[str, Any], labels: list[str], units: list[str]) -> DataStruct:
    return DataStruct.create(
        np.asarray(g["input"]["time"], dtype=float),
        np.asarray(g["input"]["values"], dtype=float),
        labels=labels,
        units=units,
    )


@pytest.mark.golden
def test_corrections_xrd_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden("calc_corrections_xrd.json")
    out = apply_corrections(
        _raw(g, ["I"], ["cps"]),
        {
            "xOff": 2.0, "yOff": 5.0, "bgSlope": 0.5, "bgInt": 100,
            "xTrimMin": 15, "xTrimMax": 75, "smoothEnabled": True, "smoothWindow": 5,
            "smoothMethod": "moving", "normMethod": "Peak (max=1)", "derivativeMode": "None",
        },
    )
    assert_allclose(out.time, np.asarray(g["output"]["time"], dtype=float), rtol=1e-9, atol=1e-9)
    assert_allclose(
        out.values[:, 0], np.asarray(g["output"]["values"], dtype=float), rtol=1e-9, atol=1e-9
    )


@pytest.mark.golden
def test_corrections_derivative_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden("calc_corrections_deriv.json")
    out = apply_corrections(
        _raw(g, ["I"], ["cps"]),
        {"bgSlope": 0.5, "bgInt": 100, "derivativeMode": "dY/dX"},
    )
    assert_allclose(out.values[:, 0], np.asarray(g["output"]["values"], dtype=float),
                    rtol=1e-9, atol=1e-9)


@pytest.mark.golden
def test_corrections_magnetometry_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden("calc_corrections_mag.json")
    out = apply_corrections(
        _raw(g, ["M"], ["emu"]),
        {
            "bgSlope": 0.001, "bgInt": 0, "isMag": True,
            "fieldUnit": "T", "momentUnit": "emu/g", "sampleMass": 2.0,
        },
    )
    assert_allclose(out.time, np.asarray(g["output"]["time"], dtype=float), rtol=1e-9, atol=1e-12)
    assert_allclose(out.values[:, 0], np.asarray(g["output"]["values"], dtype=float),
                    rtol=1e-9, atol=1e-12)


@pytest.mark.golden
def test_corrections_bg_from_file_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    """BG-from-file: subtract an interpolated reference-background dataset.

    Covers applyCorrections step 4 across all three interp methods. The active
    x-range [0,10] overhangs the bg range [2,8], so the 0-fill extrapolation
    outside the bg domain is exercised; two channels cover the per-channel loop.
    """
    g = load_golden("calc_bgfromfile.json")
    active = DataStruct.create(
        np.asarray(g["input"]["active"]["time"], dtype=float),
        np.asarray(g["input"]["active"]["values"], dtype=float),
        labels=["A", "B"],
        units=["u", "u"],
    )
    bg = DataStruct.create(
        np.asarray(g["input"]["bg"]["time"], dtype=float),
        np.asarray(g["input"]["bg"]["values"], dtype=float),
        labels=["bg"],
        units=["u"],
    )
    for case in g["cases"]:
        out = apply_corrections(active, {}, bg_dataset=bg, bg_interp=case["interp"])
        exp_time = np.asarray(case["time"], dtype=float)
        exp_vals = np.asarray(case["values"], dtype=float)  # (60, 2)
        assert_allclose(out.time, exp_time, rtol=1e-9, atol=1e-9,
                        err_msg=f"time mismatch for interp={case['interp']}")
        assert_allclose(out.values, exp_vals, rtol=1e-9, atol=1e-9,
                        err_msg=f"values mismatch for interp={case['interp']}")


def test_corrections_bg_from_file_zero_fill_outside_range() -> None:
    """Outside the bg x-range the subtraction is 0, so those points pass through."""
    x = np.linspace(0.0, 10.0, 21)
    y = np.full_like(x, 100.0)
    active = DataStruct.create(x, y, labels=["I"], units=["cps"])
    bg = DataStruct.create(np.array([4.0, 5.0, 6.0]), np.array([10.0, 10.0, 10.0]))
    out = apply_corrections(active, {}, bg_dataset=bg, bg_interp="linear")
    # x < 4 and x > 6 -> 0-fill -> unchanged 100; inside [4,6] -> 100 - 10 = 90.
    inside = (x >= 4.0) & (x <= 6.0)
    assert_allclose(out.values[~inside, 0], 100.0)
    assert_allclose(out.values[inside, 0], 90.0)


def test_corrections_trim_and_offset() -> None:
    x = np.linspace(0.0, 10.0, 11)
    y = np.arange(11.0)
    ds = DataStruct.create(x, y)
    out = apply_corrections(ds, {"xTrimMin": 2.0, "xTrimMax": 8.0, "xOff": 1.0})
    # trim keeps x in [2,8] (7 points), then x -= 1
    assert out.time[0] == pytest.approx(1.0)
    assert out.time[-1] == pytest.approx(7.0)
    assert out.n_points == 7


def test_corrections_neutron_scales_r() -> None:
    x = np.linspace(0.01, 0.2, 20)
    r = np.linspace(1.0, 0.01, 20)
    ds = DataStruct.create(x, r, labels=["R"], units=[""])
    out = apply_corrections(ds, {"isNeutron": True, "yOff": 2.0})
    assert_allclose(out.values[:, 0], r * 2.0)  # R-scale, not BG subtraction


def test_corrections_identity() -> None:
    x = np.linspace(0.0, 5.0, 50)
    y = np.sin(x)
    ds = DataStruct.create(x, y)
    out = apply_corrections(ds, {})  # all defaults -> no-op (bgSlope/bgInt/yOff = 0)
    assert_allclose(out.values[:, 0], y, atol=1e-12)


# --- MAIN_PLAN #37: arbitrary non-destructive X/Y rescaling -----------------


def test_rescale_absent_is_identity() -> None:
    x = np.linspace(1.0, 5.0, 20)
    y = np.cos(x)
    ds = DataStruct.create(x, y)
    out = apply_corrections(ds, {})
    assert_allclose(out.time, x)
    assert_allclose(out.values[:, 0], y, atol=1e-12)


def test_rescale_unity_is_identity() -> None:
    """An explicit 1.0 must be a true no-op, not a float round-trip."""
    x = np.linspace(1.0, 5.0, 20)
    y = np.cos(x)
    ds = DataStruct.create(x, y)
    out = apply_corrections(ds, {"xScale": 1.0, "yScale": 1.0})
    assert_allclose(out.time, x, atol=0)
    assert_allclose(out.values[:, 0], y, atol=0)


def test_rescale_multiplies_x_and_y() -> None:
    x = np.linspace(1.0, 5.0, 20)
    y = np.linspace(2.0, 9.0, 20)
    ds = DataStruct.create(x, y)
    out = apply_corrections(ds, {"xScale": 0.1, "yScale": 1000.0})
    assert_allclose(out.time, x * 0.1)
    assert_allclose(out.values[:, 0], y * 1000.0)


def test_rescale_division_is_the_reciprocal_multiplier() -> None:
    """The UI stores 1/v for a division; verify that is exactly a divide."""
    x = np.linspace(1.0, 5.0, 10)
    ds = DataStruct.create(x, x * 3.0)
    out = apply_corrections(ds, {"yScale": 1.0 / 3.0})
    assert_allclose(out.values[:, 0], x, atol=1e-12)


def test_rescale_scales_every_channel_so_error_bars_stay_consistent() -> None:
    """A y-channel and its paired error channel must scale together."""
    x = np.linspace(0.0, 1.0, 8)
    y = np.linspace(1.0, 8.0, 8)
    err = np.full(8, 0.5)
    ds = DataStruct.create(x, np.column_stack([y, err]), labels=["M", "dM"], units=["", ""])
    out = apply_corrections(ds, {"yScale": 4.0})
    assert_allclose(out.values[:, 0], y * 4.0)
    assert_allclose(out.values[:, 1], err * 4.0)
    # The ratio is what error bars are drawn from — it must be invariant.
    assert_allclose(out.values[:, 1] / out.values[:, 0], err / y)


def test_rescale_runs_before_trim_so_bounds_are_in_displayed_units() -> None:
    """Trim bounds are picked off the PLOT, so they must mean scaled units."""
    x = np.linspace(0.0, 100.0, 101)  # scaled by 0.1 -> 0..10
    ds = DataStruct.create(x, x)
    out = apply_corrections(ds, {"xScale": 0.1, "xTrimMin": 2.0, "xTrimMax": 4.0})
    assert out.time.min() == pytest.approx(2.0)
    assert out.time.max() == pytest.approx(4.0)
    assert out.n_points == 21  # x = 20..40 step 1 -> 2.0..4.0 step 0.1


def test_rescale_runs_before_x_offset() -> None:
    x = np.linspace(0.0, 10.0, 11)
    ds = DataStruct.create(x, x)
    out = apply_corrections(ds, {"xScale": 2.0, "xOff": 5.0})
    assert_allclose(out.time, x * 2.0 - 5.0)  # scale, THEN subtract the offset


def test_rescale_derivative_uses_both_factors() -> None:
    """The ordering guard: d(y*sy)/d(x*sx) = (sy/sx) dy/dx.

    Scaling AFTER the derivative would multiply by sy alone and silently give
    an answer wrong by a factor of sx. This test is the reason step 0 exists.
    """
    x = np.linspace(0.0, 10.0, 201)
    y = 3.0 * x  # dy/dx = 3
    ds = DataStruct.create(x, y)
    sx, sy = 2.0, 5.0
    out = apply_corrections(ds, {"xScale": sx, "yScale": sy, "derivativeMode": "dY/dX"})
    expected = 3.0 * sy / sx
    assert_allclose(out.values[:, 0], np.full_like(out.values[:, 0], expected), rtol=1e-9)


def test_rescale_is_invisible_to_range_normalization() -> None:
    """Range/peak/z-score normalize the factor away — no interaction."""
    x = np.linspace(0.0, 1.0, 25)
    y = np.sin(x * 3.0) + 2.0
    ds = DataStruct.create(x, y)
    plain = apply_corrections(ds, {"normMethod": "Range [0,1]"})
    scaled = apply_corrections(ds, {"yScale": 250.0, "normMethod": "Range [0,1]"})
    assert_allclose(scaled.values[:, 0], plain.values[:, 0], atol=1e-12)


@pytest.mark.parametrize("bad", [0.0, float("inf"), float("-inf"), float("nan")])
def test_rescale_rejects_zero_and_non_finite(bad: float) -> None:
    ds = DataStruct.create(np.linspace(0.0, 1.0, 5), np.ones(5))
    for key in ("xScale", "yScale"):
        with pytest.raises(ValueError):
            apply_corrections(ds, {key: bad})


def test_rescale_rejects_non_numeric() -> None:
    ds = DataStruct.create(np.linspace(0.0, 1.0, 5), np.ones(5))
    with pytest.raises(ValueError):
        apply_corrections(ds, {"xScale": "abc"})


def test_rescale_error_message_is_ascii() -> None:
    """Non-ASCII in an error string crashes Windows cp1252 log handlers."""
    ds = DataStruct.create(np.linspace(0.0, 1.0, 5), np.ones(5))
    with pytest.raises(ValueError) as exc:
        apply_corrections(ds, {"yScale": 0.0})
    str(exc.value).encode("ascii")  # raises UnicodeEncodeError if it regressed


def test_rescale_negative_factor_flips_sign() -> None:
    """A negative factor is legitimate (inverting a signal), so it is allowed.

    The log-axis consequence is handled upstream, not here: the frontend's
    existing ``log && v <= 0`` extent guard already drops non-positive values
    from a log scale, so a sign-flipped series degrades the same way any other
    non-positive data does. Nothing about rescaling needs its own log rule.
    """
    x = np.linspace(1.0, 5.0, 10)
    y = np.linspace(2.0, 20.0, 10)
    ds = DataStruct.create(x, y)
    out = apply_corrections(ds, {"yScale": -1.0})
    assert_allclose(out.values[:, 0], -y)


def test_rescale_composes_with_offset_and_trim_in_scaled_units() -> None:
    """End-to-end ordering check across three interacting corrections."""
    x = np.linspace(0.0, 100.0, 101)
    ds = DataStruct.create(x, np.ones_like(x))
    out = apply_corrections(
        ds, {"xScale": 0.1, "xTrimMin": 2.0, "xTrimMax": 4.0, "xOff": 2.0}
    )
    # scale -> 0..10, trim -> 2..4, then subtract the offset -> 0..2.
    assert out.time[0] == pytest.approx(0.0)
    assert out.time[-1] == pytest.approx(2.0)


def _mixed_categorical() -> DataStruct:
    return DataStruct.create(
        [1.0, 2.0, 3.0],
        [[10.0, 0.0], [20.0, 1.0], [30.0, 0.0]],
        labels=["Y", "Phase"],
        units=["V", ""],
        metadata={"operator": "Ada"},
        cat_levels={1: ("alpha", "beta")},
        level_order={0: (30, 20, 10), 1: (1, 0)},
    )


def test_corrections_keeps_cat_levels_when_the_codes_did_not_move():
    data = _mixed_categorical()

    out = apply_corrections(data, {})

    assert out.cat_levels == {1: ("alpha", "beta")}
    np.testing.assert_array_equal(out.values, data.values)  # nothing moved


def test_corrections_keeps_cat_levels_through_a_pure_row_trim():
    """A trim SELECTS rows; it never touches a value, so every surviving code
    still indexes the table. The categorical mask follows the same row selection
    as numeric data while all later y transforms skip those codes."""
    data = DataStruct.create(
        [0.0, 1.0, 2.0, 3.0],
        [[1.0, 0.0], [2.0, 1.0], [3.0, 0.0], [4.0, 1.0]],
        labels=["Y", "Phase"],
        units=["", ""],
        cat_levels={1: ("alpha", "beta")},
    )

    out = apply_corrections(data, {"xTrimMin": 1.0, "xTrimMax": 2.0})

    assert out.values.shape[0] == 2, "the trim really did drop rows"
    assert out.cat_levels == {1: ("alpha", "beta")}
    np.testing.assert_array_equal(out.values[:, 1], [1.0, 0.0])


def test_footprint_skips_both_categorical_and_dq_channels():
    data = DataStruct.create(
        [0.5, 1.0],
        [[1.0, 0.0, 0.1], [2.0, 1.0, 0.2]],
        labels=["R", "Phase", "dq"],
        units=["", "", ""],
        cat_levels={1: ("alpha", "beta")},
    )

    out = apply_corrections(
        data, {"footprintW": 10.0, "footprintL": 20.0, "footprintTwoTheta": True}
    )

    assert not np.array_equal(out.values[:, 0], data.values[:, 0]), "ch0 really moved"
    np.testing.assert_array_equal(out.values[:, 1], data.values[:, 1])
    np.testing.assert_array_equal(out.values[:, 2], data.values[:, 2])
    assert out.cat_levels == {1: ("alpha", "beta")}


def test_corrections_keeps_cat_levels_for_an_x_only_shift():
    """An x offset moves the GRID, never a value, so every code still indexes the
    table. Third of the three real preservation cases, alongside the identity and
    the trim."""
    data = DataStruct.create(
        [0.0, 1.0],
        [[1.0, 0.0], [2.0, 1.0]],
        labels=["Y", "Phase"],
        units=["", ""],
        cat_levels={1: ("alpha", "beta")},
    )

    out = apply_corrections(data, {"xOff": 2.0})

    np.testing.assert_array_equal(out.time, [-2.0, -1.0])  # xOff SUBTRACTS, measured
    assert out.cat_levels == {1: ("alpha", "beta")}


def test_corrections_y_offset_changes_numeric_values_not_categorical_codes():
    data = _mixed_categorical()

    out = apply_corrections(data, {"yOff": 5.0})

    np.testing.assert_array_equal(out.values[:, 0], [5.0, 15.0, 25.0])
    np.testing.assert_array_equal(out.values[:, 1], data.values[:, 1])
    assert out.cat_levels == data.cat_levels


@pytest.mark.parametrize(
    "params",
    [
        pytest.param({"derivativeMode": "dY/dX"}, id="derivative"),
        pytest.param({"derivativeMode": "d²Y/dX²"}, id="second-derivative"),
        pytest.param({"derivativeMode": "∫Y dx"}, id="integral"),
        pytest.param({"derivativeMode": "dlog/dlog"}, id="log-derivative"),
        pytest.param(
            {"smoothEnabled": True, "smoothMethod": "moving", "smoothWindow": 3},
            id="smooth",
        ),
        pytest.param({"normMethod": "Range [0,1]"}, id="norm-range"),
        pytest.param({"normMethod": "Peak (max=1)"}, id="norm-peak"),
        pytest.param({"normMethod": "Z-score"}, id="norm-zscore"),
        pytest.param({"normMethod": "Area (integral=1)"}, id="norm-area"),
        pytest.param({"yScale": 1000.0}, id="y-scale"),
        pytest.param({"yOff": 5.0}, id="y-offset"),
        pytest.param({"bgSlope": 1.0, "bgInt": 2.0}, id="linear-background"),
        pytest.param({"bgPoly": [1.0, 0.0, 1.0]}, id="polynomial-background"),
        pytest.param(
            {"bgAnchors": [[1.0, 1.0], [3.0, 2.0]], "bgAnchorMethod": "linear"},
            id="anchor-background",
        ),
        pytest.param({"isNeutron": True, "yOff": 2.0}, id="neutron-scale"),
        pytest.param(
            {"isMag": True, "momentUnit": "emu/g", "sampleMass": 2.0}, id="mass-normalize"
        ),
        pytest.param(
            {"isMag": True, "momentUnit": "emu/cm³", "sampleVolume": 2.0},
            id="volume-normalize",
        ),
        pytest.param({"isMag": True, "momentUnit": "A·m²"}, id="unit-convert"),
        pytest.param(
            {"footprintW": 10.0, "footprintL": 20.0, "footprintTwoTheta": True},
            id="footprint",
        ),
    ],
)
def test_every_y_transform_skips_categorical_channels(params):
    """BUG-005 regression matrix: every pipeline leg must respect the mask."""
    data = _mixed_categorical()

    out = apply_corrections(data, params)

    assert not np.array_equal(out.values[:, 0], data.values[:, 0]), params
    np.testing.assert_array_equal(out.values[:, 1], data.values[:, 1])
    assert out.cat_levels == {1: ("alpha", "beta")}
    assert out.level_order == {1: (1, 0)}
    assert level_of(out, 1, 0.0) == "alpha"
    assert out.metadata["operator"] == "Ada"


def test_corrections_preserves_category_contract_when_a_trim_keeps_no_rows():
    data = DataStruct.create(
        [0.0, 1.0],
        [[1.0, 0.0], [2.0, 1.0]],
        labels=["Y", "Phase"],
        units=["", ""],
        cat_levels={1: ("a", "b")},
    )

    out = apply_corrections(data, {"xTrimMin": 99.0})

    assert out.values.shape[0] == 0
    assert out.cat_levels == {1: ("a", "b")}


def test_corrections_carries_level_order_with_the_table_it_belongs_to():
    """Review MEDIUM 3: `level_order` names level CODES, so its validity
    condition is IDENTICAL to `cat_levels`'. Keeping one without the other left a
    new incoherent state — an identity correction returned the labels but
    silently reset the user's chosen ORDER, which `calc/plotting.py`'s
    `_ordered_levels` reads to keep the screen and an exported PDF agreeing about
    series colours, legend order and z-order."""
    data = DataStruct.create(
        [0.0, 1.0],
        [[1.0, 0.0], [2.0, 1.0]],
        labels=["Y", "Phase"],
        units=["", ""],
        cat_levels={1: ("a", "b")},
        level_order={1: (1, 0)},
    )

    kept = apply_corrections(data, {})
    assert kept.cat_levels == {1: ("a", "b")}
    assert kept.level_order == {1: (1, 0)}

    # A y correction changes only numeric channels; the categorical table and
    # its display order remain attached to the untouched codes.
    moved = apply_corrections(data, {"yOff": 5.0})
    assert moved.cat_levels == {1: ("a", "b")}
    assert moved.level_order == {1: (1, 0)}
    np.testing.assert_array_equal(moved.values[:, 1], data.values[:, 1])


def test_reference_background_subtracts_only_numeric_channels():
    data = _mixed_categorical()
    bg = DataStruct.create([1.0, 2.0, 3.0], [[1.0], [2.0], [3.0]])

    out = apply_corrections(data, {}, bg_dataset=bg)

    np.testing.assert_array_equal(out.values[:, 0], [9.0, 18.0, 27.0])
    np.testing.assert_array_equal(out.values[:, 1], data.values[:, 1])
    assert out.cat_levels == data.cat_levels


def test_all_categorical_dataset_is_a_safe_pass_through_for_y_corrections():
    data = DataStruct.create(
        [1.0, 2.0, 3.0],
        [[0.0], [1.0], [0.0]],
        labels=["Phase"],
        cat_levels={0: ("alpha", "beta")},
    )

    out = apply_corrections(
        data,
        {
            "yScale": 1000.0,
            "yOff": 5.0,
            "smoothEnabled": True,
            "smoothMethod": "moving",
            "smoothWindow": 3,
            "normMethod": "Z-score",
            "derivativeMode": "dY/dX",
        },
    )

    np.testing.assert_array_equal(out.values, data.values)
    assert out.cat_levels == data.cat_levels


def test_corrections_drops_a_minus_one_level_order_when_x_moves():
    """`-1` is the x column and has no `cat_levels` entry to key off, so it
    survives only while the x values themselves do. An x offset moves them."""
    data = DataStruct.create(
        [0.0, 1.0],
        [[1.0, 0.0], [2.0, 1.0]],
        labels=["Y", "Phase"],
        units=["", ""],
        level_order={-1: (1, 0)},
    )

    assert apply_corrections(data, {}).level_order == {-1: (1, 0)}
    assert apply_corrections(data, {"xOff": 2.0}).level_order is None
