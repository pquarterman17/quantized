r"""Semiconductor device-physics calculators (DiraCulator ``buildSemiconductorTab``
+ ``+calc/+semiconductor``).

Pure calc layer — closed-form scalars in, result dicts out. No fastapi /
pydantic imports. Ports the MATLAB ``calc.semiconductor`` functions verbatim
(the MATLAB ``latex`` field is intentionally omitted):

.. math::

    n_i = \sqrt{N_c N_v}\,e^{-E_g/2k_BT} \qquad
    N_{c,v} = 2\left(\tfrac{2\pi m^* k_B T}{h^2}\right)^{3/2} \\
    n = \tfrac12\!\left(\Delta + \sqrt{\Delta^2 + 4 n_i^2}\right),\;
        p = n_i^2/n,\; \Delta = N_d - N_a \\
    E_F - E_i = k_BT\,\operatorname{asinh}\!\big(\Delta/2n_i\big) \qquad
    V_{bi} = \tfrac{k_BT}{q}\ln\!\big(N_a N_d/n_i^2\big) \\
    W = \sqrt{\tfrac{2\varepsilon_0\varepsilon_r}{q}
        \big(\tfrac1{N_a}+\tfrac1{N_d}\big)V_{bi}'} \qquad
    L_D = \sqrt{\tfrac{\varepsilon_0\varepsilon_r k_BT}{q^2 n}} \\
    D = \mu k_BT/q \qquad L = \sqrt{D\tau} \qquad
    v_{th} = \sqrt{3 k_BT/m^*} \qquad
    R_H = \tfrac1q\tfrac{p\mu_h^2 - n\mu_e^2}{(p\mu_h + n\mu_e)^2}

Units follow the MATLAB toolbox (the behavioural reference): concentrations in
cm⁻³, lengths reported in both cm and nm, temperatures in K (never °C), masses
as ``m*/m₀`` (dimensionless), mobilities in cm²/(V·s), velocities in cm/s.

Material presets (300 K) — Eg [eV], εᵣ, mₑ*, m_h* (in m₀):
  Si, Ge, GaAs, InP, GaN, SiC, SiO₂, Al₂O₃.
"""

from __future__ import annotations

import math
from typing import Any

from quantized.calc.constants import constants

__all__ = [
    "MATERIALS",
    "built_in_potential",
    "carrier_concentration",
    "debye_length",
    "depletion_width",
    "diffusion_coeff",
    "diffusion_length",
    "dos_effective_mass",
    "fermi_level",
    "hall_coefficient",
    "intrinsic_carrier_conc",
    "material_presets",
    "mobility_model",
    "sheet_carrier_density",
    "thermal_velocity",
]

# Common semiconductor material parameters (calc.semiconductor.materialPresets).
# Eg [eV] @ 300 K, eps_r, me*/m0, mh*/m0 (NaN where unavailable). Do-not-"fix":
# these are calibrated literature values from the MATLAB reference.
MATERIALS: dict[str, dict[str, float | str]] = {
    "Si": {"Eg": 1.12, "eps_r": 11.7, "me": 1.08, "mh": 0.81, "name": "Silicon"},
    "Ge": {"Eg": 0.66, "eps_r": 16.0, "me": 0.55, "mh": 0.37, "name": "Germanium"},
    "GaAs": {"Eg": 1.42, "eps_r": 12.9, "me": 0.067, "mh": 0.45, "name": "Gallium Arsenide"},
    "InP": {"Eg": 1.35, "eps_r": 12.5, "me": 0.08, "mh": 0.6, "name": "Indium Phosphide"},
    "GaN": {"Eg": 3.4, "eps_r": 8.9, "me": 0.2, "mh": 1.4, "name": "Gallium Nitride"},
    "SiC": {"Eg": 3.26, "eps_r": 9.7, "me": 0.37, "mh": 1.0, "name": "4H-SiC"},
    "SiO2": {"Eg": 9.0, "eps_r": 3.9, "me": 0.5, "mh": float("nan"), "name": "Silicon Dioxide"},
    "Al2O3": {"Eg": 8.8, "eps_r": 9.0, "me": 0.4, "mh": float("nan"), "name": "Sapphire"},
}


def material_presets() -> dict[str, dict[str, float | str]]:
    """Return the semiconductor material-parameter table (``materialPresets.m``).

    Each entry has ``Eg`` (eV), ``eps_r``, ``me`` and ``mh`` (in m₀), ``name``.

    >>> material_presets()["GaAs"]["Eg"]
    1.42
    """
    return {k: dict(v) for k, v in MATERIALS.items()}


