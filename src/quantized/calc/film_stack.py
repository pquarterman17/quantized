r"""Strain through an epitaxial multilayer (THIN_FILM_STACK_PLANNING_PLAN G4).

Pure calc layer. A Python extension: MATLAB has no stack model. It composes
the golden per-pair pieces (Matthews–Blakeslee ``critical_thickness``, the
Poisson coupling of ``strain_from_poisson``, the thermal-mismatch strain of
``thermal_mismatch_strain``, Bragg's law) layer by layer.

**Scope of this first model.** Cube-on-cube (001)-type stacks: each layer is
described by its relaxed in-plane parameter ``a`` and out-of-plane parameter
``c`` (a pseudocubic cell is fine), the in-plane match is the scalar ``a`` of
the layer below, and the growth direction is ``c``. Orientation-aware nets and
supercell matches (``calc.surface_net`` / ``calc.coincidence``) are not wired
in yet. Elasticity is isotropic, through a Poisson ratio ``nu`` per layer
(elastic constants are plan decision D4).

**Per layer, bottom to top:**

1. The *template* is the in-plane lattice the layer grows on: the substrate's
   ``a`` for the first layer, then the in-plane parameter of the layer below
   *as grown* (strained if that layer stayed coherent, relaxed if not).
2. Mismatch ``f = (a − a_template)/a_template`` (the repo's convention) and the
   Matthews–Blakeslee critical thickness ``h_c`` for that pair.
3. If ``thickness < h_c`` the layer is **coherent**: it takes the template's
   in-plane parameter, ``ε∥ = (a_template − a)/a`` (negative = compressive).
   Otherwise it is treated as **fully relaxed** (``ε∥ = 0``): a deliberately
   simple limit; real films relax partially, and the result says so.
4. ``ε⊥ = −2ν/(1−ν)·ε∥`` and the strained ``c = c₀(1 + ε⊥)``.
5. The predicted symmetric (00L) Bragg angles from ``d = c/L``.
6. Cool-down from the growth temperature: the clamped film's in-plane strain
   is ``ε_th = (α_sub − α_layer)(T_room − T_growth)``: a layer that expands more
   than its substrate ends up in tension after cooling (positive), as metal
   films on Si do. The substrate sets the in-plane contraction of a thin stack.
   ``ε_th`` is reported separately and as ``ε∥ + ε_th``; it is not fed back
   into the coherence decision. (Note: ``calc.thin_film.thermal_mismatch_strain``,
   the MATLAB-parity card, reports ``(α_f − α_s)·ΔT`` and calls a positive value
   tensile; that is the opposite physical sign and is left as ported.)

**Reciprocal-space map (optional).** With ``rsm_reflection = (H, L)`` each
layer and the substrate also get the predicted peak of the asymmetric
reflection (H 0 L) in the coplanar geometry, using the same convention as
:mod:`quantized.calc.rsm` (``Q = 2π/d``): ``Qx = 2πH/a∥`` (``a∥`` the
as-grown in-plane parameter, so a coherent layer shares the substrate's Qx)
and ``Qz = 2πL/c``. Also ``2θ`` from ``|Q|``, the tilt ``ψ = atan(Qx/Qz)``, and
the incidence angle ``ω = θ − ψ`` (grazing incidence) or ``θ + ψ`` (grazing
exit), each ``None`` when it falls outside ``0 < ω < 2θ``.

**Critical thickness caveat.** ``h_c`` is the MATLAB-parity Matthews–Blakeslee
form, which takes 60° dislocations with ``b = a/√2`` (FCC-type slip). Perovskites
and other lattices relax on different slip systems, so treat ``h_c`` as an
order-of-magnitude guide there.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from quantized.calc.substrates import critical_thickness
from quantized.calc.xray import bragg_two_theta

__all__ = ["evaluate_stack", "rsm_point"]

_MAX_LAYERS = 20


def _pos(spec: Mapping[str, Any], key: str, label: str) -> float:
    v = spec.get(key)
    if v is None or isinstance(v, bool) or not isinstance(v, int | float):
        raise ValueError(f"{label}: {key} is required and must be a number")
    if not (math.isfinite(v) and v > 0):
        raise ValueError(f"{label}: {key} must be positive and finite")
    return float(v)


def _num(spec: Mapping[str, Any], key: str, label: str, default: float) -> float:
    v = spec.get(key, default)
    if v is None:
        v = default
    if isinstance(v, bool) or not isinstance(v, int | float) or not math.isfinite(v):
        raise ValueError(f"{label}: {key} must be a finite number")
    return float(v)


def _two_thetas(c: float, wavelength: float, max_order: int) -> list[float | None]:
    out: list[float | None] = []
    for order in range(1, max_order + 1):
        d = c / order
        out.append(bragg_two_theta(wavelength, d) if wavelength / (2 * d) <= 1 else None)
    return out


def rsm_point(
    a_parallel: float,
    c: float,
    h: int,
    l: int,  # noqa: E741 -- Miller index
    wavelength: float,
) -> dict[str, float | None]:
    """Predicted (H 0 L) peak: ``qx``, ``qz`` (Å⁻¹, Q = 2π/d), ``two_theta``,
    ``tilt`` (ψ), ``omega_gi`` (θ − ψ) and ``omega_ge`` (θ + ψ), in degrees.
    Angles are ``None`` when the reflection is out of reach at ``wavelength``
    or the geometry puts ω outside (0, 2θ)."""
    if not (math.isfinite(a_parallel) and a_parallel > 0 and math.isfinite(c) and c > 0):
        raise ValueError("lattice parameters must be positive and finite")
    if l == 0:
        raise ValueError("L must be non-zero for a coplanar reflection")
    qx = 2 * math.pi * h / a_parallel
    qz = 2 * math.pi * l / c
    q = math.hypot(qx, qz)
    out: dict[str, float | None] = {
        "qx": qx,
        "qz": qz,
        "two_theta": None,
        "tilt": None,
        "omega_gi": None,
        "omega_ge": None,
    }
    s = wavelength * q / (4 * math.pi)
    if s > 1:
        return out
    theta = math.degrees(math.asin(s))
    tilt = math.degrees(math.atan2(abs(qx), abs(qz)))
    out["two_theta"] = 2 * theta
    out["tilt"] = tilt
    gi, ge = theta - tilt, theta + tilt
    out["omega_gi"] = gi if 0 < gi < 2 * theta else None
    out["omega_ge"] = ge if 0 < ge < 2 * theta else None
    return out


def evaluate_stack(
    substrate: Mapping[str, Any],
    layers: Sequence[Mapping[str, Any]],
    *,
    growth_temperature: float = 973.0,
    room_temperature: float = 300.0,
    wavelength: float = 1.5406,
    max_order: int = 4,
    rsm_reflection: Sequence[int] | None = None,
) -> dict[str, Any]:
    """Layer-by-layer strain of a cube-on-cube stack (see the module docstring).

    ``substrate``: ``a`` (Å) and optional ``cte`` (1e-6/K, default 0).
    ``layers`` (bottom to top): ``a`` (Å), optional ``c`` (Å, default ``a``),
    ``thickness`` (nm), optional ``nu`` (default 0.3), ``cte`` (1e-6/K,
    default 0), ``name``. Temperatures in K, ``wavelength`` in Å; ``max_order``
    is the highest (00L) order reported. ``rsm_reflection = (H, L)`` adds the
    predicted (H 0 L) reciprocal-space peak per layer (``rsm``) and for the
    substrate (``substrate_rsm``; optional substrate ``c``, default ``a``).

    Returns ``layers``, one record per layer with ``template_a``, ``mismatch``
    (f), ``h_c_nm`` (``None`` when the film relaxes at once, ``inf`` when
    matched) with ``h_c_kind`` (``"finite"``/``"infinite"``/``"none"``),
    ``state`` (``"coherent"`` / ``"relaxed"``), ``in_plane_a``,
    ``eps_parallel``, ``eps_perp``, ``c_strained``, ``two_theta_00l``,
    ``eps_thermal`` and ``eps_parallel_total``; plus ``warnings``.
    """
    if not layers:
        raise ValueError("add at least one layer")
    if len(layers) > _MAX_LAYERS:
        raise ValueError(f"at most {_MAX_LAYERS} layers")
    if not (1 <= max_order <= 10):
        raise ValueError("max_order must be in 1..10")
    if not (math.isfinite(wavelength) and wavelength > 0):
        raise ValueError("wavelength must be positive and finite")
    for name, t in (
        ("growth_temperature", growth_temperature),
        ("room_temperature", room_temperature),
    ):
        if not (math.isfinite(t) and t > 0):
            raise ValueError(f"{name} must be positive and finite (K)")
    if rsm_reflection is not None:
        if len(rsm_reflection) != 2 or any(int(x) != x for x in rsm_reflection):
            raise ValueError("rsm_reflection must be two integers (H, L)")
        if abs(rsm_reflection[0]) > 10 or not (1 <= abs(rsm_reflection[1]) <= 10):
            raise ValueError("rsm_reflection needs |H| <= 10 and 1 <= |L| <= 10")
    a_sub = _pos(substrate, "a", "substrate")
    c_sub = _pos(substrate, "c", "substrate") if substrate.get("c") is not None else a_sub
    cte_sub = _num(substrate, "cte", "substrate", 0.0) * 1e-6
    d_t = room_temperature - growth_temperature

    template = a_sub
    records: list[dict[str, Any]] = []
    warnings: list[str] = []
    for i, spec in enumerate(layers):
        label = str(spec.get("name") or f"layer {i + 1}")
        a = _pos(spec, "a", label)
        c0 = _pos(spec, "c", label) if spec.get("c") is not None else a
        thickness = _pos(spec, "thickness", label)
        nu = _num(spec, "nu", label, 0.3)
        if not (0 <= nu < 0.5):
            raise ValueError(f"{label}: nu must be in [0, 0.5)")
        cte = _num(spec, "cte", label, 0.0) * 1e-6

        f = (a - template) / template
        try:
            hc = critical_thickness(a, template, nu=nu)["h_c_nm"]
        except ValueError:
            hc = None  # no Matthews–Blakeslee root: relaxes from the first monolayer
        coherent = hc is not None and thickness < hc
        if coherent:
            in_plane = template
            eps_par = (template - a) / a
        else:
            in_plane = a
            eps_par = 0.0
            if abs(f) > 1e-6:
                warnings.append(
                    f"{label}: {thickness:g} nm exceeds h_c "
                    f"({'none' if hc is None else f'{hc:.3g} nm'}); treated as fully relaxed, "
                    "a real film is usually partly relaxed"
                )
        eps_perp = -2 * nu / (1 - nu) * eps_par
        c = c0 * (1 + eps_perp)
        # The film is clamped to the substrate: its strain is the substrate's
        # free contraction minus its own, (α_sub − α_layer)·ΔT (ΔT < 0 on cooling).
        eps_th = (cte_sub - cte) * d_t
        records.append(
            {
                "name": label,
                "template_a": template,
                "mismatch": f,
                "mismatch_pct": f * 100,
                "h_c_nm": hc,
                # Explicit, because inf and None both serialize to JSON null.
                "h_c_kind": "none" if hc is None else ("infinite" if math.isinf(hc) else "finite"),
                "thickness_nm": thickness,
                "state": "coherent" if coherent else "relaxed",
                "in_plane_a": in_plane,
                "eps_parallel": eps_par,
                "eps_perp": eps_perp,
                "c_relaxed": c0,
                "c_strained": c,
                "two_theta_00l": _two_thetas(c, wavelength, max_order),
                "eps_thermal": eps_th,
                "eps_parallel_total": eps_par + eps_th,
                "rsm": (
                    rsm_point(
                        in_plane, c, int(rsm_reflection[0]), int(rsm_reflection[1]), wavelength
                    )
                    if rsm_reflection is not None
                    else None
                ),
            }
        )
        template = in_plane
    return {
        "layers": records,
        "substrate_rsm": (
            rsm_point(a_sub, c_sub, int(rsm_reflection[0]), int(rsm_reflection[1]), wavelength)
            if rsm_reflection is not None
            else None
        ),
        "rsm_reflection": list(rsm_reflection) if rsm_reflection is not None else None,
        "warnings": warnings,
        "substrate_a": a_sub,
        "wavelength": wavelength,
        "growth_temperature": growth_temperature,
        "room_temperature": room_temperature,
    }
