"""Integration tests for the /api/rsm route (TestClient)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from quantized.app import app
from quantized.io.xrdml import import_xrdml

client = TestClient(app)
FIXTURES = Path(__file__).parent / "fixtures"


def test_strain_basic() -> None:
    resp = client.post(
        "/api/rsm/strain",
        json={"q_sub": [0.50, 4.00], "q_film": [0.40, 3.80]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["eps_parallel"] == 0.50 / 0.40 - 1
    assert body["relaxation"] is None  # no bulk -> NaN -> null


def test_strain_with_bulk_relaxation() -> None:
    resp = client.post(
        "/api/rsm/strain",
        json={"q_sub": [0.50, 4.00], "q_film": [0.40, 3.80], "bulk": [0.40, 3.70]},
    )
    assert resp.status_code == 200
    assert resp.json()["relaxation"] == 1.0  # film Qx == bulk Qx -> fully relaxed


def test_strain_symmetric_nan_serializes_as_null() -> None:
    resp = client.post(
        "/api/rsm/strain",
        json={"q_sub": [0.0, 4.00], "q_film": [0.0, 3.80]},
    )
    assert resp.status_code == 200
    assert resp.json()["eps_parallel"] is None  # symmetric -> NaN -> null


def test_strain_zero_qz_is_422() -> None:
    resp = client.post(
        "/api/rsm/strain",
        json={"q_sub": [0.50, 0.0], "q_film": [0.40, 3.80]},
    )
    assert resp.status_code == 422


def test_analyze_finds_the_fixture_peak() -> None:
    ds = import_xrdml(FIXTURES / "xrdml_rsm_synthetic.xrdml")
    resp = client.post(
        "/api/rsm/analyze",
        json={"dataset": ds.to_dict(), "n_peaks": 1, "smooth_sigma": 0.6, "fit_window": 6},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_peaks_found"] == 1
    assert body["used_q_space"] is True
    omega_c, tth_c = body["peaks"][0]["centre_angle"]
    assert 30.0 <= omega_c <= 31.0
    assert 60.0 <= tth_c <= 62.0


def test_analyze_rejects_non_rsm_dataset() -> None:
    plain = {
        "time": [0.0, 1.0],
        "values": [[1.0], [2.0]],
        "labels": ["m"],
        "units": ["emu"],
        "metadata": {},
    }
    resp = client.post("/api/rsm/analyze", json={"dataset": plain})
    assert resp.status_code == 422


def _rsm_dataset() -> dict:
    """The committed synthetic RSM fixture, parsed then serialized for the wire."""
    from pathlib import Path

    from quantized.io.xrdml import import_xrdml
    from quantized.routes._payload import datastruct_payload

    fx = Path(__file__).parent / "fixtures" / "xrdml_rsm_synthetic.xrdml"
    return datastruct_payload(import_xrdml(fx))


def test_linecut_roundtrip() -> None:
    ds = _rsm_dataset()
    omega0 = ds["values"][0][1]
    resp = client.post(
        "/api/rsm/linecut",
        json={"dataset": ds, "direction": "h", "value": omega0, "space": "angular"},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["labels"] == ["Intensity"]
    assert "H-cut" in out["metadata"]["cut_label"]
    assert len(out["time"]) == ds["metadata"]["map_shape"][1]


def test_cut_segment_roundtrip_and_422() -> None:
    ds = _rsm_dataset()
    resp = client.post(
        "/api/rsm/cut-segment",
        json={"dataset": ds, "p0": [60.2, 30.1], "p1": [61.8, 30.9], "n": 40},
    )
    assert resp.status_code == 200
    assert resp.json()["metadata"]["x_column_name"] == "Distance"

    bad = client.post(
        "/api/rsm/cut-segment",
        json={"dataset": ds, "p0": [60.0, 30.0], "p1": [60.0, 30.0]},
    )
    assert bad.status_code == 422


def test_projection_roundtrip() -> None:
    ds = _rsm_dataset()
    resp = client.post("/api/rsm/projection", json={"dataset": ds, "axis": "frames"})
    assert resp.status_code == 200
    out = resp.json()
    assert len(out["time"]) == ds["metadata"]["map_shape"][0]


# The fixture's Q cloud sits at |Q| ~= 4.08-4.20 Ang^-1, phi ~= 89-91 deg
# (near-specular: Qz >> Qx). q_min/q_max/phi bounds below are chosen to
# bracket that with margin, not transcribed from a separate computation.


def test_sector_roundtrip_full_circle_default() -> None:
    ds = _rsm_dataset()
    resp = client.post(
        "/api/rsm/sector",
        json={"dataset": ds, "q_min": 4.0, "q_max": 4.3, "n_bins": 10},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["labels"] == ["Intensity", "N points"]
    assert out["metadata"]["cut_kind"] == "sector"
    assert out["metadata"]["sector"] == [-180.0, 180.0]  # neither pair given -> full circle


def test_sector_dual_parameterization_equivalent() -> None:
    ds = _rsm_dataset()
    minmax = client.post(
        "/api/rsm/sector",
        json={
            "dataset": ds, "q_min": 4.0, "q_max": 4.3, "n_bins": 8,
            "phi_min": 85.0, "phi_max": 95.0,
        },
    )
    center = client.post(
        "/api/rsm/sector",
        json={
            "dataset": ds, "q_min": 4.0, "q_max": 4.3, "n_bins": 8,
            "phi_center": 90.0, "phi_halfwidth": 5.0,
        },
    )
    assert minmax.status_code == center.status_code == 200
    assert minmax.json()["values"] == center.json()["values"]


def test_sector_both_parameterizations_is_422() -> None:
    ds = _rsm_dataset()
    resp = client.post(
        "/api/rsm/sector",
        json={
            "dataset": ds, "q_min": 4.0, "q_max": 4.3,
            "phi_min": 85.0, "phi_max": 95.0,
            "phi_center": 90.0, "phi_halfwidth": 5.0,
        },
    )
    assert resp.status_code == 422


def test_sector_empty_selection_is_422() -> None:
    ds = _rsm_dataset()
    resp = client.post(
        "/api/rsm/sector",
        json={
            "dataset": ds, "q_min": 0.0, "q_max": 100.0,
            "phi_center": 0.0, "phi_halfwidth": 1.0,  # far from the data's phi~90
        },
    )
    assert resp.status_code == 422


def test_chi_profile_roundtrip() -> None:
    ds = _rsm_dataset()
    resp = client.post(
        "/api/rsm/chi-profile",
        json={"dataset": ds, "q_min": 4.0, "q_max": 4.3, "n_bins": 12},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["labels"] == ["Intensity", "N points"]
    assert out["metadata"]["cut_kind"] == "chi"
    assert out["metadata"]["mode"] == "mean"  # chi-profile's own default (unlike sector's sum)


def test_chi_profile_both_parameterizations_is_422() -> None:
    ds = _rsm_dataset()
    resp = client.post(
        "/api/rsm/chi-profile",
        json={
            "dataset": ds, "q_min": 4.0, "q_max": 4.3,
            "phi_min": 85.0, "phi_max": 95.0,
            "phi_center": 90.0, "phi_halfwidth": 5.0,
        },
    )
    assert resp.status_code == 422


# ── box / box-stats (item 3, calc.boxcut) ────────────────────────────────────
#
# The fixture is an angular mesh (2Theta ~= 60-62 deg, Omega ~= 30-31 deg) --
# bounds below stay inside that so the grid path (exact, no map_shape/angle/
# wrap override) applies by default.


def test_box_roundtrip_grid_path() -> None:
    ds = _rsm_dataset()
    resp = client.post(
        "/api/rsm/box",
        json={"dataset": ds, "x_min": 60.2, "x_max": 61.8, "y_min": 30.1, "y_max": 30.9},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["labels"] == ["Intensity", "N points"]
    assert out["metadata"]["cut_kind"] == "box"
    assert out["metadata"]["cut_space"] == "angular"


def test_box_q_space_uses_cloud_path() -> None:
    # Q cloud sits at Qx ~= 0 (phi ~= 89-91 deg, near-specular), Qz ~= 4.0-4.3
    # (see the sector-test comment above) -- x bounds Qx, y bounds Qz.
    ds = _rsm_dataset()
    resp = client.post(
        "/api/rsm/box",
        json={
            "dataset": ds, "x_min": -0.5, "x_max": 0.5, "y_min": 4.0, "y_max": 4.3,
            "space": "q", "collapse": "x", "n_bins": 20,
        },
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["metadata"]["cut_space"] == "q"
    assert out["metadata"]["n_bins_or_lines"] == 20  # cloud path always bins


def test_box_empty_selection_is_422() -> None:
    ds = _rsm_dataset()
    resp = client.post(
        "/api/rsm/box",
        json={"dataset": ds, "x_min": 1000.0, "x_max": 1001.0, "y_min": 30.1, "y_max": 30.9},
    )
    assert resp.status_code == 422


def test_box_stats_empty_selection_is_422() -> None:
    ds = _rsm_dataset()
    resp = client.post(
        "/api/rsm/box-stats",
        json={"dataset": ds, "x_min": 1000.0, "x_max": 1001.0, "y_min": 30.1, "y_max": 30.9},
    )
    assert resp.status_code == 422


def test_box_stats_roundtrip() -> None:
    ds = _rsm_dataset()
    resp = client.post(
        "/api/rsm/box-stats",
        json={"dataset": ds, "x_min": 60.2, "x_max": 61.8, "y_min": 30.1, "y_max": 30.9},
    )
    assert resp.status_code == 200
    body = resp.json()
    for key in (
        "n_points", "integrated_intensity", "mean_intensity", "max_intensity",
        "peak_x", "peak_y", "centroid_x", "centroid_y",
        "x_min", "x_max", "y_min", "y_max", "space", "angle", "wrap",
    ):
        assert key in body
    assert body["n_points"] > 0
    assert body["wrap"] is None


def test_box_angle_and_wrap_ride_as_fields() -> None:
    ds = _rsm_dataset()
    resp = client.post(
        "/api/rsm/box",
        json={
            "dataset": ds, "x_min": -0.5, "x_max": 0.5, "y_min": 4.0, "y_max": 4.3,
            "space": "q", "angle": 10.0,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["metadata"]["angle"] == 10.0
