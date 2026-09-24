"""Thin-route integration tests for /api/reductions (routes/reductions.py).

The math is golden-verified in test_calc_reductions.py; these only check the
adapters validate, dispatch, and serialize.
"""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import create_app
from quantized.calc.crystallography import plane_spacings

client = TestClient(create_app())


def test_williamson_hall_route() -> None:
    resp = client.post(
        "/api/reductions/williamson-hall",
        json={"two_theta_deg": [30.1, 43.2, 57.0], "fwhm_deg": [0.25, 0.28, 0.32]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["grain_size_nm"] > 0
    assert len(body["plot_x"]) == 3


def test_williamson_hall_route_validation_422() -> None:
    resp = client.post(
        "/api/reductions/williamson-hall",
        json={"two_theta_deg": [30.1], "fwhm_deg": [0.25]},
    )
    assert resp.status_code == 422


def test_fft_thickness_route() -> None:
    tt = np.linspace(15, 35, 201)
    q = (4 * math.pi / 1.5406) * np.sin(np.deg2rad(tt / 2))
    intensity = 500 * (1 + 0.45 * np.cos(q * 800)) + 50
    resp = client.post(
        "/api/reductions/fft-thickness",
        json={
            "two_theta_deg": tt.tolist(),
            "intensity": intensity.tolist(),
            "wavelength_a": 1.5406,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["thickness_nm" ] > 0


def test_reflectivity_fft_route_neutron() -> None:
    q = np.linspace(0.01, 0.12, 201)
    r = np.maximum(q, 1e-3) ** -4.0 * (1 + 0.4 * np.cos(q * 1200))
    resp = client.post(
        "/api/reductions/reflectivity-fft",
        json={"x": q.tolist(), "reflectivity": (r / r.max()).tolist(), "is_neutron": True},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["thicknesses_nm"]) >= 1
    assert "superlattice" in body


def test_reflectivity_fft_route_xrr_missing_wavelength_422() -> None:
    resp = client.post(
        "/api/reductions/reflectivity-fft",
        json={"x": list(np.linspace(0.5, 6, 50)), "reflectivity": [1.0] * 50},
    )
    assert resp.status_code == 422


def test_spin_asymmetry_route() -> None:
    resp = client.post(
        "/api/reductions/spin-asymmetry",
        json={"r_pp": [0.9, 0.5, -0.1], "r_mm": [0.3, 0.5, 0.2]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_valid"] == 2
    assert body["asymmetry"][2] is None or math.isnan(body["asymmetry"][2])


def _si_pattern(lo: float = 20.0, hi: float = 80.0, n: int = 1500) -> dict[str, Any]:
    """Noise-free cubic-Si (F, a = 5.4307 Å) pattern on a flat background."""
    ps = plane_spacings(5.4307, centering="F", max_hkl=5, lambda_=1.5406)
    tt = np.linspace(lo, hi, n)
    obs = 10.0 * np.ones_like(tt)
    for tth, mult in zip(ps["two_theta"], ps["multiplicity"], strict=True):
        if math.isfinite(tth) and lo < tth < hi:
            obs = obs + 1000.0 * mult * np.exp(-0.5 * ((tt - tth) / 0.05) ** 2)
    return {"two_theta": tt.tolist(), "intensity": obs.tolist()}


def _pawley(**over: Any) -> Any:
    body: dict[str, Any] = {
        **_si_pattern(),
        "a": 5.45,
        "b": 5.45,
        "c": 5.45,
        "symmetry": "F",
        "tie": "abc",
        "min_two_theta": 20.0,
        "max_two_theta": 80.0,
        "profile_fwhm": 0.12,
    }
    body.update(over)
    return client.post("/api/reductions/pawley", json=body)


def test_pawley_route_refines_toward_the_true_cell() -> None:
    r = _pawley()
    assert r.status_code == 200, r.text
    body = r.json()
    assert abs(body["cell"][0] - 5.4307) < abs(5.45 - 5.4307)  # moved toward truth
    assert body["cell"][0] == body["cell"][1] == body["cell"][2]
    assert body["tie"] == "abc"
    assert body["rwp"] < body["rwp_initial"]
    assert isinstance(body["converged"], bool)
    assert body["scale"] is None
    n = len(body["model"])
    assert n == len(body["background"]) == len(body["residual"]) == 1500
    # hkl_max derived from the cell and 80° (not the old fixed 6), and every
    # reported reflection lies inside the scan.
    assert body["hkl_max"] == math.ceil(1.05 * 5.45 / (1.5406 / (2 * math.sin(math.radians(40)))))
    assert body["n_peaks"] == len(body["peaks"]) > 0
    for pk in body["peaks"]:
        assert 20.0 <= pk["two_theta"] <= 80.0
        assert len(pk["hkl"]) == 3 and pk["intensity"] >= 0


def test_pawley_route_rejects_mismatched_arrays() -> None:
    r = _pawley(two_theta=[20.0, 21.0, 22.0, 23.0], intensity=[1.0, 2.0, 3.0])
    assert r.status_code == 422
    assert "same length" in r.json()["detail"]


@pytest.mark.parametrize(
    "over",
    [
        {"profile_fwhm": 0.0},
        {"a": -5.43},
        {"b": 0.0},
        {"wavelength": 0.0},
        {"symmetry": "X"},
        {"tie": "abcd"},
        {"alpha": 0.0},
        {"gamma": 180.0},
        {"alpha": 170.0, "beta": 170.0, "gamma": 170.0},  # no real cell volume
        {"hkl_max": 0},
        {"hkl_max": 21},
        {"max_iter": 0},
        {"max_iter": 10_000},
        {"min_two_theta": 80.0, "max_two_theta": 20.0},
        {"max_two_theta": 181.0},
    ],
)
def test_pawley_route_rejects_unphysical_input(over: dict[str, Any]) -> None:
    assert _pawley(**over).status_code == 422


def test_pawley_route_rejects_nan_literal() -> None:
    # json.dumps writes a bare NaN token, which the float-only contract refuses.
    body = {**_si_pattern(), "a": 5.43, "b": 5.43, "c": 5.43}
    body["intensity"][3] = float("nan")
    r = client.post(
        "/api/reductions/pawley",
        content=json.dumps(body),
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 422


def test_pawley_route_refuses_a_cell_too_large_to_enumerate() -> None:
    r = _pawley(a=40.0, b=40.0, c=40.0, max_two_theta=80.0)
    assert r.status_code == 422
    assert "narrower" in r.json()["detail"]


def test_pawley_route_refuses_a_window_with_no_reflections() -> None:
    body = _si_pattern(lo=10.0, hi=25.0, n=300)
    r = _pawley(**body, min_two_theta=10.0, max_two_theta=25.0)
    assert r.status_code == 422
    assert "No allowed reflections" in r.json()["detail"]


def test_a_nan_literal_in_an_invalid_body_is_a_422_not_a_500() -> None:
    # App-wide: the default validation handler echoed the NaN input and then
    # failed JSON serialization. Any route with a missing field shows it.
    r = client.post(
        "/api/reductions/williamson-hall",
        content='{"two_theta_deg": [NaN, 30.0]}',  # fwhm_deg missing: input = whole body
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], list)