def _preset(material: str) -> dict[str, float | str]:
    """Look up a material preset, raising ValueError for unknown names."""
    try:
        return MATERIALS[material]
    except KeyError as exc:
        raise ValueError(f"unknown material '{material}'") from exc


def _doping_type(net: float, ni: float) -> str:
    """Doping type from the net donor density (intrinsic within 0.1·n_i)."""
    if abs(net) < 0.1 * ni:
        return "intrinsic"
    return "n" if net > 0 else "p"


def intrinsic_carrier_conc(
    eg: float | None = None,
    me_star: float | None = None,
    mh_star: float | None = None,
    t: float = 300.0,
    material: str | None = None,
) -> dict[str, float]:
    """Intrinsic carrier concentration n_i (``intrinsicCarrierConc.m``).

    ``N_{c,v} = 2(2π m* k_B T / h²)^{3/2}`` (effective DOS, m⁻³ → cm⁻³) and
    ``n_i = √(N_c N_v)·exp(−E_g q / 2k_B T)``. A ``material`` name fills any of
    ``eg``/``me_star``/``mh_star`` left as ``None`` from the preset table.

    Args:
        eg: band gap (eV); from ``material`` if omitted.
        me_star: electron DOS effective mass (m₀); from ``material`` if omitted.
        mh_star: hole DOS effective mass (m₀); from ``material`` if omitted.
        t: temperature (K), > 0.
        material: preset name (e.g. ``'Si'``) to auto-fill the above.

    Returns ``ni``, ``Nc``, ``Nv`` (cm⁻³), ``Eg`` (eV), ``T`` (K).

    >>> r = intrinsic_carrier_conc(material="Si")
    >>> 5e9 < r["ni"] < 2e10
    True
    """
    if material is not None:
        mat = _preset(material)
        if eg is None:
            eg = float(mat["Eg"])
        if me_star is None:
            me_star = float(mat["me"])
        if mh_star is None:
            mh_star = float(mat["mh"])
    if eg is None or me_star is None or mh_star is None:
        raise ValueError("provide eg, me_star, mh_star or a valid material name")
    if t <= 0:
        raise ValueError("T must be positive")
    if me_star <= 0 or mh_star <= 0 or math.isnan(me_star) or math.isnan(mh_star):
        raise ValueError("effective masses must be positive")

    c = constants()
    me_kg = me_star * c["m_e"]
    mh_kg = mh_star * c["m_e"]
    nc_m3 = 2.0 * (2.0 * math.pi * me_kg * c["kB"] * t / c["h"] ** 2) ** 1.5
    nv_m3 = 2.0 * (2.0 * math.pi * mh_kg * c["kB"] * t / c["h"] ** 2) ** 1.5
    nc = nc_m3 * 1e-6
    nv = nv_m3 * 1e-6
    ni = math.sqrt(nc * nv) * math.exp(-eg * c["e"] / (2.0 * c["kB"] * t))
    return {"ni": ni, "Nc": nc, "Nv": nv, "Eg": eg, "T": t}


def carrier_concentration(nd: float, na: float, ni: float) -> dict[str, Any]:
    """Majority/minority carrier concentrations (``carrierConcentration.m``).

    Exact charge-neutrality + mass-action solution (Sze §1.5):
    ``n = ½(Δ + √(Δ² + 4n_i²))``, ``p = n_i²/n`` with ``Δ = N_d − N_a``. This
    interpolates smoothly between the intrinsic and extrinsic regimes.

    Args:
        nd: donor concentration (cm⁻³), >= 0.
        na: acceptor concentration (cm⁻³), >= 0.
        ni: intrinsic carrier concentration (cm⁻³), > 0.

    Returns ``n``, ``p`` (cm⁻³) and ``type`` (``'n'``/``'p'``/``'intrinsic'``).

    >>> r = carrier_concentration(1e16, 0.0, 1.5e10)
    >>> round(r["n"] / 1e16, 4), r["type"]
    (1.0, 'n')
    """
    if nd < 0 or na < 0:
        raise ValueError("Nd and Na must be non-negative")
    if ni <= 0:
        raise ValueError("ni must be positive")
    net = nd - na
    n = 0.5 * (net + math.sqrt(net**2 + 4.0 * ni**2))
    p = ni**2 / n
    return {"n": n, "p": p, "type": _doping_type(net, ni)}


