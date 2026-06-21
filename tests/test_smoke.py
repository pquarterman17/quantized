"""Skeleton smoke test: the package imports and the app answers /api/health."""

from __future__ import annotations

from fastapi.testclient import TestClient

import quantized
from quantized.app import app


def test_package_imports() -> None:
    assert quantized.__version__


def test_health() -> None:
    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
