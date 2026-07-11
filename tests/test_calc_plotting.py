"""Unit tests for calc.plotting's `resolve_style_channels` (MAIN #13's
per-series `fill` CHANNEL reference resolver — the glue between the wire-level
channel indices `export_figures.FigureRequest.series_styles` carries and the
display-position values `calc.figure`'s pure renderer expects)."""

from __future__ import annotations

import numpy as np

from quantized.calc.plotting import resolve_style_channels
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


def test_default_y_keys_is_every_channel_in_order() -> None:
    # y_keys=None -> plotted = [0, 1, 2]; vs=2 is the THIRD display series.
    out = resolve_style_channels(_ds(), None, [{"fill": {"vs": 2}}, None, None])
    assert out is not None
    assert out[0] == {"fill": {"vs": 2}}


def test_original_dict_is_not_mutated() -> None:
    spec = {"fill": {"vs": 1}}
    resolve_style_channels(_ds(), [1], [spec])
    assert spec == {"fill": {"vs": 1}}  # the input dict is untouched
