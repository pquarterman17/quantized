"""Data-driven marks in the export (gap audit 3, N5 + N6).

N5 -- marker SIZE driven by a column: ``size_by`` (a resolved per-row array),
``size_range`` ([min, max] marker diameter in points) and a size key in the
exported figure. N6 -- ``drop_lines`` (to the X axis / Y axis) and
``connect: "spline"`` (natural cubic spline through the points, only where X is
strictly ascending; otherwise straight segments plus a warning, so a hysteresis
loop keeps its acquisition order).
"""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

from quantized.calc.figure import draw_series_axes, render_figure  # noqa: E402
from quantized.calc.figure_marks import spline_dense  # noqa: E402
from quantized.calc.figure_sizes import size_diameters  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402
from quantized.calc.figure_warnings import collect_figure_warnings  # noqa: E402
from quantized.calc.plotting import resolve_style_channels  # noqa: E402
from quantized.datastruct import DataStruct  # noqa: E402

X = np.array([1.0, 2.0, 3.0, 4.0])
Y = [10.0, 20.0, 15.0, 30.0]


def _draw(spec: dict[str, object], x: np.ndarray = X, y: list[float] = Y, **kw: object):
    fig, ax = plt.subplots()
    st = figure_style("aps")
    draw_series_axes(fig, ax, x, [("A", y)], st=st, ov={}, series_styles=[spec], **kw)
    return fig, ax


# --------------------------------------------------------------------------- N5


def test_size_diameters_maps_range_linearly() -> None:
    d = size_diameters({"size_by": [0.0, 5.0, 10.0], "size_range": [4.0, 12.0]}, 3)
    assert d is not None
    np.testing.assert_allclose(d, [4.0, 8.0, 12.0])


def test_size_diameters_default_range_nonfinite_and_degenerate() -> None:
    d = size_diameters({"size_by": [1.0, float("nan"), 3.0]}, 3)
    assert d is not None
    assert d[0] == pytest.approx(3.0) and d[2] == pytest.approx(14.0) and np.isnan(d[1])
    flat = size_diameters({"size_by": [2.0, 2.0]}, 2)
    assert flat is not None
    np.testing.assert_allclose(flat, [8.5, 8.5])  # a constant column reads mid-range
    assert size_diameters({}, 3) is None


def test_size_by_scatter_sizes_are_squared_diameters_in_points() -> None:
    _, ax = _draw({"color": "#ff0000", "size_by": [0.0, 1.0, 2.0, 4.0], "size_range": [4.0, 12.0]})
    sc = [c for c in ax.collections if hasattr(c, "get_sizes")]
    assert len(sc) == 1
    np.testing.assert_allclose(sc[0].get_sizes(), [16.0, 36.0, 64.0, 144.0])
    # An unstyled series keeps today's draw: no scatter overlay.
    _, plain = _draw({"color": "#ff0000"})
    assert not [c for c in plain.collections if hasattr(c, "get_sizes")]


def test_size_by_draws_a_size_key_titled_with_the_channel() -> None:
    _, ax = _draw(
        {"size_by": [0.0, 1.0, 2.0, 4.0], "size_range": [4.0, 12.0], "size_label": "Mass (g)"}
    )
    legends = [c for c in ax.get_children() if c.__class__.__name__ == "Legend"]
    assert len(legends) == 1
    assert legends[0].get_title().get_text() == "Mass (g)"
    texts = [t.get_text() for t in legends[0].get_texts()]
    assert texts[0] == "0" and texts[-1] == "4"  # the data range's ends


def test_size_by_with_color_by_sizes_the_colour_mapped_points() -> None:
    _, ax = _draw(
        {
            "color_by": [1.0, 2.0, 3.0, 4.0],
            "size_by": [0.0, 1.0, 2.0, 4.0],
            "size_range": [4.0, 12.0],
        }
    )
    sc = [c for c in ax.collections if hasattr(c, "get_sizes")]
    np.testing.assert_allclose(sc[0].get_sizes(), [16.0, 36.0, 64.0, 144.0])


