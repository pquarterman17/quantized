r"""Superconductivity calculators (DiraCulator ``buildSuperconductorTab`` +
``+calc/+superconductor``).

Pure calc layer — closed-form scalars in, result dicts out. No fastapi /
pydantic imports. Ports the scalar MATLAB ``calc.superconductor`` functions
verbatim (London depth, coherence length, GL parameter, critical fields,
depairing current) plus the material-preset table and the weak-coupling BCS
gap relation.

.. math::

    \lambda(T) = \frac{\lambda_0}{\sqrt{1 - (T/T_c)^4}} \qquad
    \xi(T) = \frac{\xi_0}{\sqrt{1 - (T/T_c)^2}} \\
    \kappa = \lambda/\xi \qquad
    H_c(T) = H_{c0}\,(1 - (T/T_c)^2) \\
    H_{c1} = \frac{\Phi_0}{4\pi\lambda^2}\,(\ln\kappa + 0.5) \qquad
    H_{c2} = \frac{\Phi_0}{2\pi\xi^2} \\
    J_d(T) = \frac{H_c(T)}{3\sqrt{6}\,\pi\,\lambda(T)} \qquad
    \Delta_0 = 1.764\,k_B T_c

Conventions follow the MATLAB toolbox (the behavioural reference): lengths in
nm, temperatures in K, fields in Oe (Gaussian CGS, ``Φ₀`` converted to G·cm²),
current density in A/cm², gap in meV. ``type`` is ``'I'`` for
``κ < 1/√2 ≈ 0.7071`` and ``'II'`` otherwise.

Reference values (from the MATLAB docstrings / closed form):
  - ``london_depth(39, 4.2, 9.25) -> lambda ≈ 39.86`` nm (Nb)
  - ``coherence_length(38, 4.2, 9.25) -> xi ≈ 42.65`` nm (Nb)
  - ``gl_parameter(39, 38) -> kappa ≈ 1.026`` (Nb, type II)
  - ``critical_fields(1980, 9.25, 4.2) Nb -> type II, Hc1 < Hc < Hc2``
  - ``bcs_gap(9.25) -> delta0 ≈ 1.406 meV, ratio = 3.528`` (weak coupling)

The three array-based data-reduction routines in the MATLAB package
(``bcsGap`` curve fitting, ``extractTc`` from R(T), ``beanJc`` from M(H)) are
measurement-analysis functions, not calculator-tab features, and are deferred
to the transport / magnetometry analysis surface.
"""

from __future__ import annotations

import math
from typing import Any

from quantized.calc.constants import constants

__all__ = [
    "bcs_gap",
    "coherence_length",
    "critical_fields",
    "depairing_current",
    "gl_parameter",
    "london_depth",
    "material_presets",
]

# κ boundary between type-I and type-II superconductors.
_KAPPA_BOUNDARY = 1.0 / math.sqrt(2.0)  # ≈ 0.7071

# Weak-coupling BCS: 2*Delta0/(kB*Tc) = 3.528  ->  Delta0 = 1.764*kB*Tc.
_BCS_RATIO = 3.528
_BCS_HALF = _BCS_RATIO / 2.0  # 1.764

# Material presets (Tinkham 2nd ed.; Orlando & Delin). lambda0/xi0 in nm,
# Hc0 in Oe, Delta0 in meV. Port verbatim from materialPresets.m.
_PRESETS: dict[str, dict[str, Any]] = {
    "Nb": {"Tc": 9.25, "lambda0": 39.0, "xi0": 38.0, "Hc0": 1980.0, "Delta0": 1.55, "type": "II"},
    "NbN": {"Tc": 16.0, "lambda0": 200.0, "xi0": 5.0, "Hc0": 80000.0, "Delta0": 2.6, "type": "II"},
    "YBCO": {"Tc": 92.0, "lambda0": 150.0, "xi0": 1.5, "Hc0": 0.0, "Delta0": 20.0, "type": "II"},
    "MgB2": {"Tc": 39.0, "lambda0": 140.0, "xi0": 5.0, "Hc0": 0.0, "Delta0": 7.1, "type": "II"},
    "Al": {"Tc": 1.18, "lambda0": 16.0, "xi0": 1600.0, "Hc0": 105.0, "Delta0": 0.172, "type": "I"},
    "Pb": {"Tc": 7.19, "lambda0": 37.0, "xi0": 83.0, "Hc0": 803.0, "Delta0": 1.33, "type": "I"},
    "In": {"Tc": 3.41, "lambda0": 24.0, "xi0": 440.0, "Hc0": 282.0, "Delta0": 0.541, "type": "I"},
    "Sn": {"Tc": 3.72, "lambda0": 34.0, "xi0": 230.0, "Hc0": 305.0, "Delta0": 0.592, "type": "I"},
}


