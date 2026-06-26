"""Simultaneous multi-peak fit: golden parity vs MATLAB peakAnalysis.onFitSimultaneous
(composite peaks + polynomial background) and the exposed buildLinkedPacker.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.peak_multifit import (
    build_linked_packer,
    compute_peak_area,
    fit_multi_peak,
)

FIT_CASES = ["lorentzian", "gaussian", "pv_shared", "lorentzian_constrained", "pv_shared_eta"]


def _seeds(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, dict):
        raw = [raw]
    out: list[dict[str, Any]] = []
    for s in raw:
        d: dict[str, Any] = {"center": s["center"], "fwhm": s["fwhm"], "height": s["height"]}
        if s.get("eta") is not None:
            d["eta"] = s["eta"]
        out.append(d)
    return out


def _peaklist(raw: Any) -> list[dict[str, Any]]:
    return [raw] if isinstance(raw, dict) else list(raw)


@pytest.mark.golden
@pytest.mark.parametrize("case", FIT_CASES)
def test_multi_peak_fit_matches_matlab(
    case: str, load_golden: Callable[[str], dict[str, Any]]
) -> None:
    """Each fit replicates fminsearch's eval-limited result bit-for-bit (worst
    observed rel ~7e-9 — scipy/MATLAB share the Lagarias simplex and we match the
    200*nFree MaxFunEvals budget)."""
    g = load_golden("calc_multipeakfit.json")
    c = g[case]
    r = fit_multi_peak(
        np.asarray(c["x"], dtype=float),
        np.asarray(c["y"], dtype=float),
        _seeds(c["seeds"]),
        model=c["model"],
        bg_degree=int(c["bgDeg"]),
        constrain=bool(c["constrain"]),
        link_mode=c["linkMode"],
    )
    assert_allclose(r["params"], np.asarray(c["params"], dtype=float).ravel(),
                    rtol=1e-6, atol=1e-8)
    assert_allclose(r["bgCoeffs"], np.asarray(c["bgCoeffs"], dtype=float).ravel(),
                    rtol=1e-6, atol=1e-8)
    assert r["R2"] == pytest.approx(c["R2"], rel=1e-6, abs=1e-9)
    assert r["rmse"] == pytest.approx(c["rmse"], rel=1e-6, abs=1e-9)
    ref = _peaklist(c["peaks"])
    assert len(r["peaks"]) == len(ref)
    for got, exp in zip(r["peaks"], ref, strict=True):
        for k in ("center", "fwhm", "height", "bg", "area"):
            assert got[k] == pytest.approx(exp[k], rel=1e-6, abs=1e-8)
        if c["model"] == "Pseudo-Voigt":
            assert got["eta"] == pytest.approx(exp["eta"], rel=1e-6, abs=1e-8)
        else:
            assert math.isnan(got["eta"])
        assert got["status"] == "fitted(global)"


@pytest.mark.golden
def test_build_linked_packer_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]]
) -> None:
    """The reduce/expand machinery is deterministic — exact parity vs the exposed
    bosonPlotter.buildLinkedPacker (1-based MATLAB indices == 0-based Python +1)."""
    lp = load_golden("calc_multipeakfit.json")["linked_packer"]

    sf = lp["shared_fwhm"]
    pf, expand, fci = build_linked_packer(sf["p0"], 2, 3, "Shared FWHM", [1, 4])
    assert_allclose(pf, np.asarray(sf["pFree0"], dtype=float), rtol=0, atol=0)
    assert_allclose(expand(pf), np.asarray(sf["expand_pFree0"], dtype=float), rtol=0, atol=0)
    assert_allclose(expand(np.asarray(sf["pFree_perturbed"], dtype=float)),
                    np.asarray(sf["expand_perturbed"], dtype=float), rtol=0, atol=0)
    assert [i + 1 for i in fci] == [int(v) for v in np.atleast_1d(sf["freeCenterIdx"])]

    se = lp["shared_eta"]
    pf2, expand2, fci2 = build_linked_packer(se["p0"], 2, 4, "Shared FWHM + eta", [1, 5])
    assert_allclose(pf2, np.asarray(se["pFree0"], dtype=float), rtol=0, atol=0)
    assert_allclose(expand2(pf2), np.asarray(se["expand_pFree0"], dtype=float), rtol=0, atol=0)
    assert [i + 1 for i in fci2] == [int(v) for v in np.atleast_1d(se["freeCenterIdx"])]

    none = lp["none"]
    pf3, expand3, fci3 = build_linked_packer([20, 16, 1.5, 12, 24, 2.0, 5, 0.2],
                                             2, 3, "None", [1, 4])
    assert_allclose(pf3, np.asarray(none["pFree0"], dtype=float), rtol=0, atol=0)
    assert [i + 1 for i in fci3] == [int(v) for v in np.atleast_1d(none["freeCenterIdx"])]


# ── unit tests (no MATLAB needed) ────────────────────────────────────────────

def test_linked_packer_none_is_identity() -> None:
    p0 = [10.0, 5.0, 1.0, 6.0, 9.0, 1.2, 2.0, 0.1]
    pf, expand, fci = build_linked_packer(p0, 2, 3, "None", [1, 4])
    assert_allclose(pf, p0)
    assert_allclose(expand(np.asarray(p0)), p0)
    assert fci == [1, 4]


def test_linked_packer_shared_fwhm_drops_and_copies() -> None:
    # 3 Lorentzian peaks + 1 bg: slaves 2,3 drop their FWHM (idx 5, 8).
    p0 = np.array([10, 4, 1.0, 6, 9, 2.0, 8, 14, 3.0, 0.5], dtype=float)
    pf, expand, fci = build_linked_packer(p0, 3, 3, "Shared FWHM", [1, 4, 7])
    assert pf.size == 8  # 10 - 2 dropped slave FWHMs
    full = expand(pf)
    # all three peaks share peak-0's FWHM (1.0)
    assert full[2] == full[5] == full[8] == 1.0
    # keep_idx = [0,1,2,3,4,6,7,9] (slave FWHMs 5,8 dropped); centers 1,4,7 → 1,4,6
    assert fci == [1, 4, 6]


def test_compute_peak_area_formulas() -> None:
    h, fw = 10.0, 2.0
    lor_area = h * fw * math.pi / 2
    gauss_area = h * fw * math.sqrt(math.pi / math.log(2)) / 2
    assert compute_peak_area("Lorentzian", h, fw, float("nan")) == pytest.approx(lor_area)
    assert compute_peak_area("Gaussian", h, fw, float("nan")) == pytest.approx(gauss_area)
    # SPVII/TCH fall through to the Lorentzian form (MATLAB 'otherwise')
    assert compute_peak_area("Split Pearson VII", h, fw, float("nan")) == pytest.approx(lor_area)
    assert compute_peak_area("TCH-pV", h, fw, float("nan")) == pytest.approx(lor_area)
    # pure-Lorentzian PV (eta=1) == Lorentzian area
    assert compute_peak_area("Pseudo-Voigt", h, fw, 1.0) == pytest.approx(lor_area)


def test_fit_multi_peak_recovers_clean_lorentzians() -> None:
    """With a generous eval budget the fit recovers the true params (validates the
    composite model/objective independent of MATLAB's eval-limited budget)."""
    x = np.linspace(0.0, 20.0, 400)

    def lor(h: float, c: float, fw: float) -> np.ndarray:
        u = (x - c) / fw
        return np.asarray(h / (1 + 4 * u**2), dtype=float)

    y = 2.0 + 0.1 * x + lor(10, 7, 1.2) + lor(6, 13, 0.9)
    seeds = [{"center": 7.2, "fwhm": 1.0, "height": 9.0},
             {"center": 12.8, "fwhm": 1.0, "height": 5.0}]
    r = fit_multi_peak(x, y, seeds, model="Lorentzian", bg_degree=1, max_fev=40000)
    assert r["R2"] > 1 - 1e-8
    assert r["peaks"][0]["center"] == pytest.approx(7.0, abs=1e-3)
    assert r["peaks"][1]["center"] == pytest.approx(13.0, abs=1e-3)
    assert_allclose(r["bgCoeffs"], [2.0, 0.1], atol=1e-3)


def test_fit_multi_peak_empty_raises() -> None:
    with pytest.raises(ValueError, match="at least one peak"):
        fit_multi_peak([0.0, 1.0], [1.0, 2.0], [])
