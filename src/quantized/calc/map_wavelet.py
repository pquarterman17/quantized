"""2-D wavelet denoise and smooth of a map (Origin gap plan item 6, G22 residue).

``pywt.wavedec2`` / ``waverec2`` over the ``(ny, nx)`` array of
``calc.map_ops.MapGrid`` (axis 0 is Y, axis 1 is X); the axes, labels and units
are unchanged and only the values are replaced. PyWavelets is the same optional
``[wavelets]`` extra as the 1-D transforms: without it the op refuses with the
install instruction (``wavelets.WAVELETS_MISSING``).

Conventions:

* Coefficients are ``[cA_n, (cH_n, cV_n, cD_n), ..., (cH_1, cV_1, cD_1)]``;
  level 1 is the finest. The reconstruction is trimmed to the map's shape.
* ``denoise`` thresholds every detail band (H, V, D, all levels), never the
  approximation. The noise estimate is ``sigma = median(|cD_1|) / 0.6745`` (the
  finest DIAGONAL band, Donoho-Johnstone) and the universal threshold is
  ``sigma * sqrt(2 ln N)`` with ``N`` the number of cells. ``value`` overrides
  it with an absolute threshold in the map's value unit; ``0`` changes nothing
  (a round trip to rounding, 1e-12).
* ``smooth`` zeroes the chosen detail levels (all three bands of each).
* Non-finite cells are refused (a transform spreads them everywhere).

Pure layer: no fastapi / pydantic.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from quantized.calc import wavelets as wv
from quantized.calc.map_ops import MapGrid, replace_grid

__all__ = ["wavelet_map"]

ACTIONS = ("denoise", "smooth")
_MAD_TO_SIGMA = 0.6745
_DEFAULT_LEVEL = 3


def _check(g: MapGrid, wavelet: str, mode: str, level: int | None) -> int:
    wv.check_discrete(wavelet, mode)
    if mode == "origin-periodic":
        raise ValueError("origin-periodic is a 1-D convention; choose another edge extension")
    bad = int((~np.isfinite(g.z)).sum())
    if bad:
        raise ValueError(
            f"the map has {bad} non-finite cell(s); a wavelet transform needs finite data"
        )
    pywt = wv.pywt_module()
    top = int(pywt.dwtn_max_level(g.z.shape, wavelet))
    if top < 1:
        raise ValueError(f"a {g.z.shape[0]} x {g.z.shape[1]} map is too small for {wavelet}")
    if level is None:
        return min(_DEFAULT_LEVEL, top)
    if not 1 <= level <= top:
        raise ValueError(f"level must be 1 to {top} for this map and {wavelet} (got {level})")
    return int(level)


def _shrink(pywt: Any, band: Any, t: float, how: str) -> Any:
    """``pywt.threshold``, except that ``t == 0`` returns the band (soft shrinkage
    with a zero threshold is 0/0 on zero coefficients: NaN)."""
    return (
        np.asarray(band, dtype=float)
        if t <= 0.0
        else np.asarray(pywt.threshold(band, t, mode=how), dtype=float)
    )


def wavelet_map(
    g: MapGrid,
    action: str,
    *,
    wavelet: str = "db4",
    level: int | None = None,
    mode: str = "symmetric",
    threshold: str = "soft",
    value: float | None = None,
    zero: str = "1",
) -> tuple[MapGrid, dict[str, Any]]:
    """Denoise (threshold the detail bands) or smooth (zero detail levels) a map."""
    if action not in ACTIONS:
        raise ValueError(f"wavelet action must be one of {list(ACTIONS)}, got {action!r}")
    if threshold not in ("soft", "hard"):
        raise ValueError("threshold mode must be soft or hard")
    lev = _check(g, wavelet, mode, level)
    pywt = wv.pywt_module()
    shape = g.z.shape
    coeffs = pywt.wavedec2(g.z, wavelet, mode=mode, level=lev)
    info: dict[str, Any] = {
        "op": "wavelet2d", "action": action, "wavelet": wavelet, "level": lev, "mode": mode,
    }  # fmt: skip
    if action == "denoise":
        sigma = float(np.median(np.abs(coeffs[-1][2])) / _MAD_TO_SIGMA)
        if value is None:
            t = sigma * math.sqrt(2.0 * math.log(max(g.z.size, 2)))
        elif math.isfinite(value) and value >= 0:
            t = float(value)
        else:
            raise ValueError("the threshold must be zero or a positive number")
        coeffs = [coeffs[0]] + [
            tuple(_shrink(pywt, b, t, threshold) for b in band) for band in coeffs[1:]
        ]
        info.update(sigma=sigma, threshold_value=t, threshold=threshold, custom=value is not None)
    else:
        levels = wv.parse_levels(zero, lev, allow_approx=False)
        names = [f"D{j}" for j in range(lev, 0, -1)]  # coefficient order: coarse to fine
        coeffs = [coeffs[0]] + [
            tuple(np.zeros_like(b) for b in band) if n in levels else band
            for n, band in zip(names, coeffs[1:], strict=True)
        ]
        info["zeroed"] = sorted(levels)
    out = np.asarray(pywt.waverec2(coeffs, wavelet, mode=mode), dtype=float)[: shape[0], : shape[1]]
    return replace_grid(g, z=out), info