def material_presets(material: str | None = None) -> dict[str, Any]:
    """Superconductor material property table (``materialPresets.m``).

    Returns the full table keyed by material name when ``material`` is omitted,
    or a single material's properties (``Tc``, ``lambda0``, ``xi0``, ``Hc0``,
    ``Delta0``, ``type``) when given. Names are matched case-insensitively.

    >>> material_presets("Nb")["Tc"]
    9.25
    >>> sorted(material_presets()["materials"])  # doctest: +ELLIPSIS
    ['Al', 'In', 'MgB2', 'Nb', 'NbN', 'Pb', 'Sn', 'YBCO']
    """
    if material is None or material == "":
        return {"materials": {k: dict(v) for k, v in _PRESETS.items()}}
    key = _match_material(material)
    return dict(_PRESETS[key])


def _match_material(material: str) -> str:
    for name in _PRESETS:
        if name.lower() == material.lower():
            return name
    valid = ", ".join(_PRESETS)
    raise ValueError(f"Unknown material '{material}'. Valid options: {valid}.")


def _resolve(
    explicit: float | None, material: str | None, field: str, label: str
) -> float:
    """Explicit value if given, else the preset field, else an error."""
    if explicit is not None:
        return explicit
    if material:
        return float(_PRESETS[_match_material(material)][field])
    raise ValueError(f"Provide '{label}' or a Material name.")


def _check_below_tc(t: float, tc: float) -> None:
    if tc <= 0:
        raise ValueError("Tc must be positive")
    if t < 0:
        raise ValueError("T must be non-negative")
    if t >= tc:
        raise ValueError(f"T ({t:.4g} K) must be below Tc ({tc:.4g} K).")


def london_depth(
    lambda0: float | None = None,
    t: float = 0.0,
    tc: float | None = None,
    *,
    material: str | None = None,
) -> dict[str, float]:
    """London penetration depth at temperature T (``londonDepth.m``).

    Two-fluid (Gorter-Casimir) approximation
    ``λ(T) = λ₀ / √(1 − (T/T_c)⁴)``.

    Args:
        lambda0: zero-temperature London depth λ₀ (nm); from preset if omitted.
        t: measurement temperature (K), 0 ≤ t < Tc.
        tc: critical temperature (K); from preset if omitted.
        material: optional preset name supplying λ₀ and Tc.

    >>> round(london_depth(39.0, 4.2, 9.25)["lambda"], 2)
    39.86
    """
    lam0 = _resolve(lambda0, material, "lambda0", "lambda0")
    tc_v = _resolve(tc, material, "Tc", "Tc")
    if lam0 <= 0:
        raise ValueError("lambda0 must be positive")
    _check_below_tc(t, tc_v)
    lam = lam0 / math.sqrt(1.0 - (t / tc_v) ** 4)
    return {"lambda": lam, "lambda0": lam0, "T": t, "Tc": tc_v}


def coherence_length(
    xi0: float | None = None,
    t: float = 0.0,
    tc: float | None = None,
    *,
    material: str | None = None,
) -> dict[str, float]:
    """BCS coherence length at temperature T (``coherenceLength.m``).

    Gorkov / GL-regime temperature dependence
    ``ξ(T) = ξ₀ / √(1 − (T/T_c)²)``.

    >>> round(coherence_length(38.0, 4.2, 9.25)["xi"], 2)
    42.65
    """
    xi0_v = _resolve(xi0, material, "xi0", "xi0")
    tc_v = _resolve(tc, material, "Tc", "Tc")
    if xi0_v <= 0:
        raise ValueError("xi0 must be positive")
    _check_below_tc(t, tc_v)
    xi = xi0_v / math.sqrt(1.0 - (t / tc_v) ** 2)
    return {"xi": xi, "xi0": xi0_v, "T": t, "Tc": tc_v}


