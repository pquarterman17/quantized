"""SLD-from-formula (calc.sld_formula) — parity with the NIST NCNR calculator.

The reference numbers are the values the NIST NCNR online SLD calculator
(https://www.ncnr.nist.gov/resources/activation/) reports for these
materials. Our implementation wraps ``periodictable`` — the same engine the
NCNR calculator uses — so parity is exact in principle; we assert to ~0.1%
(``rtol=2e-3``) to document the published numbers rather than chase the last
digit. These are *reference-value* tests (universal atomic data), not MATLAB
golden tests — there is no MATLAB source for this feature.
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.sld_formula import sld_from_formula

RTOL = 2e-3

# ── NIST NCNR reference values ──────────────────────────────────────────────
# (formula, density g/cm³) → expected neutron/xray real SLD (10⁻⁶ Å⁻²),
# neutron λ = 1.798 Å, X-ray λ = 1.5418 Å (Cu Kα).
NIST_NEUTRON_REAL = {
    ("Si", 2.33): 2.074,
    ("SiO2", 2.65): 4.186,  # fused quartz
    ("H2O", 1.00): -0.561,  # light water — negative SLD (H is negative b)
    ("D2O", 1.11): 6.388,  # heavy water
    ("Fe", 7.87): 8.020,
}
NIST_XRAY_REAL = {
    ("Si", 2.33): 20.07,
    ("SiO2", 2.65): 22.72,
    ("Fe", 7.87): 59.42,
}


@pytest.mark.parametrize(("key", "expected"), NIST_NEUTRON_REAL.items())
def test_neutron_real_sld_matches_nist(key: tuple[str, float], expected: float) -> None:
    out = sld_from_formula(key[0], key[1])
    assert out["neutron"]["sld_real"] == pytest.approx(expected, rel=RTOL)


@pytest.mark.parametrize(("key", "expected"), NIST_XRAY_REAL.items())
def test_xray_real_sld_matches_nist(key: tuple[str, float], expected: float) -> None:
    out = sld_from_formula(key[0], key[1])
    assert out["xray"]["sld_real"] == pytest.approx(expected, rel=RTOL)


def test_silicon_full_block() -> None:
    """Si is the canonical reference: every reported quantity vs NIST/CXRO."""
    out = sld_from_formula("Si", 2.33)
    n, x = out["neutron"], out["xray"]
    assert n["sld_real"] == pytest.approx(2.074, rel=RTOL)
    assert n["penetration"] == pytest.approx(8.561, rel=5e-3)  # cm
    assert x["sld_real"] == pytest.approx(20.07, rel=RTOL)
    assert x["sld_imag"] == pytest.approx(0.458, rel=5e-3)  # absorption term
    # X-ray 1/e penetration ≈ 71 µm at 8 keV (CXRO attenuation length).
    assert x["penetration"] * 1e4 == pytest.approx(70.8, rel=5e-3)  # cm → µm
    assert out["molar_mass"] == pytest.approx(28.085, rel=RTOL)


def test_water_neutron_sld_is_negative() -> None:
    """H2O has a negative neutron SLD (hydrogen's coherent b < 0) — a headline
    fact of contrast-matching that any correct calculator must reproduce."""
    out = sld_from_formula("H2O", 1.0)
    assert out["neutron"]["sld_real"] < 0
    assert out["neutron"]["sld_real"] == pytest.approx(-0.561, rel=RTOL)


def test_gadolinium_strong_neutron_absorber() -> None:
    """Gd is the textbook strong neutron absorber: a large imaginary SLD."""
    out = sld_from_formula("Gd", 7.9)
    assert out["neutron"]["sld_imag"] > 4.0  # 10⁻⁶ Å⁻²
    assert out["neutron"]["xs_absorption"] > 100.0  # 1/cm — opaque to neutrons


def test_iron_xray_absorption() -> None:
    """Cu Kα (8 keV) sits above the Fe K-edge → strong X-ray absorption."""
    out = sld_from_formula("Fe", 7.87)
    assert out["xray"]["sld_imag"] == pytest.approx(7.68, rel=5e-3)


# ── Wavelength dependence (the explicit requirement) ───────────────────────
def test_neutron_absorption_scales_with_wavelength() -> None:
    """1/v absorption: the macroscopic absorption cross section ∝ λ."""
    a = sld_from_formula("Si", 2.33, neutron_wavelength=1.798)
    b = sld_from_formula("Si", 2.33, neutron_wavelength=2.0 * 1.798)
    ratio = b["neutron"]["xs_absorption"] / a["neutron"]["xs_absorption"]
    assert ratio == pytest.approx(2.0, rel=1e-3)


def test_neutron_imaginary_sld_wavelength_independent() -> None:
    """Im(SLD) = σ_abs/(2λ); with σ_abs ∝ λ the λ cancels → constant."""
    a = sld_from_formula("Si", 2.33, neutron_wavelength=1.798)
    b = sld_from_formula("Si", 2.33, neutron_wavelength=2.0 * 1.798)
    assert b["neutron"]["sld_imag"] == pytest.approx(a["neutron"]["sld_imag"], rel=1e-3)


def test_xray_energy_changes_sld() -> None:
    """X-ray SLD is wavelength-dependent through f′/f″ — Mo Kα ≠ Cu Kα for Fe
    (different distance from the K-edge)."""
    cu = sld_from_formula("Fe", 7.87, xray_wavelength=1.5418)
    mo = sld_from_formula("Fe", 7.87, xray_wavelength=0.7107)
    assert cu["xray"]["sld_imag"] != pytest.approx(mo["xray"]["sld_imag"], rel=1e-2)


def test_critical_q_silicon() -> None:
    """Qc = 4√(πρ_SLD): Si neutron Qc ≈ 0.0102 Å⁻¹ (a standard substrate value)."""
    out = sld_from_formula("Si", 2.33)
    assert out["neutron"]["qc"] == pytest.approx(0.01021, rel=RTOL)


# ── Validation ─────────────────────────────────────────────────────────────
def test_empty_formula_raises() -> None:
    with pytest.raises(ValueError, match="empty"):
        sld_from_formula("   ", 2.33)


def test_nonpositive_density_raises() -> None:
    with pytest.raises(ValueError, match="density"):
        sld_from_formula("Si", 0.0)


def test_nonpositive_wavelength_raises() -> None:
    with pytest.raises(ValueError, match="wavelength"):
        sld_from_formula("Si", 2.33, neutron_wavelength=-1.0)


def test_bad_formula_raises() -> None:
    with pytest.raises(ValueError):
        sld_from_formula("Xx2O3", 2.33)


def test_no_infinite_or_nan() -> None:
    out = sld_from_formula("SiO2", 2.65)
    for block in (out["neutron"], out["xray"]):
        for key, v in block.items():
            if isinstance(v, float):
                assert math.isfinite(v), f"{key} not finite"


# ── API integration ───────────────────────────────────────────────────────
client = TestClient(app)


def test_api_sld_formula() -> None:
    resp = client.post(
        "/api/sld/formula",
        json={"formula": "Si", "density": 2.33},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["neutron"]["sld_real"] == pytest.approx(2.074, rel=RTOL)
    assert body["xray"]["sld_real"] == pytest.approx(20.07, rel=RTOL)


def test_api_sld_custom_wavelengths() -> None:
    resp = client.post(
        "/api/sld/formula",
        json={
            "formula": "D2O",
            "density": 1.11,
            "neutron_wavelength": 5.0,
            "xray_wavelength": 0.7107,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["neutron"]["sld_real"] == pytest.approx(6.388, rel=RTOL)


def test_api_bad_formula_returns_422() -> None:
    resp = client.post("/api/sld/formula", json={"formula": "Zz9", "density": 1.0})
    assert resp.status_code == 422
