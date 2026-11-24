"""G15 plot types (GAP_AUDIT_9): Bland-Altman, Pareto, 2-D KDE, hexbin,
parallel coordinates -- numerics against references, then the export route."""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.figure import Figure
from scipy import stats as sps

from quantized.app import app
from quantized.calc.figure_parallel import scale_columns
from quantized.calc.plots2_stats import bland_altman, kde2d_grid, pareto_table

client = TestClient(app)

# Bland JM, Altman DG (1986) Lancet 327:307-310, Fig 1: peak expiratory flow
# (l/min) of 17 subjects, FIRST readings, large Wright meter vs mini Wright meter.
# Values checked against the full 17-subject table (first and second readings)
# reproduced at https://www-users.york.ac.uk/~mb55/meas/repeated.htm (M Bland's
# page; also the R datasets ISwR::wright and BlandAltmanLeh::bland.altman.PEFR).
# The paper reports mean difference -2.1, limits +75.4 and -79.6 l/min (2 SD).
WRIGHT = [494, 395, 516, 434, 476, 557, 413, 442, 650, 433, 417, 656, 267, 478, 178, 423, 427]
MINI = [512, 430, 520, 428, 500, 600, 364, 380, 658, 445, 432, 626, 260, 477, 259, 350, 451]


def test_bland_altman_matches_published_1986_example() -> None:
    r = bland_altman(WRIGHT, MINI, k=2.0)
    assert r.n == 17
    assert r.bias == pytest.approx(-2.1, abs=0.05)
    assert r.sd == pytest.approx(38.8, abs=0.05)
    assert r.lower == pytest.approx(-79.6, abs=0.06)
    assert r.upper == pytest.approx(75.4, abs=0.06)


def test_bland_altman_default_limits_and_cis() -> None:
    a, b = np.array(WRIGHT, float), np.array(MINI, float)
    r = bland_altman(a, b)
    d = a - b
    n, s, m = 17, d.std(ddof=1), d.mean()
    assert (r.lower, r.upper) == pytest.approx((m - 1.96 * s, m + 1.96 * s))
    t = sps.t.ppf(0.975, n - 1)
    se_bias = s / np.sqrt(n)
    assert r.bias_ci == pytest.approx((m - t * se_bias, m + t * se_bias))
    # 1999 variance of a limit: s^2/n + k^2 s^2/(2(n-1)); ~3 s^2/n for k = 1.96
    se_lim = np.sqrt(s * s / n + 1.96**2 * s * s / (2 * (n - 1)))
    assert r.upper_ci == pytest.approx((r.upper - t * se_lim, r.upper + t * se_lim))
    assert se_lim == pytest.approx(s * np.sqrt(3 / n), rel=0.05)  # the 1986 shortcut
    assert r.lower_ci[0] < r.lower < r.lower_ci[1]
    assert r.normality_p is not None and r.normality_p > 0.05


def test_bland_altman_percent_and_refusals() -> None:
    a = np.array([10.0, 20, 30, 40, 55])
    b = np.array([11.0, 19, 33, 38, 50])
    r = bland_altman(a, b, percent=True)
    assert r.difference == pytest.approx(100 * (a - b) / ((a + b) / 2))
    with pytest.raises(ValueError, match="at least 3"):
        bland_altman([1, 2], [1, 3])
    with pytest.raises(ValueError, match="identical"):
        bland_altman([1, 2, 3], [2, 3, 4])
    with pytest.raises(ValueError, match="zero"):
        bland_altman([1, -1, 3], [-1, 1, 4], percent=True)
    with pytest.raises(ValueError, match="equal-length"):
        bland_altman([1, 2, 3], [1, 2])
    r2 = bland_altman([1, 2, 3, np.nan], [1.5, 2, 4, 5])  # a non-finite pair is dropped
    assert r2.n == 3


def test_pareto_sorts_descending_with_cumulative_percent() -> None:
    t = pareto_table(["a", "b", "c", "a", "d"], [5, 20, 10, 5, 10])
    assert t.labels == ["b", "a", "c", "d"]  # a = 10 ties c = 10: first seen first
    assert list(t.values) == [20, 10, 10, 10]
    assert t.cumulative_pct == pytest.approx([40, 60, 80, 100])
    assert t.total == 50
    with pytest.raises(ValueError, match="non-negative"):
        pareto_table(["a"], [-1.0])
    with pytest.raises(ValueError, match="zero"):
        pareto_table(["a", "b"], [0.0, 0.0])


def test_kde2d_matches_scipy_scott_and_silverman() -> None:
    rng = np.random.default_rng(3)
    x = rng.normal(size=200)
    y = 0.5 * x + rng.normal(size=200)
    gx, gy, z = kde2d_grid(x, y, n=20)
    ref = sps.gaussian_kde(np.vstack([x, y]), bw_method="scott")
    assert z[7, 11] == pytest.approx(float(ref([[gx[11]], [gy[7]]])[0]))
    # in 2-D Scott's and Silverman's factors coincide (both n^(-1/6)); a numeric
    # factor must reproduce scipy's and differ from the default
    _, _, zs = kde2d_grid(x, y, n=20, bandwidth="silverman")
    assert np.allclose(z, zs)
    _, _, zf = kde2d_grid(x, y, n=20, bandwidth=0.5)
    reff = sps.gaussian_kde(np.vstack([x, y]), bw_method=0.5)
    assert zf[7, 11] == pytest.approx(float(reff([[gx[11]], [gy[7]]])[0]))
    assert not np.allclose(z, zf)
    # density integrates to ~1 over a padded grid
    gx, gy, z = kde2d_grid(x, y, n=200, pad=0.6)
    assert np.trapezoid(np.trapezoid(z, gx, axis=1), gy) == pytest.approx(1.0, abs=0.02)
    with pytest.raises(ValueError, match="collinear"):
        kde2d_grid(np.arange(20.0), 2 * np.arange(20.0))
    with pytest.raises(ValueError, match="at least"):
        kde2d_grid(x[:5], y[:5])


