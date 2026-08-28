"""Integration tests for /api/spectral (TestClient). The math is golden in
test_calc_spectral; here we prove the transport — request validation, the
complex-output guard, and error mapping."""

from __future__ import annotations

import math

import numpy as np
import pytest
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


def _hysteresis_loop() -> tuple[list[float], list[float]]:
    """A closed there-and-back sweep (the canonical M-vs-H loop shape): x
    returns exactly to its starting value, so mean(diff(x)) == 0."""
    up = np.linspace(-1.0, 1.0, 33)
    down = np.linspace(1.0, -1.0, 33)[1:]
    x = np.concatenate([up, down])
    y = np.sin(2 * math.pi * 5 * np.arange(x.size) / x.size)
    return x.tolist(), y.tolist()


def test_fft_on_closed_hysteresis_loop_reports_true_sample_rate() -> None:
    """Regression for the bug-hunt finding: a closed loop used to make
    mean(diff(x)) exactly 0.0 -> an uncaught ZeroDivisionError inside
    calc.spectral._infer_sampling_rate -> Internal Server Error. Switching
    the estimator to median(abs(diff(x))) fixes the case outright (the
    per-sample spacing is well defined even though net displacement is
    zero), so this must succeed with the TRUE Nyquist frequency, not merely
    degrade to a 422."""
    x, y = _hysteresis_loop()
    true_spacing = float(np.median(np.abs(np.diff(np.asarray(x)))))
    resp = client.post("/api/spectral/fft", json={"x": x, "y": y})
    assert resp.status_code == 200, resp.text
    freq = np.asarray(resp.json()["freq"], dtype=float)
    nyquist = 1.0 / (2.0 * true_spacing)
    assert freq.max() == pytest.approx(nyquist, rel=0.05)


def test_fft_on_all_equal_x_is_422_not_500() -> None:
    """The genuinely degenerate case (every x identical -> diff is all
    zero) must still come back as a 422 with an ASCII message, never an
    Internal Server Error."""
    resp = client.post("/api/spectral/fft", json={"x": [3.0] * 8, "y": list(range(8))})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert all(ord(c) < 128 for c in detail), detail


def test_fft_on_near_closed_loop_reports_true_sample_rate() -> None:
    """The near-closed variant used to return HTTP 200 with a frequency axis
    ~63x too wide because fs came from mean(diff(x)) (~0 for a there-and-back
    sweep) instead of the true |dx| spacing. Now the frequency axis top
    (Nyquist) must reflect the true median sample spacing."""
    up = np.linspace(-1.0, 1.0, 33)
    down = np.linspace(1.0, -1.0, 33)[1:-1]
    x = np.concatenate([up, down])
    y = np.sin(2 * math.pi * 5 * np.arange(x.size) / x.size)
    true_spacing = float(np.median(np.abs(np.diff(x))))
    resp = client.post("/api/spectral/fft", json={"x": x.tolist(), "y": y.tolist()})
    assert resp.status_code == 200, resp.text
    freq = np.asarray(resp.json()["freq"], dtype=float)
    nyquist = 1.0 / (2.0 * true_spacing)
    assert freq.max() == pytest.approx(nyquist, rel=0.05), (
        f"frequency axis tops out at {freq.max():.6g}; expected ~{nyquist:.6g} "
        f"for a true |dx| of {true_spacing:.6g}"
    )
