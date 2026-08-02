"""Integration tests for /api/reference (TestClient): constants, elements,
unit convert. Data parity is golden in test_calc_*; here we prove transport."""

from __future__ import annotations

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_constants_has_speed_of_light() -> None:
    resp = client.get("/api/reference/constants")
    assert resp.status_code == 200
    c = resp.json()["constants"]
    assert c["c"] > 2.9e8  # speed of light, m/s


def test_constants_has_systems_breakdown() -> None:
    resp = client.get("/api/reference/constants")
    assert resp.status_code == 200
    body = resp.json()
    systems = body["systems"]
    assert set(systems.keys()) == {"SI", "CGS", "eV"}

    si_by_key = {e["key"]: e for e in systems["SI"]}
    # The flat "constants" field and the SI system entries must agree.
    assert si_by_key["c"]["value"] == body["constants"]["c"]
    assert si_by_key["c"]["unit"] == "m/s"

    cgs_by_key = {e["key"]: e for e in systems["CGS"]}
    assert cgs_by_key["muB"]["unit"] == "erg/G"

    ev_by_key = {e["key"]: e for e in systems["eV"]}
    assert ev_by_key["kB"]["unit"] == "eV/K"
    # mu0/eps0 have no meaningful non-SI form -- must not appear elsewhere.
    assert "mu0" not in cgs_by_key
    assert "mu0" not in ev_by_key


def test_elements_full_table() -> None:
    resp = client.get("/api/reference/elements")
    assert resp.status_code == 200
    els = resp.json()["elements"]
    assert len(els) == 118
    assert els[0]["symbol"] == "H"


def test_element_by_symbol() -> None:
    resp = client.get("/api/reference/elements/Fe")
    assert resp.status_code == 200
    assert resp.json()["symbol"] == "Fe"
    assert resp.json()["Z"] == 26


def test_unknown_element_is_404() -> None:
    resp = client.get("/api/reference/elements/Zz")
    assert resp.status_code == 404


def test_convert_oe_to_tesla() -> None:
    resp = client.post(
        "/api/reference/convert", json={"value": 1.0, "from": "Oe", "to": "T"}
    )
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["result"] - 1e-4) < 1e-12


def test_convert_incompatible_dims_is_422() -> None:
    resp = client.post(
        "/api/reference/convert", json={"value": 1.0, "from": "Oe", "to": "kg"}
    )
    assert resp.status_code == 422


def test_convert_photon_energy_zero_is_422_with_ascii_detail() -> None:
    resp = client.post(
        "/api/reference/convert", json={"value": 0.0, "from": "eV", "to": "nm"}
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail.isascii()
    assert "positive" in detail


def test_unit_categories_returns_curated_table() -> None:
    resp = client.get("/api/reference/unit-categories")
    assert resp.status_code == 200
    cats = resp.json()["categories"]
    ids = {c["id"] for c in cats}
    assert {"length", "energy", "photon_energy", "magnetic_field", "magnetization",
            "pressure", "temperature", "angle", "time", "mass", "resistivity",
            "area", "volume", "frequency", "charge", "current", "voltage"} <= ids
    for cat in cats:
        assert len(cat["units"]) >= 2
        for u in cat["units"]:
            assert "value" in u and "label" in u


def test_unit_categories_every_unit_is_convertible_via_convert_endpoint() -> None:
    """Every unit string the categories endpoint advertises must actually be
    accepted by /convert (round-tripped against itself) -- catches a typo'd
    unit string in the curated table before it reaches the UI."""
    cats = client.get("/api/reference/unit-categories").json()["categories"]
    for cat in cats:
        for u in cat["units"]:
            resp = client.post(
                "/api/reference/convert",
                json={"value": 1.0, "from": u["value"], "to": u["value"]},
            )
            assert resp.status_code == 200, f"{cat['id']}: {u['value']} rejected by /convert"
