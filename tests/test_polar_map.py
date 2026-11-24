"""Polar map / pole-figure projection (GAP_AUDIT_9 G2).

Projection formulas are checked against the textbook closed forms
(Kocks/Tome/Wenk 1998 ch. 2; Snyder, USGS PP 1395): equal-area
r = sqrt(2) sin(chi/2), stereographic r = tan(chi/2), both 1 at chi = 90.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.polar_map import (
    DEFAULT_PROJECTION,
    grid_polar_map,
    project_radius,
    projected_xy,
)

client = TestClient(app)


def _pole_columns() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    chi, phi = np.meshgrid(np.arange(0, 91, 5.0), np.arange(0, 360, 10.0), indexing="ij")
    chi, phi = chi.ravel(), phi.ravel()
    z = 100.0 + 50.0 * np.cos(np.deg2rad(chi)) + 20.0 * np.cos(4 * np.deg2rad(phi))
    return chi, phi, z


def test_default_is_equal_area_owner_decision() -> None:
    assert DEFAULT_PROJECTION == "equal_area"


@pytest.mark.parametrize("chi", [0.0, 15.0, 30.0, 45.0, 60.0, 75.0, 90.0])
def test_textbook_formulas(chi: float) -> None:
    c = np.deg2rad(chi)
    assert project_radius(chi, "equal_area") == pytest.approx(np.sqrt(2) * np.sin(c / 2), abs=1e-15)
    assert project_radius(chi, "stereographic") == pytest.approx(np.tan(c / 2), abs=1e-15)


@pytest.mark.parametrize("proj", ["equal_area", "stereographic"])
def test_known_points_rim_and_centre(proj: str) -> None:
    assert project_radius(0.0, proj) == 0.0
    assert project_radius(90.0, proj) == pytest.approx(1.0, abs=1e-15)
    x, y = projected_xy(90.0, 90.0, proj)
    assert (x, y) == (pytest.approx(0.0, abs=1e-12), pytest.approx(1.0))
    # stereographic chi=60 -> tan(30) = 0.57735; equal-area chi=60 -> sqrt2*0.5
    assert project_radius(60.0, "stereographic") == pytest.approx(0.5773502691896257)
    assert project_radius(60.0, "equal_area") == pytest.approx(0.7071067811865476)


def test_equal_area_property() -> None:
    """Annulus area on the unit sphere is 2*pi*(cos c1 - cos c2); on the disk
    pi*(r2^2 - r1^2). Their ratio must be the same constant (1/2) for every
    annulus; stereographic must NOT have that property."""
    edges = np.deg2rad(np.linspace(0, 90, 19))
    sph = 2 * np.pi * (np.cos(edges[:-1]) - np.cos(edges[1:]))
    for proj, equal in (("equal_area", True), ("stereographic", False)):
        r = project_radius(np.rad2deg(edges), proj)
        disk = np.pi * (r[1:] ** 2 - r[:-1] ** 2)
        ratio = disk / sph
        if equal:
            np.testing.assert_allclose(ratio, 0.5, rtol=1e-12)
        else:
            assert ratio.max() / ratio.min() > 1.5


def test_grid_recovers_smooth_field() -> None:
    chi, phi, z = _pole_columns()
    g = grid_polar_map(chi, phi, z, n_r=60, n_phi=180)
    assert g.z.shape == (60, 180)
    # Compare with the analytic field at interior cells (chi well inside 0-90).
    r = g.r[:, None] * np.ones((1, 180))
    chi_cell = 2 * np.rad2deg(np.arcsin(r / np.sqrt(2)))
    ang = 20 * np.cos(4 * np.deg2rad(g.phi_deg))[None, :]
    exact = 100 + 50 * np.cos(np.deg2rad(chi_cell)) + ang
    inner = (chi_cell > 10) & (chi_cell < 80)
    err = np.abs(g.z - exact)[inner]
    assert np.isfinite(g.z[inner]).all()
    assert err.max() < 2.0  # measured 1.63: linear interpolation on a 5 x 10 degree mesh


def test_grid_nan_outside_hull() -> None:
    chi, phi, z = _pole_columns()
    keep = chi <= 60
    g = grid_polar_map(chi[keep], phi[keep], z[keep])
    assert np.isnan(g.z[-1]).all() and np.isfinite(g.z[0]).any()


def test_refusals() -> None:
    chi, phi, z = _pole_columns()
    with pytest.raises(ValueError, match="0-90"):
        grid_polar_map(chi + 5.0, phi, z)
    with pytest.raises(ValueError, match="0-90"):
        grid_polar_map(chi - 1.0, phi, z)
    with pytest.raises(ValueError, match="at least"):
        grid_polar_map(chi[:5], phi[:5], z[:5])
    with pytest.raises(ValueError, match="2-D"):
        grid_polar_map(np.linspace(10, 80, 20), np.full(20, 30.0), np.arange(20.0))
    with pytest.raises(ValueError, match="projection"):
        grid_polar_map(chi, phi, z, projection="mercator")


def _body(chi: Any, phi: Any, z: Any, **polar_map: Any) -> dict[str, Any]:
    vals = [[float(a), float(b)] for a, b in zip(chi, z, strict=True)]
    return {
        "dataset": {"time": [float(p) for p in phi], "values": vals,
                    "labels": ["Chi", "Intensity"], "units": ["deg", "cps"], "metadata": {}},
        "fmt": "svg",
        "polar": {"polar_map": {"chi_col": 1, "phi_col": 0, "z_col": 2, **polar_map}},
    }


@pytest.mark.parametrize("extra", [{}, {"projection": "stereographic", "mode": "both"},
                                   {"mode": "contour", "z_scale": "log"}])
def test_export_route_renders(extra: dict[str, Any]) -> None:
    chi, phi, z = _pole_columns()
    r = client.post("/api/export/figure", json=_body(chi, phi, z, **extra))
    assert r.status_code == 200, r.text
    assert b"<svg" in r.content[:2000]


def test_export_route_refuses() -> None:
    chi, phi, z = _pole_columns()
    r = client.post("/api/export/figure", json=_body(chi + 20, phi, z))
    assert r.status_code == 422 and "0-90" in r.text
    r = client.post("/api/export/figure", json=_body(chi, phi, z, z_col=9))
    assert r.status_code == 422 and "does not exist" in r.text
    r = client.post("/api/export/figure", json=_body(chi, phi, z - z.max()))
    assert r.status_code == 200
    r = client.post("/api/export/figure", json=_body(chi, phi, z - z.max(), z_scale="log"))
    assert r.status_code == 422 and "log" in r.text
