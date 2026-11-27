"""Seeded inputs for the Origin fit-function oracle (one curve per function).

The curve is the quantized registry model evaluated at the planted parameters
of ``oracle_fit_planted.PLANTED`` plus Gaussian noise (sigma = 1% of the
curve's peak-to-peak range). The formulas come from
``quantized.calc.fit_models.FIT_MODELS``; nothing is retyped.
"""

from __future__ import annotations

import numpy as np
from oracle_fit_planted import PLANTED
from oracle_model import Column, Generator, InputSpec

from quantized.calc.fit_models import FIT_MODELS

N_POINTS = 60
NOISE_FRACTION = 0.01
FIT_SEED_BASE = 700


def origin_name(registry_name: str) -> str:
    """Origin's function name for a registry name (``Gaussian (Origin)`` -> ``Gaussian``)."""
    return registry_name.replace(" (Origin)", "")


def case_id(registry_name: str) -> str:
    """Filename-safe case id: ``fit_gaussian_origin`` for ``Gaussian (Origin)``."""
    return "fit_" + registry_name.replace(" (Origin)", "_origin").lower()


def planted_curve(registry_name: str) -> tuple[np.ndarray, np.ndarray, list[float]]:
    x0, x1, params = PLANTED[registry_name]
    x = np.linspace(x0, x1, N_POINTS)
    p = list(params)
    y = FIT_MODELS[registry_name]["fcn"](x, np.asarray(p, dtype=float))
    return x, np.asarray(y, dtype=float), p


def fit_generator(registry_name: str) -> Generator:
    def gen(rng: np.random.Generator) -> InputSpec:
        x, clean, p = planted_curve(registry_name)
        span = float(np.ptp(clean)) or float(np.max(np.abs(clean)))  # a constant has no range
        sigma = NOISE_FRACTION * span
        y = clean + rng.normal(0.0, sigma, x.size)
        names = FIT_MODELS[registry_name]["paramNames"]
        return InputSpec(
            (Column("x", "X", x), Column("y", "Y", y)),
            {"function": registry_name, "origin_function": origin_name(registry_name),
             "param_names": list(names), "params": p, "noise_sigma": sigma,
             "noise_fraction_of_range": NOISE_FRACTION, "n_points": N_POINTS,
             "lower": FIT_MODELS[registry_name]["lb"], "upper": FIT_MODELS[registry_name]["ub"]},
        )

    return gen
