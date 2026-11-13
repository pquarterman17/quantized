"""Origin built-in fit models: auto-guess + fit recover known truths.

For every Origin model, synthetic data are drawn from random-but-reasonable
true parameters plus Gaussian noise. The data-driven ``auto_guess`` seeds
both scipy's ``curve_fit`` (TRF) and quantized's own bounded Nelder-Mead
engine (``calc.fitting.curve_fit``). Asserted:

* recovery — every scipy parameter lies within 6 standard errors of the truth
  (``sqrt(diag(pcov))``, so ill-conditioned parameters get honest, wide
  tolerances while well-determined ones must be tight), and the fitted curve
  tracks the noiseless truth to within a few noise sigmas;
* engine parity — the quantized engine's fitted values match scipy's to 1e-6
  of the data range (measured ~1e-9).

The ``x0`` variants (ExpDecay*, ExpGrow*) are fitted with ``x0`` held at its
guess, the way Origin users fix it: ``x0`` and the amplitudes are otherwise
one degenerate direction.
"""

from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np
import pytest
from numpy.typing import NDArray
from scipy.optimize import curve_fit as scipy_curve_fit

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_models import FIT_MODELS, evaluate
from quantized.calc.fitting import curve_fit

Truth = Callable[[np.random.Generator], list[float]]
Case = tuple[NDArray[np.float64], Truth, float]

_SEEDS = (0, 1, 2)
_L = np.linspace


Spec = float | tuple[float, float]


def _truth(*spec: Spec) -> Truth:
    """Sampler: a (lo, hi) entry draws uniformly, a bare float is held fixed."""

    def gen(r: np.random.Generator) -> list[float]:
        return [float(r.uniform(*s)) if isinstance(s, tuple) else float(s) for s in spec]

    return gen


def _signed(lo: float, hi: float) -> Truth:
    def gen(r: np.random.Generator) -> list[float]:
        return [float(r.uniform(lo, hi)) * (1.0 if r.random() < 0.5 else -1.0)]

    return gen


def _sine_truth(w_lo: float, w_hi: float, damped: bool) -> Truth:
    """xc is drawn within one period 2w, so it depends on the drawn w."""

    def gen(r: np.random.Generator) -> list[float]:
        w = float(r.uniform(w_lo, w_hi))
        head = [float(r.uniform(-1, 1)), float(r.uniform(0, 2 * w)), w]
        if damped:
            return head + [float(r.uniform(5, 15)), float(r.uniform(2, 4))]
        return head + [float(r.uniform(1, 3))]

    return gen


_PEAK = (-1.0, 1.0), (7.0, 13.0)  # y0, xc
_DEC2 = (3.0, 6.0), (0.2, 0.6), (3.0, 6.0), (2.0, 5.0)
_DEC3 = (3.0, 6.0), (0.1, 0.25), (3.0, 6.0), (0.8, 1.5), (3.0, 6.0), (5.0, 10.0)
_GRO2 = (0.2, 0.6), (0.8, 1.2), (10.0, 20.0), (3.0, 5.0)
_STEP = (-1.0, 1.0), (4.0, 6.0)  # A1, A2 asymptotes