def built_in_potential(na: float, nd: float, ni: float, t: float = 300.0) -> dict[str, float]:
    """Built-in potential of a p-n junction (``builtInPotential.m``).

    ``V_bi = (k_B T / q)·ln(N_a N_d / n_i²)`` (V).

    Args:
        na: acceptor concentration (cm⁻³), > 0.
        nd: donor concentration (cm⁻³), > 0.
        ni: intrinsic carrier concentration (cm⁻³), > 0.
        t: temperature (K), > 0.

    >>> round(built_in_potential(1e17, 1e17, 9.65e9, 300.0)["Vbi"], 3)
    0.835
    """
    if na <= 0 or nd <= 0 or ni <= 0:
        raise ValueError("Na, Nd and ni must be positive")
    if t <= 0:
        raise ValueError("T must be positive")
    c = constants()
    kt = c["kB"] * t / c["e"]
    return {"Vbi": kt * math.log(na * nd / ni**2)}


def depletion_width(
    vbi: float,
    na: float,
    nd: float,
    epsilon_r: float | None = None,
    material: str | None = None,
    t: float = 300.0,
) -> dict[str, float]:
    """Depletion width of a p-n junction (``depletionWidth.m``).

    Sze Ch. 2.2 with the ``−2k_BT/q`` correction to V_bi (the majority-carrier
    distribution tails): ``W = √(2ε₀εᵣ(1/N_a + 1/N_d)·V_bi'/q)`` with
    ``V_bi' = max(V_bi − 2k_BT/q, 0)``. ``x_n``/``x_p`` are partitioned by charge
    neutrality. A ``material`` name fills ``epsilon_r`` if omitted.

    Args:
        vbi: built-in potential (V), > 0.
        na: acceptor doping on the p-side (cm⁻³), > 0.
        nd: donor doping on the n-side (cm⁻³), > 0.
        epsilon_r: relative permittivity; from ``material`` if omitted.
        material: preset name (e.g. ``'Si'``) to auto-fill ``epsilon_r``.
        t: temperature (K) for the kT/q correction, > 0.

    Returns ``W``, ``xn``, ``xp`` (nm) and ``Wcm`` (cm).
    """
    if material is not None and epsilon_r is None:
        epsilon_r = float(_preset(material)["eps_r"])
    if epsilon_r is None:
        raise ValueError("provide epsilon_r or a valid material name")
    if vbi <= 0 or na <= 0 or nd <= 0:
        raise ValueError("Vbi, Na and Nd must be positive")
    if t <= 0:
        raise ValueError("T must be positive")
    c = constants()
    na_m3 = na * 1e6
    nd_m3 = nd * 1e6
    kt_over_q = c["kB"] * t / c["e"]
    vbi_eff = max(vbi - 2.0 * kt_over_q, 0.0)
    w_m = math.sqrt(2.0 * c["eps0"] * epsilon_r * (1.0 / na_m3 + 1.0 / nd_m3) * vbi_eff / c["e"])
    w_nm = w_m * 1e9
    xn = w_nm * na / (na + nd)
    xp = w_nm * nd / (na + nd)
    return {"W": w_nm, "Wcm": w_m * 100.0, "xn": xn, "xp": xp}


def diffusion_coeff(mu: float, t: float = 300.0) -> dict[str, float]:
    """Diffusion coefficient via the Einstein relation (``diffusionCoeff.m``).

    ``D = μ·k_B T / q`` (cm²/s).

    Args:
        mu: carrier mobility (cm²/V·s), > 0.
        t: temperature (K), > 0.

    >>> round(diffusion_coeff(1400.0, 300.0)["D"], 3)
    36.193
    """
    if mu <= 0:
        raise ValueError("mu must be positive")
    if t <= 0:
        raise ValueError("T must be positive")
    c = constants()
    return {"D": mu * c["kB"] * t / c["e"], "mu": mu, "T": t}


def diffusion_length(d: float, tau: float) -> dict[str, float]:
    """Minority-carrier diffusion length (``diffusionLength.m``).

    ``L = √(D·τ)`` (cm); ``Lum = L·10⁴`` (µm).

    Args:
        d: diffusion coefficient (cm²/s), > 0.
        tau: minority-carrier lifetime (s), > 0.

    >>> round(diffusion_length(25.0, 1e-6)["Lum"], 3)
    50.0
    """
    if d <= 0:
        raise ValueError("D must be positive")
    if tau <= 0:
        raise ValueError("tau must be positive")
    length = math.sqrt(d * tau)
    return {"L": length, "Lum": length * 1e4, "D": d, "tau": tau}


