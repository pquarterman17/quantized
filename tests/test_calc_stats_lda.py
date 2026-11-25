"""LDA and spectra PCA (G12). Oracles: scikit-learn's LinearDiscriminantAnalysis
(svd solver, dev-only), the existing pca_analysis on the transposed matrix, and
numpy.interp for the explicit resample."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.stats import pca_analysis
from quantized.calc.stats_lda import lda_analysis
from quantized.calc.stats_spectra import common_grid, pca_spectra

disc = pytest.importorskip("sklearn.discriminant_analysis")


def _blobs(seed: int = 0, k: int = 3, p: int = 4) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    centres = rng.normal(scale=3, size=(k, p))
    sizes = [20, 25, 15][:k]
    x = np.vstack([centres[i] + rng.normal(size=(s, p)) for i, s in enumerate(sizes)])
    y = np.concatenate([[i] * s for i, s in enumerate(sizes)])
    return x, y


@pytest.mark.parametrize("priors", ["empirical", "equal"])
def test_lda_matches_sklearn(priors: str) -> None:
    x, y = _blobs()
    r = lda_analysis(x, y, priors=priors)
    ref = disc.LinearDiscriminantAnalysis(
        solver="svd", priors=None if priors == "empirical" else [1 / 3] * 3
    ).fit(x, y)
    # Two documented conventions differ from sklearn (neither changes the
    # classes' ordering for equal priors): it centres the decision function on
    # the grand mean (a term shared by every class), and its pooled covariance
    # divides by n (ours: n - K, the unbiased estimate). So compare the
    # covariance-dependent part after removing the class-mean and rescaling.
    n, k = x.shape[0], 3
    f = n / (n - k)

    def cc(a: np.ndarray, axis: int) -> np.ndarray:
        return np.asarray(a - a.mean(axis=axis, keepdims=True))

    logp = np.log(r["priors"])
    np.testing.assert_allclose(
        cc(r["decision"] - logp, 1) * f,
        cc(ref.decision_function(x) - np.log(ref.priors_), 1),
        rtol=1e-8,
        atol=1e-8,
    )
    np.testing.assert_allclose(cc(r["coef"], 0) * f, cc(ref.coef_, 0), rtol=1e-8, atol=1e-8)
    # Independent textbook check of OUR convention (unbiased pooled covariance).
    xc = x - np.vstack([x[y == c].mean(0) for c in range(k)])[y.astype(int)]
    sw = xc.T @ xc / (n - k)
    mu = r["means"]
    expect = (
        x @ np.linalg.solve(sw, mu.T)
        - 0.5 * np.sum(mu * np.linalg.solve(sw, mu.T).T, axis=1)
        + logp
    )
    np.testing.assert_allclose(r["decision"], expect, rtol=1e-9, atol=1e-9)
    np.testing.assert_array_equal(r["predicted"], ref.predict(x))
    rescaled = (ref.decision_function(x) - np.log(ref.priors_)) / f + logp
    e = np.exp(rescaled - rescaled.max(axis=1, keepdims=True))
    np.testing.assert_allclose(r["posterior"], e / e.sum(axis=1, keepdims=True), atol=1e-9)
    np.testing.assert_allclose(
        r["explained_variance_ratio"], ref.explained_variance_ratio_, rtol=1e-8
    )
    np.testing.assert_allclose(
        np.abs(r["scores"]) * np.sqrt(f), np.abs(ref.transform(x)), rtol=1e-7, atol=1e-8
    )
    assert r["accuracy"] == pytest.approx(ref.score(x, y))


def test_lda_two_class_matches_fisher_direction_and_string_labels() -> None:
    rng = np.random.default_rng(1)
    a = rng.normal(size=(30, 2))
    b = rng.normal(size=(30, 2)) + np.array([3.0, 1.0])
    x = np.vstack([a, b])
    r = lda_analysis(x, ["lo"] * 30 + ["hi"] * 30)
    assert r["classes"] == ["hi", "lo"] and r["n_discriminants"] == 1
    sw = (np.cov(a.T) * 29 + np.cov(b.T) * 29) / 58
    fisher = np.linalg.solve(sw, b.mean(0) - a.mean(0))
    w = r["scalings"][:, 0]
    cos = abs(w @ fisher) / np.linalg.norm(w) / np.linalg.norm(fisher)
    assert cos == pytest.approx(1.0, abs=1e-10)
    assert r["explained_variance_ratio"][0] == pytest.approx(1.0)


def test_lda_cv_is_deterministic_stratified_and_honest() -> None:
    x, y = _blobs(seed=4)
    a = lda_analysis(x, y, cv_folds=5, seed=3)["cv"]
    b = lda_analysis(x, y, cv_folds=5, seed=3)["cv"]
    np.testing.assert_array_equal(a["predicted"], b["predicted"])
    assert int(a["confusion"].sum()) == len(y)
    assert a["accuracy"] <= lda_analysis(x, y)["accuracy"] + 1e-12


@pytest.mark.parametrize("case", ["one_class", "singleton", "singular", "folds", "nan"])
def test_lda_refusals(case: str) -> None:
    x, y = _blobs()
    if case == "one_class":
        with pytest.raises(ValueError, match="two classes"):
            lda_analysis(x, np.zeros(len(y)))
    elif case == "singleton":
        y2 = y.copy()
        y2[0] = 9
        with pytest.raises(ValueError, match="at least 2"):
            lda_analysis(x, y2)
    elif case == "singular":
        with pytest.raises(ValueError, match="singular"):
            lda_analysis(np.column_stack([x, x[:, 0]]), y)
    elif case == "folds":
        with pytest.raises(ValueError, match="folds"):
            lda_analysis(x, y, cv_folds=16)
    else:
        x[0, 0] = np.nan
        with pytest.raises(ValueError, match="finite"):
            lda_analysis(x, y)


def _spectra(n: int = 6, g: int = 50) -> tuple[np.ndarray, np.ndarray]:
    grid = np.linspace(100, 400, g)
    rng = np.random.default_rng(2)
    comp = np.vstack([np.exp(-(((grid - c) / 20) ** 2)) for c in (150, 250, 330)])
    return grid, rng.uniform(0, 1, (n, 3)) @ comp + 0.01 * rng.normal(size=(n, g))


def test_spectra_pca_equals_pca_of_transpose() -> None:
    grid, s = _spectra()
    r = pca_spectra([grid] * 6, list(s))
    ref = pca_analysis(s)
    np.testing.assert_allclose(r["score"], ref["score"])
    np.testing.assert_allclose(r["coeff"], ref["coeff"])
    assert r["coeff"].shape[0] == 50 and r["n_spectra"] == 6 and r["notes"] == []
    assert r["cumulative"][2] > 99.0  # three real components


def test_spectra_off_grid_refused_unless_resample() -> None:
    grid, s = _spectra()
    xs = [grid] * 5 + [grid + 0.5]
    with pytest.raises(ValueError, match=r"spectra \[6\].*resample"):
        pca_spectra(xs, list(s))
    g, mat, notes = common_grid(xs, list(s), resample=True)
    assert g[0] >= 100.5 and g[-1] <= 400
    np.testing.assert_allclose(mat[5], np.interp(g, grid + 0.5, s[5]))
    np.testing.assert_allclose(mat[0], np.interp(g, grid, s[0]))
    assert "resampled" in notes[0]


def test_spectra_bad_inputs() -> None:
    grid, s = _spectra()
    with pytest.raises(ValueError, match="at least 2"):
        pca_spectra([grid], [s[0]])
    with pytest.raises(ValueError, match="monotonic"):
        pca_spectra([grid[::-1][[1, 0, 2, *range(3, 50)]]] * 2, [s[0], s[1]])
    with pytest.raises(ValueError, match="same length"):
        pca_spectra([grid, grid], [s[0], s[1][:-1]])
    with pytest.raises(ValueError, match="too little"):
        common_grid([grid, grid + 1000], [s[0], s[1]], resample=True)
