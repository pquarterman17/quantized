r"""The mixed-shape peak model's shape table: fields, kinds, curves, FWHM, area.

Pure calc layer, the single home of what each shape of
:mod:`quantized.calc.peak_model` reads and reports, and of the model's
evaluation (:class:`PeakModel`: peaks + polynomial background). The profiles
themselves live in :mod:`quantized.calc.peakshapes`.

Convention: ``height`` is the profile's value AT ``center`` above the
background. For every shape but ``fano`` and ``doniach_sunjic`` that is also
its maximum; for those two the maximum lies off ``center`` (see
:func:`quantized.calc.peakshapes.fano` / ``doniach_sunjic``) and the reported
``center``/``height`` are still the parameters. Area is linear in ``height``
for every shape that has one.

Fields (in order; every shape starts ``center, height``), FWHM and area, with
H = height, w = fwhm, W = (fwhm_left + fwhm_right)/2, pv(e) = e*AREA_L +
(1-e)*AREA_G (AREA_G = sqrt(pi/ln 2)/2, AREA_L = pi/2):

==================  =======================  ===================  ================
shape               further fields           FWHM                 area
==================  =======================  ===================  ================
gaussian            fwhm                     w                    H w pv(0)
lorentzian          fwhm                     w                    H w pv(1)
pseudo_voigt        fwhm, eta                w                    H w pv(eta)
voigt               fwhm_g, fwhm_l           Olivero-Longbothum   H / V(0)
split_gaussian      fwhm_left, fwhm_right    W                    H W pv(0)
split_lorentzian    fwhm_left, fwhm_right    W                    H W pv(1)
split_pseudo_voigt  fwhm_left, fwhm_right,   W                    H W pv(eta)
                    eta
pearson_vii         fwhm, m                  w                    Gamma closed form
fano                fwhm, inv_q              closed form, |s|<1   none
doniach_sunjic      fwhm, alpha              root finding         none
==================  =======================  ===================  ================

Kinds and their physical rules (:data:`KIND_RULES`): every width is > 0 (a
FIXED Voigt component may be 0); ``eta`` in [0, 1]; ``m`` >= 0.5 (start
above it); ``alpha`` in [0, 1); ``inv_q`` (= 1/q, 0 = Lorentzian) is free.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

from quantized.calc.peakshapes import (
    doniach_sunjic,
    doniach_sunjic_fwhm,
    fano,
    fano_fwhm,
    gaussian,
    lorentzian,
    pearson_vii,
    pearson_vii_area,
    pseudo_voigt,
    pseudo_voigt_area,
    split_gaussian,
    split_lorentzian,
    split_pseudo_voigt,
    voigt,
    voigt_area,
)

__all__ = [
    "BACKGROUNDS",
    "KIND_RULES",
    "NO_AREA_SHAPES",
    "SHAPES",
    "WIDTHS",
    "PeakModel",
    "model_parameter_names",
    "peak_area",
    "peak_fwhm",
    "shape_curve",
]

SHAPES: dict[str, tuple[str, ...]] = {
    "gaussian": ("center", "height", "fwhm"),
    "lorentzian": ("center", "height", "fwhm"),
    "pseudo_voigt": ("center", "height", "fwhm", "eta"),
    "voigt": ("center", "height", "fwhm_g", "fwhm_l"),
    "split_gaussian": ("center", "height", "fwhm_left", "fwhm_right"),
    "split_lorentzian": ("center", "height", "fwhm_left", "fwhm_right"),
    "split_pseudo_voigt": ("center", "height", "fwhm_left", "fwhm_right", "eta"),
    "pearson_vii": ("center", "height", "fwhm", "m"),
    "fano": ("center", "height", "fwhm", "inv_q"),
    "doniach_sunjic": ("center", "height", "fwhm", "alpha"),
}
#: Shapes whose integral diverges: no area, so no area-ratio tie either.
NO_AREA_SHAPES = frozenset({"fano", "doniach_sunjic"})
BACKGROUNDS: dict[str, int] = {"none": 0, "constant": 1, "linear": 2, "quadratic": 3}
WIDTHS = ("fwhm", "fwhm_g", "fwhm_l", "fwhm_left", "fwhm_right")

# kind -> (value lo, lo inclusive, value hi, hi inclusive, default (min, max)
# when varying). A start value and any user bound must satisfy the value range.
KIND_RULES: dict[str, tuple[float, bool, float, bool, tuple[float | None, float | None]]] = {
    "eta": (0.0, True, 1.0, True, (0.0, 1.0)),
    "m": (0.5, True, math.inf, False, (0.5, None)),
    "alpha": (0.0, True, 1.0, False, (0.0, 0.99)),
}


def shape_curve(shape: str, x: NDArray[np.float64], p: list[float]) -> NDArray[np.float64]:
    """One peak from its field values in :data:`SHAPES` order."""
    c, h = p[0], p[1]
    if shape == "gaussian":
        return gaussian(x, c, p[2], h)
    if shape == "lorentzian":
        return lorentzian(x, c, p[2], h)
    if shape == "voigt":
        return voigt(x, c, p[2], p[3], h)
    if shape == "pseudo_voigt":
        return pseudo_voigt(x, c, p[2], h, p[3])
    if shape == "split_gaussian":
        return split_gaussian(x, c, p[2], p[3], h)
    if shape == "split_lorentzian":
        return split_lorentzian(x, c, p[2], p[3], h)
    if shape == "split_pseudo_voigt":
        return split_pseudo_voigt(x, c, p[2], p[3], h, p[4])
    if shape == "pearson_vii":
        return pearson_vii(x, c, p[2], h, p[3])
    if shape == "fano":
        return fano(x, c, p[2], h, p[3])
    if shape == "doniach_sunjic":
        return doniach_sunjic(x, c, p[2], h, p[3])
    raise ValueError(f"unknown shape '{shape}'")


def peak_fwhm(shape: str, p: list[float]) -> float | None:
    """Full width at half maximum, or None where the shape has none (a Fano
    with |inv_q| >= 1). Exact for G/L/pV/PVII and the split shapes; Voigt by
    Olivero & Longbothum (1977), 0.5346 fL + sqrt(0.2166 fL^2 + fG^2), ~0.02 %
    (exact at fL = 0); Doniach-Sunjic by root finding to ~1e-15."""
    if shape == "voigt":
        fg, fl = p[2], p[3]
        return 0.5346 * fl + math.sqrt(0.2166 * fl**2 + fg**2)
    if shape.startswith("split_"):
        return 0.5 * (p[2] + p[3])
    if shape == "fano":
        return fano_fwhm(p[2], p[3])
    if shape == "doniach_sunjic":
        return doniach_sunjic_fwhm(p[2], p[3])
    return p[2]


def peak_area(shape: str, p: list[float]) -> float | None:
    """Integrated area (closed forms in :mod:`quantized.calc.peakshapes`), or
    None for the shapes in :data:`NO_AREA_SHAPES`; see the module table."""
    if shape == "voigt":
        return voigt_area(p[1], p[2], p[3])
    if shape in NO_AREA_SHAPES:
        return None
    if shape == "pearson_vii":
        return pearson_vii_area(p[1], p[2], p[3])
    if shape.startswith("split_"):
        eta = {"split_gaussian": 0.0, "split_lorentzian": 1.0}.get(shape, p[-1])
        return pseudo_voigt_area(p[1], 0.5 * (p[2] + p[3]), eta)
    eta = {"gaussian": 0.0, "lorentzian": 1.0}.get(shape, p[3] if len(p) > 3 else 0.0)
    return pseudo_voigt_area(p[1], p[2], eta)


def model_parameter_names(shapes: list[str], background: str) -> list[str]:
    """Every parameter name the model reads, in canonical order."""
    if background not in BACKGROUNDS:
        raise ValueError(f"background must be one of {tuple(BACKGROUNDS)}")
    if not shapes:
        raise ValueError("the model needs at least one peak")
    names: list[str] = []
    for i, shape in enumerate(shapes):
        if shape not in SHAPES:
            raise ValueError(f"peak {i}: unknown shape '{shape}' (one of {tuple(SHAPES)})")
        names += [f"p{i}.{f}" for f in SHAPES[shape]]
    names += [f"bg.c{k}" for k in range(BACKGROUNDS[background])]
    return names


class PeakModel:
    """Peak shapes + background over named parameters (see :mod:`quantized.calc.peak_model`)."""

    def __init__(self, shapes: list[str], background: str, x_ref: float) -> None:
        self.names = model_parameter_names(shapes, background)
        self.shapes = list(shapes)
        self.x_ref = float(x_ref)
        idx = {n: i for i, n in enumerate(self.names)}
        self.fields = [[idx[f"p{i}.{f}"] for f in SHAPES[s]] for i, s in enumerate(shapes)]
        self.bg_idx = [idx[f"bg.c{k}"] for k in range(BACKGROUNDS[background])]

    def background(self, x: NDArray[np.float64], v: NDArray[np.float64]) -> NDArray[np.float64]:
        t = x - self.x_ref
        out = np.zeros_like(x)
        for k, i in enumerate(self.bg_idx):
            out = out + float(v[i]) * t**k
        return np.asarray(out, dtype=float)

    def component(self, k: int, x: NDArray[np.float64],
                  v: NDArray[np.float64]) -> NDArray[np.float64]:
        """Peak ``k`` alone (no background)."""
        return shape_curve(self.shapes[k], x, [float(v[i]) for i in self.fields[k]])

    def evaluate(self, x: NDArray[np.float64], v: NDArray[np.float64]) -> NDArray[np.float64]:
        y = self.background(x, v)
        for k in range(len(self.shapes)):
            y = y + self.component(k, x, v)
        return np.asarray(y, dtype=float)
