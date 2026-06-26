"""rsm_analyze: 2D peak extraction from a reciprocal-space map (calc/rsm_analyze.py).

Verified by synthetic recovery (find a known peak) + a real-data path
(synthetic_rsm fixture via the 2D XRDML parser). Exact MATLAB parity (golden)
pending a MATLAB run.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.calc.rsm_analyze import rsm_analyze, rsm_grids_from_datastruct
from quantized.io.xrdml import import_xrdml


def _gauss_map(axis1, axis2, omega0, tth0, amp, s_om=0.1, s_tt=0.3, bg=5.0):
    tth, om = np.meshgrid(axis2, axis1)  # (N, M)
    arg = (tth - tth0) ** 2 / (2 * s_tt**2) + (om - omega0) ** 2 / (2 * s_om**2)
    return amp * np.exp(-arg) + bg


def test_finds_a_single_peak_centre() -> None:
    axis1 = np.linspace(30.0, 31.0, 31)  # omega
    axis2 = np.linspace(60.0, 62.0, 41)  # 2theta
    img = _gauss_map(axis1, axis2, 30.5, 61.0, amp=1000.0)
    res = rsm_analyze(img, axis1, axis2, n_peaks=1, smooth_sigma=1.0, fit_window=8)
    assert res["n_peaks_found"] == 1
    omega_c, tth_c = res["peaks"][0]["centre_angle"]
    assert omega_c == pytest.approx(30.5, abs=0.05)
    assert tth_c == pytest.approx(61.0, abs=0.05)
    assert res["used_q_space"] is False
    assert np.isnan(res["peaks"][0]["centre_Q"][0])


def test_two_peaks_classified_substrate_then_film() -> None:
    axis1 = np.linspace(30.0, 31.0, 41)
    axis2 = np.linspace(60.0, 62.0, 61)
    sub = _gauss_map(axis1, axis2, 30.4, 60.8, amp=2000.0, bg=0.0)
    film = _gauss_map(axis1, axis2, 30.7, 61.4, amp=800.0, bg=0.0)
    res = rsm_analyze(sub + film, axis1, axis2, n_peaks=2, smooth_sigma=1.0, fit_window=8)
    assert res["n_peaks_found"] == 2
    # Brightest -> substrate, next -> film.
    assert res["peaks"][0]["classification"] == "substrate"
    assert res["peaks"][1]["classification"] == "film"
    # The substrate (brighter) centre is near the brighter blob.
    assert res["peaks"][0]["centre_angle"][1] == pytest.approx(60.8, abs=0.1)


def test_q_space_fit_when_grids_present() -> None:
    axis1 = np.linspace(30.0, 31.0, 31)
    axis2 = np.linspace(60.0, 62.0, 41)
    img = _gauss_map(axis1, axis2, 30.5, 61.0, amp=1000.0)
    # Synthetic monotonic Q grids (just need finiteness through the fit path).
    tth, om = np.meshgrid(axis2, axis1)
    qx = 0.01 * (tth - 60.0) + 0.001 * om
    qz = 0.02 * tth
    res = rsm_analyze(img, axis1, axis2, qx=qx, qz=qz, n_peaks=1, smooth_sigma=1.0, fit_window=8)
    assert res["used_q_space"] is True
    assert np.all(np.isfinite(res["peaks"][0]["centre_Q"]))


def test_no_peaks_above_threshold() -> None:
    # threshold > 1 puts the cut above the map maximum -> nothing qualifies.
    axis1 = np.linspace(30.0, 31.0, 21)
    axis2 = np.linspace(60.0, 62.0, 21)
    img = _gauss_map(axis1, axis2, 30.5, 61.0, amp=1000.0)
    res = rsm_analyze(img, axis1, axis2, n_peaks=2, threshold=1.5)
    assert res["n_peaks_found"] == 0
    assert res["peaks"] == []


def test_rejects_bad_inputs() -> None:
    a1, a2 = np.linspace(0, 1, 5), np.linspace(0, 1, 7)
    with pytest.raises(ValueError, match="fit_model must be one of"):
        rsm_analyze(np.zeros((5, 7)), a1, a2, fit_model="nope")
    with pytest.raises(ValueError, match="must match intensity"):
        rsm_analyze(np.zeros((5, 7)), a1, np.linspace(0, 1, 3))


# ── Real-data path: synthetic_rsm fixture via the 2D XRDML parser ──────────
def test_rsm_analyze_on_parsed_fixture(fixtures_dir: Path) -> None:
    ds = import_xrdml(fixtures_dir / "xrdml_rsm_synthetic.xrdml")
    grids = rsm_grids_from_datastruct(ds)
    assert grids["intensity"].shape == (5, 10)
    assert grids["qx"] is not None  # the fixture has a wavelength -> Q-space
    res = rsm_analyze(
        grids["intensity"], grids["axis1"], grids["axis2"],
        qx=grids["qx"], qz=grids["qz"],
        n_peaks=1, smooth_sigma=0.6, fit_window=6,
        intensity_unit=grids["intensity_unit"],
    )
    assert res["n_peaks_found"] == 1
    omega_c, tth_c = res["peaks"][0]["centre_angle"]
    # The blob peaks at omega=30.5, 2theta=61 in the synthetic mesh.
    assert 30.0 <= omega_c <= 31.0
    assert 60.0 <= tth_c <= 62.0
    assert np.all(np.isfinite(res["peaks"][0]["centre_Q"]))
    assert res["used_q_space"] is True


def test_bridge_rejects_non_rsm() -> None:
    from quantized.datastruct import DataStruct

    ds = DataStruct.create([0.0, 1.0], [[1.0], [2.0]], labels=["m"], units=["emu"])
    with pytest.raises(ValueError, match="not a 2D RSM"):
        rsm_grids_from_datastruct(ds)
