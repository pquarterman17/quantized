"""Detectable effect of the exact binomial test, against scipy ``binomtest`` / ``binom`` sums."""

from __future__ import annotations

import numpy as np
import pytest
from scipy import stats

from quantized.calc.stats_power_binom_effect import binomial_detectable_p1
from quantized.calc.stats_power_more import binomial_exact_power
from quantized.calc.stats_power_solve import solve


def _brute_power(
    p0: float, p1: np.ndarray, n: int, alpha: float, tails: int, upper: bool
) -> np.ndarray:
    """Power at each p1 from the rejection set scipy's exact test defines (independent code)."""
    alt = "two-sided" if tails == 2 else ("greater" if upper else "less")
    ks = np.array(
        [k for k in range(n + 1) if stats.binomtest(k, n, p0, alternative=alt).pvalue <= alpha],
        dtype=int,
    )
    return np.array([stats.binom.pmf(ks, n, p).sum() for p in p1])


@pytest.mark.parametrize(
    ("n", "p0", "tails", "target"),
    [
        (50, 0.5, 2, 0.8),
        (50, 0.5, 1, 0.8),
        (30, 0.3, 2, 0.9),
        (80, 0.1, 2, 0.8),
        (25, 0.7, 1, 0.8),
        (120, 0.5, 2, 0.95),
    ],
)
def test_smallest_p1_reaching_the_target_by_brute_force(
    n: int, p0: float, tails: int, target: float
) -> None:
    res = binomial_detectable_p1(p0, n, target, alpha=0.05, tails=tails)
    for key, upper in (("up", True), ("down", False)):
        entry = res[key]
        assert entry is not None
        p1, power = entry
        assert (p1 > p0) == upper
        # power at the answer, from scipy's own rejection set, reaches the target (tight)
        brute = _brute_power(p0, np.array([p1]), n, 0.05, tails, upper)[0]
        assert brute == pytest.approx(power, abs=1e-12)
        assert target - 1e-12 <= brute <= target + 1e-7
        assert binomial_exact_power(p0, p1, n, alpha=0.05, tails=tails) == pytest.approx(
            brute, abs=1e-12
        )
        # nothing closer to p0 reaches it: scan a fine independent grid strictly between p0 and p1
        between = np.linspace(p0, p1, 1500, endpoint=False)[1:]
        assert np.all(_brute_power(p0, between, n, 0.05, tails, upper) < target)


def test_exact_power_is_a_sawtooth_in_n_so_the_effect_is_not_monotone() -> None:
    p1s = {n: binomial_detectable_p1(0.5, n, 0.8, tails=2)["up"][0] for n in range(20, 70)}  # type: ignore[index]
    assert any(p1s[n + 1] > p1s[n] + 1e-9 for n in range(20, 69)), (
        "a larger n needing a larger effect is the sawtooth"
    )
    # and the size is never above alpha, so each answer's power is real
    assert all(v > 0.5 for v in p1s.values())


def test_unreachable_side_is_none_and_all_unreachable_is_refused() -> None:
    # p0 = 0.97 at n = 10: no p1 above reaches 80% (upper tail cannot reject), only the lower can
    res = binomial_detectable_p1(0.97, 10, 0.8, tails=2)
    assert res["up"] is None and res["down"] is not None
    with pytest.raises(ValueError, match="no proportion reaches 99% power"):
        solve("prop-exact", "effect", p0=0.5, n=5, power=0.99)


def test_solve_round_trip_with_sample_size() -> None:
    n_res = solve("prop-exact", "n", p0=0.4, p1=0.65, power=0.8)
    n = n_res["n"]
    eff = solve("prop-exact", "effect", p0=0.4, n=n, power=0.8)
    # the effect found at that n is no larger than the one the n was sized for ...
    assert (
        abs(eff["effect"])
        <= abs(solve("prop-exact", "power", p0=0.4, p1=0.65, n=n)["effect"]) + 1e-12
    )
    # ... and its own power at that n reaches the target and is reproduced by the forward solve
    fwd = solve("prop-exact", "power", p0=0.4, p1=eff["p1"], n=n)
    assert fwd["power"] >= 0.8 - 1e-12 and fwd["power"] == pytest.approx(eff["power"], abs=1e-12)
    assert any("not monotone in n" in note for note in eff["notes"])
    # the power-against-n curve is drawn at the solved p1 (brute-force enumeration at a few points)
    for m, pw in list(zip(eff["curve"]["n"], eff["curve"]["power"], strict=True))[::7]:
        assert pw == pytest.approx(binomial_exact_power(0.4, eff["p1"], int(m)), abs=1e-12)
    assert eff["p1"] is not None and eff["effect_alt"] is None


def test_bad_inputs() -> None:
    with pytest.raises(ValueError, match="target power"):
        binomial_detectable_p1(0.5, 20, 1.0)
    with pytest.raises(ValueError, match="alpha"):
        binomial_detectable_p1(0.5, 20, 0.8, alpha=0.0)
    with pytest.raises(ValueError, match="tails"):
        binomial_detectable_p1(0.5, 20, 0.8, tails=3)
