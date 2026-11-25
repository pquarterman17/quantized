"""PLS (G12): oracles are scikit-learn's PLSRegression (dev-only), the analytic
one-component single-predictor case (PLS == OLS), and hand-checkable identities."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.stats_pls import (
    fold_indices,
    pls_analysis,
    pls_cross_validate,
    pls_fit,
    vip_scores,
)

sk = pytest.importorskip("sklearn.cross_decomposition")


def _data(n: int = 40, p: int = 9, m: int = 2, seed: int = 3) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    x = rng.normal(size=(n, p)) * rng.uniform(0.5, 3, size=p)
    y = x @ rng.normal(size=(p, m)) + 0.4 * rng.normal(size=(n, m))
    return x, y


@pytest.mark.parametrize(("pre", "scale"), [("center", False), ("autoscale", True)])
def test_pls1_matches_sklearn_exactly(pre: str, scale: bool) -> None:
    x, y = _data(m=1)
    ours = pls_fit(x, y[:, 0], 4, preprocess=pre)  # type: ignore[arg-type]
    ref = sk.PLSRegression(4, scale=scale).fit(x, y[:, 0])
    np.testing.assert_allclose(
        ours.predict(x)[:, 0], ref.predict(x).ravel(), rtol=1e-10, atol=1e-10
    )
    np.testing.assert_allclose(np.abs(ours.scores), np.abs(ref.x_scores_), atol=1e-10)
    np.testing.assert_allclose(np.abs(ours.weights), np.abs(ref.x_weights_), atol=1e-10)
    np.testing.assert_allclose(np.abs(ours.x_loadings), np.abs(ref.x_loadings_), atol=1e-10)
    np.testing.assert_allclose(
        ours.coef()[:, 0], np.asarray(ref.coef_).ravel(), rtol=1e-9, atol=1e-10
    )


@pytest.mark.parametrize(("pre", "scale"), [("center", False), ("autoscale", True)])
def test_pls2_matches_sklearn_to_its_power_method_tolerance(pre: str, scale: bool) -> None:
    # sklearn's inner loop stops at tol=1e-6, so PLS2 agrees to about 1e-3, not machine precision.
    x, y = _data()
    ours = pls_fit(x, y, 3, preprocess=pre)  # type: ignore[arg-type]
    ref = sk.PLSRegression(3, scale=scale).fit(x, y)
    np.testing.assert_allclose(ours.predict(x), ref.predict(x), rtol=2e-3, atol=2e-3)


def test_one_component_single_predictor_equals_ols() -> None:
    rng = np.random.default_rng(0)
    x = rng.normal(2.0, 1.5, size=(25, 1))
    y = 3.0 * x[:, 0] - 1.0 + 0.2 * rng.normal(size=25)
    for pre in ("none", "center", "autoscale"):
        m = pls_fit(x, y, 1, preprocess=pre)  # type: ignore[arg-type]
        if pre == "none":
            continue  # without centring PLS has no intercept; OLS-through-origin differs
        slope, icpt = np.polyfit(x[:, 0], y, 1)
        np.testing.assert_allclose(m.coef()[0, 0], slope, rtol=1e-12)
        np.testing.assert_allclose(m.intercept()[0], icpt, rtol=1e-10)


def test_full_rank_pls_equals_ols_on_all_predictors() -> None:
    x, y = _data(n=30, p=4, m=1)
    m = pls_fit(x, y[:, 0], 4)
    a = np.column_stack([np.ones(30), x])
    beta = np.linalg.lstsq(a, y[:, 0], rcond=None)[0]
    np.testing.assert_allclose(m.coef()[:, 0], beta[1:], rtol=1e-8)
    np.testing.assert_allclose(m.intercept()[0], beta[0], rtol=1e-8, atol=1e-10)


def test_vip_sum_of_squares_equals_p_and_matches_formula_from_sklearn_parts() -> None:
    x, y = _data(m=1)
    m = pls_fit(x, y[:, 0], 3, preprocess="autoscale")
    v = vip_scores(m)
    assert np.sum(v**2) == pytest.approx(x.shape[1], rel=1e-12)
    ref = sk.PLSRegression(3, scale=True).fit(x, y[:, 0])
    w, t, q = ref.x_weights_, ref.x_scores_, ref.y_loadings_
    ssy = (q**2).sum(axis=0) * (t**2).sum(axis=0)
    expect = np.sqrt(x.shape[1] * (w**2 @ ssy) / ssy.sum())  # Chong and Jun (2005) eq. 2
    np.testing.assert_allclose(v, expect, rtol=1e-9)


def test_cv_folds_are_deterministic_disjoint_and_cover() -> None:
    a = fold_indices(23, 5, seed=7)
    b = fold_indices(23, 5, seed=7)
    assert all(np.array_equal(i, j) for i, j in zip(a, b, strict=True))
    assert sorted(np.concatenate(a).tolist()) == list(range(23))
    assert not np.array_equal(np.concatenate(a), np.concatenate(fold_indices(23, 5, seed=8)))
    assert sorted(len(f) for f in a) == [4, 4, 5, 5, 5]


def test_cv_press_matches_explicit_leave_out_loop() -> None:
    x, y = _data(n=24, p=6, m=1)
    cv = pls_cross_validate(x, y[:, 0], 3, folds=4, seed=1)
    press = np.zeros(3)
    for test in fold_indices(24, 4, 1):
        train = np.setdiff1d(np.arange(24), test)
        for a in (1, 2, 3):
            mod = sk.PLSRegression(a, scale=False).fit(x[train], y[train, 0])
            press[a - 1] += np.sum((y[test, 0] - mod.predict(x[test]).ravel()) ** 2)
    np.testing.assert_allclose(cv["press"][:, 0], press, rtol=1e-9)
    sst = np.sum((y[:, 0] - y[:, 0].mean()) ** 2)
    np.testing.assert_allclose(cv["q2"][:, 0], 1 - press / sst, rtol=1e-9)
    assert cv["best"] == int(np.argmin(press)) + 1


def test_analysis_recovers_known_rank_and_reports_everything() -> None:
    rng = np.random.default_rng(5)
    t = rng.normal(size=(60, 2))
    x = t @ rng.normal(size=(2, 12)) + 0.05 * rng.normal(size=(60, 12))
    y = (t @ np.array([1.5, -2.0]))[:, None] + 0.05 * rng.normal(size=(60, 1))
    r = pls_analysis(x, y, folds=6, seed=2)
    assert r["n_components"] == 2 and r["auto_components"]
    assert r["r2y_mean"] > 0.99 and r["q2_mean"] > 0.98
    assert r["scores"].shape == (60, 2) and r["coef"].shape == (12, 1) and r["vip"].shape == (12,)
    assert r["cv_predicted"].shape == r["predicted"].shape == (60, 1)
    ref = sk.PLSRegression(2, scale=False).fit(x, y)
    assert r["r2y"][0] == pytest.approx(ref.score(x, y), rel=1e-9)
    fixed = pls_analysis(x, y, n_components=3, folds=6, seed=2)
    assert fixed["n_components"] == 3 and not fixed["auto_components"]


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"x": np.ones((5, 3)), "y": np.ones(4)}, "rows"),
        ({"x": np.array([[1.0, np.nan], [2, 3], [3, 4]]), "y": np.ones(3)}, "finite"),
        ({"x": np.ones((2, 3)), "y": np.ones(2)}, "at least 3"),
    ],
)
def test_refusals(kwargs: dict[str, np.ndarray], match: str) -> None:
    with pytest.raises(ValueError, match=match):
        pls_fit(kwargs["x"], kwargs["y"], 1)


def test_autoscale_refuses_constant_column_but_centre_accepts() -> None:
    x, y = _data(n=20, p=4, m=1)
    x[:, 2] = 7.0
    with pytest.raises(ValueError, match="column.*3"):
        pls_fit(x, y[:, 0], 2, preprocess="autoscale")
    pls_fit(x, y[:, 0], 2, preprocess="center")


def test_too_many_components_and_exhausted_y_refused() -> None:
    x, y = _data(n=10, p=3, m=1)
    with pytest.raises(ValueError, match="between 1 and 3"):
        pls_fit(x, y[:, 0], 4)
    x9, y9 = _data(n=10, p=9, m=1)
    with pytest.raises(ValueError, match="exceeds"):
        pls_analysis(x9, y9, n_components=6, folds=2)
    with pytest.raises(ValueError, match="folds"):
        pls_analysis(x, y, folds=50)