def dos_effective_mass(material: str, carrier: str = "e") -> dict[str, Any]:
    """DOS effective mass for a material + carrier type (``dosEffectiveMass.m``).

    Args:
        material: preset name (e.g. ``'GaAs'``).
        carrier: ``'e'`` (electrons) or ``'h'`` (holes).

    Returns ``mStar`` (m₀), ``material``, ``carrier``.

    >>> dos_effective_mass("GaAs", "e")["mStar"]
    0.067
    """
    if carrier not in ("e", "h"):
        raise ValueError("carrier must be 'e' or 'h'")
    mat = _preset(material)
    m_star = float(mat["me"] if carrier == "e" else mat["mh"])
    if math.isnan(m_star):
        raise ValueError(f"hole effective mass not available for {material}")
    return {"mStar": m_star, "material": material, "carrier": carrier}


def fermi_level(
    eg: float | None = None,
    me_star: float | None = None,
    mh_star: float | None = None,
    nd: float = 0.0,
    na: float = 0.0,
    t: float = 300.0,
    material: str | None = None,
) -> dict[str, Any]:
    """Fermi level relative to the intrinsic level E_i (``fermiLevel.m``).

    From charge-neutrality + mass-action: ``E_F − E_i = k_BT·asinh(Δ/2n_i)``
    with ``Δ = N_d − N_a`` (Sze §1.5). Positive = above E_i (n-type). The
    Boltzmann (non-degenerate) approximation breaks down within ~3kT of a band
    edge — use a Fermi-Dirac solver for degenerate doping.

    Args:
        eg: band gap (eV); from ``material`` if omitted.
        me_star, mh_star: DOS effective masses (m₀); from ``material`` if omitted.
        nd: donor concentration (cm⁻³), >= 0.
        na: acceptor concentration (cm⁻³), >= 0.
        t: temperature (K), > 0.
        material: preset name to auto-fill ``eg``/``me_star``/``mh_star``.

    Returns ``EF`` (eV, relative to E_i) and ``type``.
    """
    if nd < 0 or na < 0:
        raise ValueError("Nd and Na must be non-negative")
    ni = intrinsic_carrier_conc(eg, me_star, mh_star, t, material)["ni"]
    c = constants()
    kt = c["kB"] * t / c["e"]
    net = nd - na
    ef = kt * math.asinh(net / (2.0 * ni))
    return {"EF": ef, "type": _doping_type(net, ni)}


def hall_coefficient(n: float, p: float, mu_e: float, mu_h: float) -> dict[str, Any]:
    """Hall coefficient for mixed conduction (``hallCoefficient.m``).

    ``R_H = (1/q)·(p μ_h² − n μ_e²) / (p μ_h + n μ_e)²`` (cm³/C). Sign gives the
    apparent carrier type: ``R_H < 0`` → ``'n'``, else ``'p'``.

    Args:
        n: electron concentration (cm⁻³), >= 0.
        p: hole concentration (cm⁻³), >= 0.
        mu_e: electron mobility (cm²/V·s), > 0.
        mu_h: hole mobility (cm²/V·s), > 0.

    >>> hall_coefficient(1e16, 1e4, 1400.0, 450.0)["apparent_type"]
    'n'
    """
    if n < 0 or p < 0:
        raise ValueError("n and p must be non-negative")
    if mu_e <= 0 or mu_h <= 0:
        raise ValueError("mobilities must be positive")
    denom = p * mu_h + n * mu_e
    if denom == 0:
        raise ValueError("p·μ_h + n·μ_e must be non-zero")
    q = constants()["e"]
    r_h = (1.0 / q) * (p * mu_h**2 - n * mu_e**2) / denom**2
    return {"RH": r_h, "apparent_type": "n" if r_h < 0 else "p"}


