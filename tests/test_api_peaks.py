"""Integration tests for /api/peaks (TestClient). The detector is golden in
test_calc_peaks; here we prove the transport and that two clear Gaussian peaks
are found at the expected positions."""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def _two_peaks() -> tuple[list[float], list[float]]:
    x = np.linspace(0, 10, 500)
    y = (
        1.0 * np.exp(-((x - 3.0) ** 2) / 0.05)
        + 0.7 * np.exp(-((x - 6.0) ** 2) / 0.08)
        + 0.02 * np.random.default_rng(0).standard_normal(500)
    )
    return list(x), list(y)


def test_find_two_peaks() -> None:
    x, y = _two_peaks()
    resp = client.post("/api/peaks/find", json={"x": x, "y": y})
    assert resp.status_code == 200
    out = resp.json()
    centers = sorted(p["center"] for p in out["peaks"])
    assert len(centers) == 2
    assert abs(centers[0] - 3.0) < 0.1
    assert abs(centers[1] - 6.0) < 0.1
    assert len(out["background"]) == len(x)


def test_peak_fields_present() -> None:
    x, y = _two_peaks()
    out = client.post("/api/peaks/find", json={"x": x, "y": y}).json()
    p = out["peaks"][0]
    for key in ("center", "height", "fwhm", "prominence", "localSNR"):
        assert key in p
    # NaN area serializes to null at the wire boundary.
    assert p["area"] is None or isinstance(p["area"], (int, float))


def test_high_snr_threshold_finds_fewer() -> None:
    x, y = _two_peaks()
    strict = client.post(
        "/api/peaks/find", json={"x": x, "y": y, "snr_threshold": 1e6}
    ).json()
    assert len(strict["peaks"]) == 0


def test_empty_input_is_graceful() -> None:
    # No data is valid: no peaks, empty background (not a 500).
    resp = client.post("/api/peaks/find", json={"x": [], "y": []})
    assert resp.status_code == 200
    out = resp.json()
    assert out["peaks"] == []
    assert out["background"] == []


def _one_lorentzian() -> tuple[list[float], list[float]]:
    x = np.linspace(28.0, 32.0, 200)
    y = 100.0 / (1.0 + 4.0 * ((x - 30.0) / 0.4) ** 2) + 5.0
    return list(x), list(y)


def test_fit_single_peak_endpoint() -> None:
    x, y = _one_lorentzian()
    resp = client.post(
        "/api/peaks/fit",
        json={"x": x, "y": y, "x_lo": 29.0, "x_hi": 31.0, "seed_center": 30.0},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["success"] is True
    assert abs(out["center"] - 30.0) < 1e-4
    assert out["eta"] is None  # NaN -> null for the non-PV models


def test_fit_unknown_model_rejected() -> None:
    x, y = _one_lorentzian()
    resp = client.post(
        "/api/peaks/fit",
        json={"x": x, "y": y, "x_lo": 29.0, "x_hi": 31.0, "seed_center": 30.0,
              "model": "Bogus"},
    )
    assert resp.status_code == 422


def test_fit_reports_failure_reason_without_500() -> None:
    x, y = _one_lorentzian()
    resp = client.post(
        "/api/peaks/fit",
        json={"x": x, "y": y, "x_lo": 29.99, "x_hi": 30.0, "seed_center": 30.0},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["success"] is False
    assert out["reason"] == "window-too-narrow"
