"""2D surface model library. Port of MATLAB ``fitting.surfaceModels``.

A registry of named ``z = f(p, x, y)`` surface models (the 2D analogue of
``calc/peakshapes``) used by 2D surface fitting and RSM peak extraction. Each
model carries its parameter names and a human-readable equation. Widths/sigmas
are floored at machine epsilon (matching MATLAB's ``max(p, eps)``) so a
degenerate fit never divides by zero.

Pure calc layer — ndarray in -> ndarray out; no fastapi/pydantic.
"""

from __future__ import annotations

import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = ["SurfaceModel", "surface_models", "get_surface_model"]

_EPS = sys.float_info.epsilon

_Arr = NDArray[np.float64]
# Parameter vector: a plain sequence or a numpy array (both index the same way).
PVec = Sequence[float] | _Arr
SurfaceFunc = Callable[[PVec, _Arr, _Arr], _Arr]


@dataclass(frozen=True, slots=True)
class SurfaceModel:
    name: str
    func: SurfaceFunc
    param_names: tuple[str, ...]
    description: str

    @property
    def n_params(self) -> int:
        return len(self.param_names)


def _xy(x: ArrayLike, y: ArrayLike) -> tuple[_Arr, _Arr]:
    return np.asarray(x, dtype=float), np.asarray(y, dtype=float)


def _plane(p: PVec, x: _Arr, y: _Arr) -> _Arr:
    return np.asarray(p[0] * x + p[1] * y + p[2], dtype=float)


def _paraboloid(p: PVec, x: _Arr, y: _Arr) -> _Arr:
    return np.asarray(
        p[0] * x**2 + p[1] * y**2 + p[2] * x * y + p[3] * x + p[4] * y + p[5], dtype=float
    )


def _gaussian2d(p: PVec, x: _Arr, y: _Arr) -> _Arr:
    sx = max(p[2], _EPS)
    sy = max(p[4], _EPS)
    z = p[0] * np.exp(-((x - p[1]) ** 2 / (2 * sx**2) + (y - p[3]) ** 2 / (2 * sy**2))) + p[5]
    return np.asarray(z, dtype=float)


def _lorentzian2d(p: PVec, x: _Arr, y: _Arr) -> _Arr:
    wx = max(p[2], _EPS)
    wy = max(p[4], _EPS)
    z = p[0] / (1 + ((x - p[1]) / wx) ** 2 + ((y - p[3]) / wy) ** 2) + p[5]
    return np.asarray(z, dtype=float)


def _pseudo_voigt2d(p: PVec, x: _Arr, y: _Arr) -> _Arr:
    amp, x0, y0, z0 = p[0], p[1], p[3], p[5]
    wx = max(p[2], _EPS)
    wy = max(p[4], _EPS)
    eta = max(min(p[6], 1.0), 0.0)  # clamp to [0, 1]
    gauss = amp * np.exp(-((x - x0) ** 2 / (2 * wx**2) + (y - y0) ** 2 / (2 * wy**2)))
    loren = amp / (1 + ((x - x0) / wx) ** 2 + ((y - y0) / wy) ** 2)
    return np.asarray(eta * loren + (1 - eta) * gauss + z0, dtype=float)


def _poly2d(p: PVec, x: _Arr, y: _Arr) -> _Arr:
    return np.asarray(
        p[0] + p[1] * x + p[2] * y + p[3] * x**2 + p[4] * x * y + p[5] * y**2, dtype=float
    )


def _exp_decay2d(p: PVec, x: _Arr, y: _Arr) -> _Arr:
    tx = max(p[1], _EPS)
    ty = max(p[2], _EPS)
    return np.asarray(p[0] * np.exp(-x / tx - y / ty) + p[3], dtype=float)


# Wrap each kernel so callers may pass any array-like x/y (matches MATLAB's
# element-wise handles) and always receive float64 ndarrays.
def _wrap(fn: SurfaceFunc) -> SurfaceFunc:
    def wrapped(p: PVec, x: ArrayLike, y: ArrayLike) -> NDArray[np.float64]:
        xa, ya = _xy(x, y)
        return fn(p, xa, ya)

    return wrapped


_CATALOG: tuple[SurfaceModel, ...] = (
    SurfaceModel("Plane", _wrap(_plane), ("a", "b", "c"), "z = a·x + b·y + c"),
    SurfaceModel(
        "Paraboloid",
        _wrap(_paraboloid),
        ("a", "b", "c", "d", "e", "f"),
        "z = a·x² + b·y² + c·xy + d·x + e·y + f",
    ),
    SurfaceModel(
        "2D Gaussian",
        _wrap(_gaussian2d),
        ("A", "x0", "sx", "y0", "sy", "z0"),
        "z = A·exp(-((x-x0)²/(2σx²) + (y-y0)²/(2σy²))) + z0",
    ),
    SurfaceModel(
        "2D Lorentzian",
        _wrap(_lorentzian2d),
        ("A", "x0", "wx", "y0", "wy", "z0"),
        "z = A / (1 + ((x-x0)/wx)² + ((y-y0)/wy)²) + z0",
    ),
    SurfaceModel(
        "2D Pseudo-Voigt",
        _wrap(_pseudo_voigt2d),
        ("A", "x0", "wx", "y0", "wy", "z0", "eta"),
        "z = η·Lorentzian + (1-η)·Gaussian + z0  (0 ≤ η ≤ 1)",
    ),
    SurfaceModel(
        "Polynomial 2D",
        _wrap(_poly2d),
        ("a00", "a10", "a01", "a20", "a11", "a02"),
        "z = a00 + a10·x + a01·y + a20·x² + a11·xy + a02·y²",
    ),
    SurfaceModel(
        "Exponential Decay 2D",
        _wrap(_exp_decay2d),
        ("A", "tx", "ty", "z0"),
        "z = A·exp(-x/τx - y/τy) + z0",
    ),
)

_BY_NAME = {m.name: m for m in _CATALOG}


def surface_models() -> tuple[SurfaceModel, ...]:
    """The built-in 2D surface model catalog (in display order)."""
    return _CATALOG


def get_surface_model(name: str) -> SurfaceModel:
    """Look up a model by display name (e.g. ``"2D Gaussian"``)."""
    try:
        return _BY_NAME[name]
    except KeyError:
        raise ValueError(f"unknown surface model {name!r}") from None
