"""Integration tests for /api/magnetometry (TestClient). The analysis is golden
in test_calc_magnetometry / test_calc_hysteresis; here we prove the transport
and that a known synthetic loop yields the expected coercivity."""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def _loop(hc: float = 150.0) -> tuple[list[float], list[float]]:
    """A symmetric tanh M-H loop with coercivity ~hc (asc/desc branches)."""
    up = np.linspace(-1000, 1000, 100)
    down = np.linspace(1000, -1000, 100)
    m_up = np.tanh((up + hc) / 300)
    m_down = np.tanh((down - hc) / 300)
    h = np.concatenate([up, down])
    m = np.concatenate([m_up, m_down])
    return list(h), list(m)


def test_hysteresis_recovers_coercivity() -> None:
    h, m = _loop(hc=150.0)
    resp = client.post("/api/magnetometry/hysteresis", json={"h": h, "m": m})
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["HcMean"] - 150.0) < 10.0  # recovers the ~150 Oe coercivity
    assert len(out["Hc"]) == 2
    assert out["MsMean"] > 0.9  # saturates near 1
    assert "SFD" in out and "peakH" in out["SFD"]
    assert set(out["ascending"]) == {"H", "M"}


def test_hysteresis_too_few_points_is_422() -> None:
    resp = client.post("/api/magnetometry/hysteresis", json={"h": [0, 1], "m": [0, 1]})
    assert resp.status_code == 422


def test_subtract_background_linear() -> None:
    t = list(np.linspace(2, 300, 100))
    # signal + linear high-T background (slope 0.01, intercept 5)
    m = [0.01 * ti + 5.0 + (50.0 if ti < 50 else 0.0) for ti in t]
    resp = client.post(
        "/api/magnetometry/subtract-background",
        json={"temperature": t, "moment": m},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["slope"] - 0.01) < 1e-3
    assert len(out["corrected"]) == len(t)


def test_convert_units_oe_to_tesla() -> None:
    resp = client.post(
        "/api/magnetometry/convert-units",
        json={"x": [10000.0], "y": [1.0], "from_field": "Oe", "to_field": "T"},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["x"][0] - 1.0) < 1e-9  # 10000 Oe = 1 T
    assert out["x_unit"] == "T"
