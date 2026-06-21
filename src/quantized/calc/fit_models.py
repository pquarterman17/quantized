"""Curve-fit model library. Port of fitting.models (the model evaluators).

Pure calc layer. Each model is ``f(x, p) -> y``; ``FIT_MODELS`` maps a model name
to its evaluator plus metadata (p0 / lower / upper bounds / paramNames). Closed-
form models live here; helper-based magnetic/thermal models (Langevin, Brillouin,
Stoner-Wohlfarth, Debye, Einstein) are registered in ``fit_models_special``.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from .peakshapes import pseudo_voigt

__all__ = ["FIT_MODELS", "evaluate", "model_names", "register_model"]

_INF = float("inf")
_EPS = float(np.finfo(float).eps)
_FWHM_PER_SIGMA = 2.0 * math.sqrt(2.0 * math.log(2.0))

ModelFn = Callable[[NDArray[np.float64], NDArray[np.float64]], NDArray[np.float64]]

FIT_MODELS: dict[str, dict[str, Any]] = {}


def register_model(
    name: str, category: str, fcn: ModelFn, param_names: list[str],
    p0: list[float], lb: list[float], ub: list[float],
) -> None:
    FIT_MODELS[name] = {
        "fcn": fcn, "category": category, "paramNames": param_names,
        "p0": p0, "lb": lb, "ub": ub, "nParams": len(p0),
    }


def evaluate(name: str, x: ArrayLike, p: ArrayLike) -> NDArray[np.float64]:
    """Evaluate model ``name`` at points ``x`` with parameters ``p``."""
    fcn: ModelFn = FIT_MODELS[name]["fcn"]
    return np.asarray(fcn(np.asarray(x, dtype=float), np.asarray(p, dtype=float)), dtype=float)


def model_names() -> list[str]:
    return list(FIT_MODELS)


# ── Linear / polynomial ─────────────────────────────────────────────────
def _linear(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * x + p[1], dtype=float)


def _quadratic(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * x**2 + p[1] * x + p[2], dtype=float)


def _cubic(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * x**3 + p[1] * x**2 + p[2] * x + p[3], dtype=float)


def _poly4(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * x**4 + p[1] * x**3 + p[2] * x**2 + p[3] * x + p[4], dtype=float)


# ── Decay / growth ──────────────────────────────────────────────────────
def _exp_decay(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.exp(-x / p[1]) + p[2], dtype=float)


def _stretched_exp(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.exp(-((x / p[1]) ** p[2])) + p[3], dtype=float)


def _biexp_decay(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.exp(-x / p[1]) + p[2] * np.exp(-x / p[3]) + p[4], dtype=float)


def _exp_growth(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.exp(x / p[1]) + p[2], dtype=float)


def _sat_growth(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * (1 - np.exp(-x / p[1])) + p[2], dtype=float)


# ── Peak shapes ─────────────────────────────────────────────────────────
def _gaussian(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.exp(-((x - p[1]) ** 2) / (2 * p[2] ** 2)), dtype=float)


def _lorentzian(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] / (1 + ((x - p[1]) / p[2]) ** 2), dtype=float)


def _pseudo_voigt(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return pseudo_voigt(x, float(p[1]), _FWHM_PER_SIGMA * float(p[2]), float(p[0]), float(p[3]))


# ── Power / sigmoid / misc ──────────────────────────────────────────────
def _power_law(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.abs(x) ** p[1] + p[2], dtype=float)


def _allometric(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.abs(x) ** p[1], dtype=float)


def _logistic(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] / (1 + np.exp(-p[1] * (x - p[2]))) + p[3], dtype=float)


def _tanh(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.tanh(p[1] * (x - p[2])) + p[3], dtype=float)


def _curie_weiss(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] / (x - p[1]), dtype=float)


def _bloch(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * (1 - p[1] * x**1.5), dtype=float)


def _arrhenius(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.exp(-p[1] / x), dtype=float)


def _vft(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.exp(p[1] / (8.617e-5 * (x - p[2]))), dtype=float)


def _langmuir(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * x / (p[1] + x), dtype=float)


def _logarithmic(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.log(np.abs(x) + _EPS) + p[1], dtype=float)


def _sqrt(x: NDArray[np.float64], p: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(p[0] * np.sqrt(np.abs(x)) + p[1], dtype=float)


# ── Registry (closed-form models) ───────────────────────────────────────
register_model("Linear", "Linear", _linear, ["m", "b"], [1, 0], [-_INF, -_INF], [_INF, _INF])
register_model("Quadratic", "Linear", _quadratic, ["a", "b", "c"], [0, 1, 0],
               [-_INF, -_INF, -_INF], [_INF, _INF, _INF])
register_model("Cubic", "Linear", _cubic, ["a", "b", "c", "d"], [0, 0, 1, 0],
               [-_INF] * 4, [_INF] * 4)
register_model("Poly 4", "Linear", _poly4, ["a", "b", "c", "d", "e"], [0, 0, 0, 1, 0],
               [-_INF] * 5, [_INF] * 5)
register_model("Exponential Decay", "Decay", _exp_decay, ["A", "τ", "C"], [1, 1, 0],
               [-_INF, 0, -_INF], [_INF, _INF, _INF])
register_model("Stretched Exponential", "Decay", _stretched_exp, ["A", "τ", "β", "C"],
               [1, 1, 0.5, 0], [-_INF, 0, 0, -_INF], [_INF, _INF, 2, _INF])
register_model("Bi-exponential Decay", "Decay", _biexp_decay, ["A₁", "τ₁", "A₂", "τ₂", "C"],
               [1, 1, 0.5, 5, 0], [-_INF, 0, -_INF, 0, -_INF], [_INF] * 5)
register_model("Exponential Growth", "Growth", _exp_growth, ["A", "τ", "C"], [1, 1, 0],
               [-_INF, 0, -_INF], [_INF, _INF, _INF])
register_model("Saturation Growth", "Growth", _sat_growth, ["A", "τ", "C"], [1, 1, 0],
               [-_INF, 0, -_INF], [_INF, _INF, _INF])
register_model("Gaussian", "Peak", _gaussian, ["A", "μ", "σ"], [1, 0, 1],
               [-_INF, -_INF, 0], [_INF, _INF, _INF])
register_model("Lorentzian", "Peak", _lorentzian, ["A", "x₀", "γ"], [1, 0, 1],
               [-_INF, -_INF, 0], [_INF, _INF, _INF])
register_model("Pseudo-Voigt", "Peak", _pseudo_voigt, ["A", "x₀", "w", "η"], [1, 0, 1, 0.5],
               [-_INF, -_INF, 0, 0], [_INF, _INF, _INF, 1])
register_model("Power Law", "Power", _power_law, ["A", "n", "C"], [1, 1, 0],
               [-_INF, -_INF, -_INF], [_INF, _INF, _INF])
register_model("Allometric", "Power", _allometric, ["A", "n"], [1, 1], [-_INF, -_INF], [_INF, _INF])
register_model("Logistic", "Sigmoid", _logistic, ["A", "k", "x₀", "C"], [1, 1, 0, 0],
               [-_INF, 0, -_INF, -_INF], [_INF, _INF, _INF, _INF])
register_model("Tanh", "Sigmoid", _tanh, ["A", "k", "x₀", "C"], [1, 1, 0, 0],
               [-_INF, 0, -_INF, -_INF], [_INF, _INF, _INF, _INF])
register_model("Curie-Weiss", "Magnetic", _curie_weiss, ["C", "θ"], [1, 0],
               [0, -_INF], [_INF, _INF])
register_model("Bloch T^3/2", "Magnetic", _bloch, ["M₀", "B"], [1, 1e-5], [0, 0], [_INF, _INF])
register_model("Arrhenius", "Thermal", _arrhenius, ["A", "Eₐ/kB"], [1, 1000], [0, 0], [_INF, _INF])
register_model("VFT", "Decay", _vft, ["τ₀", "Ea_eV", "T₀"], [1e-10, 0.05, 0], [0, 0, 0],
               [1, 10, _INF])
register_model("Langmuir", "Thermal", _langmuir, ["A", "K"], [1, 1], [0, 0], [_INF, _INF])
register_model("Logarithmic", "Other", _logarithmic, ["a", "b"], [1, 0], [-_INF, -_INF],
               [_INF, _INF])
register_model("Square Root", "Other", _sqrt, ["a", "b"], [1, 0], [-_INF, -_INF], [_INF, _INF])

# Register the helper-based magnetic/heat-capacity models (side-effect import).
from . import fit_models_special  # noqa: E402, F401
