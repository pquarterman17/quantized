"""Credible bands for a reflectivity posterior (audit P2.2, used by
:mod:`quantized.calc.refl_dream`).

Pure calc layer. Given posterior draws of the bound-normalised free vector,
the R(Q) band of each channel on its fitted points and the SLD(z) band of
each spin state on one common z grid (each draw's ``sld_profile``
interpolated onto it): the ``PERCENTILES`` over the draws. Stops only for a
cancel (``abort_check``); the caller bounds the cost through the draw count.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.dream_seed import DreamCancelled
from quantized.calc.refl_fit import channel_model
from quantized.calc.refl_model import ReflChannel, ReflParams, layer_stack
from quantized.calc.sld import sld_profile

__all__ = ["PERCENTILES", "posterior_bands"]

#: The band percentiles, low to high.
PERCENTILES = (2.5, 16.0, 50.0, 84.0, 97.5)
_BAND_KEYS = ("lo95", "lo68", "median", "hi68", "hi95")

ProgressFn = Callable[[float], None]
AbortFn = Callable[[], bool]


def _percentile_rows(stack: NDArray[np.float64]) -> dict[str, list[float]]:
    rows = np.percentile(stack, PERCENTILES, axis=0)
    return {key: np.asarray(row, dtype=float).tolist()
            for key, row in zip(_BAND_KEYS, rows, strict=True)}


def posterior_bands(
    params: ReflParams, chans: list[ReflChannel], masks: list[NDArray[np.bool_]], n_layers: int,
    xs: NDArray[np.float64], sld_points: int, progress_callback: ProgressFn | None,
    abort_check: AbortFn | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """R(Q) percentile bands per channel and SLD(z) bands per spin state."""
    models: list[list[NDArray[np.float64]]] = [[] for _ in chans]
    spins = sorted({c.spin for c in chans})
    Profile = tuple[NDArray[np.float64], NDArray[np.float64]]
    profiles: dict[int, list[Profile]] = {s: [] for s in spins}
    for j, x in enumerate(xs):
        if abort_check is not None and abort_check():
            raise DreamCancelled("cancelled while computing the bands")
        if progress_callback is not None and j % 20 == 0:
            progress_callback(0.95 + 0.04 * j / max(1, len(xs)))
        v = params.full(x)
        for c, m, acc in zip(chans, masks, models, strict=True):
            acc.append(channel_model(c, params, v, n_layers, m))
        for s in spins:
            z, sld = sld_profile(layer_stack(params, v, n_layers, s), n_points=sld_points)
            profiles[s].append((np.asarray(z, dtype=float), np.asarray(sld, dtype=float)))
    r_bands = [{
        "label": c.label, "spin": c.spin_label,
        "q": c.q_all[m].tolist(), "r": c.r_all[m].tolist(),
        "dr": None if c.dr is None else c.dr[m].tolist(),
        **_percentile_rows(np.vstack(acc)),
    } for c, m, acc in zip(chans, masks, models, strict=True)]
    sld_bands = []
    for s in spins:
        lo = min(float(z[0]) for z, _ in profiles[s])
        hi = max(float(z[-1]) for z, _ in profiles[s])
        grid = np.linspace(lo, hi, sld_points)
        # Outside a draw's own range its profile is flat (ambient / substrate),
        # which is exactly what np.interp's end-value hold gives.
        stack = np.vstack([np.interp(grid, z, sld) for z, sld in profiles[s]])
        sld_bands.append({"spin": {0: None, 1: "+", -1: "-"}[s], "z": grid.tolist(),
                          **_percentile_rows(stack)})
    return r_bands, sld_bands
