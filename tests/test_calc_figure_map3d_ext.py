"""3-D bars and vectors (``calc.figure_map3d_ext``): geometry, defaults and the
refusals, each with a reason a user can act on."""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from quantized.calc.figure_map import render_map_figure
from quantized.calc.figure_map3d_ext import (
    HEAD_SPREAD,
    MAX_BARS,
    MAX_VECTORS,
    bar_footprint,
    prepare_bars,
    prepare_vectors,
    vector_extent,
    vector_segments,
)

GRID = ([0.0, 1.0, 2.0, 3.0], [10.0, 20.0, 30.0], [[1, 2, 3, 4], [2, 4, 6, None], [3, 6, 9, 1]])
PTS: dict[str, Any] = {
    "x_axis": [0, 1, 2], "y_axis": [0, 1, 0], "z_values": [0, 1, 2], "contour_source": "points",
}
MAGIC = b"\x89PNG"


def _bars(**kw: Any) -> bytes:
    return render_map_figure(*GRID, kind="bars3d", fmt="png", **kw)  # type: ignore[arg-type]


def _vecs(ext: dict[str, Any], **kw: Any) -> bytes:
    return render_map_figure(
        PTS["x_axis"], PTS["y_axis"], None, kind="vectors3d", fmt="png",
        contour_source="points", z_values=PTS["z_values"], ext=ext, **kw,
    )


def test_bars_render_from_a_grid_and_from_columns() -> None:
    assert _bars(ext={})[:4] == MAGIC
    d = render_map_figure(
        [0, 1, 2, 0, 1, 2], [0, 0, 0, 5, 5, 5], None, kind="bars3d", fmt="svg",
        contour_source="points", z_values=[1, 2, 3, 4, 5, 6],
        ext={"bar_color": "#336699", "bar_width": 0.5},
    )
    assert b"<svg" in d[:400]


def test_vectors_render_in_both_forms() -> None:
    d = {"vec_dx": [1, 0, 1], "vec_dy": [0, 1, 1], "vec_dz": [1, 1, 0]}
    assert _vecs(d)[:4] == MAGIC
    assert _vecs({**d, "vec_form": "end", "vec_scale": 2.0, "vec_color": "#aa3311"})[:4] == MAGIC


def test_footprint_is_a_fraction_of_the_median_step() -> None:
    x = np.array([0.0, 1.0, 2.0, 4.0, 4.0])
    y = np.array([0.0, 10.0, 10.0, 20.0, 20.0])
    dx, dy = bar_footprint(x, y, 0.5, 1.0)
    assert (dx, dy) == pytest.approx((0.5 * 1.0, 10.0))  # steps 1, 1, 2 -> median 1


@pytest.mark.parametrize("bad", [0.0, -0.1, 1.5, float("nan")])
def test_a_bar_fraction_outside_zero_to_one_is_refused(bad: float) -> None:
    with pytest.raises(ValueError, match="bar_width must be"):
        bar_footprint(np.array([0.0, 1.0]), np.array([0.0, 1.0]), bad, 0.5)


def test_bars_that_cannot_be_sized_are_refused() -> None:
    with pytest.raises(ValueError, match="at least 2 distinct x positions"):
        render_map_figure(
            [1, 1], [0, 1], None, kind="bars3d", fmt="png", contour_source="points",
            z_values=[1, 2], ext={},
        )


def test_too_many_bars_are_refused_not_sampled() -> None:
    n = MAX_BARS + 1
    z = np.zeros(n)
    with pytest.raises(ValueError, match="at most 10,000 bars"):
        prepare_bars(np.arange(n, dtype=float), np.arange(n, dtype=float), z, {})


def test_no_finite_bar_a_bad_colour_and_a_bad_base_are_refused() -> None:
    e = np.array([])
    with pytest.raises(ValueError, match="at least 1 finite bar"):
        prepare_bars(e, e, e, {})
    one = np.array([0.0, 1.0])
    with pytest.raises(ValueError, match="#rrggbb"):
        prepare_bars(one, one, one, {"bar_color": "red"})
    with pytest.raises(ValueError, match="bar_base"):
        prepare_bars(one, one, one, {"bar_base": float("inf")})


def test_a_bar_grid_of_all_gaps_is_refused() -> None:
    with pytest.raises(ValueError, match="at least 1 finite bar"):
        render_map_figure(
            [0, 1], [0, 1], [[None, None], [None, None]], kind="bars3d", fmt="png", ext={}
        )


def test_bar_grid_shape_mismatch_is_refused() -> None:
    with pytest.raises(ValueError, match=r"z_grid must be \(ny, nx\)"):
        render_map_figure([0, 1, 2], [0, 1], [[1, 2], [3, 4]], kind="bars3d", fmt="png", ext={})


