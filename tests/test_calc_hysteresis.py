"""hysteresisAnalysis: golden parity vs MATLAB +utilities/hysteresisAnalysis."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.magnetometry import hysteresis_analysis


@pytest.mark.golden
def test_hysteresis_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_hysteresis.json")
    h = np.asarray(g["input"]["H"], dtype=float)
    m = np.asarray(g["input"]["M"], dtype=float)
    out = hysteresis_analysis(h, m)
    # ALS-free closed-form extraction; tolerate float roundoff on the 500-pt area integral.
    compare_calc(out, g["output"], rtol=1e-7, atol=1e-7)


def _make_loop() -> tuple[np.ndarray, np.ndarray]:
    hmax, hc, w, ms = 1000.0, 100.0, 200.0, 5.0
    hd = np.linspace(hmax, -hmax, 100)
    hu = np.linspace(-hmax, hmax, 100)
    h = np.concatenate([hd, hu])
    m = np.concatenate([ms * np.tanh((hd + hc) / w), ms * np.tanh((hu - hc) / w)])
    return h, m


def test_hysteresis_extracts_symmetric_coercivity() -> None:
    h, m = _make_loop()
    r = hysteresis_analysis(h, m)
    # Symmetric loop: |Hc| ~ 100 on both branches.
    assert abs(abs(r["Hc"][0]) - 100.0) < 5.0
    assert abs(abs(r["Hc"][1]) - 100.0) < 5.0
    assert r["HcMean"] == pytest.approx(np.nanmean(np.abs(r["Hc"])))


def test_hysteresis_saturation_and_squareness() -> None:
    h, m = _make_loop()
    r = hysteresis_analysis(h, m)
    assert r["MsMean"] == pytest.approx(5.0, abs=0.05)
    assert 0.0 <= r["squareness"] <= 1.0
    assert r["loopArea"] > 0.0
    # A saturated symmetric loop is not flagged. (MATLAB pooled both tails,
    # whose mean is ~0, so it flagged every loop; that source bug is fixed.)
    assert not any("saturated" in w for w in r["warnings"])


def test_hysteresis_flags_unsaturated_tails() -> None:
    # A ferromagnet on a paramagnetic background: M still climbs at high field.
    h, m = _make_loop()
    r = hysteresis_analysis(h, m + 0.004 * h)
    assert any("saturated" in w for w in r["warnings"])


def test_hysteresis_too_few_points() -> None:
    with pytest.raises(ValueError, match="at least 20"):
        hysteresis_analysis(np.arange(10.0), np.arange(10.0))


def test_sfd_ignores_near_duplicate_field_at_sweep_turnaround() -> None:
    # A real VSM sweep settles at the setpoint: two readings ~0.3 Oe apart at
    # -Hmax whose moment differs by noise. dM/dH over that 0.3 Oe step dwarfs
    # the true switching slope, and the SFD peak used to land at -Hmax
    # (corpus: a 15 kOe VSM loop reported "SFD peak H -15000, FWHM 0.38 Oe").
    hmax, hc, w, ms = 1000.0, 100.0, 200.0, 5.0
    hd = np.linspace(hmax, -hmax, 100)
    hu = np.concatenate([[-hmax, -hmax + 0.3], np.linspace(-hmax, hmax, 100)[1:]])
    mu = ms * np.tanh((hu - hc) / w)
    mu[1] += 0.25  # 5% noise on the settling reading (the corpus loop: ~6%)
    h = np.concatenate([hd, hu])
    m = np.concatenate([ms * np.tanh((hd + hc) / w), mu])
    r = hysteresis_analysis(h, m)
    assert r["SFD"]["peakH"] == pytest.approx(hc, abs=25.0)
    assert r["SFD"]["fwhm"] > 100.0
