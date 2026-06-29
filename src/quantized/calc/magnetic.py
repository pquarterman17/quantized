r"""Magnetic-properties calculators (DiraCulator ``buildMagneticTab`` +
``+calc/+magnetic``).

Pure calc layer — closed-form scalars in, result dicts out. No fastapi /
pydantic imports. Ports the MATLAB magnetic-tab cards and their backing
``calc.magnetic`` functions:

.. math::

    m\,[\mu_B] = m / \mu_{B,\text{cgs}} \qquad
    M_\text{cgs} = m / V \qquad M_\text{SI} = 1000\,M_\text{cgs} \\
    N_z + 2 N_{xy} = 1 \qquad
    \mu_\text{eff} = \sqrt{3 k_B C / (N_A \mu_B^2)}\ [\mu_B] \\
    \chi = C/(T-\theta) \qquad
    L(x) = \coth x - 1/x,\ \ x = \mu H/(k_B T) \\
    \delta = \pi\sqrt{A/K} \qquad E_\text{wall} = 4\sqrt{A K}

This is the **magnetic CALCULATOR** tab (unit conversions, demagnetizing
factors, Curie–Weiss, Langevin, domain walls) — distinct from
``calc.magnetometry`` (hysteresis-loop analysis).

Unit convention follows the MATLAB toolbox (CGS for instrument data): moment in
emu, magnetization in emu/cm³ (= 1000 A/m), field in Oe, exchange stiffness A in
erg/cm, anisotropy K in erg/cm³. CGS constants are derived from the SI
``constants()`` (no retyping): ``muB_cgs = muB_SI·1e3`` emu, ``kB_cgs =
kB_SI·1e7`` erg/K.

Reference values (closed form / MATLAB docstrings):
  - ``bohr_magneton_convert(9.2740100783e-21, 'emu') -> mu_b = 1.0``
  - ``magnetization(2.5e-3, 5e-5) -> M_si = 50000`` A/m
  - ``demag_factor('sphere') -> Nz = 1/3``;  ``'thin_film' -> Nz = 1``
  - ``curie_weiss_moment(4.375, -50) -> mu_eff ≈ 5.91`` µ_B (≈ 2.828·√C)
  - ``domain_wall(2e-6, 4.8e6) -> delta ≈ 20.3`` nm

MATLAB source bugs found and corrected here (see module-level notes):
  1. ``DiraCulator.doCurieWeiss`` / ``curieWeiss.m`` µ_eff: the GUI card is
     correct (≈ 2.828·√C); ``curieWeiss.m`` uses ``C_SI = C*1e-3`` with SI
     constants, making its ``mu_eff`` ~100× too small. We freeze the
     physically-correct CGS form (matching the GUI and textbook).
  2. ``DiraCulator.doDomainWall`` wall-energy conversion: it multiplies by
     ``1e-3*1e4 = 10`` to go erg/cm² → mJ/m², but 1 erg/cm² = 1 mJ/m² exactly.
     We use the correct ×1 factor (Co ≈ 15 mJ/m²).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from quantized.calc.constants import constants

__all__ = [
    "bohr_magneton_convert",
    "curie_weiss_fit",
    "curie_weiss_moment",
    "demag_factor",
    "demag_named",
    "domain_wall",
    "langevin",
    "magnetization",
    "moment_convert",
    "moment_per_atom",
]

# CGS constants derived from the SI CODATA values (no retyping).
#   1 emu = 1e-3 A*m^2 = 1e-3 J/T  ->  muB_cgs = muB_SI * 1e3 emu
#   1 J = 1e7 erg                  ->  kB_cgs  = kB_SI  * 1e7 erg/K
_MUB_SI = constants()["muB"]  # J/T = A*m^2
_MUB_CGS = _MUB_SI * 1e3  # emu (9.2740100783e-21)
_KB_CGS = constants()["kB"] * 1e7  # erg/K (1.380649e-16)
_NA = constants()["NA"]  # 1/mol

# Input-unit -> emu scale factor (DiraCulator moment dropdown ItemsData).
_MOMENT_UNIT_SCALE: dict[str, float] = {
    "emu": 1.0,
    "Am2": 1e3,  # 1 A*m^2 = 1e3 emu
    "memu": 1e-3,
    "uemu": 1e-6,
}


def bohr_magneton_convert(moment: float, unit: str) -> dict[str, Any]:
    """Convert a magnetic moment to a number of Bohr magnetons (``bohrMagnetonConvert.m``).

    Args:
        moment: magnetic-moment value.
        unit: ``'emu'`` (CGS, 1 emu = 1e-3 A·m²), ``'Am2'`` or ``'JT'`` (SI,
            J/T = A·m²).

    >>> round(bohr_magneton_convert(9.2740100783e-21, "emu")["mu_b"], 9)
    1.0
    >>> round(bohr_magneton_convert(9.2740100783e-24, "Am2")["mu_b"], 9)
    1.0
    """
    if unit == "emu":
        mu_b = moment / _MUB_CGS
    elif unit in ("Am2", "JT"):
        mu_b = moment / _MUB_SI
    else:
        raise ValueError("unit must be 'emu', 'Am2', or 'JT'")
    return {"mu_b": mu_b, "moment": moment, "unit": unit}


def magnetization(moment: float, volume: float) -> dict[str, float]:
    """Magnetization from moment and volume (``magnetization.m``).

    ``M_cgs = m/V`` (emu/cm³); ``M_SI = 1000·M_cgs`` (A/m), since
    1 emu/cm³ = 1000 A/m.

    >>> round(magnetization(2.5e-3, 5e-5)["m_si"], 6)
    50000.0
    """
    if volume <= 0:
        raise ValueError("volume must be positive")
    m_cgs = moment / volume
    m_si = m_cgs * 1000.0
    return {"m_cgs": m_cgs, "m_si": m_si, "m_kam": m_si / 1000.0}


def moment_per_atom(
    total_moment: float, volume: float, atom_density: float
) -> dict[str, float]:
    """Per-atom moment in Bohr magnetons (``momentPerAtom.m``).

    ``M = m/V`` (emu/cm³); ``mu_emu = M/n`` (emu/atom); ``mu_b = mu_emu/μ_B``.

    Args:
        total_moment: total sample moment (emu).
        volume: sample volume (cm³), > 0.
        atom_density: atomic number density (atoms/cm³), > 0.
    """
    if volume <= 0 or atom_density <= 0:
        raise ValueError("volume and atom_density must be positive")
    m_cgs = total_moment / volume
    mu_emu = m_cgs / atom_density
    return {"mu_b": mu_emu / _MUB_CGS, "mu_emu": mu_emu, "m_cgs": m_cgs}


def moment_convert(
    value: float,
    unit: str = "emu",
    *,
    volume: float | None = None,
    atoms: float | None = None,
) -> dict[str, Any]:
    """Moment-conversion card (``DiraCulator.doMomentConvert``).

    Converts a moment in ``emu`` / ``Am2`` / ``memu`` / ``uemu`` to emu and SI
    (A·m²), and to total Bohr magnetons. Optionally returns magnetization
    (if ``volume`` > 0, cm³) and µ_B/atom (if ``atoms`` > 0, a count).

    >>> r = moment_convert(1.0e-3, "emu", volume=0.01)
    >>> round(r["am2"], 9)
    1e-06
    """
    if unit not in _MOMENT_UNIT_SCALE:
        raise ValueError("unit must be one of emu, Am2, memu, uemu")
    emu = value * _MOMENT_UNIT_SCALE[unit]
    am2 = emu * 1e-3
    mu_b = emu / _MUB_CGS
    m_cgs: float | None = None
    m_si: float | None = None
    mu_b_per_atom: float | None = None
    if volume is not None and volume > 0:
        m_cgs = emu / volume
        m_si = m_cgs * 1e3
    if atoms is not None and atoms > 0:
        mu_b_per_atom = mu_b / atoms
    return {
        "emu": emu,
        "am2": am2,
        "mu_b": mu_b,
        "m_cgs": m_cgs,
        "m_si": m_si,
        "mu_b_per_atom": mu_b_per_atom,
    }


# ── Demagnetizing factors ───────────────────────────────────────────────────
_DEMAG_SHAPES = ("sphere", "thin_film", "cylinder", "prolate", "oblate")


def demag_factor(
    shape: str,
    *,
    length: float = 1.0,
    diameter: float = 1.0,
    ratio: float = 2.0,
) -> dict[str, Any]:
    """Demagnetizing factors for common geometries (``demagFactor.m``).

    Returns ``Nz`` along the symmetry axis and ``Nxy = (1 - Nz)/2`` (so
    ``Nz + 2·Nxy = 1``, SI convention; CGS uses ``4π·N``).

    Shapes: ``'sphere'`` (Nz=1/3), ``'thin_film'`` (Nz=1, infinite slab),
    ``'cylinder'`` (Sato–Ishii ``1/(1+1.6·L/d)``, valid L/d∈[0.1,10]),
    ``'prolate'`` (rod, ratio=c/a>1), ``'oblate'`` (disk, ratio=a/c>1) —
    both spheroids via the exact Osborn (1945) formulas.

    >>> round(demag_factor("sphere")["Nz"], 6)
    0.333333
    >>> demag_factor("thin_film")["Nz"]
    1.0
    """
    if shape not in _DEMAG_SHAPES:
        raise ValueError(f"shape must be one of {_DEMAG_SHAPES}")

    if shape == "sphere":
        nz = 1.0 / 3.0
    elif shape == "thin_film":
        nz = 1.0
    elif shape == "cylinder":
        if length <= 0 or diameter <= 0:
            raise ValueError("length and diameter must be positive")
        nz = 1.0 / (1.0 + 1.6 * (length / diameter))
    elif shape == "prolate":
        if ratio <= 1:
            raise ValueError("prolate requires ratio = c/a > 1")
        e2 = 1.0 - (1.0 / ratio) ** 2
        e = math.sqrt(e2)
        nz = (1.0 - e2) / e2 * (-1.0 + 1.0 / (2.0 * e) * math.log((1.0 + e) / (1.0 - e)))
    else:  # oblate
        if ratio <= 1:
            raise ValueError("oblate requires ratio = a/c > 1")
        e2 = 1.0 - (1.0 / ratio) ** 2
        e = math.sqrt(e2)
        nz = (1.0 / e2) * (1.0 - math.sqrt(1.0 - e2) / e * math.asin(e))

    nxy = (1.0 - nz) / 2.0
    return {"Nz": nz, "Nxy": nxy, "shape": shape, "n_cgs": 4.0 * math.pi * nz}


# DiraCulator demag dropdown labels -> canonical-shape calls (with axis swap).
_DEMAG_NAMED = (
    "Sphere",
    "Thin film (in-plane)",
    "Thin film (out-of-plane)",
    "Long cylinder (axial)",
    "Long cylinder (transverse)",
)


def demag_named(label: str) -> dict[str, Any]:
    """Demag factor by GUI dropdown label (``DiraCulator.doDemagFactor``).

    Maps the human-readable geometry to ``demag_factor`` and applies the GUI's
    axis swaps: in-plane film and transverse cylinder report ``Nxy``↔``Nz``
    swapped (long rods use a prolate spheroid with aspect ratio 20).

    >>> demag_named("Sphere")["Nz"]
    0.3333333333333333
    """
    if label == "Sphere":
        r = demag_factor("sphere")
    elif label == "Thin film (out-of-plane)":
        r = demag_factor("thin_film")
    elif label == "Thin film (in-plane)":
        r = demag_factor("thin_film")
        r["Nz"], r["Nxy"] = r["Nxy"], r["Nz"]
    elif label == "Long cylinder (axial)":
        r = demag_factor("prolate", ratio=20)
    elif label == "Long cylinder (transverse)":
        r = demag_factor("prolate", ratio=20)
        r["Nz"], r["Nxy"] = r["Nxy"], r["Nz"]
    else:
        raise ValueError(f"shape must be one of {_DEMAG_NAMED}")
    r["shape"] = label
    r["n_cgs"] = 4.0 * math.pi * r["Nz"]
    return r


# ── Curie–Weiss law ─────────────────────────────────────────────────────────
def _mag_type(theta: float) -> str:
    if theta < 0:
        return "antiferromagnetic"
    if theta > 0:
        return "ferromagnetic"
    return "paramagnetic"


def _mu_eff_from_C(c: float) -> float:
    """Effective moment (µ_B) from the molar CGS Curie constant C (emu·K/mol).

    ``mu_eff = sqrt(3·kB·C / (NA·muB²))`` with CGS units ≈ 2.828·√C. This is the
    physically-correct form (matches the GUI card and the textbook
    ``p_eff = 2.828·√(χT)``); ``curieWeiss.m`` is ~100× low — see module notes.
    """
    return math.sqrt(max(3.0 * _KB_CGS * c / (_NA * _MUB_CGS**2), 0.0))


def curie_weiss_moment(c: float, theta: float) -> dict[str, Any]:
    """Curie–Weiss card (``DiraCulator.doCurieWeiss``).

    From the Curie constant C (emu·K/mol) and Weiss temperature θ (K), returns
    the effective moment (µ_B) and the magnetic-order type from sign(θ).

    >>> round(curie_weiss_moment(4.375, -50)["mu_eff"], 2)
    5.91
    >>> curie_weiss_moment(4.375, -50)["mag_type"]
    'antiferromagnetic'
    """
    if c < 0:
        raise ValueError("Curie constant C must be non-negative")
    return {"mu_eff": _mu_eff_from_C(c), "C": c, "theta": theta, "mag_type": _mag_type(theta)}


def curie_weiss_fit(
    temperature: list[float],
    susceptibility: list[float],
    *,
    fit_range: tuple[float, float] | None = None,
) -> dict[str, Any]:
    """Curie–Weiss parameters from a χ(T) sweep via a 1/χ vs T fit (``curieWeiss.m``).

    Fits ``1/χ = T/C - θ/C`` (linear); slope → C, intercept → θ. Non-positive χ
    points are excluded. When ``fit_range`` is None the fit uses points at and
    above the temperature where 1/χ is maximal (the paramagnetic regime).

    Returns ``theta_cw`` (K), ``C`` (emu·K/mol), ``mu_eff`` (µ_B, corrected CGS
    form), ``fit_line`` ``[slope, intercept]``, ``r2`` and ``inv_chi``.
    """
    t = np.asarray(temperature, dtype=float)
    chi = np.asarray(susceptibility, dtype=float)
    if t.size < 3:
        raise ValueError("need at least 3 data points")
    if chi.size != t.size:
        raise ValueError("temperature and susceptibility must be the same length")

    valid = chi > 0
    inv_chi = np.full(t.size, np.nan, dtype=float)
    inv_chi[valid] = 1.0 / chi[valid]
    t_v = t[valid]
    ic_v = inv_chi[valid]
    if t_v.size == 0:
        raise ValueError("all susceptibility values are non-positive")

    if fit_range is None:
        i_max = int(np.argmax(ic_v))
        mask = t_v >= t_v[i_max]
    else:
        lo, hi = fit_range
        mask = (t_v >= lo) & (t_v <= hi)
    if int(np.count_nonzero(mask)) < 2:
        mask = np.ones(t_v.size, dtype=bool)

    t_fit = t_v[mask]
    ic_fit = ic_v[mask]
    amat = np.vstack([t_fit, np.ones(t_fit.size)]).T
    coef = np.asarray(np.linalg.lstsq(amat, ic_fit, rcond=None)[0], dtype=float)
    slope = float(coef[0])
    intercept = float(coef[1])
    if abs(slope) < np.finfo(float).eps:
        raise ValueError("fitted slope is essentially zero; data may not be Curie-Weiss")

    c = 1.0 / slope
    theta_cw = -intercept / slope
    pred = slope * t_fit + intercept
    ss_tot = float(np.sum((ic_fit - ic_fit.mean()) ** 2))
    ss_res = float(np.sum((ic_fit - pred) ** 2))
    r2 = 1.0 - ss_res / max(ss_tot, np.finfo(float).eps)

    return {
        "theta_cw": theta_cw,
        "C": c,
        "mu_eff": _mu_eff_from_C(c) if c > 0 else float("nan"),
        "fit_line": [slope, intercept],
        "r2": r2,
        "inv_chi": inv_chi.tolist(),
    }


# ── Langevin / superparamagnetism ───────────────────────────────────────────
def langevin(mu: float, field_oe: float, temperature: float) -> dict[str, Any]:
    """Langevin function for a superparamagnet (``DiraCulator.doLangevin``).

    ``x = μ·H/(k_B·T)`` (CGS: μ in emu, H in Oe, T in K); ``L(x) = coth x − 1/x``
    (→ 0 as x → 0). Also returns the moment in Bohr magnetons.

    >>> round(langevin(1e-16, 10000.0, 300.0)["L"], 6) >= 0.0
    True
    """
    if mu < 0:
        raise ValueError("moment mu must be non-negative")
    if temperature <= 0:
        raise ValueError("temperature must be > 0 K")
    x = mu * field_oe / (_KB_CGS * temperature)
    lval = 0.0 if abs(x) < 1e-10 else 1.0 / math.tanh(x) - 1.0 / x
    return {"L": lval, "x": x, "n_mu_b": mu / _MUB_CGS}


# ── Domain wall & anisotropy ────────────────────────────────────────────────
def domain_wall(exchange_a: float, anisotropy_k: float) -> dict[str, Any]:
    """Bloch domain-wall width and energy (``DiraCulator.doDomainWall``).

    ``δ = π·√(A/K)`` (cm) and ``E_wall = 4·√(A·K)`` (erg/cm²), with A the
    exchange stiffness (erg/cm) and K the uniaxial anisotropy (erg/cm³). Width is
    returned in nm and energy in mJ/m² (1 erg/cm² = 1 mJ/m² exactly — the GUI's
    ×10 conversion is a bug; see module notes).

    >>> round(domain_wall(2e-6, 4.8e6)["delta_nm"], 1)
    20.3
    """
    if exchange_a <= 0 or anisotropy_k <= 0:
        raise ValueError("A and K must be positive")
    delta_cm = math.pi * math.sqrt(exchange_a / anisotropy_k)
    e_wall_erg = 4.0 * math.sqrt(exchange_a * anisotropy_k)
    return {
        "delta_cm": delta_cm,
        "delta_nm": delta_cm * 1e7,
        "e_wall_erg_cm2": e_wall_erg,
        "e_wall_mj_m2": e_wall_erg,  # 1 erg/cm^2 = 1 mJ/m^2
    }