def test_resolve_style_channels_resolves_size_by_and_label() -> None:
    ds = DataStruct.create(
        np.array([0.0, 1.0, 2.0]),
        np.array([[1.0, 5.0], [2.0, 6.0], [3.0, 7.0]]),
        labels=["y", "mass"],
        units=["", "g"],
    )
    out = resolve_style_channels(ds, [0], [{"size_by": 1, "size_range": [3, 9]}])
    assert out is not None and out[0] is not None
    assert out[0]["size_by"] == [5.0, 6.0, 7.0]
    assert out[0]["size_label"] == "mass (g)"
    bad = resolve_style_channels(ds, [0], [{"size_by": 9}])
    assert bad is not None and bad[0] is not None and "size_by" not in bad[0]
    junk = resolve_style_channels(ds, [0], [{"size_by": "mass", "size_range": "big"}])
    assert junk is not None and junk[0] is not None and "size_by" not in junk[0]
    # a junk range never reaches matplotlib as anything but the default
    d = size_diameters({"size_by": [0.0, 1.0], "size_range": "big"}, 2)
    assert d is not None and d[0] == 3.0 and d[1] == 14.0


def test_size_by_series_renders_to_pdf_bytes() -> None:
    out = render_figure(
        X, [("A", Y)], fmt="pdf",
        series_styles=[{"size_by": [0.0, 1.0, 2.0, 4.0], "size_label": "m"}],
    )
    assert out[:4] == b"%PDF"


# --------------------------------------------------------------------------- N6


def test_spline_dense_passes_through_the_knots_and_is_dense() -> None:
    out = spline_dense(X, np.array(Y))
    assert out is not None
    xd, yd, knots = out
    assert len(xd) == 3 * 16 + 1
    np.testing.assert_allclose(xd[knots], X)
    np.testing.assert_allclose(yd[knots], Y)


def test_spline_dense_matches_scipy_natural_cubic_spline() -> None:
    from scipy.interpolate import CubicSpline

    out = spline_dense(X, np.array(Y))
    assert out is not None
    xd, yd, _ = out
    np.testing.assert_allclose(yd, CubicSpline(X, Y, bc_type="natural")(xd), atol=1e-12)


def test_spline_dense_refuses_non_monotonic_x_and_short_series() -> None:
    loop = np.array([0.0, 1.0, 2.0, 1.0, 0.0])
    assert spline_dense(loop, np.array([0.0, 1.0, 0.0, -1.0, 0.0])) is None
    assert spline_dense(np.array([1.0, 2.0]), np.array([1.0, 2.0])) is None
    assert spline_dense(np.array([1.0, 1.0, 2.0]), np.array([1.0, 2.0, 3.0])) is None  # tie


def test_spline_dense_splits_at_gaps() -> None:
    x = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0])
    y = np.array([1.0, 3.0, 2.0, np.nan, 5.0, 4.0, 6.0])
    out = spline_dense(x, y)
    assert out is not None
    xd, yd, _ = out
    assert np.isnan(yd).sum() == 1  # one break between the two runs of >= 3 / 3 points
    assert np.isnan(xd).sum() == 1  # the separator row


def test_spline_connect_draws_a_dense_line_and_markers_only_at_knots() -> None:
    _, ax = _draw({"connect": "spline", "marker": True})
    (line,) = ax.lines
    assert len(line.get_xdata()) == 3 * 16 + 1
    assert list(line.get_markevery()) == [0, 16, 32, 48]


def test_spline_on_non_monotonic_x_stays_straight_in_row_order_and_warns() -> None:
    loop = np.array([0.0, 1.0, 2.0, 1.0, 0.0])
    with collect_figure_warnings() as notes:
        _, ax = _draw({"connect": "spline"}, x=loop, y=[0.0, 1.0, 0.0, -1.0, 0.0])
    (line,) = ax.lines
    np.testing.assert_allclose(line.get_xdata(), loop)  # row order, not resampled
    assert any("spline" in n.lower() and "monotonic" in n.lower() for n in notes)


def test_drop_lines_to_x_axis_run_from_each_point_to_the_axis_bottom() -> None:
    fig, ax = _draw({"drop_lines": "x"})
    seg = [c for c in ax.collections if c.__class__.__name__ == "LineCollection"]
    assert len(seg) == 1
    ylo = ax.get_ylim()[0]
    paths = [np.asarray(s) for s in seg[0].get_segments()]
    assert len(paths) == 4
    for p, xv, yv in zip(paths, X, Y, strict=True):
        np.testing.assert_allclose(p, [[xv, yv], [xv, ylo]])
    plt.close(fig)


