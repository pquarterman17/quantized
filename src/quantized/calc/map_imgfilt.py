"""Image filters on map datasets: Gaussian, median, uniform (mean), Sobel, Laplacian.

Thin, explicit wrappers on ``scipy.ndimage`` (gaussian_filter, median_filter,
uniform_filter, sobel, laplace) over the ``(ny, nx)`` array of
``calc/map_ops.MapGrid`` (axis 0 is Y, axis 1 is X). The coordinates are
unchanged; only the values are replaced.

**Conventions (provisional, owner to confirm).**

* Sizes are in PIXELS: Gaussian ``sigma`` (> 0, isotropic in pixels), median
  and uniform ``size`` (odd integer >= 3 for median, >= 1 for uniform; square).
* ``edge_mode`` is always explicit and passed straight to scipy:
  ``reflect`` | ``nearest`` | ``mirror`` | ``wrap`` | ``constant`` (with ``cval``).
* ``sobel`` is scipy's unnormalised 3x3 Sobel (gradient times 8 in value per
  pixel): ``x`` (along X), ``y`` (along Y) or the ``magnitude`` hypot of both.
  ``laplacian`` is ``scipy.ndimage.laplace`` (second differences, per pixel^2).
  Their value unit is ``<unit>/px`` and ``<unit>/px^2``.
* Non-finite cells are refused (NaN would spread through every window).

Pure layer: no fastapi / pydantic.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy import ndimage

from quantized.calc.map_ops import MapGrid, replace_grid

__all__ = ["EDGE_MODES", "KINDS", "image_filter"]

EDGE_MODES = ("reflect", "nearest", "mirror", "wrap", "constant")
KINDS = ("gaussian", "median", "uniform", "sobel", "laplacian")


def image_filter(
    g: MapGrid,
    kind: str,
    *,
    sigma: float = 1.0,
    size: int = 3,
    edge_mode: str = "reflect",
    cval: float = 0.0,
    gradient: str = "magnitude",
) -> tuple[MapGrid, dict[str, Any]]:
    """Filter the map values; see the module docstring for parameter meanings."""
    if kind not in KINDS:
        raise ValueError(f"image filter must be one of {list(KINDS)}, got {kind!r}")
    if edge_mode not in EDGE_MODES:
        raise ValueError(f"edge mode must be one of {list(EDGE_MODES)}, got {edge_mode!r}")
    if not np.isfinite(cval):
        raise ValueError("constant edge value must be a number")
    bad = int((~np.isfinite(g.z)).sum())
    if bad:
        raise ValueError(f"the map has {bad} non-finite cell(s); filter windows need finite data")
    kw: dict[str, Any] = {"mode": edge_mode, "cval": cval}
    z, unit = g.z, g.z_unit
    info: dict[str, Any] = {
        "op": "image_filter",
        "kind": kind,
        "edge_mode": edge_mode,
        "cval": cval,
    }
    if kind == "gaussian":
        if not np.isfinite(sigma) or sigma <= 0:
            raise ValueError("Gaussian sigma must be a positive number of pixels")
        out = ndimage.gaussian_filter(z, sigma, **kw)
        info["sigma_px"] = sigma
    elif kind in ("median", "uniform"):
        lo = 3 if kind == "median" else 1
        if int(size) != size or size < lo or (kind == "median" and size % 2 == 0):
            raise ValueError(
                f"{kind} window size must be an integer >= {lo}"
                + (" and odd" if kind == "median" else "")
            )
        f = ndimage.median_filter if kind == "median" else ndimage.uniform_filter
        out = f(z, size=int(size), **kw)
        info["size_px"] = int(size)
    elif kind == "sobel":
        if gradient not in ("magnitude", "x", "y"):
            raise ValueError(f"Sobel output must be magnitude, x or y, got {gradient!r}")
        gx = ndimage.sobel(z, axis=1, **kw)
        gy = ndimage.sobel(z, axis=0, **kw)
        out = np.hypot(gx, gy) if gradient == "magnitude" else gx if gradient == "x" else gy
        unit = f"{unit}/px" if unit else "1/px"
        info["gradient"] = gradient
    else:
        out = ndimage.laplace(z, **kw)
        unit = f"{unit}/px^2" if unit else "1/px^2"
    return replace_grid(g, z=np.asarray(out, dtype=float), z_unit=unit), info
