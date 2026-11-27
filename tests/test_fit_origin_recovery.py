"""Every table-declared Origin fit function recovers a seeded synthetic curve.

For each function in ``NEW_ORIGIN_MODELS`` (the #1096 port) the test draws a
plausible truth near the catalogue start, adds 0.3 % noise, fits it exactly the
way ``POST /api/fitting/fit`` does without a ``p0`` (auto-guess, then the
catalogue start if that fit is poor) and asserts the fitted CURVE reproduces
the noise-free truth (R² against truth). Parameters are not compared: several
functions are degenerate (Dhyperbl's two hyperbolas, over-parametrised
sums) and only their curve is determined.
"""

from __future__ import annotations

import os
import zlib

import numpy as np
import pytest

from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_models import FIT_MODELS, evaluate
from quantized.calc.fit_models_origin_dsl import NEW_ORIGIN_MODELS
from quantized.calc.fit_start_fallback import fit_with_start_fallback
from quantized.calc.fitting import curve_fit

R2_TRUTH = 0.99
_SEED = int(os.environ.get("QZ_FIT_RECOVERY_SEED", "0"))  # widen the draw locally
N_POINTS = 100
# Functions only defined on part of the axis (a pole at x = 1, ln of x).
_RANGES = {"BET": [(0.02, 0.9)], "BETMod": [(0.02, 0.9)], "Bradley": [(0.05, 0.9)]}
_DEFAULT_RANGES = [(0.3, 10.0), (0.05, 3.0), (1.0, 100.0), (-5.0, 5.0)]

# Genuinely unidentifiable from a curve: name -> reason (strict xfail).
UNIDENTIFIABLE: dict[str, str] = {}


def _synth(name: str) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    spec = FIT_MODELS[name]
    p0, lb, ub = (np.array(spec[k], float) for k in ("p0", "lb", "ub"))
    rng = np.random.default_rng(zlib.crc32(name.encode()) + _SEED)
    for xr in _RANGES.get(name, _DEFAULT_RANGES):
        x = np.linspace(*xr, N_POINTS)
        for _ in range(20):
            pt = p0 * (1 + 0.25 * rng.uniform(-1, 1, p0.size))
            pt = np.clip(np.where(p0 == 0, rng.uniform(0.2, 0.8, p0.size), pt), lb, ub)
            with np.errstate(all="ignore"):
                y = np.asarray(evaluate(name, x, pt), float)
            if np.all(np.isfinite(y)) and np.ptp(y) > 1e-6 * max(1.0, np.abs(y).max()) \
                    and np.abs(y).max() < 1e8:
                return x, y, y + rng.normal(0, 0.003 * np.ptp(y), y.shape)
    return None


def _r2(truth: np.ndarray, fit: np.ndarray) -> float:
    return float(1 - np.sum((truth - fit) ** 2) / np.sum((truth - truth.mean()) ** 2))


def _params() -> list:
    out = []
    for n in NEW_ORIGIN_MODELS:
        marks = []
        if n in UNIDENTIFIABLE:
            marks.append(pytest.mark.xfail(strict=True, reason=UNIDENTIFIABLE[n]))
        out.append(pytest.param(n, marks=marks, id=n))
    return out


@pytest.mark.parametrize("name", _params())
def test_origin_function_recovers_seeded_curve(name: str) -> None:
    spec = FIT_MODELS[name]
    if name == "Constant":  # no curve to draw: a flat line, so compare the level
        x = np.linspace(0, 10, N_POINTS)
        y = 3.7 + np.random.default_rng(1).normal(0, 0.01, x.size)
        s = fit_with_start_fallback(
            lambda p: curve_fit(x, y, lambda xx, pp: evaluate(name, xx, pp), p),
            auto_guess(name, x, y), spec["p0"], x, y)
        assert s["params"][0] == pytest.approx(3.7, abs=0.01)
        return
    drawn = _synth(name)
    assert drawn is not None, f"no usable synthetic curve for {name}"
    x, truth, y = drawn
    with np.errstate(all="ignore"):
        res = fit_with_start_fallback(
            lambda p: curve_fit(x, y, lambda xx, pp: evaluate(name, xx, pp), p,
                                lower=list(spec["lb"]), upper=list(spec["ub"])),
            auto_guess(name, x, y), spec["p0"], x, y)
    assert res["start"] in ("auto", "catalogue")
    assert _r2(truth, np.asarray(res["yFit"])) >= R2_TRUTH