# name -> (x grid, truth sampler, noise sigma as a fraction of the curve's range)
CASES: dict[str, Case] = {
    "Gauss": (_L(0, 20, 301), _truth(*_PEAK, (1, 3), (5, 20)), 0.01),
    "GaussAmp": (_L(0, 20, 301), _truth(*_PEAK, (0.5, 1.5), (2, 8)), 0.01),
    "Lorentz": (_L(0, 20, 301), _truth(*_PEAK, (1, 3), (5, 20)), 0.01),
    "Voigt": (_L(0, 20, 401), _truth((-1, 1), (8, 12), (5, 20), (1, 2.5), (0.5, 2)), 0.002),
    "PsdVoigt1": (_L(0, 20, 301), _truth(*_PEAK, (5, 20), (1, 3), (0.2, 0.8)), 0.005),
    "PsdVoigt2": (_L(0, 20, 401),
                  _truth((-1, 1), (8, 12), (5, 20), (1, 3), (1, 3), (0.3, 0.7)), 0.002),
    "LogNormal": (_L(0.05, 20, 301), _truth((-1, 1), (3, 6), (0.2, 0.5), (5, 20)), 0.01),
    "Asym2Sig": (_L(0, 20, 401),
                 _truth((-1, 1), (8, 12), (2, 5), (2, 5), (0.3, 1), (0.3, 1)), 0.005),
    "ExpDec1": (_L(0, 10, 201), _truth((-1, 1), (2, 10), (0.5, 3)), 0.01),
    "ExpDec2": (_L(0, 20, 401), _truth((-1, 1), *_DEC2), 0.003),
    "ExpDec3": (_L(0, 40, 801), _truth((-0.5, 0.5), *_DEC3), 0.001),
    "ExpDecay1": (_L(1, 11, 201), _truth((-1, 1), 1.0, (2, 10), (0.5, 3)), 0.01),
    "ExpDecay2": (_L(1, 21, 401), _truth((-1, 1), 1.0, *_DEC2), 0.003),
    "ExpDecay3": (_L(1, 41, 801), _truth((-0.5, 0.5), 1.0, *_DEC3), 0.001),
    "ExpGro1": (_L(0, 5, 201), _truth((-1, 1), (0.5, 2), (1, 3)), 0.01),
    "ExpGro2": (_L(0, 5, 401), _truth((-1, 1), *_GRO2), 0.001),
    "ExpGrow1": (_L(1, 6, 201), _truth((-1, 1), 1.0, (0.5, 2), (1, 3)), 0.01),
    "ExpGrow2": (_L(1, 6, 401), _truth((-1, 1), 1.0, *_GRO2), 0.001),
    "Boltzmann": (_L(-10, 10, 201), _truth(*_STEP, (-3, 3), (0.5, 2)), 0.01),
    "DoseResp": (_L(-3, 3, 201), _truth(*_STEP, (-1, 1), (0.8, 2)), 0.01),
    "Hill": (_L(0, 10, 201), _truth((2, 5), (1, 4), (1, 3)), 0.01),
    "Hill1": (_L(0, 10, 201), _truth((0, 1), (4, 6), (1, 4), (1, 3)), 0.01),
    "MichaelisMenten": (_L(0, 20, 201), _truth((2, 5), (0.5, 3)), 0.01),
    "Logistic (Origin)": (_L(0.1, 20, 201), _truth(*_STEP, (2, 8), (1.5, 4)), 0.01),
    "Logistic5": (_L(0.1, 20, 401), _truth(*_STEP, (3, 7), (1.5, 3), (0.5, 2)), 0.001),
    "SLogistic1": (_L(-10, 10, 201), _truth((3, 6), (-2, 2), (0.5, 2)), 0.01),
    "Gompertz": (_L(-10, 10, 201), _truth((3, 6), (-2, 2), (0.5, 2)), 0.01),
    "Weibull1": (_L(0, 15, 301), _truth((4, 6), (0, 1), (1, 3), (1.5, 3), (0.2, 0.5)), 0.005),
    **{f"Poly {k}": (_L(-1, 1, 201), _truth(*[(-2.0, 2.0)] * (k + 1)), 1e-5)
       for k in range(5, 10)},
    "Proportional": (_L(-5, 5, 101), _signed(1, 3), 0.01),
    "Allometric1": (_L(0.1, 10, 201), _truth((1, 3), (-1.5, 2.5)), 0.01),
    "Sine": (_L(0, 20, 301), _sine_truth(1, 3, damped=False), 0.01),
    "SineDamp": (_L(0, 20, 401), _sine_truth(1, 2, damped=True), 0.005),
}

_ORIGIN_CATEGORIES = {"Peak Functions", "Exponential", "Growth/Sigmoidal", "Polynomial",
                      "Power", "Waveform"}


def test_every_origin_model_has_a_recovery_case() -> None:
    origin = {n for n, s in FIT_MODELS.items() if s["category"] in _ORIGIN_CATEGORIES}
    # "Power Law"/"Allometric" (MATLAB parity) share the Power category name.
    origin -= {"Power Law", "Allometric"}
    assert origin == set(CASES)


def _held_x0(name: str) -> int | None:
    return 1 if FIT_MODELS[name]["paramNames"][1:2] == ["x0"] else None


def _synth(name: str, seed: int) -> tuple[NDArray[np.float64], NDArray[np.float64],
                                           NDArray[np.float64], list[float], float]:
    x, gen, noise = CASES[name]
    rng = np.random.default_rng(seed)
    truth = gen(rng)
    clean = evaluate(name, x, truth)
    sigma = noise * float(np.ptp(clean))
    return x, clean, clean + rng.normal(0.0, sigma, x.size), truth, sigma


def _wrap_phase(name: str, fit: NDArray[np.float64], truth: list[float]) -> NDArray[np.float64]:
    """Sine xc is defined modulo the period 2w: move the fit's xc next to truth's."""
    if name in ("Sine", "SineDamp"):
        period = 2 * fit[2]
        fit = fit.copy()
        fit[1] = truth[1] + (fit[1] - truth[1] + period / 2) % period - period / 2
    return fit


