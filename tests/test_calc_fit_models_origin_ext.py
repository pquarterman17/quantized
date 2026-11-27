"""Origin built-in functions ported in bulk (``fit_models_origin_dsl`` family).

Per function: (1) the automatic guess plus a bounded fit recovers known
parameters from seeded noisy data (scipy's standard errors set the tolerance:
6 sigma per parameter, and the fitted curve within 4 noise sigma of the truth);
(2) the quantized engine lands on the same curve; (3) the evaluator equals an
independent transcription of the formula at three points (``_origin_ext_refs``).
"""

from __future__ import annotations

import itertools
import math

import numpy as np
import pytest
from numpy.typing import NDArray
from scipy.optimize import curve_fit as scipy_curve_fit

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_models import FIT_MODELS, evaluate
from quantized.calc.fit_models_origin_dsl import NEW_ORIGIN_MODELS
from quantized.calc.fitting import curve_fit

from _origin_ext_cases import CASES
from _origin_ext_refs import REFS

_SEEDS = (0, 1, 2)


def _synth(name: str, seed: int) -> tuple[NDArray[np.float64], NDArray[np.float64],
                                           NDArray[np.float64], float]:
    c = CASES[name]
    x = np.linspace(c.x0, c.x1, c.n)
    clean = evaluate(name, x, c.truth)
    sigma = c.noise * (float(np.ptp(clean)) or float(np.max(np.abs(clean))))
    rng = np.random.default_rng(seed)
    return x, clean, clean + rng.normal(0.0, sigma, x.size), sigma


def _relabel_order(fit: NDArray[np.float64], truth: list[float],
                   groups: tuple[tuple[int, ...], ...]) -> list[int]:
    """Index order that puts the fit's interchangeable terms in the truth's order."""
    order = list(range(len(fit)))
    if not groups:
        return order
    scale = np.maximum(np.abs(np.array(truth)), 1e-9)
    best_err = math.inf
    for perm in itertools.permutations(range(len(groups))):
        cand = list(range(len(fit)))
        for dst, src in zip(groups, (groups[i] for i in perm), strict=True):
            for d, s_ in zip(dst, src, strict=True):
                cand[d] = s_
        err = float(np.sum(np.abs(fit[cand] - np.array(truth)) / scale))
        if err < best_err:
            order, best_err = cand, err
    return order


def test_every_new_model_has_a_recovery_case() -> None:
    assert set(NEW_ORIGIN_MODELS) == set(CASES)


@pytest.mark.parametrize("seed", _SEEDS)
@pytest.mark.parametrize("name", sorted(CASES))
def test_new_origin_model_recovers_truth(name: str, seed: int) -> None:
    case = CASES[name]
    x, clean, y, sigma = _synth(name, seed)
    spec = FIT_MODELS[name]
    guess = auto_guess(name, x, y)
    assert len(guess) == spec["nParams"] and all(math.isfinite(v) for v in guess)
    names = spec["paramNames"]
    free = [k for k in range(spec["nParams"]) if names[k] not in case.held]

    def model(xx: NDArray[np.float64], *pf: float) -> NDArray[np.float64]:
        p = np.array(guess, dtype=float)
        p[free] = pf
        return evaluate(name, xx, p)

    p_all, pcov = scipy_curve_fit(
        model, x, y, p0=[guess[k] for k in free],
        bounds=([spec["lb"][k] for k in free], [spec["ub"][k] for k in free]), maxfev=40000)
    p_free = p_all
    y_fit = model(x, *p_free)
    if not case.curve_only:
        se = np.sqrt(np.diag(pcov))
        full = np.array(guess, dtype=float)
        full[free] = p_free
        se_full = np.zeros(spec["nParams"])
        se_full[free] = se
        assert np.all(np.isfinite(se)), f"{name}: singular covariance"
        order = _relabel_order(full, case.truth, case.groups)
        full, se_full = full[order], se_full[order]
        held = np.array([names[k] in case.held for k in range(spec["nParams"])])
        ok_any = []
        for truth in (case.truth, *map(list, case.alts)):
            ok = (np.abs(full - np.array(truth)) <= 6 * se_full) | held
            ok_any.append(bool(np.all(ok)))
        assert any(ok_any), f"{name} seed {seed}: fit {full} vs truth {case.truth}, 6*se {se_full * 6}"
    assert float(np.max(np.abs(y_fit - clean))) <= 4 * sigma, name

    if case.curve_only:
        return
    fixed = [names[k] in case.held for k in range(spec["nParams"])]
    ours = curve_fit(x, y, spec["fcn"], guess, lower=spec["lb"], upper=spec["ub"],
                     fixed=fixed, calc_errors=False)
    assert float(np.max(np.abs(ours["yFit"] - y_fit))) <= 5e-4 * (float(np.ptp(clean)) or 1.0), name


def test_new_origin_guess_respects_bounds() -> None:
    for name in CASES:
        x, _, y, _ = _synth(name, 1)
        spec = FIT_MODELS[name]
        guess = auto_guess(name, x, y)
        assert all(lo <= v <= hi for v, lo, hi in zip(guess, spec["lb"], spec["ub"], strict=True))


def test_every_new_model_has_a_formula_reference() -> None:
    assert set(NEW_ORIGIN_MODELS) == set(REFS)


@pytest.mark.parametrize("name", sorted(REFS))
def test_new_origin_model_matches_independent_formula(name: str) -> None:
    ref, params, xs = REFS[name]
    assert len(params) == FIT_MODELS[name]["nParams"]
    got = evaluate(name, np.array(xs), list(params))
    want = [ref(x, *params) for x in xs]
    np.testing.assert_allclose(got, want, rtol=1e-12, atol=1e-12)


# Values worked out by hand (not by the code under test).
_HAND = [
    ("SRichards1", [2, 0, 2, 1], 0.0, 1 / 1.5),  # (2^-1 + e^0)^(1/(1-2))
    ("ExpAssoc1", [1, 2, 3, 2], 3.0, 2 + 3 * (1 - math.exp(-1))),
    ("SingleExp", [4, 0.5], 2.0, 4 * math.exp(-1)),
    ("SLogistic3", [6, 2, 1], 0.0, 2.0),  # 6/(1+2)
]


@pytest.mark.parametrize(("name", "params", "x", "want"), _HAND)
def test_hand_computed_values(name: str, params: list[float], x: float, want: float) -> None:
    assert float(evaluate(name, np.array([x]), params)[0]) == pytest.approx(want, rel=1e-12)
