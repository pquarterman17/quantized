"""Exact binomial, chi-square (Cohen's w) and correlation power.

Exact binomial is checked against a brute-force enumeration with scipy's
``binomtest`` (statsmodels has no exact-binomial power); chi-square against
statsmodels ``GofChisquarePower``; correlation against statsmodels' normal power on
the Fisher z scale and Cohen's tabled n = 85.
"""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy import stats
from statsmodels.stats.power import GofChisquarePower, NormalIndPower

from quantized.app import create_app
from quantized.calc.stats_power_more import (
    binomial_actual_alpha,
    binomial_exact_power,
    chisq_power,
    correlation_power,
)
from quantized.calc.stats_power_solve import solve


def _brute(p0: float, p1: float, n: int, alpha: float, tails: int) -> tuple[float, float]:
    alt = "two-sided" if tails == 2 else ("greater" if p1 >= p0 else "less")
    reject = [stats.binomtest(k, n, p0, alternative=alt).pvalue <= alpha for k in range(n + 1)]
    pw = sum(stats.binom.pmf(k, n, p1) for k in range(n + 1) if reject[k])
    size = sum(stats.binom.pmf(k, n, p0) for k in range(n + 1) if reject[k])
    return float(pw), float(size)


@pytest.mark.parametrize("n", [8, 15, 20, 37, 60])
@pytest.mark.parametrize("p0,p1", [(0.5, 0.8), (0.3, 0.5), (0.6, 0.35)])
@pytest.mark.parametrize("tails", [1, 2])
@pytest.mark.parametrize("alpha", [0.05, 0.01])
def test_exact_binomial_matches_brute_force(
    n: int, p0: float, p1: float, tails: int, alpha: float
) -> None:
    pw, size = _brute(p0, p1, n, alpha, tails)
    assert binomial_exact_power(p0, p1, n, alpha=alpha, tails=tails) == pytest.approx(pw, abs=1e-12)
    assert binomial_actual_alpha(p0, n, alpha=alpha, tails=tails, upper=p1 >= p0) == pytest.approx(
        size, abs=1e-12
    )
    assert size <= alpha + 1e-12  # an exact test never exceeds its level


def test_exact_binomial_sample_size_is_the_least_n_and_states_the_sawtooth() -> None:
    r = solve("prop-exact", "n", p0=0.5, p1=0.8, power=0.8)
    n = r["n"]
    assert n == 20
    assert binomial_exact_power(0.5, 0.8, n) >= 0.8
    # least n over the whole range, not only above the search start
    assert all(binomial_exact_power(0.5, 0.8, m) < 0.8 for m in range(2, n))
    assert r["power"] == pytest.approx(0.8042079657, abs=1e-9)
    assert any("not monotone" in note for note in r["notes"])
    assert r["actual_alpha"] == pytest.approx(0.0413894653, abs=1e-9)


def test_exact_binomial_checks_inputs() -> None:
    with pytest.raises(ValueError, match="p1 equals p0"):
        solve("prop-exact", "n", p0=0.5, p1=0.5, power=0.8)
    with pytest.raises(ValueError, match="needs 2 <= n"):
        binomial_exact_power(0.5, 0.8, 30_000)


@pytest.mark.parametrize("w", [0.1, 0.3, 0.5])
@pytest.mark.parametrize("n", [30, 100, 400])
@pytest.mark.parametrize("df", [1, 3, 8])
def test_chisq_power_matches_statsmodels(w: float, n: int, df: int) -> None:
    ref = GofChisquarePower().power(w, n, 0.05, n_bins=df + 1)
    assert chisq_power(w, n, df) == pytest.approx(ref, rel=1e-9)


def test_chisq_null_has_power_alpha_and_cohen_table() -> None:
    assert chisq_power(0.0, 100, 3, alpha=0.05) == pytest.approx(0.05, abs=1e-12)
    # Cohen (1988) table 7.4.6: w = 0.3, df = 3, power .80 needs N = 121.
    r = solve("chi-square", "n", effect=0.3, power=0.8, df=3)
    assert r["n"] == 122 or r["n"] == 121
    sm = GofChisquarePower().solve_power(effect_size=0.3, power=0.8, alpha=0.05, n_bins=4)
    assert r["n"] == int(np.ceil(sm))
    assert chisq_power(0.3, r["n"] - 1, 3) < 0.8 <= chisq_power(0.3, r["n"], 3)


def test_chisq_effect_round_trip_and_df_required() -> None:
    r = solve("chi-square", "effect", n=100, power=0.8, df=3)
    assert chisq_power(r["effect"], 100, 3) == pytest.approx(0.8, abs=1e-9)
    with pytest.raises(ValueError, match="df is required"):
        solve("chi-square", "n", effect=0.3, power=0.8)


@pytest.mark.parametrize("r", [0.1, 0.3, 0.5, -0.4])
@pytest.mark.parametrize("n", [20, 85, 300])
@pytest.mark.parametrize("tails", [1, 2])
def test_correlation_power_matches_statsmodels_on_the_fisher_scale(
    r: float, n: int, tails: int
) -> None:
    alt = "two-sided" if tails == 2 else "larger"
    ref = NormalIndPower().power(np.arctanh(abs(r)), n - 3, 0.05, ratio=0, alternative=alt)
    assert correlation_power(r, n, tails=tails) == pytest.approx(ref, rel=1e-9)


def test_correlation_textbook_and_solvers() -> None:
    # Cohen (1988): r = 0.30, two-sided 5%, power .80 needs n = 85.
    assert correlation_power(0.3, 85) == pytest.approx(0.80, abs=0.005)
    s = solve("correlation", "n", effect=0.3, power=0.8)
    assert s["n"] == 85
    assert correlation_power(0.3, 84) < 0.8 <= correlation_power(0.3, 85)
    e = solve("correlation", "effect", n=85, power=0.8)
    assert correlation_power(e["effect"], 85) == pytest.approx(0.8, abs=1e-9)
    assert solve("correlation", "power", effect=0.3, n=85)["power"] == pytest.approx(
        0.8003462499, abs=1e-9
    )
    with pytest.raises(ValueError, match="between -1 and 1"):
        solve("correlation", "n", effect=1.0, power=0.8)


def test_routes() -> None:
    client = TestClient(create_app())
    ok = client.post(
        "/api/stats/power-solve",
        json={"test": "chi-square", "solve": "n", "effect": 0.3, "power": 0.8, "df": 3},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["df"] == 3
    assert (
        client.post(
            "/api/stats/power-solve",
            json={"test": "chi-square", "solve": "n", "effect": 0.3, "power": 0.8},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/stats/power-solve",
            json={"test": "correlation", "solve": "n", "effect": 0.3, "power": 0.8},
        ).json()["n"]
        == 85
    )
    eff = client.post(
        "/api/stats/power-solve",
        json={"test": "prop-exact", "solve": "effect", "p0": 0.5, "n": 50, "power": 0.8},
    )
    assert eff.status_code == 200, eff.text
    assert eff.json()["p1"] == pytest.approx(0.7039277417887382, abs=1e-9)
    assert eff.json()["p1_alt"] == pytest.approx(0.2960722582112618, abs=1e-9)
    assert (
        client.post(
            "/api/stats/power-solve",
            json={"test": "prop-exact", "solve": "effect", "p0": 0.5, "n": 5, "power": 0.99},
        ).status_code
        == 422
    )
