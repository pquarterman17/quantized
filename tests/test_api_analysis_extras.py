"""Integration tests for the gap-audit-5 lane I routes: /api/surface-fit,
/api/optical-gap and /api/fit-implicit (thin adapters over pure calc)."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient


def _grid(n: int = 15) -> tuple[list[float], list[float]]:
    gx, gy = np.meshgrid(np.linspace(-4, 4, n), np.linspace(-4, 4, n))
    return gx.ravel().tolist(), gy.ravel().tolist()


def test_surface_models_catalog(client: TestClient) -> None:
    r = client.get("/api/surface-fit/models")
    assert r.status_code == 200
    names = [m["name"] for m in r.json()]
    assert "Plane" in names and "2D Gaussian" in names
    plane = next(m for m in r.json() if m["name"] == "Plane")
    assert plane["param_names"] == ["a", "b", "c"]


def test_surface_fit_plane_recovers_with_inference(client: TestClient) -> None:
    x, y = _grid()
    rng = np.random.default_rng(0)
    z = (2.0 * np.array(x) - 1.0 * np.array(y) + 3.0 + rng.normal(0, 0.05, len(x))).tolist()
    r = client.post("/api/surface-fit/fit", json={"x": x, "y": y, "z": z, "model": "Plane"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["params"] == pytest.approx([2.0, -1.0, 3.0], abs=0.05)
    assert len(d["z_fit"]) == len(d["residuals"]) == len(x)
    assert d["dof"] == len(x) - 3
    row = d["inference"][0]
    assert row["error"] > 0 and row["lcl"] < row["value"] < row["ucl"]
    assert d["r2"] > 0.99


def test_surface_fit_drops_non_finite_and_honours_bounds(client: TestClient) -> None:
    x, y = _grid()
    z = (np.array(x) + 1.0).tolist()
    z[3] = None  # type: ignore[call-overload]
    r = client.post(
        "/api/surface-fit/fit",
        json={
            "x": x,
            "y": y,
            "z": z,
            "model": "Plane",
            "p0": [0.5, 0.0, 0.0],
            "lower": [None, None, None],
            "upper": [0.9, None, None],
        },
    )
    # null z is rejected by validation (a plain list[float]); the client filters
    # non-finite rows before sending, so this documents the 422 contract.
    assert r.status_code == 422
    z = (np.array(x) + 1.0).tolist()
    r = client.post(
        "/api/surface-fit/fit",
        json={
            "x": x,
            "y": y,
            "z": z,
            "model": "Plane",
            "p0": [0.5, 0.0, 0.0],
            "upper": [0.9, None, None],
        },
    )
    assert r.status_code == 200
    assert r.json()["params"][0] <= 0.9 + 1e-9


def test_surface_guess_and_errors(client: TestClient) -> None:
    x, y = _grid()
    z = (np.array(x) ** 2).tolist()
    g = client.post("/api/surface-fit/guess", json={"x": x, "y": y, "z": z, "model": "Paraboloid"})
    assert g.status_code == 200 and len(g.json()["p0"]) == 6
    bad = client.post("/api/surface-fit/fit", json={"x": x, "y": y, "z": z, "model": "Nope"})
    assert bad.status_code == 422
    short = client.post(
        "/api/surface-fit/fit", json={"x": [0, 1], "y": [0, 1], "z": [0, 1], "model": "Plane"}
    )
    assert short.status_code == 422
    mism = client.post(
        "/api/surface-fit/fit", json={"x": [0, 1, 2], "y": [0, 1], "z": [0, 1], "model": "Plane"}
    )
    assert mism.status_code == 422


def _tauc_body(eg: float = 2.35) -> dict[str, object]:
    e = np.linspace(1.5, 3.5, 300)
    alpha = np.sqrt(np.where(e > eg, 1e5 * (e - eg), 0.0)) / e  # direct: (aE)^2 linear
    return {"x": e.tolist(), "y": alpha.tolist(), "kind": "direct", "e_min": 2.6, "e_max": 3.2}


def test_tauc_route_known_gap(client: TestClient) -> None:
    r = client.post("/api/optical-gap/tauc", json=_tauc_body())
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["eg"] == pytest.approx(2.35, abs=1e-6)
    assert len(d["energy"]) == len(d["tauc"]) == len(d["alpha"])
    assert d["fit_energy"][0] == pytest.approx(2.35, abs=1e-6)


def test_tauc_route_from_wavelength_transmittance(client: TestClient) -> None:
    eg, d_nm = 2.35, 300.0
    e = np.linspace(1.6, 3.4, 300)
    alpha = np.sqrt(np.where(e > eg, 1e10 * (e - eg), 0.0)) / e
    t = np.exp(-alpha * d_nm * 1e-7)
    wl = 1239.841984 / e
    r = client.post(
        "/api/optical-gap/tauc",
        json={
            "x": wl.tolist(),
            "y": (t * 100).tolist(),
            "x_unit": "nm",
            "signal": "transmittance",
            "percent": True,
            "thickness_nm": d_nm,
            "e_min": 2.6,
            "e_max": 3.2,
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["eg"] == pytest.approx(eg, abs=2e-3)
    need = client.post(
        "/api/optical-gap/tauc",
        json={"x": wl.tolist(), "y": t.tolist(), "x_unit": "nm", "signal": "transmittance"},
    )
    assert need.status_code == 422 and "thickness" in need.text


def test_tauc_route_rejects_bad_window(client: TestClient) -> None:
    body = _tauc_body()
    body["e_min"], body["e_max"] = 3.0, 2.0
    assert client.post("/api/optical-gap/tauc", json=body).status_code == 422


def test_ellipse_route(client: TestClient) -> None:
    t = np.linspace(0, 2 * np.pi, 80, endpoint=False)
    th = np.radians(20)
    x = 1 + 4 * np.cos(t) * np.cos(th) - 2 * np.sin(t) * np.sin(th)
    y = -3 + 4 * np.cos(t) * np.sin(th) + 2 * np.sin(t) * np.cos(th)
    r = client.post("/api/fit-implicit/ellipse", json={"x": x.tolist(), "y": y.tolist()})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["semi_major"] == pytest.approx(4.0, abs=1e-6)
    assert d["angle_deg"] == pytest.approx(20.0, abs=1e-5)
    assert len(d["curve_x"]) == 200
    bad = client.post("/api/fit-implicit/ellipse", json={"x": [0, 1, 2], "y": [0, 1, 0]})
    assert bad.status_code == 422


def test_tauc_route_alpha_pairs_with_energy_when_alpha_is_negative(client: TestClient) -> None:
    e = np.linspace(1.5, 3.5, 120)
    alpha = np.where(e > 2.35, np.sqrt(1e5 * (e - 2.35)) / e, 0.0)
    alpha = alpha + np.random.default_rng(0).normal(0, 0.5, e.size)
    r = client.post(
        "/api/optical-gap/tauc",
        json={"x": e.tolist(), "y": alpha.tolist(), "e_min": 2.7, "e_max": 3.2},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["energy"]) == len(d["alpha"]) == len(d["tauc"])
    assert np.allclose(np.array(d["tauc"]), (np.array(d["alpha"]) * np.array(d["energy"])) ** 2)


def test_tauc_route_absorbance_in_wavenumbers_gives_the_same_gap(client: TestClient) -> None:
    eg = 2.35
    e = np.linspace(1.6, 3.4, 250)
    alpha = np.sqrt(np.where(e > eg, 1e5 * (e - eg), 0.0)) / e
    absorbance = alpha * 1e-4  # arbitrary scale: only proportional to alpha
    wavenumber = e / 1.239841984e-4
    r = client.post(
        "/api/optical-gap/tauc",
        json={
            "x": wavenumber.tolist(),
            "y": absorbance.tolist(),
            "x_unit": "cm-1",
            "signal": "absorbance",
            "e_min": 2.6,
            "e_max": 3.2,
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["eg"] == pytest.approx(eg, abs=1e-5)
