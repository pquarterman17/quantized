r"""Thin-film deposition / implantation / metrology calculators.

Ports DiraCulator ``buildThinFilmTab`` and every ``+calc/+thinFilm/*.m``
function verbatim. Pure calc layer — scalars (or short vectors) in, result
dicts out. No fastapi / pydantic imports. The MATLAB ``latex`` field is omitted.

.. math::

    r = t / \tau \qquad L = \sqrt{D\,t} \qquad
    \Phi = \frac{I\,t}{q\,A} \qquad C_{\text{peak}} = \frac{\Phi}{\sqrt{2\pi}\,\Delta R_p} \\
    t_{\text{film}} = \frac{2\pi}{\Delta Q}
        \;\;\Bigl(\text{or}\;\frac{2\pi}{\sqrt{\Delta Q^2 - 4 Q_c^2}}\Bigr) \\
    \sigma = \frac{E_s\,t_s^2}{6(1-\nu_s)\,t_f\,R} \\
    \varepsilon = (\alpha_f - \alpha_s)\,\Delta T \qquad
    \dot d = \frac{Y\,(J/q)\,M}{\rho\,N_A}

Units follow the MATLAB toolbox (the behavioural reference): thickness in Å,
time in s, beam current in A, area in cm², dose in ions/cm², range in nm,
deltaQ in Å⁻¹, Stoney moduli/thicknesses in SI (Pa, m), CTE in 1/K, sputter
current density in mA/cm², density in g/cm³, molar mass in g/mol.

Reference values (closed-form / MATLAB docstrings):
  - ``deposition_rate(100, 60) -> rate ≈ 1.667`` Å/s, ``10`` nm/min
  - ``diffusion_length_thermal(1e-13, 3600) -> L ≈ 1.897e-5`` cm
  - ``dose_from_current(1e-6, 60, 1.0) -> dose ≈ 3.745e14`` ions/cm²
  - ``dose_to_concentration(1e15, 80, 25) -> Cpeak ≈ 1.596e20`` atoms/cm³
  - ``kiessig_thickness(0.0628) -> thickness ≈ 100.05`` Å
  - ``stoney_stress(130e9, 0.28, 500e-6, 100e-9, 10) -> stress ≈ 7.52e9`` Pa
"""

from __future__ import annotations

import math
from typing import Any

from quantized.calc.constants import constants
from quantized.calc.ion_range import projected_range

__all__ = [
    "deposition_rate",
    "diffusion_length_thermal",
    "dose_from_current",
    "dose_to_concentration",
    "kiessig_thickness",
    "multilayer_thermal_conductivity",
    "projected_range",
    "sauerbrey",
    "scherrer_grain_size",
    "sputter_rate",
    "stoney_stress",
    "thermal_mismatch_strain",
]

# AT-cut quartz constants for the Sauerbrey equation (standard reference
# values, e.g. Sauerbrey, Z. Phys. 155, 206 (1959)).
_MU_Q = 2.947e11  # shear modulus, g/(cm*s^2)
_RHO_Q = 2.648  # density, g/cm^3


def scherrer_grain_size(
    fwhm_deg: float,
    wavelength: float,
    two_theta_deg: float,
) -> dict[str, float]:
    r"""Crystallite size from the Scherrer equation (DiraCulator Card 6).

    The MATLAB GUI supplies the instrument-corrected peak FWHM ``beta`` in
    degrees of 2-theta, converts it to radians, and uses the Bragg angle
    ``theta = two_theta / 2`` with the fixed shape factor ``K = 0.9``:

    .. math:: D = \frac{K\lambda}{\beta\cos\theta}

    Args:
        fwhm_deg: instrument-corrected peak FWHM in degrees of 2-theta, > 0.
        wavelength: X-ray wavelength in Angstrom, > 0.
        two_theta_deg: Bragg peak position in degrees, 0 <= value < 180.

    Returns ``D`` in Angstrom and ``D_nm`` in nanometres, plus the inputs and
    fixed ``K`` for traceability.

    >>> round(scherrer_grain_size(0.5, 1.5406, 33.0)["D"], 1)
    165.7
    """
    if not (math.isfinite(fwhm_deg) and fwhm_deg > 0):
        raise ValueError("FWHM must be positive and finite")
    if not (math.isfinite(wavelength) and wavelength > 0):
        raise ValueError("wavelength must be positive and finite")
    if not (math.isfinite(two_theta_deg) and 0 <= two_theta_deg < 180):
        raise ValueError("two_theta_deg must be finite and satisfy 0 <= value < 180")

    beta = math.radians(fwhm_deg)
    theta = math.radians(two_theta_deg / 2)
    shape_factor = 0.9  # DiraCulator.m Card 6; intentional fixed value.
    grain_size = shape_factor * wavelength / (beta * math.cos(theta))
    return {
        "D": grain_size,
        "D_nm": grain_size / 10,
        "fwhm_deg": fwhm_deg,
        "wavelength": wavelength,
        "two_theta_deg": two_theta_deg,
        "K": shape_factor,
    }


