"""2-D map publication rendering (calc.figure_map): contour + 3-D export.

Rendering can't be pixel-asserted, so the tests check that every kind/format
produces a valid, non-trivial file (right magic bytes), that level computation
is correct (lin/log/explicit), and that malformed input is rejected.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.figure_map import (
    MAP_KINDS,
    _contour_levels,  # noqa: PLC2701 (internal, tested directly)
    render_map_figure,
)

_MAGIC = {"pdf": b"%PDF", "svg": b"<?xml", "png": b"\x89PNG"}


def _demo_grid() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    x = np.linspace(-2.0, 2.0, 24)
    y = np.linspace(-1.0, 3.0, 18)
    xg, yg = np.meshgrid(x, y)
    z = 100.0 * np.exp(-(xg**2 + (yg - 1.0) ** 2))
    z[0, 0] = np.nan  # a gap outside the "hull"
    return x, y, z


@pytest.mark.parametrize("kind", MAP_KINDS)
@pytest.mark.parametrize("fmt", ["png", "pdf", "svg"])
def test_every_kind_and_format_renders(kind: str, fmt: str) -> None:
    x, y, z = _demo_grid()
    data = render_map_figure(x, y, z, kind=kind, fmt=fmt, title=kind,
                             x_label="qx", y_label="qz", z_label="I")
    assert data[: len(_MAGIC[fmt])] == _MAGIC[fmt]
    assert len(data) > 800


def test_contour_levels_linear_log_explicit() -> None:
    lin = _contour_levels(0.0, 10.0, 6, "linear")
    np.testing.assert_allclose(lin, [0, 2, 4, 6, 8, 10])
    log = _contour_levels(1.0, 100.0, 3, "log")
    np.testing.assert_allclose(log, [1.0, 10.0, 100.0])
    explicit = _contour_levels(0.0, 1.0, [0.3, 0.1, 0.9], "linear")
    np.testing.assert_allclose(explicit, [0.1, 0.3, 0.9])  # sorted


def test_contour_log_handles_nonpositive_floor() -> None:
    # z_min <= 0 -> log floor derives from z_max, must not raise or emit NaN
    lv = _contour_levels(-5.0, 1000.0, 4, "log")
    assert np.all(np.isfinite(lv)) and lv[0] > 0 and lv[-1] == 1000.0


def test_render_rejects_bad_shape_and_kind() -> None:
    x, y, z = _demo_grid()
    with pytest.raises(ValueError, match="z_grid must be"):
        render_map_figure(x, y, z[:, :-1], kind="heatmap")
    with pytest.raises(ValueError, match="kind must be"):
        render_map_figure(x, y, z, kind="bogus")
    with pytest.raises(ValueError, match="fmt must be"):
        render_map_figure(x, y, z, fmt="jpg")


def test_render_rejects_all_nan_contour() -> None:
    x = np.linspace(0, 1, 5)
    y = np.linspace(0, 1, 4)
    z = np.full((4, 5), np.nan)
    with pytest.raises(ValueError, match="no finite z-range"):
        render_map_figure(x, y, z, kind="contourf")


def test_levels_count_lower_bound() -> None:
    with pytest.raises(ValueError, match="levels count"):
        _contour_levels(0.0, 1.0, 1, "linear")
    with pytest.raises(ValueError, match="level_scale"):
        _contour_levels(0.0, 1.0, 5, "sqrt")
