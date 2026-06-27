"""Golden parity for RSM peak extraction + strain vs MATLAB
fitting.rsmAnalyze / fitting.rsmStrain on a deterministic synthetic map.
Unit-level behaviour is covered in test_calc_rsm_analyze.py / test_api_rsm.py;
this file pins exact MATLAB parity."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.rsm import rsm_strain
from quantized.calc.rsm_analyze import rsm_analyze


@pytest.fixture
def rsm(load_golden: Callable[[str], dict[str, Any]]) -> dict[str, Any]:
    return load_golden("calc_rsm.json")


def _nan_eq(a: Any, b: Any) -> bool:
    """jsonencode writes NaN as null → None; treat None/NaN as equal."""
    a_nan = a is None or (isinstance(a, float) and math.isnan(a))
    b_nan = b is None or (isinstance(b, float) and math.isnan(b))
    return a_nan and b_nan


@pytest.mark.golden
def test_rsm_analyze_matches_matlab(rsm: dict[str, Any]) -> None:
    """The full smooth → detect → per-peak surfaceFit pipeline matches MATLAB:
    same peaks, same order/classification, centres ~1e-12, fwhm ~1e-9."""
    intensity = np.asarray(rsm["intensity"], dtype=float)
    axis1 = np.asarray(rsm["axis1"], dtype=float)
    axis2 = np.asarray(rsm["axis2"], dtype=float)
    qx = np.asarray(rsm["Qx"], dtype=float)
    qz = np.asarray(rsm["Qz"], dtype=float)

    r = rsm_analyze(intensity, axis1, axis2, qx=qx, qz=qz, n_peaks=2, fit_model="2D Gaussian")
    ref = rsm["analyze"]
    assert r["n_peaks_found"] == int(ref["nPeaksFound"])
    assert r["used_q_space"] == bool(ref["usedQSpace"])
    assert r["intensity_unit"] == ref["intensityUnit"]

    ref_peaks = ref["peaks"] if isinstance(ref["peaks"], list) else [ref["peaks"]]
    assert len(r["peaks"]) == len(ref_peaks)
    for got, exp in zip(r["peaks"], ref_peaks, strict=True):
        assert got["rank"] == int(exp["rank"])
        assert got["classification"] == exp["classification"]
        for fld in ("centre_angle", "centre_Q", "fwhm_angle", "fwhm_Q"):
            assert_allclose(np.asarray(got[fld], dtype=float),
                            np.asarray(exp[fld], dtype=float),
                            rtol=1e-6, atol=1e-6, err_msg=f"{fld} (rank {exp['rank']})")
        assert got["amplitude"] == pytest.approx(exp["amplitude"], rel=1e-6, abs=1e-6)
        assert got["background"] == pytest.approx(exp["background"], rel=1e-6, abs=1e-6)


@pytest.mark.golden
def test_rsm_strain_chain_matches_matlab(rsm: dict[str, Any]) -> None:
    """Strain derived from the analyze peaks' Q-centres (the realistic chain)."""
    intensity = np.asarray(rsm["intensity"], dtype=float)
    axis1 = np.asarray(rsm["axis1"], dtype=float)
    axis2 = np.asarray(rsm["axis2"], dtype=float)
    qx = np.asarray(rsm["Qx"], dtype=float)
    qz = np.asarray(rsm["Qz"], dtype=float)
    r = rsm_analyze(intensity, axis1, axis2, qx=qx, qz=qz, n_peaks=2, fit_model="2D Gaussian")
    s = rsm_strain(tuple(r["peaks"][0]["centre_Q"]), tuple(r["peaks"][1]["centre_Q"]))
    ref = rsm["strain_from_analyze"]
    for k, v in ref.items():
        if _nan_eq(s[k], v):
            continue
        assert s[k] == pytest.approx(v, rel=1e-6, abs=1e-9), k


@pytest.mark.golden
@pytest.mark.parametrize("case,sub,film,bulk", [
    ("asym", (-0.050, 4.500), (-0.048, 4.520), None),
    ("with_bulk", (-0.050, 4.500), (-0.048, 4.520), (-0.040, 4.520)),
    ("symmetric", (0.0, 4.500), (0.0, 4.530), None),
])
def test_rsm_strain_closed_form_matches_matlab(
    rsm: dict[str, Any], case: str, sub: tuple[float, float],
    film: tuple[float, float], bulk: tuple[float, float] | None,
) -> None:
    """Closed-form strain/relaxation is exact (incl. NaN for symmetric eps_par
    and undefined relaxation)."""
    s = rsm_strain(sub, film, bulk=bulk)
    ref = rsm["strain"][case]
    for k, v in ref.items():
        if _nan_eq(s[k], v):
            continue
        assert s[k] == pytest.approx(v, rel=1e-12, abs=1e-12), k
