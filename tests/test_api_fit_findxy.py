"""Integration tests for POST /api/fitting/find-xy (MAIN #15). Math is golden
in test_calc_fit_findxy; here we prove the transport: registry models AND
saved custom equations both work, and validation 422s (unknown model,
missing/duplicate mode selectors, degenerate range)."""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)
URL = "/api/fitting/find-xy"


# ── registry model ───────────────────────────────────────────────────────────


def test_find_y_registry_model() -> None:
    resp = client.post(
        URL,
        json={"model": "Gaussian", "params": [2.0, 0.0, 1.0], "x_min": -5, "x_max": 5, "x": 0.0},
    )
    assert resp.status_code == 200
    assert resp.json()["y"] == pytest.approx(2.0)


def test_find_x_registry_model_gaussian_two_crossings() -> None:
    resp = client.post(
        URL,
        json={"model": "Gaussian", "params": [1.0, 0.0, 1.0], "x_min": -5, "x_max": 5, "y": 0.5},
    )
    assert resp.status_code == 200
    xs = resp.json()["x"]
    assert len(xs) == 2
    half = math.sqrt(2.0 * math.log(2.0))
    assert xs[0] == pytest.approx(-half, abs=1e-6)
    assert xs[1] == pytest.approx(half, abs=1e-6)


def test_find_x_no_crossing_is_empty_list_not_error() -> None:
    resp = client.post(
        URL,
        json={
            "model": "Exponential Decay",
            "params": [1.0, 1.0, 0.0],
            "x_min": 0,
            "x_max": 1,
            "y": 100.0,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["x"] == []


# ── custom equation ──────────────────────────────────────────────────────────


def test_find_y_custom_equation() -> None:
    resp = client.post(
        URL,
        json={
            "equation": "y = a*exp(-x/t)",
            "params": [1.0, 1.0],
            "x_min": 0,
            "x_max": 10,
            "x": 0.0,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["y"] == pytest.approx(1.0)


def test_find_x_custom_equation_single_crossing() -> None:
    resp = client.post(
        URL,
        json={
            "equation": "y = a*exp(-x/t)",
            "params": [1.0, 1.0],
            "x_min": 0,
            "x_max": 10,
            "y": 0.5,
        },
    )
    assert resp.status_code == 200
    xs = resp.json()["x"]
    assert len(xs) == 1
    assert xs[0] == pytest.approx(math.log(2.0), abs=1e-6)


def test_equation_param_count_mismatch_is_422() -> None:
    resp = client.post(
        URL,
        json={
            "equation": "y = a*exp(-x/t)",
            "params": [1.0],  # equation needs 2 params (a, t)
            "x_min": 0,
            "x_max": 10,
            "x": 0.0,
        },
    )
    assert resp.status_code == 422


def test_invalid_equation_is_422() -> None:
    resp = client.post(
        URL,
        json={"equation": "a*(x", "params": [1.0], "x_min": 0, "x_max": 10, "x": 0.0},
    )
    assert resp.status_code == 422


# ── validation ───────────────────────────────────────────────────────────────


def test_unknown_model_is_422() -> None:
    resp = client.post(
        URL,
        json={"model": "NoSuchModel", "params": [1.0], "x_min": 0, "x_max": 10, "x": 0.0},
    )
    assert resp.status_code == 422


def test_neither_model_nor_equation_is_422() -> None:
    resp = client.post(URL, json={"params": [1.0], "x_min": 0, "x_max": 10, "x": 0.0})
    assert resp.status_code == 422


def test_both_model_and_equation_is_422() -> None:
    resp = client.post(
        URL,
        json={
            "model": "Linear",
            "equation": "y = a*x",
            "params": [1.0, 0.0],
            "x_min": 0,
            "x_max": 10,
            "x": 0.0,
        },
    )
    assert resp.status_code == 422


def test_neither_x_nor_y_is_422() -> None:
    resp = client.post(
        URL, json={"model": "Linear", "params": [1.0, 0.0], "x_min": 0, "x_max": 10}
    )
    assert resp.status_code == 422


def test_both_x_and_y_is_422() -> None:
    resp = client.post(
        URL,
        json={
            "model": "Linear",
            "params": [1.0, 0.0],
            "x_min": 0,
            "x_max": 10,
            "x": 1.0,
            "y": 1.0,
        },
    )
    assert resp.status_code == 422


def test_degenerate_range_is_422() -> None:
    resp = client.post(
        URL,
        json={"model": "Linear", "params": [1.0, 0.0], "x_min": 5, "x_max": 5, "y": 1.0},
    )
    assert resp.status_code == 422