def _sc_type(kappa: float) -> str:
    return "I" if kappa < _KAPPA_BOUNDARY else "II"


def gl_parameter(
    lambda_: float | None = None,
    xi: float | None = None,
    *,
    material: str | None = None,
    t: float | None = None,
) -> dict[str, Any]:
    """Ginzburg-Landau parameter κ = λ/ξ (``glParameter.m``).

    Type-I when ``κ < 1/√2 ≈ 0.7071``, type-II otherwise. When ``material``
    and ``t`` are given, λ and ξ are computed at T from the preset.

    >>> r = gl_parameter(39.0, 38.0)
    >>> round(r["kappa"], 4), r["type"]
    (1.0263, 'II')
    """
    lam = lambda_
    xi_v = xi
    if material:
        if t is None:
            raise ValueError("Provide T when using Material for glParameter.")
        if lam is None:
            lam = london_depth(t=t, material=material)["lambda"]
        if xi_v is None:
            xi_v = coherence_length(t=t, material=material)["xi"]
    if lam is None or xi_v is None:
        raise ValueError("Provide both lambda and xi, or a Material name with T.")
    if lam <= 0 or xi_v <= 0:
        raise ValueError("lambda and xi must be positive")
    kappa = lam / xi_v
    return {"kappa": kappa, "lambda": lam, "xi": xi_v, "type": _sc_type(kappa)}


def critical_fields(
    hc0: float | None = None,
    tc: float | None = None,
    t: float = 0.0,
    *,
    material: str | None = None,
    lambda_: float | None = None,
    xi: float | None = None,
    kappa: float | None = None,
) -> dict[str, Any]:
    """Superconducting critical fields at temperature T (``criticalFields.m``).

    Thermodynamic ``Hc(T) = Hc0·(1 − (T/T_c)²)`` for both types. For type-II
    (preset type ``'II'``, ``Hc0`` zero/absent, or explicit λ+ξ / κ):

    - ``Hc1 = (Φ₀/(4πλ²))·(ln κ + 0.5)`` (Tinkham Eq. 5.11, NaN for type-I),
    - ``Hc2 = Φ₀/(2πξ²)``,

    with Φ₀ in G·cm² and λ, ξ in cm. All fields in Oe.

    Args:
        hc0: thermodynamic critical field at T=0 (Oe); from preset if omitted.
        tc: critical temperature (K); from preset if omitted.
        t: measurement temperature (K), 0 ≤ t < Tc.
        material: optional preset name; supplies Hc0, Tc, type, and λ/ξ at T.
        lambda_, xi: λ(T), ξ(T) in nm (override / direct type-II input).
        kappa: GL parameter override (else λ/ξ).

    >>> r = critical_fields(material="Nb", t=4.2)
    >>> r["type"], r["Hc1"] < r["Hc"] < r["Hc2"]
    ('II', True)
    """
    if material:
        preset = material_presets(material)
        hc0_v = hc0 if hc0 is not None else float(preset["Hc0"])
        tc_v = tc if tc is not None else float(preset["Tc"])
        sc_type: str = str(preset["type"])
    else:
        if hc0 is None or tc is None:
            raise ValueError("Provide Hc0 and Tc, or a Material name.")
        hc0_v = hc0
        tc_v = tc
        sc_type = ""
    _check_below_tc(t, tc_v)

    t_red = t / tc_v
    hc = hc0_v * (1.0 - t_red**2)

    phi0_gcm2 = constants()["Phi0"] * 1e8  # Wb -> G*cm^2 (= 2.0678e-7)
    hc1 = math.nan
    hc2 = math.nan

    has_type_ii = (lambda_ is not None and xi is not None) or kappa is not None
    if sc_type == "II" or hc0_v == 0 or has_type_ii:
        lam = lambda_
        xi_v = xi
        kap = kappa
        if lam is None and material:
            lam = london_depth(t=t, material=material)["lambda"]
        if xi_v is None and material:
            xi_v = coherence_length(t=t, material=material)["xi"]
        if kap is None and lam is not None and xi_v is not None:
            kap = lam / xi_v

        if lam is not None and xi_v is not None and kap is not None:
            lam_cm = lam * 1e-7
            xi_cm = xi_v * 1e-7
            if kap > _KAPPA_BOUNDARY:
                hc1 = phi0_gcm2 * (math.log(kap) + 0.5) / (4 * math.pi * lam_cm**2)
            hc2 = phi0_gcm2 / (2 * math.pi * xi_cm**2)
        if not sc_type:
            sc_type = "II"

    if not sc_type:
        sc_type = "I"

    return {"Hc": hc, "Hc1": hc1, "Hc2": hc2, "type": sc_type, "T": t, "Tc": tc_v}


