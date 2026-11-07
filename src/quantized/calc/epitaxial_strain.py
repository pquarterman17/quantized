r"""Epitaxial-film strain helpers (DiraCulator ``buildCrystalTab`` Cards 6-7).

Ports ``+calc/+crystal/tetragonalDistortion.m`` and
``+calc/+crystal/strainFromPoisson.m``. Pure calc layer — scalars in, result
dicts out.

**Tetragonal distortion** of a strained film, from its relaxed (bulk) in-plane
parameter ``a_relaxed`` and its measured out-of-plane parameter ``c_measured``:

.. math::

    c/a = \frac{c_\text{meas}}{a_\text{relaxed}}, \qquad
    \delta = \frac{c_\text{meas} - c_\text{relaxed}}{c_\text{relaxed}} \times 100\,\%

``c_relaxed`` defaults to ``a_relaxed`` (a cubic bulk reference).

**Poisson coupling** for biaxial in-plane strain
(``ε_xx = ε_yy = ε_∥``) with a free out-of-plane surface (isotropic elasticity):

.. math::

    \varepsilon_\perp = -\frac{2\nu}{1-\nu}\,\varepsilon_\parallel

Tensile in-plane strain (``ε_∥ > 0``) gives c-axis compression (``ε_⊥ < 0``).

MATLAB's ``latex`` result fields are GUI display strings and are not ported.
Output keys are snake_case (``c_over_a``, ``eps_perp`` …) where MATLAB uses
camelCase; the golden tests remap them.

Reference (the MATLAB docstring examples): BaTiO3 film, ``a = 4.00 Å``,
``c = 4.03 Å`` → ``c/a = 1.0075``, ``δ = 0.75 %``; ``ε_∥ = 0.01``, ``ν = 0.3``
→ ``ε_⊥ ≈ −0.00857``.
"""

from __future__ import annotations

import math
from typing import Any

__all__ = ["strain_from_poisson", "tetragonal_distortion"]


def _positive(name: str, value: float) -> None:
    if not (math.isfinite(value) and value > 0):
        raise ValueError(f"{name} must be positive and finite")


def tetragonal_distortion(
    a_relaxed: float, c_measured: float, *, c_relaxed: float | None = None
) -> dict[str, float]:
    """Film c/a ratio and tetragonal distortion (``tetragonalDistortion.m``).

    Lengths in Å. ``c_relaxed`` (the bulk c reference) defaults to
    ``a_relaxed``, i.e. a cubic bulk. Returns ``c_over_a``, ``distortion_pct``,
    ``a_relaxed``, ``c_measured``, ``c_relaxed``.

    >>> r = tetragonal_distortion(4.00, 4.03)
    >>> round(r["c_over_a"], 6), round(r["distortion_pct"], 6)
    (1.0075, 0.75)
    """
    c_ref = a_relaxed if c_relaxed is None else c_relaxed
    _positive("a_relaxed", a_relaxed)
    _positive("c_measured", c_measured)
    _positive("c_relaxed", c_ref)
    return {
        "c_over_a": c_measured / a_relaxed,
        "distortion_pct": (c_measured - c_ref) / c_ref * 100,
        "a_relaxed": a_relaxed,
        "c_measured": c_measured,
        "c_relaxed": c_ref,
    }


def strain_from_poisson(eps_parallel: float, nu: float) -> dict[str, Any]:
    """Out-of-plane strain from biaxial in-plane strain (``strainFromPoisson.m``).

    ``ε_⊥ = −2ν/(1−ν)·ε_∥`` for an isotropic film with a free surface. Both
    strains are dimensionless. ``ν`` must be non-negative, as in MATLAB. ``ν = 1``
    is refused: the coupling is singular there, and MATLAB would return
    ``±Inf``/``NaN`` instead of a number. Returns ``eps_perp``,
    ``eps_parallel``, ``nu``, ``formula``.

    >>> round(strain_from_poisson(0.01, 0.3)["eps_perp"], 6)
    -0.008571
    """
    if not math.isfinite(eps_parallel):
        raise ValueError("in-plane strain must be finite")
    if not (math.isfinite(nu) and nu >= 0):
        raise ValueError("Poisson ratio nu must be non-negative and finite")
    if nu == 1.0:
        raise ValueError("Poisson ratio nu = 1 makes the biaxial coupling singular")
    return {
        "eps_perp": -2 * nu / (1 - nu) * eps_parallel,
        "eps_parallel": eps_parallel,
        "nu": nu,
        "formula": "eps_perp = -2*nu/(1-nu) * eps_parallel",
    }
