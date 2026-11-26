"""Curve interpolation against Origin, plus fixtures for functions quantized lacks.

``interp1`` is compared with the Resample transform. ``polyarea`` and ``corr1``
have no quantized implementation yet (plan item 13), so their fixtures are
checked against an independent computation, ready for the lane that builds
them. Skips without the local corpus. Measured on OriginPro 2026b (10.35).
"""

from __future__ import annotations

import numpy as np
import pytest

from _origin_oracle_fixture import load_fixture
from quantized.calc.resample_align import align_resample
from quantized.datastruct import DataStruct

pytestmark = pytest.mark.realdata


def _resampled(method: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    fx = load_fixture("interp1_curve")
    c = fx.input_columns()
    n = fx.planted["n_points"]
    ds = DataStruct.create(time=c["x"][:n], values=c["y"][:n].reshape(-1, 1), labels=("y",))
    res = align_resample(ds, mode="match", match_x=c["xq"], method=method)
    ref = fx.outputs()
    return np.asarray(res.data.values)[:, 0], ref[0], ref[1]


def test_linear_resample_matches_origin_interp1() -> None:
    """Piecewise linear: identical to 1e-16 (measured 1.1e-16)."""
    got, lin, _ = _resampled("linear")
    np.testing.assert_allclose(got, lin, rtol=0, atol=1e-12)


def test_spline_resample_matches_origin_interp1() -> None:
    """Cubic spline, Origin's default not-a-knot end condition, scipy
    ``CubicSpline`` not-a-knot: identical to 3e-15 (measured)."""
    got, _, spl = _resampled("spline")
    np.testing.assert_allclose(got, spl, rtol=0, atol=1e-9)


def test_pchip_is_not_origins_spline() -> None:
    """pchip is a different interpolant: it differs from Origin's cubic spline
    by 0.029. Documents that only ``spline`` is the like-for-like method."""
    got, _, spl = _resampled("pchip")
    assert 0.01 < np.max(np.abs(got - spl)) < 0.05


def test_polyarea_fixture_equals_the_shoelace_area() -> None:
    """No quantized polygon-area function exists (item 13). Origin's
    ``polyarea`` equals the planted shoelace area to 1e-12 for both the
    mathematical (signed) and absolute types on a counter-clockwise polygon."""
    fx = load_fixture("polyarea")
    area = fx.planted["area"]
    assert area > 0
    assert fx.oracle["values"]["am"] == pytest.approx(area, rel=1e-12)
    assert fx.oracle["values"]["aa"] == pytest.approx(area, rel=1e-12)


def test_corr1_fixture_peaks_at_the_planted_lag() -> None:
    """No quantized cross-correlation exists (item 13). Origin's ``corr1(a, b)``
    peaks at lag -7 for b delayed by 7 rows (its sign convention), with raw sum
    values equal to ``numpy.correlate`` (152.5003 here)."""
    fx = load_fixture("corr1_lag")
    lag, corr = fx.outputs()
    c = fx.input_columns()
    k = int(np.nanargmax(corr))
    assert lag[k] == -fx.planted["lag_rows"]
    assert corr[k] == pytest.approx(float(np.correlate(c["a"], c["b"], "full").max()), rel=1e-9)