def deposition_rate(thickness: float, time: float) -> dict[str, float]:
    """Deposition rate r = thickness/time (``depositionRate.m``).

    Args:
        thickness: deposited film thickness (Å), > 0.
        time: deposition time (s), > 0.

    Returns ``rate`` (Å/s) and ``rate_nm_per_min`` (nm/min, = rate·0.1·60).

    >>> r = deposition_rate(100.0, 60.0)
    >>> round(r["rate"], 4), round(r["rate_nm_per_min"], 4)
    (1.6667, 10.0)
    """
    if thickness <= 0 or time <= 0:
        raise ValueError("thickness and time must be positive")
    rate = thickness / time
    return {
        "rate": rate,
        "rate_nm_per_min": rate * 0.1 * 60,
        "thickness": thickness,
        "time": time,
    }


def diffusion_length_thermal(d: float, t: float) -> dict[str, float]:
    """Thermal diffusion length L = √(D·t) (``diffusionLength_thermal.m``).

    Args:
        d: diffusion coefficient (cm²/s), > 0.
        t: anneal time (s), > 0.

    Returns ``L`` (cm), ``L_nm`` (= L·1e7) and ``L_um`` (= L·1e4).

    >>> round(diffusion_length_thermal(1e-13, 3600.0)["L_nm"], 4)
    189.7367
    """
    if d <= 0 or t <= 0:
        raise ValueError("D and t must be positive")
    length = math.sqrt(d * t)
    return {
        "L": length,
        "L_nm": length * 1e7,
        "L_um": length * 1e4,
        "D": d,
        "t": t,
    }


def dose_from_current(current: float, time: float, area: float) -> dict[str, float]:
    """Ion-implant dose Φ = I·t/(q·A) (``doseFromCurrent.m``).

    Assumes singly charged ions. q is the elementary charge.

    Args:
        current: beam current (A), > 0.
        time: implant time (s), > 0.
        area: implanted area (cm²), > 0.

    Returns ``dose`` (ions/cm²).

    >>> round(dose_from_current(1e-6, 60.0, 1.0)["dose"] / 1e14, 4)
    3.7449
    """
    if current <= 0 or time <= 0 or area <= 0:
        raise ValueError("current, time and area must be positive")
    q = constants()["e"]
    dose = (current * time) / (q * area)
    return {"dose": dose, "current": current, "time": time, "area": area}


def dose_to_concentration(dose: float, rp: float, delta_rp: float) -> dict[str, float]:
    """Peak implant concentration from dose + range straggle (``doseToConcentration.m``).

    Gaussian depth profile centred at Rp with std dev ΔRp:
    ``C_peak = dose / (√(2π)·ΔRp)`` with ΔRp converted nm→cm so C_peak is
    in atoms/cm³.

    Args:
        dose: implanted dose (ions/cm²), > 0.
        rp: projected range (nm), > 0 (echoed only).
        delta_rp: range straggle (nm), > 0.

    >>> round(dose_to_concentration(1e15, 80.0, 25.0)["Cpeak"] / 1e20, 4)
    1.5958
    """
    if dose <= 0 or rp <= 0 or delta_rp <= 0:
        raise ValueError("dose, Rp and deltaRp must be positive")
    delta_rp_cm = delta_rp * 1e-7  # nm -> cm
    cpeak = dose / (math.sqrt(2 * math.pi) * delta_rp_cm)
    return {"Cpeak": cpeak, "dose": dose, "Rp": rp, "deltaRp": delta_rp}


