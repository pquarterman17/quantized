r"""Out-of-plane strain next to the in-plane mismatch of an oriented film.

THIN_FILM_STACK_PLANNING_PLAN G1. A Python extension (no MATLAB counterpart):
it composes ``surface_net.net_mismatch`` with ``epitaxial_strain.strain_from_poisson``
and ``epitaxial_strain.tetragonal_distortion``; it adds no new physics.

**In-plane strain.** The mismatch is ``f = (film - substrate)/substrate`` along
each net axis. A film that is coherent with the substrate net is strained to it,
so its in-plane strain relative to its own relaxed net is

.. math::

    \varepsilon_\parallel = \frac{a_\text{sub} - a_\text{film}}{a_\text{film}}
                          = -\frac{f}{1+f}

(the same ``(template - a)/a`` that ``film_stack`` uses). A film larger than the
substrate (``f > 0``) is compressed in plane (``ε_∥ < 0``).

**Out-of-plane strain** is ``ε_⊥ = -2ν/(1-ν)·ε_∥`` (``strain_from_poisson``,
isotropic film, free surface). It is reported only when the formula applies and
the inputs exist; otherwise every missing value is ``None`` with a one-sentence
reason (fail closed, never a default ν):

- no ν given (the repo stores no Poisson ratio for any material);
- the strain is not equibiaxial (the two net axes strain by more than
  ``EQUIBIAXIAL_TOL``, or the net angles differ by more than ``ANGLE_TOL``),
  so no single ``ε_∥`` exists.

**c/a** (``tetragonal_distortion``) is reported only when a film cell axis lies
along the plane normal and the other two axes are equal (a cubic film on a
{100} plane, a tetragonal film on (001), a hexagonal-axes film on (0001)):
``c_ref`` is that axis, the strained in-plane length is ``a(1+ε_∥)`` and the
predicted ``c = c_ref(1+ε_⊥)``, so ``distortion_pct`` equals ``100·ε_⊥``.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

from quantized.calc.epitaxial_strain import strain_from_poisson, tetragonal_distortion

__all__ = ["ANGLE_TOL", "EQUIBIAXIAL_TOL", "oriented_out_of_plane"]

#: Largest |ε_u − ε_v| (absolute, dimensionless) still treated as equibiaxial.
EQUIBIAXIAL_TOL = 1e-3
#: Largest |Δγ| (degrees) between the film and substrate nets still treated as one shape.
ANGLE_TOL = 0.5

NU_REASON = (
    "No Poisson ratio is stored for the film phase (the phase table carries lattice data "
    "only), so enter one for the film."
)
_AXIAL_TOL = 1e-6


def _normal_axis(cell: Mapping[str, float], hkl: list[int]) -> tuple[float, float] | None:
    """(in-plane axis length, normal axis length) when a cell axis is the plane normal."""
    nz = [i for i, x in enumerate(hkl) if x != 0]
    if len(nz) != 1:
        return None
    i = nz[0]
    lengths = [cell["a"], cell["b"], cell["c"]]
    angles = [cell["alpha"], cell["beta"], cell["gamma"]]
    others = [j for j in range(3) if j != i]
    # The normal axis must be perpendicular to the two in-plane axes, i.e. the two
    # angles that involve it are 90 deg; the angle between the in-plane axes
    # themselves may be 90 or (hexagonal) 120. ``angles[j]`` is opposite axis j,
    # so the angles involving axis i are angles[k] for k != i.
    if any(abs(angles[k] - 90.0) > _AXIAL_TOL for k in others):
        return None
    if abs(lengths[others[0]] - lengths[others[1]]) > _AXIAL_TOL * lengths[others[0]]:
        return None
    return lengths[others[0]], lengths[i]


def oriented_out_of_plane(
    mismatch: Mapping[str, Any], film_cell: Mapping[str, Any], nu: float | None
) -> dict[str, Any]:
    """Out-of-plane strain and c/a for a ``net_mismatch`` result (module docstring).

    ``film_cell`` holds ``a`` and optionally ``b``, ``c`` (default ``a``),
    ``alpha``, ``beta``, ``gamma`` (default 90). The plane comes from
    ``mismatch["film"]["hkl"]``. Raises ``ValueError`` for a ν outside [0, 0.5).

    >>> m = {"f_u": -0.0074, "f_v": -0.0074, "delta_gamma": 0.0, "film": {"hkl": [0, 0, 1]}}
    >>> r = oriented_out_of_plane(m, {"a": 3.876}, 0.3)
    >>> round(r["eps_perp"] * 100, 3)
    -0.642
    """
    if nu is not None and not (math.isfinite(nu) and 0 <= nu < 0.5):
        raise ValueError("Poisson ratio nu must be in [0, 0.5)")
    f_u, f_v = float(mismatch["f_u"]), float(mismatch["f_v"])
    eps_u, eps_v = -f_u / (1 + f_u), -f_v / (1 + f_v)
    out: dict[str, Any] = {
        "eps_u": eps_u,
        "eps_v": eps_v,
        "eps_parallel": None,
        "eps_perp": None,
        "nu": nu,
        "c_over_a": None,
        "distortion_pct": None,
        "c_predicted": None,
        "eps_perp_reason": None,
        "c_over_a_reason": None,
    }
    dg = abs(float(mismatch["delta_gamma"]))
    if abs(eps_u - eps_v) > EQUIBIAXIAL_TOL or dg > ANGLE_TOL:
        why = (
            "The in-plane strain is not equibiaxial "
            f"(ε₁ = {eps_u:.4g}, ε₂ = {eps_v:.4g}, Δγ = {dg:.3g}°), so the biaxial Poisson "
            "coupling does not give one out-of-plane strain."
        )
        out["eps_perp_reason"] = out["c_over_a_reason"] = why
        return out
    eps_par = 0.5 * (eps_u + eps_v)
    out["eps_parallel"] = eps_par
    if nu is None:
        out["eps_perp_reason"] = out["c_over_a_reason"] = NU_REASON
        return out
    out["eps_perp"] = strain_from_poisson(eps_par, nu)["eps_perp"]

    cell = {
        "a": float(film_cell["a"]),
        "b": float(film_cell.get("b") or film_cell["a"]),
        "c": float(film_cell.get("c") or film_cell["a"]),
        "alpha": float(film_cell.get("alpha", 90.0)),
        "beta": float(film_cell.get("beta", 90.0)),
        "gamma": float(film_cell.get("gamma", 90.0)),
    }
    axes = _normal_axis(cell, [int(x) for x in mismatch["film"]["hkl"]])
    if axes is None:
        out["c_over_a_reason"] = (
            "c/a is shown only when a cell axis lies along the plane normal and the other two "
            "are equal (cubic {100}, tetragonal (001), hexagonal (0001)); "
            "this plane has no such axis."
        )
        return out
    a_in, c_ref = axes
    c_pred = c_ref * (1 + out["eps_perp"])
    tetra = tetragonal_distortion(a_in * (1 + eps_par), c_pred, c_relaxed=c_ref)
    out["c_over_a"] = tetra["c_over_a"]
    out["distortion_pct"] = tetra["distortion_pct"]
    out["c_predicted"] = c_pred
    return out