def test_drop_lines_to_y_axis_run_to_the_axis_left_and_both_gives_two_sets() -> None:
    _, ax = _draw({"drop_lines": "y"})
    (coll,) = [c for c in ax.collections if c.__class__.__name__ == "LineCollection"]
    xlo = ax.get_xlim()[0]
    for p, xv, yv in zip(coll.get_segments(), X, Y, strict=True):
        np.testing.assert_allclose(p, [[xv, yv], [xlo, yv]])
    _, both = _draw({"drop_lines": "both"})
    assert len([c for c in both.collections if c.__class__.__name__ == "LineCollection"]) == 2


def test_drop_lines_skip_nonfinite_points_and_unstyled_draws_none() -> None:
    _, ax = _draw({"drop_lines": "x"}, y=[10.0, float("nan"), 15.0, 30.0])
    (coll,) = [c for c in ax.collections if c.__class__.__name__ == "LineCollection"]
    assert len(coll.get_segments()) == 3
    _, plain = _draw({})
    assert not [c for c in plain.collections if c.__class__.__name__ == "LineCollection"]


def test_drop_line_series_renders_to_svg() -> None:
    out = render_figure(
        X, [("A", Y)], fmt="svg", series_styles=[{"drop_lines": "both", "connect": "spline"}]
    )
    assert b"<svg" in out


# ------------------------------------------------- x-break panels, secondary axis


def test_x_break_figure_warns_that_marks_are_not_drawn() -> None:
    x = np.linspace(0.0, 10.0, 20)
    for style in ({"connect": "spline"}, {"size_by": [1.0] * 20}, {"drop_lines": "x"}):
        with collect_figure_warnings() as notes:
            out = render_figure(
                x, [("a", x * 2)], fmt="png", series_styles=[style],
                overrides={"x_breaks": [[4.0, 6.0]]},
            )
        assert out[:4] == b"\x89PNG"
        assert any("break" in n.lower() and "not drawn" in n.lower() for n in notes), style
    with collect_figure_warnings() as plain:
        render_figure(x, [("a", x)], fmt="png", overrides={"x_breaks": [[4.0, 6.0]]})
    assert not plain


def test_secondary_axis_series_draw_drop_lines_on_the_secondary_axes(monkeypatch) -> None:
    import quantized.calc.figure_y2 as y2

    seen: list[tuple[object, list[object]]] = []
    real = y2.apply_drop_lines

    def spy(ax: object, drops: list[object]) -> None:
        seen.append((ax, list(drops)))
        real(ax, drops)  # type: ignore[arg-type]

    monkeypatch.setattr(y2, "apply_drop_lines", spy)
    with collect_figure_warnings() as notes:
        render_figure(
            X, [("a", Y), ("b", [1.0, 2.0, 3.0, 4.0])], fmt="png", y2_mask=[False, True],
            series_styles=[None, {"drop_lines": "both"}],
        )
    assert len(seen) == 1 and len(seen[0][1]) == 1
    assert not notes  # drawn, so nothing to warn about


# ----------------------------------------------------------------- the wire


def _api_dataset(time: list[float]) -> dict[str, object]:
    return {
        "time": time,
        "values": [[t * 2.0, float(i)] for i, t in enumerate(time)],
        "labels": ["M", "mass"],
        "units": ["emu", "g"],
        "metadata": {},
    }


def test_figure_route_accepts_size_by_drop_lines_and_spline() -> None:
    from fastapi.testclient import TestClient

    from quantized.app import app

    resp = TestClient(app).post(
        "/api/export/figure",
        json={
            "dataset": _api_dataset([1.0, 2.0, 3.0, 4.0]),
            "fmt": "png",
            "y_keys": [0],
            "series_styles": [
                {"size_by": 1, "size_range": [4, 12], "drop_lines": "both", "connect": "spline"}
            ],
        },
    )
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert not resp.headers.get("X-Figure-Warnings")


def test_figure_route_warns_when_a_loop_cannot_be_a_spline() -> None:
    from fastapi.testclient import TestClient

    from quantized.app import app

    resp = TestClient(app).post(
        "/api/export/figure",
        json={
            "dataset": _api_dataset([0.0, 1.0, 2.0, 1.0, 0.0]),
            "fmt": "png",
            "y_keys": [0],
            "series_styles": [{"connect": "spline"}],
        },
    )
    assert resp.status_code == 200
    assert "monotonic" in resp.headers.get("X-Figure-Warnings", "").lower()