@pytest.mark.parametrize("seed", _SEEDS)
@pytest.mark.parametrize("name", sorted(CASES))
def test_origin_model_recovers_truth_and_matches_scipy(name: str, seed: int) -> None:
    x, clean, y, truth, sigma = _synth(name, seed)
    spec = FIT_MODELS[name]
    guess = auto_guess(name, x, y)
    assert len(guess) == spec["nParams"] and all(math.isfinite(v) for v in guess)

    held = _held_x0(name)
    free = [k for k in range(spec["nParams"]) if k != held]

    def model(xx: NDArray[np.float64], *pf: float) -> NDArray[np.float64]:
        p = np.array(guess, dtype=float)
        p[free] = pf
        return evaluate(name, xx, p)

    lb = [spec["lb"][k] for k in free]
    ub = [spec["ub"][k] for k in free]
    p_free, pcov = scipy_curve_fit(model, x, y, p0=[guess[k] for k in free], bounds=(lb, ub),
                                   maxfev=20000)
    se = np.sqrt(np.diag(pcov))
    fit = _wrap_phase(name, np.asarray(p_free, dtype=float), [truth[k] for k in free])
    want = np.array([truth[k] for k in free])
    assert np.all(np.isfinite(se)), f"{name}: singular covariance {se}"
    assert np.all(np.abs(fit - want) <= 6 * se), (
        f"{name} seed {seed}: fit {fit} vs truth {want}, 6*se {6 * se}")

    y_scipy = model(x, *p_free)
    assert float(np.max(np.abs(y_scipy - clean))) <= 4 * sigma, name

    fixed = [k == held for k in range(spec["nParams"])]
    ours = curve_fit(x, y, spec["fcn"], guess, lower=spec["lb"], upper=spec["ub"],
                     fixed=fixed, calc_errors=False)
    span = float(np.ptp(clean))
    assert float(np.max(np.abs(ours["yFit"] - y_scipy))) <= 1e-6 * span, name


@pytest.mark.parametrize("name", ["Gauss", "Lorentz", "Voigt", "PsdVoigt1", "Asym2Sig"])
def test_peak_guess_handles_a_dip(name: str) -> None:
    """A negative-area peak (an absorption dip) is found, not mistaken for flat."""
    x, clean, y, truth, sigma = _synth(name, 0)
    area_idx = FIT_MODELS[name]["paramNames"].index("A")
    neg = list(truth)
    neg[area_idx] = -neg[area_idx]
    y_dip = evaluate(name, x, neg) + (y - clean)
    guess = auto_guess(name, x, y_dip)
    assert guess[area_idx] < 0
    assert guess[1] == pytest.approx(truth[1], abs=0.2)


# Families whose formula is invariant under x -> x + b (a centre/onset/x0
# parameter absorbs the shift). Power laws, Poly, Proportional and the
# no-x0 exponentials are not — that is the reason Origin has the x0 variants.
_LOCATION_FAMILIES = {
    "Gauss", "GaussAmp", "Lorentz", "Voigt", "PsdVoigt1", "PsdVoigt2", "Asym2Sig",
    "ExpDecay1", "ExpDecay2", "ExpDecay3", "ExpGrow1", "ExpGrow2", "Boltzmann", "DoseResp",
    "SLogistic1", "Gompertz", "Weibull1", "Sine", "SineDamp",
}
_TRANSFORMS = [(1e-6, 0.0), (1e4, 0.0)] + [(1.0, 1e3)]


@pytest.mark.parametrize(("scale", "shift"), _TRANSFORMS)
@pytest.mark.parametrize("name", sorted(CASES))
def test_origin_guess_is_x_scale_and_shift_robust(name: str, scale: float, shift: float) -> None:
    """The guess alone already traces the data, whatever the x units/origin.

    Regression: the variable-projection polish used scipy's default
    Nelder-Mead start simplex, whose step for a coordinate that is exactly 0
    (SLogistic1/Gompertz centres on a symmetric x grid) is a fixed 2.5e-4 —
    blind to the x scale, so the polish stalled. Steps now come from the grid.
    """
    if shift and name not in _LOCATION_FAMILIES:
        pytest.skip("formula is not shift-invariant")
    x, clean, y, _, sigma = _synth(name, 0)
    xt = scale * x + shift
    guess = auto_guess(name, xt, y)
    assert float(np.max(np.abs(evaluate(name, xt, guess) - clean))) <= 3 * sigma, guess
