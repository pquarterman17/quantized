"""SLD-depth-profile helpers for reflectivity. Ports of +fitting SLD functions.

Pure calc layer: sld_profile (layer stack -> error-function SLD(z)), spline_sld
(knots -> interpolated SLD(z)), profile_to_layers (SLD(z) -> discrete layers), and
refl_sld_presets (material SLD table, loaded from JSON for exact data parity).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.special import erf

from .resample import _interp_column

__all__ = ["profile_to_layers", "refl_sld_presets", "sld_profile", "spline_sld"]

_PRESETS_PATH = Path(__file__).parent / "refl_sld_presets.json"
_PRESETS: list[dict[str, Any]] | None = None


def sld_profile(
    layers: ArrayLike, *, n_points: int = 500, padding: float = 50.0
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Layer stack -> (z, SLD) with error-function interfaces. Port of sldProfile."""
    lay = np.asarray(layers, dtype=float)
    n_layers = lay.shape[0]
    d, sld_r, sigma = lay[:, 0], lay[:, 1], lay[:, 3]
    total_thick = float(np.sum(d[1:-1]))
    z = np.linspace(-padding, total_thick + padding, n_points)

    interface_z = np.zeros(n_layers)
    for j in range(1, n_layers - 1):
        interface_z[j] = interface_z[j - 1] + d[j]
    interface_z[n_layers - 1] = total_thick

    sld = np.full(z.shape, sld_r[0])
    for j in range(1, n_layers):
        sig = max(sigma[j], 0.5)
        d_sld = sld_r[j] - sld_r[j - 1]
        sld = sld + d_sld * 0.5 * (1 + erf((z - interface_z[j - 1]) / (sig * math.sqrt(2))))
    return np.asarray(z, dtype=float), np.asarray(sld, dtype=float)


def spline_sld(
    z_knots: ArrayLike,
    sld_knots: ArrayLike,
    *,
    sld_ambient: float = float("nan"),
    sld_substrate: float = float("nan"),
    z_range: tuple[float, float] | None = None,
    n_points: int = 500,
    method: str = "pchip",
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Knot interpolation -> (z, SLD), flat ambient/substrate outside. Port of splineSLD."""
    zk = np.asarray(z_knots, dtype=float).ravel()
    sk = np.asarray(sld_knots, dtype=float).ravel()
    if zk.size < 2:
        raise ValueError("need at least 2 knots")
    if sk.size != zk.size:
        raise ValueError("zKnots and sldKnots must be the same length")
    if np.any(np.diff(zk) <= 0):
        raise ValueError("zKnots must be strictly increasing")
    method = method.lower()
    if method not in ("pchip", "spline", "makima", "linear"):
        raise ValueError("method must be pchip/spline/makima/linear")

    sa = sk[0] if math.isnan(sld_ambient) else sld_ambient
    ss = sk[-1] if math.isnan(sld_substrate) else sld_substrate
    lo, hi = (zk[0] - 50, zk[-1] + 50) if z_range is None else (z_range[0], z_range[1])
    if hi <= lo:
        raise ValueError("z_range[1] must exceed z_range[0]")

    z = np.linspace(lo, hi, n_points)
    sld = np.zeros(z.shape)
    inside = (z >= zk[0]) & (z <= zk[-1])
    if np.any(inside):
        sld[inside] = _interp_column(zk, sk, z[inside], method, False)
    sld[z < zk[0]] = sa
    sld[z > zk[-1]] = ss
    return np.asarray(z, dtype=float), np.asarray(sld, dtype=float)


def profile_to_layers(
    z: ArrayLike,
    sld: ArrayLike,
    *,
    imag_sld: ArrayLike | None = None,
    sld_ambient: float = float("nan"),
    sld_substrate: float = float("nan"),
) -> NDArray[np.float64]:
    """SLD(z) profile -> discrete (M,4) layer stack (midpoint slabs). Port of profileToLayers."""
    zv = np.asarray(z, dtype=float).ravel()
    sldv = np.asarray(sld, dtype=float).ravel()
    n = zv.size
    if n < 2:
        raise ValueError("need at least 2 profile points")
    if sldv.size != n:
        raise ValueError("sld must match z length")
    if np.any(np.diff(zv) <= 0):
        raise ValueError("z must be strictly increasing")
    imag = np.zeros(n) if imag_sld is None else np.asarray(imag_sld, dtype=float).ravel()
    if imag.size != n:
        raise ValueError("imag_sld must match z length")

    sa = sldv[0] if math.isnan(sld_ambient) else sld_ambient
    ss = sldv[-1] if math.isnan(sld_substrate) else sld_substrate
    interior = np.column_stack([
        np.diff(zv),
        0.5 * (sldv[:-1] + sldv[1:]),
        0.5 * (imag[:-1] + imag[1:]),
        np.zeros(n - 1),
    ])
    top = np.array([[0.0, sa, 0.0, 0.0]])
    bot = np.array([[0.0, ss, 0.0, 0.0]])
    return np.asarray(np.vstack([top, interior, bot]), dtype=float)


def refl_sld_presets() -> list[dict[str, Any]]:
    """Material SLD presets (name/formula/sldX/sldN/sldImag/density). Port of reflSLDPresets."""
    global _PRESETS
    if _PRESETS is None:
        _PRESETS = json.loads(_PRESETS_PATH.read_text(encoding="utf-8"))
    return _PRESETS
