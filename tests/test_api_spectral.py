"""Integration tests for /api/spectral (TestClient). The math is golden in
test_calc_spectral; here we prove the transport — request validation, the
complex-output guard, and error mapping."""

from __future__ import annotations

import math

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def _sine(freq: float = 5.0, n: int = 256, fs: float = 100.0) -> tuple[list[float], list[float]]:
    t = np.arange(n) / fs
    y = np.sin(2 * math.pi * freq * t)
    return list(t), list(y)


def test_fft_magnitude_default() -> None:
    x, y = _sine()
    resp = client.post("/api/spectral/fft", json={"x": x, "y": y})
    assert resp.status_code == 200
    out = resp.json()
    assert "magnitude" in out
    assert "freq" in out
    assert len(out["magnitude"]) == len(out["freq"])
    # The window array is dropped from the wire response (internal detail).
    assert "window" not in out


def test_fft_peak_near_the_input_frequency() -> None:
    x, y = _sine(freq=5.0, n=512, fs=100.0)
    out = client.post(
        "/api/spectral/fft", json={"x": x, "y": y, "window": "hanning"}
    ).json()
    freq = out["freq"]
    mag = out["magnitude"]
    i_peak = max(range(len(mag)), key=lambda i: mag[i] if mag[i] is not None else -1.0)
    assert abs(freq[i_peak] - 5.0) < 1.0


def test_psd_output_type() -> None:
    x, y = _sine()
    resp = client.post("/api/spectral/fft", json={"x": x, "y": y, "output_type": "psd"})
    assert resp.status_code == 200
    assert "psd" in resp.json()


def test_complex_output_type_rejected() -> None:
    # "complex" would serialize numpy complex -> not JSON-safe; the route never
    # exposes it (see module docstring).
    x, y = _sine()
    resp = client.post(
        "/api/spectral/fft", json={"x": x, "y": y, "output_type": "complex"}
    )
    assert resp.status_code == 422


def test_too_few_points_is_422_not_500() -> None:
    resp = client.post("/api/spectral/fft", json={"x": [0, 1, 2], "y": [0, 1, 2]})
    assert resp.status_code == 422
