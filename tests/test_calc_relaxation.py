"""compareRelaxation: golden parity vs MATLAB +utilities/compareRelaxation."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest

from quantized.calc.relaxation import compare_relaxation

_KB = 8.617333e-5


@pytest.mark.golden
def test_compare_relaxation_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]], compare_calc: Callable[..., None]
) -> None:
    g = load_golden("calc_relaxation.json")
    t = np.asarray(g["input"]["T"], dtype=float)
    tau = np.asarray(g["input"]["tau"], dtype=float)
    out = compare_relaxation(t, tau)
    # Arrhenius is closed-form (exact); VFT is Nelder-Mead, so allow a modest
    # tolerance for optimizer-path differences (empirically matches to ~1e-5).
    compare_calc(out, g["output"], rtol=1e-4, atol=1e-6)


def test_compare_relaxation_recovers_vft_params() -> None:
    t = np.linspace(30.0, 100.0, 20)
    tau0, ea, t0 = 1e-9, 0.05, 20.0
    tau = np.exp(np.log(tau0) + ea / (_KB * (t - t0)))
    out = compare_relaxation(t, tau)
    # VFT data -> VFT preferred, params recovered, near-perfect fit.
    assert out["preferred"] == "VFT"
    assert out["vft"]["Ea_eV"] == pytest.approx(ea, rel=1e-3)
    assert out["vft"]["T0"] == pytest.approx(t0, rel=1e-2)
    assert out["vft"]["R2"] > 0.999


def test_compare_relaxation_arrhenius_preferred_for_arrhenius_data() -> None:
    t = np.linspace(50.0, 200.0, 20)
    tau = np.exp(np.log(1e-12) + 0.1 / (_KB * t))  # pure Arrhenius
    out = compare_relaxation(t, tau)
    assert out["arrhenius"]["Ea_eV"] == pytest.approx(0.1, rel=1e-6)
    assert out["arrhenius"]["R2"] > 0.9999


def test_compare_relaxation_validation() -> None:
    with pytest.raises(ValueError, match="at least 5"):
        compare_relaxation([10.0, 20.0], [1.0, 2.0])
    with pytest.raises(ValueError, match="positive"):
        compare_relaxation([10.0, 20.0, 30.0, 40.0, 50.0], [1.0, -2.0, 3.0, 4.0, 5.0])
