"""interpolate2D + regrid2D: golden parity vs MATLAB +utilities."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.interp2d import interpolate2d, regrid2d


def _scattered(g: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    inp = g["input"]
    return (
        np.asarray(inp["x"], dtype=float),
        np.asarray(inp["y"], dtype=float),
        np.asarray(inp["z"], dtype=float),
    )


@pytest.mark.golden
@pytest.mark.parametrize("method", ["linear", "idw", "thinplate"])
def test_interpolate2d_matches_matlab(
    method: str,
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden(f"calc_interp2d_{method}.json")
    x, y, z = _scattered(g)
    xq = np.asarray(g["input"]["xq"], dtype=float)
    yq = np.asarray(g["input"]["yq"], dtype=float)
    out = interpolate2d(x, y, z, xq, yq, method=method)
    compare_calc(out, g["output"])


@pytest.mark.golden
def test_regrid2d_idw_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden("calc_regrid_idw.json")
    x, y, z = _scattered(g)
    xq, yq, zq = regrid2d(x, y, z, nx=8, ny=8, method="idw")
    np.testing.assert_allclose(xq, np.asarray(g["output"]["Xq"], dtype=float), rtol=1e-9, atol=1e-9)
    np.testing.assert_allclose(yq, np.asarray(g["output"]["Yq"], dtype=float), rtol=1e-9, atol=1e-9)
    np.testing.assert_allclose(zq, np.asarray(g["output"]["Zq"], dtype=float), rtol=1e-9, atol=1e-9)


def test_interpolate2d_nearest_returns_node_values() -> None:
    # Nearest-neighbour matches MATLAB except at Voronoi-cell boundaries (tie-break
    # differs between scipy KDTree and MATLAB scatteredInterpolant), so it is tested
    # structurally: every result is one of the input node values.
    x = np.array([0.1, 0.9, 0.5, 0.2, 0.8, 0.4])
    y = np.array([0.2, 0.3, 0.8, 0.6, 0.7, 0.1])
    z = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    xq, yq = np.meshgrid(np.linspace(0.2, 0.8, 4), np.linspace(0.2, 0.8, 4))
    out = interpolate2d(x, y, z, xq, yq, method="nearest")["zq"]
    assert set(np.unique(out[~np.isnan(out)])).issubset(set(z.tolist()))


def test_interpolate2d_idw_reproduces_nodes() -> None:
    # IDW returns the exact node value when queried at a data point.
    x = np.array([0.0, 1.0, 0.0, 1.0, 0.5])
    y = np.array([0.0, 0.0, 1.0, 1.0, 0.5])
    z = np.array([1.0, 2.0, 3.0, 4.0, 9.0])
    out = interpolate2d(x, y, z, np.array([0.5]), np.array([0.5]), method="idw")
    assert out["zq"][0] == pytest.approx(9.0)


def test_interpolate2d_too_few_points() -> None:
    with pytest.raises(ValueError, match="at least 3"):
        interpolate2d([0.0, 1.0], [0.0, 1.0], [0.0, 1.0], [0.5], [0.5])


def test_thinplate_singular_raises_valueerror() -> None:
    # Collinear data (all points on y = x) makes the thin-plate system singular;
    # it must surface as a clean ValueError, not an unhandled LinAlgError.
    x = np.array([0.0, 1.0, 2.0, 3.0])
    y = np.array([0.0, 1.0, 2.0, 3.0])
    z = np.array([0.0, 1.0, 4.0, 9.0])
    with pytest.raises(ValueError, match="singular"):
        interpolate2d(x, y, z, np.array([1.5]), np.array([1.5]), method="thinplate")


def test_regrid2d_shape_and_extent() -> None:
    x = np.array([0.0, 1.0, 0.0, 1.0, 0.5])
    y = np.array([0.0, 0.0, 1.0, 1.0, 0.5])
    z = np.array([1.0, 2.0, 3.0, 4.0, 2.5])
    xq, yq, zq = regrid2d(x, y, z, nx=10, ny=6, method="idw")
    assert xq.shape == (6, 10)
    assert zq.shape == (6, 10)
    assert xq.min() == pytest.approx(0.0)
    assert xq.max() == pytest.approx(1.0)


# ── robustness: real-world scattered data with NaN gaps (corpus audit) ────────


def test_regrid2d_drops_nonfinite_triples() -> None:
    """A NaN in x, y, or z drops that triple instead of crashing the grid.

    scatteredInterpolant/griddata reject non-finite nodes; real instrument maps
    have NaN gaps, so regrid2d must filter them and still grid the finite rest.
    """
    x = np.array([0.0, 1.0, 0.0, 1.0, 0.5, np.nan])
    y = np.array([0.0, 0.0, 1.0, 1.0, 0.5, 0.5])
    z = np.array([1.0, 2.0, 3.0, 4.0, 2.5, 7.0])
    xq, yq, zq = regrid2d(x, y, z, nx=8, ny=8, method="idw")
    assert xq.shape == (8, 8)
    # The auto-extent comes from the finite x only (max 1.0), not the NaN.
    assert xq.max() == pytest.approx(1.0)
    assert np.isfinite(zq).any()


def test_regrid2d_constant_axis_reports_clearly() -> None:
    """A constant y axis (1-D profile mis-mapped as 2-D) gives a clear error."""
    x = np.array([0.0, 1.0, 2.0, 3.0])
    y = np.array([5.0, 5.0, 5.0, 5.0])  # no range
    z = np.array([1.0, 2.0, 3.0, 4.0])
    with pytest.raises(ValueError, match="y axis has no range"):
        regrid2d(x, y, z, nx=8, ny=8, method="idw")