def kiessig_thickness(
    delta_q: float, *, sld: float | None = None, qc: float | None = None
) -> dict[str, Any]:
    """Film thickness from Kiessig-fringe Q-spacing (``kiessigThickness.m``).

    Kinematic (Born) limit ``t = 2π/ΔQ`` neglects refraction at the
    vacuum-film interface (accurate well above the critical edge). Supplying a
    scattering-length density (or Qc directly) uses the refraction-corrected
    form (Tolan Ch. 3.3) ``t = 2π/√(ΔQ² − 4 Q_c²)`` with ``Q_c = 4√(π·SLD)``.

    Args:
        delta_q: Q-spacing of adjacent fringes (Å⁻¹), > 0.
        sld: layer SLD (Å⁻²); if given (>0), sets Qc = 4√(π·SLD).
        qc: critical-edge Q (Å⁻¹) directly; ignored when ``sld`` is given.

    Returns ``thickness`` (Å), ``thickness_nm``, ``Qc`` (NaN when uncorrected),
    and ``thickness_raw`` (the uncorrected 2π/ΔQ). When ΔQ ≤ 2·Qc the corrected
    formula would diverge, so it falls back to the kinematic value (Qc=NaN).

    >>> round(kiessig_thickness(0.0628)["thickness"], 2)
    100.05
    """
    if delta_q <= 0:
        raise ValueError("deltaQ must be positive")

    qc_eff = qc
    if sld is not None and sld > 0:
        qc_eff = 4 * math.sqrt(math.pi * sld)  # Q_c^2 = 16*pi*SLD

    thickness_raw = 2 * math.pi / delta_q
    if qc_eff is None or math.isnan(qc_eff) or qc_eff <= 0:
        thickness = thickness_raw
        qc_used = float("nan")
    else:
        arg = delta_q**2 - 4 * qc_eff**2
        if arg <= 0:
            # deltaQ at/below 2*Qc: correction diverges -> fall back, Qc=NaN.
            thickness = thickness_raw
            qc_used = float("nan")
        else:
            thickness = 2 * math.pi / math.sqrt(arg)
            qc_used = qc_eff

    return {
        "thickness": thickness,
        "thickness_nm": thickness * 0.1,
        "deltaQ": delta_q,
        "Qc": qc_used,
        "thickness_raw": thickness_raw,
    }


def multilayer_thermal_conductivity(
    thicknesses: list[float], kappas: list[float]
) -> dict[str, Any]:
    """Effective thermal conductivity of a multilayer stack (``multilayerThermalConductivity.m``).

    Series (heat flow ⊥ layers): ``k = Σdᵢ / Σ(dᵢ/kᵢ)``.
    Parallel (heat flow ∥ layers): ``k = Σ(kᵢ·dᵢ) / Σdᵢ``.

    Args:
        thicknesses: layer thicknesses (nm), all > 0.
        kappas: layer thermal conductivities (W/m/K), all > 0, same length.

    Returns ``k_series``, ``k_parallel`` (W/m/K), ``total_thickness`` (nm),
    ``n_layers``.

    >>> r = multilayer_thermal_conductivity([100.0, 50.0], [1.4, 148.0])
    >>> round(r["k_series"], 4), round(r["k_parallel"], 4)
    (2.0901, 50.2667)
    """
    if len(thicknesses) != len(kappas):
        raise ValueError("thicknesses and kappas must have the same number of elements")
    if not thicknesses:
        raise ValueError("at least one layer is required")
    if any(d <= 0 for d in thicknesses) or any(k <= 0 for k in kappas):
        raise ValueError("thicknesses and kappas must be positive")

    total = math.fsum(thicknesses)
    k_series = total / math.fsum(d / k for d, k in zip(thicknesses, kappas, strict=True))
    k_parallel = math.fsum(k * d for k, d in zip(kappas, thicknesses, strict=True)) / total
    return {
        "k_series": k_series,
        "k_parallel": k_parallel,
        "total_thickness": total,
        "n_layers": len(thicknesses),
    }


