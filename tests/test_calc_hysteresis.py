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
    # A symmetric loop's combined high-field M averages ~0, so MATLAB's
    # saturation heuristic always flags it — match that behavior.
    assert any("saturated" in w for w in r["warnings"])


def test_hysteresis_too_few_points() -> None:
    with pytest.raises(ValueError, match="at least 20"):
        hysteresis_analysis(np.arange(10.0), np.arange(10.0))
