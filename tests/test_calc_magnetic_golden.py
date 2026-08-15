"""Magnetic calculators (calc.magnetic) -- golden parity vs quantized_matlab.

DIRACULATOR_AUDIT P1 evidence. Golden fixtures are STAGED: run
tools/matlab/freeze_calc_values.m (with the "Magnetic" section from
freeze_dira_xray_mag_optics.m merged in) against ../quantized_matlab, then
these tests exercise for real; until then they SKIP via load_golden.

Classification (see calc/magnetic.py module docstring for the full
provenance and the two documented MATLAB-bug corrections):
  class (a) -- direct +calc/+magnetic/*.m port:
    bohr_magneton_convert, magnetization, moment_per_atom, demag_factor
  class (b) -- GUI-embedded formula (DiraCulator.m buildMagneticTab), no
  dedicated +calc file, formula matches the GUI exactly (no divergence):
    demag_named        <-> doDemagFactor    (~3830-3859)
    curie_weiss_moment <-> doCurieWeiss     (~3885-3907) -- NOT curieWeiss.m
    langevin           <-> doLangevin       (~3937-3958)
    moment_convert     <-> doMomentConvert  (~3783-3805)
  class (d) -- intentional divergence from a MATLAB bug; Python freezes/
  computes the INTENDED (corrected) behavior:
    curie_weiss_fit <-> +calc/+magnetic/curieWeiss.m -- the fit machinery
                        (theta_CW/C/fitLine/R2/invChi) is unaffected by the
                        bug and IS compared directly against the real MATLAB
                        output; only curieWeiss.m's mu_eff is wrong (C_SI =
                        C*1e-3 combined with SI kB/muB -> exactly 100x too
                        small -- see magnetic.py module docstring point 1).
                        The exact factor is derivable from unit algebra:
                        (1e-3/1e7) / (1e3)^-2 == 1e-4, sqrt -> 1e-2, so
                        mu_eff_correct == mu_eff_matlab_buggy * 100 exactly.
    domain_wall     <-> doDomainWall (~3984-3996) -- the GUI's x10 erg/cm^2
                        -> mJ/m^2 conversion is wrong (should be x1); frozen
                        with the corrected factor (see docstring point 2).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc.magnetic import (
    bohr_magneton_convert,
    curie_weiss_fit,
    curie_weiss_moment,
    demag_factor,
    demag_named,
    domain_wall,
    langevin,
    magnetization,
    moment_convert,
    moment_per_atom,
)


@pytest.mark.golden
def test_bohr_magneton_convert_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.magnetic.bohrMagnetonConvert(2.5e-3, 'emu') -> muB."""
    g = load_golden("calc_dira_magnetic_bohr_magneton.json")
    out = bohr_magneton_convert(2.5e-3, "emu")
    compare_calc(out["mu_b"], g["output"]["muB"])


@pytest.mark.golden
def test_magnetization_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.magnetic.magnetization(2.5e-3, 5e-5) -> Mcgs/Msi/MkAm."""
    g = load_golden("calc_dira_magnetic_magnetization.json")
    out = magnetization(2.5e-3, 5e-5)
    compare_calc(out["m_cgs"], g["output"]["Mcgs"])
    compare_calc(out["m_si"], g["output"]["Msi"])
    compare_calc(out["m_kam"], g["output"]["MkAm"])


@pytest.mark.golden
def test_moment_per_atom_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.magnetic.momentPerAtom(1.5e-3, 1e-4, 8.49e22) -> muB/muEmu/M."""
    g = load_golden("calc_dira_magnetic_moment_per_atom.json")
    out = moment_per_atom(1.5e-3, 1e-4, 8.49e22)
    compare_calc(out["mu_b"], g["output"]["muB"])
    compare_calc(out["mu_emu"], g["output"]["muEmu"])
    compare_calc(out["m_cgs"], g["output"]["M"])