def sauerbrey(
    delta_f: float,
    f0: float,
    *,
    area: float | None = None,
    density: float | None = None,
) -> dict[str, Any]:
    r"""QCM areal mass (and optional thickness) from a Sauerbrey frequency
    shift (``sauerbrey.m`` / DiraCulator QCM card).

    .. math::

        \Delta f = -\frac{2 f_0^2}{\sqrt{\mu_q \rho_q}} \cdot \frac{\Delta m}{A}
                 = -C_f \cdot \frac{\Delta m}{A}

    Standard sign convention: a mass-loaded crystal's resonant frequency
    DECREASES, so ``delta_f`` is negative for the ordinary case of added
    mass (film growth, adsorption) — the returned areal mass is then
    positive. ``Cf = 2·f0²/√(μ_q·ρ_q)`` is the crystal's mass-sensitivity
    factor (Hz per g/cm²), using the standard AT-cut quartz shear modulus
    ``μ_q = 2.947e11 g/(cm·s²)`` and density ``ρ_q = 2.648 g/cm³`` — for the
    common 5 MHz crystal this evaluates to the textbook ``Cf ≈ 56.6 Hz·cm²/µg``.

    Valid only in the thin, rigid-film regime (``|Δf|/f0 ≪ 1``, conventionally
    up to a few percent of ``f0``); this function does not itself check for or
    warn about that regime (it has no access to the raw admittance spectrum to
    judge rigidity) — outside it, a viscoelastic model (Kanazawa-Gordon,
    Voinova) is needed instead.

    Args:
        delta_f: measured frequency shift (Hz); negative for added mass.
        f0: crystal fundamental resonant frequency (Hz), > 0.
        area: active electrode area (cm²); when given (> 0), the total
            deposited mass ``delta_m = areal_mass · area`` is also returned.
        density: film mass density (g/cm³); when given (> 0) together with
            ``area``, the film thickness ``delta_m / (density · area)`` is
            also returned (cm and nm).

    Returns ``areal_mass`` (g/cm²) and ``areal_mass_ng_cm2`` (ng/cm²), the
    sensitivity factor ``Cf`` (Hz·cm²/g) and ``Cf_hz_cm2_ug`` (Hz·cm²/µg),
    plus ``delta_m`` (g) and ``thickness``/``thickness_nm`` (cm/nm) when
    ``area``/``density`` are supplied.

    >>> r = sauerbrey(-10.0, 5e6)
    >>> round(r["Cf_hz_cm2_ug"], 2)
    56.6
    >>> round(r["areal_mass_ng_cm2"], 4)
    176.6766
    """
    if f0 <= 0:
        raise ValueError("f0 must be positive")
    if area is not None and area <= 0:
        raise ValueError("area must be positive")
    if density is not None and density <= 0:
        raise ValueError("density must be positive")

    cf = 2.0 * f0**2 / math.sqrt(_MU_Q * _RHO_Q)  # Hz*cm^2/g
    areal_mass = -delta_f / cf  # g/cm^2 (positive for delta_f < 0, added mass)

    out: dict[str, Any] = {
        "areal_mass": areal_mass,
        "areal_mass_ng_cm2": areal_mass * 1e9,
        "Cf": cf,
        "Cf_hz_cm2_ug": cf / 1e6,
        "delta_f": delta_f,
        "f0": f0,
    }
    if area is not None:
        delta_m = areal_mass * area
        out["delta_m"] = delta_m
        out["delta_m_ng"] = delta_m * 1e9
        if density is not None:
            thickness = delta_m / (density * area)  # cm
            out["thickness"] = thickness
            out["thickness_nm"] = thickness * 1e7
    return out


def sputter_rate(y: float, j: float, rho: float, m: float) -> dict[str, float]:
    """Sputter erosion rate from yield + current density (``sputterRate.m``).

    Ion flux φ = J/q (J in A/cm²); atom flux = Y·φ; volume flux =
    Y·φ·M/(ρ·N_A) (cm/s); rate (nm/s) = volume flux · 1e7. J is supplied in
    mA/cm² and converted to A/cm² internally.

    Args:
        y: sputter yield (atoms/ion), > 0.
        j: ion current density (mA/cm²), > 0.
        rho: target bulk density (g/cm³), > 0.
        m: target molar mass (g/mol), > 0.

    Returns ``rate`` (nm/s) and ``rate_nm_per_min``.

    >>> round(sputter_rate(2.5, 1.0, 19.3, 196.97)["rate"], 4)
    2.6444
    """
    if y <= 0 or j <= 0 or rho <= 0 or m <= 0:
        raise ValueError("Y, J, rho and M must be positive")
    c = constants()
    j_a = j * 1e-3  # mA/cm^2 -> A/cm^2
    flux = j_a / c["e"]  # ions/cm^2/s
    rate_cmps = y * flux * m / (rho * c["NA"])
    rate = rate_cmps * 1e7  # cm/s -> nm/s
    return {
        "rate": rate,
        "rate_nm_per_min": rate * 60,
        "Y": y,
        "J": j,
        "rho": rho,
        "M": m,
    }


