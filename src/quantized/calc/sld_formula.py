"""Scattering-length density from a chemical formula (neutron + X-ray).

Computes the neutron and X-ray scattering-length densities (SLD) of a
compound from its chemical formula, mass density, and probe wavelength —
including the **imaginary (absorption)** parts and the wavelength
dependence (neutron absorption scales as 1/v ∝ λ; X-ray f′/f″ are
energy-dependent).

The atomic data and formulas come from ``periodictable`` (Sears neutron
tables + Henke/CXRO X-ray f1/f2 tables), which is the same engine behind
the **NIST NCNR online SLD calculator** and ``refl1d``. Parity with the
NCNR calculator is asserted in ``tests/test_sld_formula.py``.

Pure library: ndarray/scalars in → ``dict`` out. No fastapi/pydantic.
"""

from __future__ import annotations

import math
from typing import Any

import periodictable as pt
from periodictable import formula as _formula

#: Thermal-neutron wavelength (2200 m/s) — the NCNR calculator default (Å).
NEUTRON_WAVELENGTH = 1.798
#: Cu Kα — the conventional laboratory X-ray wavelength (Å).
XRAY_WAVELENGTH = 1.5418


def _critical_q(sld_real_1e6: float) -> float:
    """Critical wavevector Qc (1/Å) for total external reflection.

    Qc = 4·√(π·SLD) with SLD the *real* coherent SLD (1/Å²). Below Qc a
    beam totally externally reflects; it is the headline number for a
    reflectometry substrate. Returns 0 for a non-positive (over-/under-
    dense relative to vacuum) SLD, where no critical edge exists.
    """
    sld = sld_real_1e6 * 1e-6
    if sld <= 0:
        return 0.0
    return 4.0 * math.sqrt(math.pi * sld)


def sld_from_formula(
    compound: str,
    density: float,
    *,
    neutron_wavelength: float = NEUTRON_WAVELENGTH,
    xray_wavelength: float = XRAY_WAVELENGTH,
) -> dict[str, Any]:
    """Neutron + X-ray SLD of *compound* at mass *density* (g/cm³).

    Parameters
    ----------
    compound:
        Chemical formula, e.g. ``"SiO2"``, ``"D2O"``, ``"Fe2O3"``. Isotopes
        use ``periodictable`` syntax (``"D2O"``, ``"Si[30]"``).
    density:
        Mass density in g/cm³ (required — there is no default for a
        compound, matching the NCNR calculator).
    neutron_wavelength, xray_wavelength:
        Probe wavelengths in Å. The neutron value sets the absorption (1/v)
        scaling; the X-ray value selects the f′/f″ anomalous corrections.

    Returns
    -------
    dict with ``formula``, ``molar_mass`` (g/mol), ``number_density``
    (formula units/cm³), and ``neutron`` / ``xray`` sub-dicts. Each carries
    ``sld_real`` and ``sld_imag`` (10⁻⁶ Å⁻²; ``sld_imag`` is the absorption
    term), a ``penetration`` 1/e depth (cm), and a critical ``qc`` (1/Å).
    The neutron block additionally reports the ``incoherent`` SLD and the
    coherent/absorption/incoherent macroscopic cross sections (1/cm).

    Raises
    ------
    ValueError
        Empty formula, non-positive density/wavelength, an unparseable
        formula, or a formula whose elements lack neutron data.
    """
    if not compound.strip():
        raise ValueError("formula is empty")
    if not (density > 0):
        raise ValueError("density must be positive")
    if not (neutron_wavelength > 0 and xray_wavelength > 0):
        raise ValueError("wavelength must be positive")

    try:
        mol = _formula(compound, density=density)
    except (ValueError, KeyError) as exc:
        raise ValueError(f"could not parse formula {compound!r}: {exc}") from exc

    # neutron_scattering → ((real, -imag, incoh) SLD [1e-6/Å²],
    #                       (coh, abs, incoh) xs [1/cm], penetration [cm])
    # or (None, None, None) when a component has no neutron data.
    sld, xs, pen = pt.neutron_scattering(mol, wavelength=neutron_wavelength)
    if sld is None:
        raise ValueError(f"no neutron scattering data for {compound!r}")
    n_re, n_im, n_inc = (float(v) for v in sld)
    xs_coh, xs_abs, xs_inc = (float(v) for v in xs)
    n_pen = float(pen)

    # xray_sld → (real, imag) SLD [1e-6/Å²]; imag is the absorption term.
    x_re_v, x_im_v = pt.xray_sld(mol, wavelength=xray_wavelength)
    x_re, x_im = float(x_re_v), float(x_im_v)
    # 1/e *intensity* penetration depth: μ = 2·λ·Im(SLD) [1/Å] (λ Å, SLD 1/Å²);
    # depth = 1/μ, converted Å → cm (×1e-8).
    x_mu = 2.0 * xray_wavelength * (x_im * 1e-6)
    x_pen = (1.0 / x_mu) * 1e-8 if x_mu > 0 else math.inf

    number_density = density / mol.mass * pt.constants.avogadro_number

    return {
        "formula": str(mol),
        "molar_mass": float(mol.mass),
        "number_density": float(number_density),
        "neutron": {
            "wavelength": neutron_wavelength,
            "sld_real": n_re,
            "sld_imag": n_im,
            "incoherent": n_inc,
            "xs_coherent": xs_coh,
            "xs_absorption": xs_abs,
            "xs_incoherent": xs_inc,
            "penetration": n_pen,
            "qc": _critical_q(n_re),
        },
        "xray": {
            "wavelength": xray_wavelength,
            "sld_real": x_re,
            "sld_imag": x_im,
            "penetration": x_pen,
            "qc": _critical_q(x_re),
        },
    }