def debye_length(
    n: float,
    epsilon_r: float | None = None,
    t: float = 300.0,
    material: str | None = None,
) -> dict[str, float]:
    """Debye screening length in a semiconductor (``debyeLength.m``).

    ``L_D = √(ε₀ εᵣ k_B T / (q² n))``. A ``material`` name fills ``epsilon_r``.

    Args:
        n: carrier concentration (cm⁻³), > 0.
        epsilon_r: relative permittivity; from ``material`` if omitted.
        t: temperature (K), > 0.
        material: preset name to auto-fill ``epsilon_r``.

    Returns ``LD`` (nm) and ``LDcm`` (cm).
    """
    if material is not None and epsilon_r is None:
        epsilon_r = float(_preset(material)["eps_r"])
    if epsilon_r is None:
        raise ValueError("provide epsilon_r or a valid material name")
    if n <= 0:
        raise ValueError("n must be positive")
    if t <= 0:
        raise ValueError("T must be positive")
    c = constants()
    n_m3 = n * 1e6
    ld_m = math.sqrt(c["eps0"] * epsilon_r * c["kB"] * t / (c["e"] ** 2 * n_m3))
    return {"LD": ld_m * 1e9, "LDcm": ld_m * 100.0}


# Si Caughey-Thomas coefficients (Sze empirical). Do-not-"fix": calibrated.
_CT_SI = {
    "muMin_e": 88.0,
    "muMax_e": 1252.0,
    "Nref_e": 1.26e17,
    "alpha_e": 0.88,
    "beta_e": -2.4,
    "muMin_h": 54.0,
    "muMax_h": 407.0,
    "Nref_h": 2.35e17,
    "alpha_h": 0.88,
    "beta_h": -2.2,
}


def mobility_model(material: str = "Si", t: float = 300.0, n: float = 0.0) -> dict[str, Any]:
    """Caughey-Thomas doping/temperature-dependent mobility (``mobilityModel.m``).

    ``μ = μ_min + (μ_max − μ_min)/(1 + (N/N_ref)^α)`` scaled by ``(T/300)^β``.
    Only Si is parameterised; other materials fall back to the Si coefficients.

    Args:
        material: material name (Si coefficients used as a fallback otherwise).
        t: temperature (K), > 0.
        n: total impurity concentration N_d + N_a (cm⁻³), >= 0.

    Returns ``muE``, ``muH`` (cm²/V·s) and ``material``.

    >>> round(mobility_model("Si", 300.0, 1e16)["muE"], 1)
    1139.0
    """
    if t <= 0:
        raise ValueError("T must be positive")
    if n < 0:
        raise ValueError("N must be non-negative")
    k = _CT_SI
    n_eff = max(n, 1.0)  # avoid divide-by-zero; N→0 gives μ_max

    def _ct(mn: float, mx: float, nref: float, alpha: float, beta: float) -> float:
        mu_lattice = mn + (mx - mn) / (1.0 + (n_eff / nref) ** alpha)
        return float(mu_lattice * (t / 300.0) ** beta)

    mu_e = _ct(k["muMin_e"], k["muMax_e"], k["Nref_e"], k["alpha_e"], k["beta_e"])
    mu_h = _ct(k["muMin_h"], k["muMax_h"], k["Nref_h"], k["alpha_h"], k["beta_h"])
    return {"muE": mu_e, "muH": mu_h, "material": material}


def sheet_carrier_density(n: float, t: float) -> dict[str, float]:
    """Sheet carrier density from bulk concentration and thickness (``sheetCarrierDensity.m``).

    ``n_s = n·t`` (cm⁻²).

    Args:
        n: bulk carrier concentration (cm⁻³), > 0.
        t: layer thickness (cm), > 0.

    >>> sheet_carrier_density(1e17, 1e-6)["ns"]
    100000000000.0
    """
    if n <= 0:
        raise ValueError("n must be positive")
    if t <= 0:
        raise ValueError("t must be positive")
    return {"ns": n * t, "n": n, "t": t}


def thermal_velocity(m_star: float, t: float = 300.0) -> dict[str, float]:
    """Thermal velocity of carriers (``thermalVelocity.m``).

    ``v_th = √(3 k_B T / (m* m₀))`` (cm/s).

    Args:
        m_star: effective mass in units of m₀, > 0.
        t: temperature (K), > 0.

    >>> 1e7 < thermal_velocity(0.26, 300.0)["vth"] < 5e7
    True
    """
    if m_star <= 0:
        raise ValueError("m_star must be positive")
    if t <= 0:
        raise ValueError("T must be positive")
    c = constants()
    vth_m = math.sqrt(3.0 * c["kB"] * t / (m_star * c["m_e"]))
    return {"vth": vth_m * 100.0, "mStar": m_star, "T": t}
