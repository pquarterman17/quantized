"""Linear regrid of a band-shaped cloud (plot-correctness audit 2026-10-02).

A PIXcel3D snapshot RSM is a DIAGONAL BAND: the 2theta window moves with
omega, so most of the bounding-box output grid lies outside the data's convex
hull. scipy's ``find_simplex`` cannot walk to a point outside the hull and
falls back to scanning every simplex, so the default 200x200 map of
m3learning_rsm.xrdml took ~49 s and blocked the server. Only inside-hull
queries may reach the full triangulation; the answer must not change (outside
the hull is NaN either way).
"""

from __future__ import annotations

import importlib
import time
from pathlib import Path
from types import ModuleType
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose
from scipy.interpolate import griddata

import quantized.calc.interp2d as interp2d
from quantized.calc.interp2d import interpolate2d, regrid2d


def _band_cloud() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Frames of 60 pixels whose x window slides with y (a sheared band)."""
    rows = []
    for i in range(80):
        y = 20.0 + 0.01 * i
        x = np.linspace(40.0 + 0.05 * i, 41.0 + 0.05 * i, 60)
        rows.append(np.c_[x, np.full(60, y)])
    pts = np.vstack(rows)
    z = np.exp(-((pts[:, 0] - 42.5) ** 2) / 0.1 - ((pts[:, 1] - 20.4) ** 2) / 0.01) + 1.0
    return pts[:, 0], pts[:, 1], z


def _modules_using_griddata() -> list[ModuleType]:
    mods: list[ModuleType] = [interp2d]
    try:
        mods.append(importlib.import_module("quantized.calc._hull_query"))
    except ModuleNotFoundError:
        pass
    return mods


def test_linear_queries_outside_hull_never_reach_griddata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    x, y, z = _band_cloud()
    xq, yq = np.meshgrid(np.linspace(x.min(), x.max(), 50), np.linspace(y.min(), y.max(), 40))
    seen: list[int] = []

    def spy(points: Any, values: Any, xi: Any, method: str = "linear", **kw: Any) -> Any:
        if method == "linear":
            seen.append(int(np.asarray(xi).shape[0]))
        return griddata(points, values, xi, method=method, **kw)

    for mod in _modules_using_griddata():
        if hasattr(mod, "griddata"):
            monkeypatch.setattr(mod, "griddata", spy)
    out = interpolate2d(x, y, z, xq, yq, method="linear")["zq"]
    n_inside = int(np.isfinite(out).sum())
    assert seen, "linear interpolation never reached griddata"
    # The band fills well under half its bounding box; only the inside-hull
    # queries (all finite here) may be handed to the full triangulation.
    assert n_inside < 0.6 * xq.size
    assert sum(seen) == n_inside


def test_band_cloud_result_unchanged() -> None:
    x, y, z = _band_cloud()
    xq, yq = np.meshgrid(np.linspace(x.min(), x.max(), 50), np.linspace(y.min(), y.max(), 40))
    ref = griddata(np.c_[x, y], z, np.c_[xq.ravel(), yq.ravel()], method="linear")
    out = interpolate2d(x, y, z, xq, yq, method="linear")["zq"].ravel()
    assert np.array_equal(np.isnan(out), np.isnan(ref))
    assert_allclose(out[~np.isnan(out)], ref[~np.isnan(ref)], rtol=0, atol=1e-12)


def test_collinear_cloud_still_degrades_to_nan() -> None:
    x = np.linspace(0.0, 1.0, 10)
    out = interpolate2d(x, 2 * x, x, np.array([0.5]), np.array([1.0]), method="linear")["zq"]
    assert np.isnan(out).all()


@pytest.mark.realdata
def test_snapshot_rsm_default_map_skips_outside_queries(
    corpus_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from quantized.io import import_auto

    path = corpus_dir / "panalytical" / "xrd" / "m3learning_rsm.xrdml"
    if not path.exists():
        pytest.skip("snapshot RSM corpus file missing")
    ds = import_auto(path)
    seen: list[int] = []

    def spy(points: Any, values: Any, xi: Any, method: str = "linear", **kw: Any) -> Any:
        seen.append(int(np.asarray(xi).shape[0]))
        return griddata(points, values, xi, method=method, **kw)

    monkeypatch.setattr(interp2d, "griddata", spy)
    t0 = time.perf_counter()
    _, _, zq = regrid2d(ds.column("2Theta"), ds.column("Omega"), ds.column("Intensity"),
                        nx=200, ny=200, method="linear")
    assert 0.2 < float(np.isfinite(zq).mean()) < 0.6  # a band, not a full box
    assert sum(seen) <= int(np.isfinite(zq).sum())  # outside queries never searched
    # Loose wall-clock backstop only (was ~49 s unloaded; ~3 s now).
    assert time.perf_counter() - t0 < 120.0
