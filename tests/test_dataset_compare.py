"""Compare datasets: extra-sum-of-squares F-test (calc + route).

The reference is closed-form: for the Linear model every fit is ordinary least
squares, so the restricted RSS (one shared slope AND intercept) comes from a
single stacked ``polyfit`` and the full RSS from per-dataset ``polyfit``s; the
F statistic and p-value are computed by hand with ``scipy.stats.f``.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.testing import assert_allclose
from scipy import stats

from quantized.app import app
from quantized.calc.dataset_compare import compare_datasets, extra_sum_of_squares
from quantized.calc.fit_models import evaluate

client = TestClient(app)


def _line(x, p):  # noqa: ANN001, ANN202
    return evaluate("Linear", x, p)


def _data(slope2: float, seed: int = 3):  # noqa: ANN202
    rng = np.random.default_rng(seed)
    x = np.linspace(0, 10, 25)
    y1 = 2.0 * x + 1.0 + rng.normal(0, 0.4, x.size)
    y2 = slope2 * x + 1.0 + rng.normal(0, 0.4, x.size)
    return x, y1, y2


def _reference(x, y1, y2, shared_slope_only: bool = False):  # noqa: ANN001, ANN202
    n = 2 * x.size
    rss_full = sum(np.sum((y - np.polyval(np.polyfit(x, y, 1), x)) ** 2) for y in (y1, y2))
    if shared_slope_only:
        # y = m x + b_k : design with a common slope and per-dataset intercepts
        A = np.column_stack([np.r_[x, x], np.r_[np.ones_like(x), np.zeros_like(x)],
                             np.r_[np.zeros_like(x), np.ones_like(x)]])
        yy = np.r_[y1, y2]
        sol = np.linalg.lstsq(A, yy, rcond=None)[0]
        rss_r, p_r = float(np.sum((yy - A @ sol) ** 2)), 3
    else:
        yy, xx = np.r_[y1, y2], np.r_[x, x]
        rss_r = float(np.sum((yy - np.polyval(np.polyfit(xx, yy, 1), xx)) ** 2))
        p_r = 2
    df_r, df_f = n - p_r, n - 4
    f = ((rss_r - rss_full) / (df_r - df_f)) / (rss_full / df_f)
    return f, df_r - df_f, df_f, float(stats.f.sf(f, df_r - df_f, df_f)), rss_r, float(rss_full)


@pytest.mark.parametrize("slope2", [2.0, 2.8])
def test_all_params_shared_matches_closed_form(slope2: float) -> None:
    x, y1, y2 = _data(slope2)
    out = compare_datasets([(x, y1), (x, y2)], _line, ["m", "b"], ["m", "b"],
                           init_guess=[[1.0, 0.0], [1.0, 0.0]])
    f, d1, d2, p, rss_r, rss_f = _reference(x, y1, y2)
    assert out["test"]["dfNum"] == d1 and out["test"]["dfDen"] == d2
    assert_allclose(out["shared"]["rss"], rss_r, rtol=1e-6)
    assert_allclose(out["separate"]["rss"], rss_f, rtol=1e-6)
    assert_allclose(out["test"]["F"], f, rtol=1e-4, atol=1e-8)
    assert_allclose(out["test"]["p"], p, rtol=1e-3, atol=1e-8)
    assert out["conclusion"] == ("shared" if slope2 == 2.0 else "separate")


def test_partial_sharing_slope_only_matches_closed_form() -> None:
    x, y1, y2 = _data(2.8)
    out = compare_datasets([(x, y1), (x, y2)], _line, ["m", "b"], ["m"],
                           init_guess=[[1.0, 0.0], [1.0, 0.0]])
    f, d1, d2, p, rss_r, _ = _reference(x, y1, y2, shared_slope_only=True)
    assert (out["test"]["dfNum"], out["test"]["dfDen"]) == (d1, d2) == (1, 46)
    assert_allclose(out["shared"]["rss"], rss_r, rtol=1e-6)
    assert_allclose(out["test"]["F"], f, rtol=1e-3)
    assert_allclose(out["test"]["p"], p, rtol=1e-2, atol=1e-8)


def test_extra_sum_of_squares_hand_values() -> None:
    # F = ((30-20)/2)/(20/10) = 2.5 on (2, 10)
    r = extra_sum_of_squares(30.0, 12, 20.0, 10)
    assert r["F"] == pytest.approx(2.5)
    assert r["p"] == pytest.approx(float(stats.f.sf(2.5, 2, 10)))


@pytest.mark.parametrize(
    "args",
    [
        (30.0, 10, 20.0, 10),  # no extra parameters in the full model
        (30.0, 12, 20.0, 0),  # no residual dof
        (30.0, 12, float("nan"), 10),
        (20.0, 12, 30.0, 10),  # full fit worse than restricted: unconverged
    ],
)
def test_extra_sum_of_squares_fails_closed(args: tuple[float, int, float, int]) -> None:
    with pytest.raises(ValueError):
        extra_sum_of_squares(*args)


def test_compare_refuses_single_dataset_and_empty_or_unknown_shared() -> None:
    x, y1, _ = _data(2.0)
    g = [[1.0, 0.0]]
    with pytest.raises(ValueError, match="at least two"):
        compare_datasets([(x, y1)], _line, ["m", "b"], ["m"], init_guess=g)
    with pytest.raises(ValueError, match="at least one parameter"):
        compare_datasets([(x, y1), (x, y1)], _line, ["m", "b"], [], init_guess=g * 2)
    with pytest.raises(ValueError, match="unknown parameter"):
        compare_datasets([(x, y1), (x, y1)], _line, ["m", "b"], ["zz"], init_guess=g * 2)


def _req(x, y1, y2, constraints):  # noqa: ANN001, ANN202
    return {
        "model": "Linear",
        "datasets": [{"x": x.tolist(), "y": y1.tolist()}, {"x": x.tolist(), "y": y2.tolist()}],
        "constraints": constraints,
        "p0": [1.0, 0.0],
    }


def test_route_returns_f_test_and_rejects_bad_requests() -> None:
    x, y1, y2 = _data(2.8)
    shared_all = [{"param_name": "m", "datasets": [0, 1]}, {"param_name": "b", "datasets": [0, 1]}]
    r = client.post("/api/fitting/compare-datasets", json=_req(x, y1, y2, shared_all))
    assert r.status_code == 200, r.text
    body = r.json()
    f, _, _, p, _, _ = _reference(x, y1, y2)
    assert_allclose(body["test"]["F"], f, rtol=1e-4)
    assert body["conclusion"] == "separate" and body["paramNames"] == ["m", "b"]
    # no hypothesis named, or a hypothesis that does not span every dataset
    assert client.post("/api/fitting/compare-datasets", json=_req(x, y1, y2, [])).status_code == 422
    partial = [{"param_name": "m", "datasets": [0]}]
    r = client.post("/api/fitting/compare-datasets", json=_req(x, y1, y2, partial))
    assert r.status_code == 422
    one = _req(x, y1, y2, shared_all)
    one["datasets"] = one["datasets"][:1]
    assert client.post("/api/fitting/compare-datasets/job", json=one).status_code == 422
