"""Route-boundary HTTP 500 guards.

Regression guards for a route-layer bug-hunt (2026-07-05) that found handlers
catching only ``ValueError`` while the callee raised ``OverflowError`` /
``ZeroDivisionError`` / ``AttributeError`` on edge input -> an uncaught HTTP
500. Each is now a clean 422; a paired valid request confirms the guard doesn't
over-fire. All fixed at the calc boundary, so a single fix covers every route
that reaches the same function.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)
D = [float(x) for x in range(1, 11)]


@pytest.mark.parametrize(
    "path, body",
    [
        # OverflowError from math.exp (Butler-Volmer / intrinsic carrier conc)
        (
            "/api/electrochemistry/butler-volmer",
            {"j0": 1e-3, "eta": 1e6, "alpha": 0.5, "t": 298.15},
        ),
        ("/api/semiconductor/intrinsic", {"eg": -1e6, "me_star": 1.0, "mh_star": 1.0, "t": 300}),
        ("/api/semiconductor/fermi-level", {"eg": -1e6, "me_star": 1.0, "mh_star": 1.0, "t": 300}),
        # ZeroDivisionError from a Poisson ratio of exactly 1.0
        (
            "/api/thin-film/thermal-mismatch",
            {"alpha_film": 17e-6, "alpha_sub": 3e-6, "delta_t": -500.0, "e": 100e9, "nu": 1.0},
        ),
        (
            "/api/thin-film/stoney-stress",
            {"es": 130e9, "nus": 1.0, "ts": 500e-6, "tf": 100e-9, "r": 10.0},
        ),
        # AttributeError: a scipy.stats name that exists but isn't a distribution
        ("/api/statplots/histogram", {"data": D, "fit": "kstest"}),
        ("/api/statplots/qq", {"data": D, "dist": "kstest"}),
        ("/api/export/statplot-figure", {"kind": "histogram", "data": D, "fit": "kstest"}),
    ],
)
def test_malformed_request_returns_422_not_500(path: str, body: dict[str, Any]) -> None:
    resp = client.post(path, json=body)
    assert resp.status_code == 422, f"{path} -> {resp.status_code}: {resp.text[:140]}"


@pytest.mark.parametrize(
    "path, body",
    [
        (
            "/api/electrochemistry/butler-volmer",
            {"j0": 1e-3, "eta": 0.1, "alpha": 0.5, "t": 298.15},
        ),
        ("/api/semiconductor/intrinsic", {"eg": 1.12, "me_star": 1.08, "mh_star": 0.81, "t": 300}),
        (
            "/api/thin-film/stoney-stress",
            {"es": 130e9, "nus": 0.28, "ts": 500e-6, "tf": 100e-9, "r": 10.0},
        ),
        ("/api/statplots/qq", {"data": D, "dist": "norm"}),
    ],
)
def test_valid_request_still_200(path: str, body: dict[str, Any]) -> None:
    resp = client.post(path, json=body)
    assert resp.status_code == 200, f"{path} -> {resp.status_code}: {resp.text[:140]}"


@pytest.mark.parametrize(
    "filename, content",
    [
        # XML ParseError (not a ValueError) from the PANalytical .xrdml parser
        ("empty.xrdml", b""),
        ("bad.xrdml", b"<?xml version='1.0'?><xrdMeasurements><broken"),
        ("notxml.xrdml", b"this is not xml at all \x00\xff"),
        # zipfile.BadZipFile / InvalidFileException from the openpyxl .xlsx parser
        ("empty.xlsx", b""),
        ("bad.xlsx", b"PK\x03\x04 not really an xlsx payload"),
    ],
)
def test_malformed_upload_returns_422_not_500(filename: str, content: bytes) -> None:
    """A malformed binary upload must be rejected with 422, never crash the
    import route with an uncaught ParseError/BadZipFile (a 500)."""
    resp = client.post(
        "/api/parsers/upload",
        files={"file": (filename, content, "application/octet-stream")},
    )
    assert resp.status_code == 422, f"{filename} -> {resp.status_code}: {resp.text[:140]}"
