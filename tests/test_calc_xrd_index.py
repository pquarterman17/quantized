"""calc/xrd_index.py: built-in-phase reflections + peak → (hkl) matching.

No MATLAB golden exists for the matcher (``matchPhases`` was not available to
freeze — see PORT_CHECKLIST "Phase matching"), so every value below is a
HAND-COMPUTED reference with the arithmetic shown. The cell enumeration is the
golden-verified ``plane_spacings``; the phases are ``calc.phase_database``
(verbatim MATLAB ``phaseDatabase``: Si there is a = 5.4309 Å).
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pytest

from quantized.calc.xrd_index import (
    CU_KA1_A,
    cell_reflections,
    index_peaks,
    match_peaks,
    phase_reflections,
    xrd_phase_choices,
)

# Si, a = 5.431 Å, Cu Kα1 λ = 1.5406 Å. Cubic: d = a/√(h²+k²+l²);
# Bragg: 2θ = 2·asin(λ/2d).
#   (111): N=3,  √3  = 1.732051, d = 5.431/1.732051 = 3.135589, λ/2d = 0.245664, 2θ = 28.4421°
#   (220): N=8,  √8  = 2.828427, d = 5.431/2.828427 = 1.920148, λ/2d = 0.401167, 2θ = 47.3023°
#   (311): N=11, √11 = 3.316625, d = 5.431/3.316625 = 1.637508, λ/2d = 0.470410, 2θ = 56.1218°
#   (400): N=16, √16 = 4,        d = 5.431/4        = 1.357750, λ/2d = 0.567336, 2θ = 69.1293°
#   (331): N=19, √19 = 4.358899, d = 5.431/4.358899 = 1.245957, λ/2d = 0.618240, 2θ = 76.3754°
# Diamond absences in 20–80°: (200) N=4 (all even, h+k+l=2 ≠ 4n) at 32.96°,
# (222) N=12 (sum 6 ≠ 4n) at 58.86°; mixed-parity (100)/(110)/(210)... by F centering.
SI_TABLE = [
    ([1, 1, 1], 3.135589, 28.4421, 8),
    ([2, 2, 0], 1.920148, 47.3023, 12),
    ([3, 1, 1], 1.637508, 56.1218, 24),
    ([4, 0, 0], 1.357750, 69.1293, 6),
    ([3, 3, 1], 1.245957, 76.3754, 24),
]

# Peak centres of the repo's synthetic Si-like pattern
# frontend/e2e/fixtures/XRD_theta2theta.xy (Lorentzian least-squares centres of
# its six peaks, measured 2026-11-17). 32.899 is a deliberate non-Si peak.
FIXTURE_CENTRES = [28.4001, 32.899, 47.2998, 56.0995, 69.1009, 76.4000]
FIXTURE = Path(__file__).resolve().parents[1] / "frontend/e2e/fixtures/XRD_theta2theta.xy"


def _diamond(h: int, k: int, ll: int) -> bool:
    """Fd-3m beyond F centering: all-even (hkl) need h+k+l = 4n."""
    return not (h % 2 == 0 and k % 2 == 0 and ll % 2 == 0) or (h + k + ll) % 4 == 0


def test_si_cell_reflections_match_hand_table() -> None:
    refl = cell_reflections(5.431, centering="F", rule=_diamond, two_theta_min=20, two_theta_max=80)
    assert [r["hkl"] for r in refl] == [row[0] for row in SI_TABLE]
    assert [r["label"] for r in refl] == ["(111)", "(220)", "(311)", "(400)", "(331)"]
    for r, (_, d, tt, mult) in zip(refl, SI_TABLE, strict=True):
        assert r["d"] == pytest.approx(d, abs=5e-6)
        assert r["two_theta"] == pytest.approx(tt, abs=5e-4)
        assert r["multiplicity"] == mult


def test_silicon_phase_uses_basis_absences_and_matlab_cell() -> None:
    out = phase_reflections("Silicon", two_theta_min=20, two_theta_max=80)
    assert out["absences"] == "structure factor"
    assert out["phase"]["a"] == 5.4309  # phaseDatabase.m verbatim, not 5.431
    refl = out["reflections"]
    assert [r["label"] for r in refl] == ["(111)", "(220)", "(311)", "(400)", "(331)"]
    # a 5.4309 vs 5.431 moves 2θ by < 0.002° here (Δa/a = 1.8e-5 → Δ2θ = 2·tanθ·1.8e-5 rad)
    for r, (_, _, tt, _) in zip(refl, SI_TABLE, strict=True):
        assert r["two_theta"] == pytest.approx(tt, abs=2e-3)


def test_structure_factor_absences() -> None:
    ge = {tuple(r["hkl"]) for r in phase_reflections("Ge", two_theta_max=100)["reflections"]}
    assert (2, 0, 0) not in ge and (2, 2, 2) not in ge and (4, 2, 0) not in ge  # d-glide
    assert (4, 0, 0) in ge and (4, 2, 2) in ge  # all-even with h+k+l = 4n survive
    # Au, a = 4.0782: (200) d = 2.0391, 2θ = 2·asin(1.5406/4.0782) = 44.39°
    au = phase_reflections("Gold", two_theta_max=100)["reflections"]
    assert [r["label"] for r in au][:2] == ["(111)", "(200)"]
    assert au[1]["two_theta"] == pytest.approx(44.39, abs=0.01)
    # rock salt keeps all-odd (111) (F = 4(Z_Mg − Z_O) ≠ 0); zinc blende keeps (200)
    assert phase_reflections("MgO", two_theta_max=40)["reflections"][0]["label"] == "(111)"
    gaas = {r["label"] for r in phase_reflections("GaAs", two_theta_max=40)["reflections"]}
    assert "(200)" in gaas
    # wurtzite: (001) absent by the 6_3 screw, (002) present
    gan = {r["label"] for r in phase_reflections("GaN (wurtzite)", two_theta_max=40)["reflections"]}
    assert "(001)" not in gan and "(002)" in gan


def test_fixture_si_peaks_index_within_005_deg() -> None:
    res = index_peaks(
        FIXTURE_CENTRES, "Silicon", tolerance=0.05, two_theta_min=10, two_theta_max=80
    )
    labels = [m["label"] for m in res["matches"]]
    assert labels == ["(111)", None, "(220)", "(311)", "(400)", "(331)"]
    assert res["n_matched"] == 5
    for m in res["matches"]:
        if m["label"] is not None:
            assert abs(m["delta"]) < 0.05
            # d_obs is the peak's own Bragg d: λ/(2 sin θ_peak)
            assert m["d_obs"] == pytest.approx(
                CU_KA1_A / (2 * math.sin(math.radians(m["peak_two_theta"] / 2)))
            )


@pytest.mark.skipif(not FIXTURE.exists(), reason="frontend fixture not in this checkout")
def test_fixture_centres_are_the_files_peaks() -> None:
    data = np.loadtxt(FIXTURE)
    for c in FIXTURE_CENTRES:
        window = data[(data[:, 0] > c - 0.3) & (data[:, 0] < c + 0.3)]
        assert abs(window[np.argmax(window[:, 1]), 0] - c) <= 0.02


def test_match_rule_nearest_within_tolerance_inclusive_and_ties_low() -> None:
    # Binary-exact positions (multiples of 1/8) so "inclusive" is tested, not rounding.
    refl = [
        {"hkl": [1, 0, 0], "label": "(100)", "d": 2.0, "two_theta": 30.0},
        {"hkl": [1, 1, 0], "label": "(110)", "d": 1.9, "two_theta": 30.5},
    ]
    got = match_peaks([30.25, 30.375, 30.5, 31.0, float("nan")], refl, tolerance=0.125)
    assert [m["label"] for m in got] == [None, "(110)", "(110)", None, None]
    tie = match_peaks([30.25], refl, tolerance=0.25)
    assert tie[0]["label"] == "(100)"  # equidistant → earlier reflection
    assert tie[0]["delta"] == 0.25
    with pytest.raises(ValueError):
        match_peaks([30.0], refl, tolerance=-1)


def test_corundum_r3c_conditions() -> None:
    # Hexagonal: 1/d² = 4/3·(h²+hk+k²)/a² + l²/c², a = 4.7589, c = 12.991.
    #   (012): 4/3·1/22.6471 + 4/168.766 = 0.058874 + 0.023702 = 0.082576 → d = 3.4800,
    #          2θ = 2·asin(1.5406/6.9600) = 25.577°
    #   (104): 4/3·1/22.6471 + 16/168.766 = 0.058874 + 0.094806 = 0.153680 → d = 2.5509,
    #          2θ = 35.152°
    out = phase_reflections("Sapphire (Al2O3)", two_theta_min=20, two_theta_max=70)
    assert out["absences"] == "space group"
    refl = out["reflections"]
    labels = [r["label"] for r in refl]
    assert labels[:8] == ["(012)", "(104)", "(110)", "(006)", "(113)", "(202)", "(024)", "(116)"]
    assert "(300)" in labels
    assert "(101)" not in labels and "(003)" not in labels
    assert refl[0]["d"] == pytest.approx(3.4800, abs=1e-4)
    assert refl[0]["two_theta"] == pytest.approx(25.577, abs=1e-3)
    assert refl[1]["d"] == pytest.approx(2.5509, abs=1e-4)


def test_phase_choices_and_errors() -> None:
    choices = {p["name"]: p for p in xrd_phase_choices()}
    cubic = ("Silicon", "Ge", "Gold", "Silver", "Copper", "Aluminum", "Platinum", "MgO", "SrTiO3")
    for name in cubic:
        assert choices[name]["absences"] == "structure factor"
    assert choices["Sapphire (Al2O3)"]["absences"] == "space group"
    assert choices["Fe3O4 (magnetite)"]["absences"] == "lattice"
    assert "SrRuO3" not in choices  # orthorhombic: not indexable here
    with pytest.raises(ValueError, match="unknown phase"):
        phase_reflections("unobtainium")
    with pytest.raises(ValueError):
        phase_reflections("Silicon", two_theta_min=50, two_theta_max=40)
    with pytest.raises(ValueError, match="Miller indices"):
        phase_reflections("Sapphire (Al2O3)", wavelength=0.2, two_theta_max=170)


def test_srtio3_primitive_keeps_100() -> None:
    # SrTiO₃ a = 3.905: (100) d = 3.905, 2θ = 2·asin(1.5406/7.810) = 22.754°
    refl = phase_reflections("SrTiO3", two_theta_min=20, two_theta_max=40)["reflections"]
    assert refl[0]["label"] == "(100)"
    assert refl[0]["two_theta"] == pytest.approx(22.754, abs=1e-3)