def test_hexbin_counts_match_independent_nearest_centre_assignment() -> None:
    # matplotlib's hexbin vs brute force: every point belongs to the nearest
    # hexagon centre (metric of the scaled lattice), counts must agree exactly.
    rng = np.random.default_rng(11)
    x, y = rng.normal(size=500), rng.normal(size=500)
    fig = Figure()
    hb = fig.subplots().hexbin(x, y, gridsize=12, mincnt=1)
    counts = np.asarray(hb.get_array())
    centres = np.asarray(hb.get_offsets())
    assert counts.sum() == 500
    # lattice units from the plotted centres: lattice-1 columns are sx apart,
    # adjacent unique centre rows are sy/2 apart (lattice 2 sits half a row off)
    sx = 2.0 * np.min(np.diff(np.unique(np.round(centres[:, 0], 9))))
    sy = 2.0 * np.min(np.diff(np.unique(np.round(centres[:, 1], 9))))
    assert sx == pytest.approx((x.max() - x.min()) / 12, rel=1e-6)
    # matplotlib's rule: the nearer lattice point under d^2 = dx^2 + 3 dy^2
    # (both in lattice units), i.e. the nearest hexagon centre.
    dx = (x[:, None] - centres[None, :, 0]) / sx
    dy = (y[:, None] - centres[None, :, 1]) / sy
    owner = (dx**2 + 3.0 * dy**2).argmin(1)
    brute = np.bincount(owner, minlength=len(centres))
    assert (brute == counts.astype(int)).all()


def test_scale_columns() -> None:
    m = np.array([[1.0, 5.0, 3.0], [3.0, 5.0, 9.0], [2.0, 5.0, 6.0]])
    mm = scale_columns(m, "minmax")
    assert mm[:, 0] == pytest.approx([0, 1, 0.5]) and mm[:, 1] == pytest.approx([0.5] * 3)
    z = scale_columns(m, "zscore")
    assert z[:, 0].mean() == pytest.approx(0) and z[:, 0].std(ddof=1) == pytest.approx(1)
    assert z[:, 1] == pytest.approx([0, 0, 0])


def _ds(n: int = 60, **meta: Any) -> dict[str, Any]:
    rng = np.random.default_rng(5)
    a = rng.normal(50, 10, n)
    b = a + rng.normal(1, 3, n)
    c = rng.uniform(0, 1, n)
    return {"time": c.tolist(), "values": np.column_stack([a, b, a * c]).tolist(),
            "labels": ["A", "B", "C"], "units": ["", "", ""], "metadata": meta}


def _post(plots2: dict[str, Any], ds: dict[str, Any] | None = None, **extra: Any) -> Any:
    return client.post("/api/export/figure", json={
        "dataset": ds or _ds(), "fmt": "svg", "plots2": plots2, **extra})


@pytest.mark.parametrize("spec", [
    {"kind": "parallel", "cols": [0, 1, 2, 3]},
    {"kind": "parallel", "cols": [1, 2, 3], "color_col": 0, "normalize": "zscore"},
    {"kind": "density2d", "x_col": 1, "y_col": 2},
    {"kind": "density2d", "x_col": 1, "y_col": 2, "method": "hexbin", "log_counts": True},
    {"kind": "density2d", "x_col": 1, "y_col": 2, "method": "kde", "show_points": True},
    {"kind": "bland_altman", "x_col": 1, "y_col": 2},
    {"kind": "bland_altman", "x_col": 1, "y_col": 2, "percent": True, "show_ci": False},
])
def test_export_route_renders(spec: dict[str, Any]) -> None:
    r = _post(spec)
    assert r.status_code == 200, r.text
    assert b"<svg" in r.content[:2000]


def test_export_route_pareto_text_categories() -> None:
    ds = {"time": [1, 2, 3, 4, 5], "values": [[5.0], [20.0], [10.0], [3.0], [7.0]],
          "labels": ["Count"], "units": [""],
          "metadata": {"x_category_labels": ["dust", "scratch", "pit", "crack", "void"]}}
    r = _post({"kind": "pareto", "cat_col": 0, "value_col": 1}, ds)
    assert r.status_code == 200, r.text
    assert r.content.find(b"scratch") < r.content.find(b"pit") < r.content.find(b"dust")
    r = _post({"kind": "pareto", "cat_col": 0, "value_col": 1}, {**ds, "values": [[-1.0]] * 5})
    assert r.status_code == 422 and "non-negative" in r.text


def test_export_route_refuses() -> None:
    assert _post({"kind": "parallel", "cols": [1]}).status_code == 422
    assert _post({"kind": "parallel", "cols": [1, 1]}).status_code == 422
    r = _post({"kind": "density2d", "x_col": 1, "y_col": 9})
    assert r.status_code == 422 and "does not exist" in r.text
    r = _post({"kind": "bland_altman", "x_col": 1, "y_col": 1})
    assert r.status_code == 422 and "identical" in r.text
    r = _post({"kind": "density2d", "x_col": 1, "y_col": 2}, y_log=True)
    assert r.status_code == 422 and "y_log" in r.text
    r = _post({"kind": "density2d", "x_col": 1, "y_col": 2}, polar={})
    assert r.status_code in (200, 422)  # polar wins; just never a 500
