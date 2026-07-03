"""Statistical-plot primitives (calc.statplots).

Oracles are the exact libraries the app already uses downstream:
- ``matplotlib.cbook.boxplot_stats`` for box/whisker/fliers,
- ``numpy.histogram`` for the binning rules,
- ``scipy.stats.probplot`` for the Q-Q reference line,
- ``scipy.stats.gaussian_kde`` for the violin density.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from matplotlib import cbook
from scipy import stats as sps

from quantized.calc.statplots import (
    box_stats,
    grouped_box_stats,
    histogram,
    qq_plot,
    violin_kde,
)

_RNG = np.random.default_rng(20260703)
_NORMAL = _RNG.normal(5.0, 2.0, size=200)
_SKEW = np.array([1, 2, 2, 3, 3, 3, 4, 4, 5, 6, 8, 12, 20, 50], dtype=float)


# --------------------------------------------------------------------------
# box stats vs matplotlib
# --------------------------------------------------------------------------
def test_box_stats_matches_matplotlib_with_outlier() -> None:
    data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
    got = box_stats(data)
    ref = cbook.boxplot_stats(np.asarray(data, dtype=float))[0]
    assert math.isclose(got["q1"], ref["q1"])
    assert math.isclose(got["median"], ref["med"])
    assert math.isclose(got["q3"], ref["q3"])
    assert math.isclose(got["whislo"], ref["whislo"])
    assert math.isclose(got["whishi"], ref["whishi"])
    assert got["fliers"] == [float(f) for f in ref["fliers"]]
    assert got["fliers"] == [100.0]


def test_box_stats_matches_matplotlib_on_random() -> None:
    got = box_stats(_NORMAL)
    ref = cbook.boxplot_stats(_NORMAL)[0]
    for key, rkey in [("q1", "q1"), ("median", "med"), ("q3", "q3"),
                      ("whislo", "whislo"), ("whishi", "whishi"), ("mean", "mean")]:
        assert math.isclose(got[key], ref[rkey], rel_tol=1e-12), key
    assert sorted(got["fliers"]) == sorted(float(f) for f in ref["fliers"])


def test_box_stats_range_whiskers_have_no_fliers() -> None:
    got = box_stats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], whis="range")
    assert got["whislo"] == 1.0 and got["whishi"] == 100.0
    assert got["fliers"] == []


def test_box_stats_empty_raises() -> None:
    with pytest.raises(ValueError, match="finite"):
        box_stats([np.nan, np.inf])


def test_grouped_box_stats_labels_and_count() -> None:
    out = grouped_box_stats([[1, 2, 3, 4], [10, 20, 30, 40]], labels=["a", "b"])
    assert out["n_groups"] == 2
    assert [b["label"] for b in out["boxes"]] == ["a", "b"]
    with pytest.raises(ValueError, match="labels length"):
        grouped_box_stats([[1, 2]], labels=["a", "b"])


# --------------------------------------------------------------------------
# violin KDE vs scipy
# --------------------------------------------------------------------------
def test_violin_kde_matches_scipy_and_integrates_to_one() -> None:
    out = violin_kde(_NORMAL, n_points=256)
    x = np.asarray(out["x"])
    dens = np.asarray(out["density"])
    ref = sps.gaussian_kde(_NORMAL)(x)
    np.testing.assert_allclose(dens, ref, rtol=1e-12)
    # density integrates to ~1 over a range that extends past the data
    assert math.isclose(float(np.trapezoid(dens, x)), 1.0, abs_tol=0.02)
    assert out["x"][0] < float(_NORMAL.min()) and out["x"][-1] > float(_NORMAL.max())


def test_violin_kde_rejects_constant_and_tiny() -> None:
    with pytest.raises(ValueError, match="non-constant"):
        violin_kde([3.0, 3.0, 3.0, 3.0])
    with pytest.raises(ValueError, match="at least 2"):
        violin_kde([1.0])


# --------------------------------------------------------------------------
# Q-Q plot vs scipy.stats.probplot
# --------------------------------------------------------------------------
def test_qq_line_matches_scipy_probplot() -> None:
    out = qq_plot(_NORMAL, dist="norm")
    (_osm, _osr), (slope, intercept, r) = sps.probplot(_NORMAL, dist="norm")
    # different plotting positions, but the fitted normal line is ~identical
    assert math.isclose(out["slope"], slope, rel_tol=1e-2)
    assert math.isclose(out["intercept"], intercept, rel_tol=1e-2)
    assert out["r_squared"] > 0.99
    # sample quantiles are just the sorted data
    np.testing.assert_allclose(out["sample_quantiles"], np.sort(_NORMAL))


def test_qq_slope_recovers_scale() -> None:
    # standard normal -> slope ~ sigma, intercept ~ mu
    out = qq_plot(_RNG.normal(0.0, 1.0, size=5000))
    assert math.isclose(out["slope"], 1.0, abs_tol=0.05)
    assert math.isclose(out["intercept"], 0.0, abs_tol=0.05)


def test_qq_unknown_dist_raises() -> None:
    with pytest.raises(ValueError, match="unknown distribution"):
        qq_plot(_NORMAL, dist="not_a_dist")


# --------------------------------------------------------------------------
# histogram binning + fit overlay
# --------------------------------------------------------------------------
def test_histogram_delegates_to_numpy_rules() -> None:
    for rule in ("fd", "sturges", "scott", "rice", "sqrt", "auto"):
        got = histogram(_NORMAL, bins=rule)
        counts, edges = np.histogram(_NORMAL, bins=rule)
        np.testing.assert_allclose(got["counts"], counts)
        np.testing.assert_allclose(got["edges"], edges)
        assert got["n_bins"] == len(counts)
        assert math.isclose(sum(got["counts"]), _NORMAL.size)


def test_histogram_explicit_int_bins_and_density() -> None:
    got = histogram(_SKEW, bins=5, density=True)
    assert got["n_bins"] == 5
    widths = np.diff(got["edges"])
    assert math.isclose(float(np.sum(np.asarray(got["counts"]) * widths)), 1.0)


def test_histogram_normal_fit_overlay() -> None:
    got = histogram(_NORMAL, bins="fd", fit="norm")
    assert got["fit"]["dist"] == "norm"
    mu, sigma = got["fit"]["params"]
    assert math.isclose(mu, float(_NORMAL.mean()), rel_tol=1e-6)
    assert math.isclose(sigma, float(_NORMAL.std(ddof=0)), rel_tol=1e-6)
    # the fitted pdf peaks near the mean
    x = np.asarray(got["fit"]["x"])
    pdf = np.asarray(got["fit"]["pdf"])
    assert abs(x[int(np.argmax(pdf))] - mu) < sigma


def test_histogram_too_small_raises() -> None:
    with pytest.raises(ValueError, match="at least 2"):
        histogram([1.0])
