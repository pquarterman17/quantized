"""Bauer-criterion growth-mode verdict across a range of interface energy.

Bauer (Z. Kristallogr. 110, 372 (1958)): with substrate surface energy
``g_s``, film surface energy ``g_f`` and interface energy ``g_int``, define
``delta = g_f + g_int - g_s``.

* ``delta < 0``: the film wets the substrate; layer-by-layer growth,
  Frank-van der Merwe (FvdM).
* ``delta > 0``: the film does not wet; three-dimensional islands,
  Volmer-Weber (VW).
* Stranski-Krastanov (SK): wetting at the first layer, but ``delta`` turns
  positive as the film thickens (strain energy accumulates).  A static
  inequality cannot show that, so the caller may supply ``strain_penalty``
  (>= 0, same energy unit): the amount by which ``delta`` rises at the thick
  limit.  With 0 (the default) SK is never reported.  Provisional, owner to
  confirm: this one-number SK model.

``g_int`` is usually unknown, so it is scanned over a user range; no surface
or interface energy is stored here.  The inputs carry their own uncertainty:
``uncertainty`` (>= 0, same unit) is the combined +/- on ``delta``; a point
within it of a boundary is reported ``indeterminate`` instead of guessed.
Energies are unit-agnostic (use one unit throughout).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

__all__ = ["VERDICTS", "bauer_scan"]

VERDICTS = {
    "FvdM": "Frank-van der Merwe (layer-by-layer)",
    "VW": "Volmer-Weber (islands)",
    "SK": "Stranski-Krastanov (layer then islands)",
    "indeterminate": "indeterminate (within the stated uncertainty of a boundary)",
}


def _verdict(delta: float, penalty: float, u: float) -> str:
    if abs(delta) <= u:
        return "indeterminate"
    if delta > 0:
        return "VW"
    if penalty > 0:
        thick = delta + penalty
        if abs(thick) <= u:
            return "indeterminate"
        if thick > 0:
            return "SK"
    return "FvdM"


def bauer_scan(
    gamma_substrate: float,
    gamma_film: float,
    gamma_int_min: float,
    gamma_int_max: float,
    n: int = 11,
    *,
    uncertainty: float = 0.0,
    strain_penalty: float = 0.0,
) -> dict[str, Any]:
    """Verdict at ``n`` evenly spaced ``g_int`` values plus the exact boundaries.

    Boundaries (``g_int`` values where the verdict changes, before applying
    ``uncertainty``): ``vw_onset = g_s - g_f`` and, when ``strain_penalty`` > 0,
    ``sk_onset = g_s - g_f - strain_penalty``.

    Raises:
        ValueError: non-finite/non-positive surface energies, negative
            ``g_int`` or ``uncertainty``/``strain_penalty``, empty range, or
            ``n`` outside 2..2000.
    """
    for name, v in (("gamma_substrate", gamma_substrate), ("gamma_film", gamma_film)):
        if not (math.isfinite(v) and v > 0):
            raise ValueError(f"{name} must be positive and finite")
    for name, v in (
        ("gamma_int_min", gamma_int_min),
        ("gamma_int_max", gamma_int_max),
        ("uncertainty", uncertainty),
        ("strain_penalty", strain_penalty),
    ):
        if not (math.isfinite(v) and v >= 0):
            raise ValueError(f"{name} must be non-negative and finite")
    if gamma_int_max <= gamma_int_min:
        raise ValueError("gamma_int_max must exceed gamma_int_min")
    if not 2 <= n <= 2000:
        raise ValueError("n must be between 2 and 2000")

    grid = np.linspace(gamma_int_min, gamma_int_max, n)
    points = []
    for g in grid:
        delta = gamma_film + float(g) - gamma_substrate
        points.append(
            {
                "gamma_int": float(g),
                "delta": delta,
                "verdict": _verdict(delta, strain_penalty, uncertainty),
            }
        )
    boundaries = [
        {
            "name": "vw_onset",
            "gamma_int": gamma_substrate - gamma_film,
            "between": ["FvdM/SK", "VW"],
        }
    ]
    if strain_penalty > 0:
        boundaries.append(
            {
                "name": "sk_onset",
                "gamma_int": gamma_substrate - gamma_film - strain_penalty,
                "between": ["FvdM", "SK"],
            }
        )
    return {
        "points": points,
        "boundaries": boundaries,
        "uncertainty": uncertainty,
        "strain_penalty": strain_penalty,
        "verdict_labels": VERDICTS,
        "note": (
            "Bauer inequality on user-supplied energies; the verdict is only as reliable as "
            "the inputs. Set an uncertainty to see the indeterminate band."
        ),
    }
