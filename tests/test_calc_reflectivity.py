"""parrattRefl specular reflectivity: golden parity vs MATLAB fitting.parrattRefl."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.reflectivity import parratt_refl


@pytest.mark.golden
def test_parratt_matches_matlab(load_golden: Callable[[str], dict[str, Any]]) -> None:
    g = load_golden("calc_parratt.json")
    q = np.asarray(g["input"]["Q"], dtype=float)
    layers = np.asarray(g["input"]["layers"], dtype=float)
    r = parratt_refl(q, layers)
    assert_allclose(r, np.asarray(g["output"], dtype=float), rtol=1e-9, atol=1e-12)


@pytest.mark.golden
def test_parratt_resolution_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    g = load_golden("calc_parratt_res.json")
    q = np.asarray(g["input"]["Q"], dtype=float)
    layers = np.asarray(g["input"]["layers"], dtype=float)
    r = parratt_refl(q, layers, resolution=float(g["input"]["resolution"]))
    assert_allclose(r, np.asarray(g["output"], dtype=float), rtol=1e-9, atol=1e-12)


def test_parratt_total_reflection_below_critical() -> None:
    # Below the critical edge, R -> 1 (total external reflection).
    layers = np.array([[0, 0, 0, 0], [0, 2.07e-6, 0, 0]])  # vacuum / Si substrate
    q = np.array([0.005])  # well below Qc ~ sqrt(16*pi*SLD)
    r = parratt_refl(q, layers, roughness=False)
    assert r[0] == pytest.approx(1.0, abs=1e-3)


def test_parratt_decays_at_high_q() -> None:
    layers = np.array([[0, 0, 0, 0], [200, 4e-6, 0, 5], [0, 2.07e-6, 0, 3]])
    q = np.linspace(0.05, 0.4, 50)
    r = parratt_refl(q, layers)
    assert np.all(r >= 0)
    assert r[-1] < r[0]  # reflectivity falls off at high Q


def test_parratt_scale_background() -> None:
    layers = np.array([[0, 0, 0, 0], [200, 4e-6, 0, 5], [0, 2.07e-6, 0, 3]])
    q = np.linspace(0.05, 0.3, 40)
    base = parratt_refl(q, layers)
    scaled = parratt_refl(q, layers, scale=2.0, background=1e-6)
    assert_allclose(scaled, 2.0 * base + 1e-6, rtol=1e-9)


def test_parratt_too_few_layers() -> None:
    with pytest.raises(ValueError, match="at least 2 layers"):
        parratt_refl(np.array([0.1]), np.array([[0, 0, 0, 0]]))
