"""Transport + 422 contract of /api/spectro (routes/spectro_extras.py, G21).
The maths is oracle-tested in test_calc_spectro_extras."""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)
_X = np.arange(0, 200, 0.5)


def test_fsd_roundtrip_and_refusals() -> None:
    y = (2 / np.pi) / ((_X - 100) ** 2 + 4)
    body = {"x": _X.tolist(), "y": y.tolist(), "hwhm": 2.0, "k": 2.0}
    r = client.post("/api/spectro/fsd", json=body)
    assert r.status_code == 200
    assert len(r.json()["y"]) == _X.size and r.json()["info"]["fwhm_out"] == 2.0
    assert client.post("/api/spectro/fsd", json={**body, "k": 99}).status_code == 422
    uneven = _X.copy()
    uneven[5] += 0.2
    assert client.post("/api/spectro/fsd", json={**body, "x": uneven.tolist()}).status_code == 422
    assert client.post("/api/spectro/fsd", json={**body, "apodization": "box"}).status_code == 422


def test_corr2d_returns_two_native_maps() -> None:
    x = np.linspace(0, 10, 21)
    t = np.arange(5.0)
    s = np.outer(t, np.exp(-((x - 3) ** 2))) + np.outer(t**2, np.exp(-((x - 7) ** 2)))
    body = {"x": x.tolist(), "spectra": s.tolist(), "x_label": "Wavenumber", "x_unit": "cm-1"}
    r = client.post("/api/spectro/corr2d", json=body)
    assert r.status_code == 200
    out = r.json()
    assert out["synchronous"]["metadata"]["map_shape"] == [21, 21]
    assert out["asynchronous"]["labels"] == ["Wavenumber 1", "Wavenumber 2", "Intensity"]
    cropped = client.post("/api/spectro/corr2d", json={**body, "x_min": 2, "x_max": 8}).json()
    assert cropped["synchronous"]["metadata"]["map_shape"] == [13, 13]
    assert (
        client.post("/api/spectro/corr2d", json={**body, "spectra": s[:2].tolist()}).status_code
        == 422
    )
    short = [row[:-1] for row in s.tolist()]
    assert client.post("/api/spectro/corr2d", json={**body, "spectra": short}).status_code == 422


def test_onset_both_methods_and_refusals() -> None:
    x = np.arange(0, 10.0001, 0.05)
    y = np.clip(x - 2.0, 0, 2.0) * 3.0
    body = {"x": x.tolist(), "y": y.tolist(), "fraction": 0.25}
    out = client.post("/api/spectro/onset", json=body).json()
    assert abs(out["tangent"]["x_onset"] - 2.0) < 1e-9
    assert abs(out["threshold"]["x_onset"] - 2.5) < 1e-9
    assert len(out["baseline_line"]) == len(out["tangent_line"]) == len(out["x"])
    assert client.post("/api/spectro/onset", json={**body, "fraction": 2}).status_code == 422
    assert client.post("/api/spectro/onset", json={**body, "baseline_min": 0}).status_code == 422
    assert client.post("/api/spectro/onset", json={**body, "side": "up"}).status_code == 422