def stoney_stress(es: float, nus: float, ts: float, tf: float, r: float) -> dict[str, float]:
    """Biaxial film stress via the Stoney equation (``stoneyStress.m``).

    ``σ = E_s·t_s² / (6·(1−ν_s)·t_f·R)``. Positive σ = tensile, negative =
    compressive (sign carried by R, the radius of curvature).

    Args:
        es: substrate Young's modulus (Pa), > 0.
        nus: substrate Poisson ratio (dimensionless), >= 0.
        ts: substrate thickness (m), > 0.
        tf: film thickness (m), > 0.
        r: substrate radius of curvature (m), non-zero (positive = concave up).

    Returns ``stress`` (Pa), ``stress_MPa``, ``stress_GPa``.

    >>> round(stoney_stress(130e9, 0.28, 500e-6, 100e-9, 10.0)["stress"] / 1e9, 4)
    7.5231
    """
    if es <= 0 or ts <= 0 or tf <= 0:
        raise ValueError("Es, ts and tf must be positive")
    if not (0 <= nus < 1):
        # nus == 1 divides by zero in the biaxial modulus (1 - nus) below.
        raise ValueError("nus must satisfy 0 <= nus < 1")
    if r == 0:
        raise ValueError("radius of curvature R must be non-zero")
    stress = (es * ts**2) / (6 * (1 - nus) * tf * r)
    return {
        "stress": stress,
        "stress_MPa": stress * 1e-6,
        "stress_GPa": stress * 1e-9,
        "Es": es,
        "ts": ts,
        "tf": tf,
        "R": r,
    }


def thermal_mismatch_strain(
    alpha_film: float,
    alpha_sub: float,
    delta_t: float,
    *,
    e: float | None = None,
    nu: float = 0.3,
) -> dict[str, Any]:
    """Thermal-mismatch strain (and optional biaxial stress) (``thermalMismatchStrain.m``).

    ``ε = (α_f − α_s)·ΔT``; if a film biaxial modulus E is given,
    ``σ = E·ε/(1−ν)``. Positive = tensile, negative = compressive.

    Args:
        alpha_film: film linear CTE (1/K).
        alpha_sub: substrate linear CTE (1/K).
        delta_t: temperature change T_final − T_initial (K).
        e: film biaxial modulus (Pa); enables the stress calculation.
        nu: film Poisson ratio (used only when ``e`` is given), >= 0; default 0.3.

    Returns ``strain`` (dimensionless), ``stress_MPa`` (NaN when E absent), and
    ``description`` ('tensile' / 'compressive' / 'none').

    >>> r = thermal_mismatch_strain(17e-6, 3e-6, -500.0)
    >>> round(r["strain"], 9), r["description"]
    (-0.007, 'compressive')
    """
    if not (0 <= nu < 1):
        # nu == 1 divides by zero in the biaxial modulus below; nu > 0.5 is
        # already unphysical for a real solid.
        raise ValueError("nu must satisfy 0 <= nu < 1")
    strain = (alpha_film - alpha_sub) * delta_t

    if e is not None:
        stress_mpa: float = (e * strain / (1 - nu)) * 1e-6
    else:
        stress_mpa = float("nan")

    if strain > 0:
        desc = "tensile"
    elif strain < 0:
        desc = "compressive"
    else:
        desc = "none"

    return {
        "strain": strain,
        "stress_MPa": stress_mpa,
        "alphaFilm": alpha_film,
        "alphaSub": alpha_sub,
        "deltaT": delta_t,
        "description": desc,
    }
