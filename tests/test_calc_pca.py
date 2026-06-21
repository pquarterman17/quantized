"""PCA: golden parity vs MATLAB +utilities/pcaAnalysis."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.stats import pca_analysis


@pytest.mark.golden
def test_pca_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_pca.json")
    out = pca_analysis(np.asarray(g["input"], dtype=float))
    compare_calc(out, g["output"])


def test_pca_variance_sums_to_100() -> None:
    rng = np.random.default_rng(0)
    x = rng.normal(size=(50, 3))
    r = pca_analysis(x)
    assert float(np.sum(r["explained"])) == pytest.approx(100.0)
    assert r["cumulative"][-1] == pytest.approx(100.0)


def test_pca_sign_convention_deterministic() -> None:
    # Largest-magnitude loading of each component is positive (sign-fixed).
    rng = np.random.default_rng(1)
    x = rng.normal(size=(40, 4))
    r = pca_analysis(x)
    coeff = np.asarray(r["coeff"])
    for j in range(coeff.shape[1]):
        idx = int(np.argmax(np.abs(coeff[:, j])))
        assert coeff[idx, j] > 0


def test_pca_num_components_truncates() -> None:
    rng = np.random.default_rng(2)
    x = rng.normal(size=(30, 5))
    r = pca_analysis(x, num_components=2)
    assert np.asarray(r["coeff"]).shape == (5, 2)
    assert np.asarray(r["score"]).shape == (30, 2)
    assert np.asarray(r["latent"]).size == 2


def test_pca_too_few_rows() -> None:
    with pytest.raises(ValueError, match="at least 2"):
        pca_analysis(np.array([[1.0, 2.0, 3.0]]))