@pytest.mark.golden
@pytest.mark.parametrize(
    ("shape", "kwargs", "golden_name"),
    [
        ("sphere", {}, "calc_dira_magnetic_demag_sphere.json"),
        ("thin_film", {}, "calc_dira_magnetic_demag_thinfilm.json"),
        ("cylinder", {"length": 0.3, "diameter": 0.1}, "calc_dira_magnetic_demag_cylinder.json"),
        ("prolate", {"ratio": 5}, "calc_dira_magnetic_demag_prolate.json"),
        ("oblate", {"ratio": 10}, "calc_dira_magnetic_demag_oblate.json"),
    ],
)
def test_demag_factor_matches_matlab(
    shape: str,
    kwargs: dict[str, float],
    golden_name: str,
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.magnetic.demagFactor(shape, ...) -> Nz/Nxy, all five geometries."""
    g = load_golden(golden_name)
    out = demag_factor(shape, **kwargs)
    compare_calc(out["Nz"], g["output"]["Nz"])
    compare_calc(out["Nxy"], g["output"]["Nxy"])


@pytest.mark.golden
def test_demag_named_inplane_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """DiraCulator.doDemagFactor 'Thin film (in-plane)' -- Nz/Nxy axis swap."""
    g = load_golden("calc_dira_magnetic_demag_named_inplane.json")
    out = demag_named("Thin film (in-plane)")
    compare_calc(out["Nz"], g["output"]["Nz"])
    compare_calc(out["Nxy"], g["output"]["Nxy"])


@pytest.mark.golden
def test_demag_named_transverse_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """DiraCulator.doDemagFactor 'Long cylinder (transverse)' -- Nz/Nxy axis swap."""
    g = load_golden("calc_dira_magnetic_demag_named_transverse.json")
    out = demag_named("Long cylinder (transverse)")
    compare_calc(out["Nz"], g["output"]["Nz"])
    compare_calc(out["Nxy"], g["output"]["Nxy"])


@pytest.mark.golden
def test_curie_weiss_moment_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """DiraCulator.doCurieWeiss(C=4.375, theta=-50) -> mu_eff (GUI formula, no bug)."""
    g = load_golden("calc_dira_magnetic_curie_weiss_moment.json")
    out = curie_weiss_moment(4.375, -50)
    compare_calc(out["mu_eff"], g["output"]["mu_eff"])


@pytest.mark.golden
def test_curie_weiss_fit_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """calc.magnetic.curieWeiss(T, chi, FitRange=[150,400]) -- fit params direct,
    mu_eff corrected by the exact x100 factor (see module docstring)."""
    g = load_golden("calc_dira_magnetic_curie_weiss_fit.json")
    temperature = g["input"]["temperature"]
    susceptibility = g["input"]["susceptibility"]
    out = curie_weiss_fit(temperature, susceptibility, fit_range=(150.0, 400.0))
    compare_calc(out["theta_cw"], g["output"]["theta_CW"])
    compare_calc(out["C"], g["output"]["C"])
    compare_calc(out["fit_line"], g["output"]["fitLine"])
    compare_calc(out["r2"], g["output"]["R2"])
    compare_calc(out["inv_chi"], g["output"]["invChi"])
    # class (d): MATLAB's mu_eff is ~100x too small (unit bug); the correct
    # value is the frozen (buggy) value times the exact factor 100.
    compare_calc(out["mu_eff"], g["output"]["mu_eff"] * 100.0)


@pytest.mark.golden
def test_langevin_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """DiraCulator.doLangevin(mu=1e-16, H=10000, T=300) -> L/x."""
    g = load_golden("calc_dira_magnetic_langevin.json")
    out = langevin(1e-16, 10000.0, 300.0)
    compare_calc(out["L"], g["output"]["L"])
    compare_calc(out["x"], g["output"]["x"])


@pytest.mark.golden
def test_domain_wall_matches_matlab_intended(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """DiraCulator.doDomainWall(A=2e-6, K=4.8e6), INTENDED (bug-corrected)
    behavior -- the GUI's erg/cm^2 -> mJ/m^2 conversion factor is x10, wrong;
    the correct factor is x1 (see module docstring point 2)."""
    g = load_golden("calc_dira_magnetic_domain_wall.json")
    out = domain_wall(2e-6, 4.8e6)
    compare_calc(out["delta_nm"], g["output"]["delta_nm"])
    compare_calc(out["e_wall_mj_m2"], g["output"]["e_wall_mj_m2"])


@pytest.mark.golden
def test_moment_convert_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """DiraCulator.doMomentConvert(1e-3, 'emu', volume=0.01, atoms=1e15)."""
    g = load_golden("calc_dira_magnetic_moment_convert.json")
    out = moment_convert(1.0e-3, "emu", volume=0.01, atoms=1e15)
    compare_calc(out["emu"], g["output"]["emu"])
    compare_calc(out["am2"], g["output"]["am2"])
    compare_calc(out["mu_b"], g["output"]["mu_b"])
    compare_calc(out["m_cgs"], g["output"]["m_cgs"])
    compare_calc(out["m_si"], g["output"]["m_si"])
    compare_calc(out["mu_b_per_atom"], g["output"]["mu_b_per_atom"])
