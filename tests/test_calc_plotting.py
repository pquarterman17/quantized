"""Unit tests for calc.plotting's `resolve_style_channels` (MAIN #13/#14's
per-series `fill`/`color_by` CHANNEL reference resolver — the glue between the
wire-level channel indices `export_figures.FigureRequest.series_styles`
carries and the display-position / concrete-array values `calc.figure`'s pure
renderer expects)."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.plotting import build_grouped_series, resolve_style_channels
from quantized.datastruct import DataStruct


def _ds() -> DataStruct:
    values = [[1.0, 10.0, 100.0], [2.0, 20.0, 200.0], [3.0, 30.0, 300.0], [4.0, 40.0, 400.0]]
    return DataStruct(
        time=np.arange(4.0),
        values=np.array(values),
        labels=("a", "b", "c"),
        units=("", "", ""),
        metadata={},
    )


def test_none_series_styles_pass_through() -> None:
    assert resolve_style_channels(_ds(), None, None) is None


def test_none_and_empty_entries_stay_none() -> None:
    out = resolve_style_channels(_ds(), None, [None, {}])
    assert out == [None, None]


def test_fill_vs_resolves_to_display_position() -> None:
    # y_keys=[0, 2] (channels a, c) plotted as display series 0, 1.
    out = resolve_style_channels(_ds(), [0, 2], [{"fill": {"vs": 2}}, None])
    assert out is not None
    assert out[0] == {"fill": {"vs": 1}}  # channel 2 ("c") is display position 1


def test_fill_vs_not_plotted_is_dropped() -> None:
    out = resolve_style_channels(_ds(), [0, 2], [{"fill": {"vs": 1}, "color": "#fff"}])
    assert out is not None
    assert "fill" not in out[0]  # channel 1 ("b") isn't plotted -> no band
    assert out[0]["color"] == "#fff"  # other keys are untouched


def test_fill_under_is_untouched() -> None:
    out = resolve_style_channels(_ds(), None, [{"fill": "under"}])
    assert out == [{"fill": "under"}]


def test_color_by_resolves_to_concrete_array() -> None:
    out = resolve_style_channels(_ds(), [0], [{"color_by": 2}])
    assert out is not None
    assert out[0]["color_by"] == [100.0, 200.0, 300.0, 400.0]


def test_color_by_need_not_be_plotted() -> None:
    # channel 1 ("b") isn't in y_keys but color_by still resolves -- it's an
    # auxiliary z-column, independent of the x/y channel picks.
    out = resolve_style_channels(_ds(), [0], [{"color_by": 1}])
    assert out is not None
    assert out[0]["color_by"] == [10.0, 20.0, 30.0, 40.0]


def test_color_by_out_of_range_is_dropped() -> None:
    out = resolve_style_channels(_ds(), None, [{"color_by": 99, "colormap": "magma"}])
    assert out is not None
    assert "color_by" not in out[0]
    assert out[0]["colormap"] == "magma"


def test_default_y_keys_is_every_channel_in_order() -> None:
    # y_keys=None -> plotted = [0, 1, 2]; vs=2 is the THIRD display series.
    out = resolve_style_channels(_ds(), None, [{"fill": {"vs": 2}}, None, None])
    assert out is not None
    assert out[0] == {"fill": {"vs": 2}}


def test_original_dict_is_not_mutated() -> None:
    spec = {"fill": {"vs": 1}}
    resolve_style_channels(_ds(), [1], [spec])
    assert spec == {"fill": {"vs": 1}}  # the input dict is untouched


# ── build_grouped_series (GUI_INTERACTION #12 Slice 5) ──────────────────────
# Faithful port of the frontend's lib/plotspec.ts buildXY colour-split
# algorithm -- see the function's own docstring for the exact algorithm
# match (level sort, (yChannel, level) nesting, finite-masking, label
# format).


def _parity_ds() -> DataStruct:
    """The SAME tiny fixture as the frontend's plotspec.test.ts
    cross-language parity test ("cross-language parity fixture: matches the
    backend's build_grouped_series exactly") -- keep both in sync by hand if
    either changes; a drift between buildXY and this port is exactly what
    this pair of tests exists to catch. Row 2's NaN VALUE proves per-series
    finite-masking applies independently of the group match; row 4's NaN
    GROUP proves a non-finite group value is dropped from `levels` (never
    becomes its own series)."""
    return DataStruct(
        time=np.array([0.0, 1.0, 2.0, 3.0, 4.0]),
        values=np.array(
            [[10.0, 1.0], [20.0, 2.0], [np.nan, 1.0], [40.0, 2.0], [50.0, np.nan]]
        ),
        labels=("Value", "Group"),
        units=("V", ""),
        metadata={},
    )


def test_build_grouped_series_matches_frontend_parity_fixture() -> None:
    plot = build_grouped_series(_parity_ds(), None, [0], 1)
    assert [s.label for s in plot.series] == ["Value (Group=1)", "Value (Group=2)"]
    assert [s.unit for s in plot.series] == ["V", "V"]
    assert [s.axis for s in plot.series] == [0, 0]
    np.testing.assert_array_equal(
        plot.series[0].values, np.array([10.0, np.nan, np.nan, np.nan, np.nan])
    )
    np.testing.assert_array_equal(
        plot.series[1].values, np.array([np.nan, 20.0, np.nan, 40.0, np.nan])
    )
    np.testing.assert_array_equal(plot.x, np.array([0.0, 1.0, 2.0, 3.0, 4.0]))
    assert plot.x_label == "x"  # no x_key -> derives from metadata, same as build_series


def test_build_grouped_series_group_col_resolves_by_label_too() -> None:
    plot = build_grouped_series(_parity_ds(), None, [0], "Group")
    assert [s.label for s in plot.series] == ["Value (Group=1)", "Value (Group=2)"]


def test_build_grouped_series_orders_by_y_channel_then_level() -> None:
    # Nesting order matters: outer loop is yChannels (given order), inner
    # loop is levels (sorted) -- must match buildXY so screen and export
    # series lists stay aligned.
    ds = DataStruct(
        time=np.array([0.0, 1.0, 2.0, 3.0]),
        values=np.array(
            [[1.0, 2.0, 10.0], [3.0, 4.0, 20.0], [5.0, 6.0, 10.0], [7.0, 8.0, 20.0]]
        ),
        labels=("A", "B", "G"),
        units=("", "", ""),
        metadata={},
    )
    plot = build_grouped_series(ds, None, [0, 1], 2)
    assert [s.label for s in plot.series] == [
        "A (G=10)",
        "A (G=20)",
        "B (G=10)",
        "B (G=20)",
    ]


def test_build_grouped_series_explicit_x_key() -> None:
    ds = DataStruct(
        time=np.array([0.0, 1.0, 2.0, 3.0]),
        values=np.array(
            [[100.0, 1.0, 10.0], [200.0, 2.0, 20.0], [300.0, 3.0, 10.0], [400.0, 4.0, 20.0]]
        ),
        labels=("X", "Value", "G"),
        units=("s", "V", ""),
        metadata={},
    )
    plot = build_grouped_series(ds, 0, [1], 2)
    assert plot.x_label == "X"
    np.testing.assert_array_equal(plot.x, np.array([100.0, 200.0, 300.0, 400.0]))


def test_build_grouped_series_bad_group_col_raises() -> None:
    with pytest.raises(ValueError):
        build_grouped_series(_parity_ds(), None, [0], 99)
