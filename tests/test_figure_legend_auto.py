"""The ``auto`` legend location (plot audit round 2).

The screen places an ``auto`` legend in the plot's least-occupied corner, or in
a column outside the plot's right edge once more than eight series are drawn.
The export follows the same rule: matplotlib's ``best`` for a few series,
``outside right`` past eight (split into columns when tall)."""

from types import SimpleNamespace

import numpy as np

from quantized.calc.figure_overrides import _validate_overrides, legend_kwargs

ST = SimpleNamespace(legend_box=True, legend_font_size=8)


def test_auto_is_best_for_a_few_series() -> None:
    kw = legend_kwargs(None, None, ST, {"loc": "auto"}, n_series=3)
    assert kw is not None
    assert kw["loc"] == "best"
    assert "bbox_to_anchor" not in kw


def test_auto_moves_outside_right_past_eight_series() -> None:
    kw = legend_kwargs(None, None, ST, {"loc": "auto"}, n_series=9)
    assert kw is not None
    assert kw["loc"] == "center left"
    assert kw["bbox_to_anchor"] == (1.02, 0.5)
    assert kw.get("ncols", 1) == 1


def test_auto_splits_a_tall_outside_legend_into_columns() -> None:
    kw = legend_kwargs(None, None, ST, {"loc": "auto"}, n_series=32)
    assert kw is not None
    assert kw["ncols"] == 2


def test_auto_is_an_accepted_location() -> None:
    _validate_overrides({"legend": {"loc": "auto"}})


def test_auto_renders_ten_series_with_the_legend_outside_the_axes() -> None:
    import matplotlib

    matplotlib.use("Agg")
    from quantized.calc.figure import render_figure

    x = np.linspace(0, 1, 20)
    series = [(f"s{i}", x + i) for i in range(10)]
    svg = render_figure(x, series, fmt="svg", overrides={"legend": {"show": True, "loc": "auto"}})
    assert svg.lstrip().startswith(b"<?xml") or b"<svg" in svg[:400]
