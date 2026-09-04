"""Integration tests for /api/diffusion (TestClient) -- the c-profile route
added alongside the Fick erfc calculator card. Thin adapter over
calc.diffusion; the math is reference-tested in test_diffusion.py."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def test_c_profile_surface_equals_c0(client: TestClient) -> None:
    r = client.post(
        "/api/diffusion/c-profile", json={"x": 0.0, "t": 3600.0, "d": 1e-12, "c0": 1e18}
    )
    assert r.status_code == 200
    assert r.json()["c"] == pytest.approx(1e18, rel=1e-9)


def test_c_profile_vectorized_x(client: TestClient) -> None:
    r = client.post(
        "/api/diffusion/c-profile",
        json={"x": [0.0, 1e-5, 3e-5], "t": 3600.0, "d": 1e-12, "c0": 1e18},
    )
    assert r.status_code == 200
    c = r.json()["c"]
    assert isinstance(c, list) and len(c) == 3
    assert c[0] > c[1] > c[2] > 0


def test_c_profile_rejects_negative_time(client: TestClient) -> None:
    r = client.post(
        "/api/diffusion/c-profile", json={"x": 1e-5, "t": 0.0, "d": 1e-12, "c0": 1e18}
    )
    assert r.status_code == 422


def test_fick_flux_rejects_nonpositive_dx_with_ascii_message(client: TestClient) -> None:
    """Regression: the dx<=0 message used to spell dx as capital-delta-x
    (U+0394), a non-ASCII character shipped in an HTTP error detail."""
    r = client.post("/api/diffusion/fick-flux", json={"d": 1.0, "dc": 1.0, "dx": 0.0})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert all(ord(c) < 128 for c in detail), detail
    assert "dx" in detail