def depairing_current(
    hc0: float | None = None,
    lambda0: float | None = None,
    tc: float | None = None,
    t: float = 0.0,
    *,
    material: str | None = None,
) -> dict[str, float]:
    """Depairing (pair-breaking) current density (``depairingCurrent.m``).

    ``Jd(T) = Hc(T) / (3√6·π·λ(T))`` in Gaussian CGS, converted to A/cm² via
    ``1 Oe/cm = (10³/4π) A/cm²``. Hc(T) from :func:`critical_fields`, λ(T) from
    :func:`london_depth`.

    >>> r = depairing_current(1980.0, 39.0, 9.25, 4.2)
    >>> r["JdMA"] > 0
    True
    """
    hc0_v = _resolve(hc0, material, "Hc0", "Hc0")
    lam0 = _resolve(lambda0, material, "lambda0", "lambda0")
    tc_v = _resolve(tc, material, "Tc", "Tc")
    _check_below_tc(t, tc_v)

    if material:
        hc_t = critical_fields(material=material, t=t)["Hc"]
        lam_t = london_depth(t=t, material=material)["lambda"]
    else:
        hc_t = critical_fields(hc0=hc0_v, tc=tc_v, t=t)["Hc"]
        lam_t = london_depth(lambda0=lam0, t=t, tc=tc_v)["lambda"]

    lam_cm = lam_t * 1e-7
    jd_cgs = hc_t / (3 * math.sqrt(6) * math.pi * lam_cm)
    jd_acm2 = jd_cgs * (1e3 / (4 * math.pi))
    return {"Jd": jd_acm2, "JdMA": jd_acm2 * 1e-6, "T": t, "Tc": tc_v}


def bcs_gap(tc: float, t: float | None = None) -> dict[str, float]:
    """Weak-coupling BCS energy gap from Tc.

    Zero-temperature gap ``Δ₀ = 1.764·k_B·T_c`` (the weak-coupling relation
    ``2Δ₀/(k_B T_c) = 3.528``). When ``t`` is given (0 < t < Tc) the
    Mühlschlegel approximation ``Δ(T) = Δ₀·tanh(1.74·√(T_c/T − 1))`` is also
    returned. Gap values in meV.

    >>> r = bcs_gap(9.25)
    >>> round(r["delta0"], 3), round(r["ratio"], 3)
    (1.406, 3.528)
    """
    if tc <= 0:
        raise ValueError("Tc must be positive")
    kb_mev = constants()["kB"] / constants()["e"] * 1e3  # meV/K
    delta0 = _BCS_HALF * kb_mev * tc
    delta_t = delta0
    if t is not None:
        if t < 0:
            raise ValueError("T must be non-negative")
        if t == 0 or t >= tc:
            delta_t = 0.0 if t >= tc else delta0
        else:
            delta_t = delta0 * math.tanh(1.74 * math.sqrt(tc / t - 1.0))
    return {
        "delta0": delta0,
        "ratio": _BCS_RATIO,
        "deltaT": delta_t,
        "Tc": tc,
        "T": t if t is not None else 0.0,
    }
