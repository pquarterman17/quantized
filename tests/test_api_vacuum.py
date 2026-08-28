"""Integration tests for /api/vacuum (TestClient) -- error-mapping regression
coverage. The math is reference-tested in test_vacuum.py; this file proves
the transport layer turns finite-but-extreme input into a 4xx, never a 500."""

from __future__ import annotations

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_monolayer_time_extreme_finite_input_is_422_not_500() -> None:
    """Regression: a tiny pressure with a huge molecular mass/temperature
    underflows calc.vacuum.monolayer_time's impingement flux to exactly 0.0,
    a ZeroDivisionError escaping the route's old `except ValueError`."""
    r = client.post(
        "/api/vacuum/monolayer-time",
        json={"p": 1e-308, "m": 1e10, "temperature": 1e10},
    )
    assert r.status_code == 422, r.text