def test_vectors_need_their_columns_and_point_sources() -> None:
    with pytest.raises(ValueError, match="vec_dx, vec_dy and vec_dz"):
        _vecs({})
    with pytest.raises(ValueError, match="contour_source='points'"):
        render_map_figure(
            [0, 1], [0, 1], [[1, 2], [3, 4]], kind="vectors3d", fmt="png",
            ext={"vec_dx": [1], "vec_dy": [1], "vec_dz": [1]},
        )
    with pytest.raises(ValueError, match="one value per row"):
        _vecs({"vec_dx": [1], "vec_dy": [1], "vec_dz": [1]})


def test_vectors_with_no_length_or_gaps_are_not_drawn_and_none_left_is_refused() -> None:
    x = np.array([0.0, 1.0, 2.0])
    ext = {"vec_dx": [0.0, 1.0, None], "vec_dy": [0.0, 0.0, 1.0], "vec_dz": [0.0, 0.0, 1.0]}
    tails, tips = prepare_vectors(x, x, x, ext)
    assert tails.shape == (1, 3)  # the zero row and the gap row are not drawn
    np.testing.assert_allclose(tips - tails, [[1.0, 0.0, 0.0]])
    with pytest.raises(ValueError, match="non-zero length"):
        prepare_vectors(x, x, x, {"vec_dx": [0, 0, 0], "vec_dy": [0, 0, 0], "vec_dz": [0, 0, 0]})


@pytest.mark.parametrize(
    ("key", "val", "msg"),
    [("vec_scale", 0.0, "vec_scale"), ("vec_head", 0.9, "vec_head"), ("vec_form", "x", "vec_form"),
     ("vec_color", "blue", "#rrggbb")],
)
def test_bad_vector_options_are_refused(key: str, val: Any, msg: str) -> None:
    x = np.array([0.0, 1.0])
    ext = {"vec_dx": [1, 1], "vec_dy": [1, 1], "vec_dz": [1, 1], key: val}
    with pytest.raises(ValueError, match=msg):
        prepare_vectors(x, x, x, ext)


def test_too_many_vectors_are_refused() -> None:
    n = MAX_VECTORS + 1
    x = np.arange(n, dtype=float)
    ones = np.ones(n)
    with pytest.raises(ValueError, match="at most 20,000"):
        prepare_vectors(x, x, x, {"vec_dx": ones, "vec_dy": ones, "vec_dz": ones})


def test_end_form_is_tail_to_end_and_scale_multiplies_the_delta() -> None:
    t = np.array([1.0, 1.0])
    ext = {"vec_dx": [3.0, 3.0], "vec_dy": [1.0, 1.0], "vec_dz": [1.0, 1.0],
           "vec_form": "end", "vec_scale": 2.0}
    tails, tips = prepare_vectors(t, t, t, ext)
    np.testing.assert_allclose(tips - tails, [[4.0, 0.0, 0.0]] * 2)


def test_the_arrowhead_sits_on_the_tip_with_the_asked_length_in_box_space() -> None:
    tails, tips = np.array([[0.0, 0.0, 0.0]]), np.array([[2.0, 4.0, 6.0]])
    lim = vector_extent(tails, tips)
    seg = vector_segments(tails, tips, lim, 0.25)[0]
    np.testing.assert_allclose(seg[0], [[0, 0, 0], [2, 4, 6]])
    box = np.array([1.0, 1.0, 0.75])
    span = np.array([b - a for a, b in lim])

    def to_box(p: np.ndarray) -> np.ndarray:
        return np.asarray(p / span * box, dtype=float)

    shaft = np.linalg.norm(to_box(seg[0, 1]) - to_box(seg[0, 0]))
    for k in range(1, 5):
        np.testing.assert_allclose(seg[k, 0], [2, 4, 6])  # every barb starts at the tip
        barb = to_box(seg[k, 1]) - to_box(seg[k, 0])
        # back along the shaft by head * length, spread by HEAD_SPREAD of that
        assert np.linalg.norm(barb) == pytest.approx(
            0.25 * shaft * np.sqrt(1 + HEAD_SPREAD**2), rel=1e-9
        )


def test_new_kinds_do_not_join_the_standard_kind_registry() -> None:
    from quantized.calc.figure_map import MAP_KINDS

    assert "bars3d" not in MAP_KINDS and "vectors3d" not in MAP_KINDS


def test_log_scale_bars_label_by_value() -> None:
    z = [[-3.0, -2.0], [-1.0, 0.0]]
    assert _bars_log(z)[:4] == MAGIC


def _bars_log(z: list[list[float]]) -> bytes:
    return render_map_figure(
        [0, 1], [0, 1], z, kind="bars3d", fmt="png", colorbar_log10=True,
        ext={"bar_base": -4.0}, z_label="I - log",
    )
