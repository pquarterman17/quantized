"""Transport + 422/501 contract of /api/timeseries (routes/timeseries.py, G13).
The math is oracle-tested in test_calc_timeseries."""

from __future__ import annotations

import sys

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

_T = np.arange(144)
_Y = (
    10 + 0.05 * _T + 2 * np.sin(2 * np.pi * _T / 12) + np.random.default_rng(1).normal(0, 0.3, 144)
).tolist()


def _post(path: str, **body: object) -> object:
    return client.post(f"/api/timeseries/{path}", json={"y": _Y, **body})


def test_correlogram_shape() -> None:
    r = _post("correlogram", nlags=20)
    assert r.status_code == 200  # type: ignore[attr-defined]
    out = r.json()  # type: ignore[attr-defined]
    assert out["lags"] == list(range(21)) and len(out["acf"]) == len(out["pacf"]) == 21
    assert len(out["acf_bartlett_band"]) == 21 and out["dt"] == 1.0 and out["irregular"] is False


def test_default_nlags_is_capped() -> None:
    assert _post("correlogram").json()["lags"][-1] == 21  # type: ignore[attr-defined]


def test_time_axis_sets_dt_and_irregular_is_refused() -> None:
    r = _post("correlogram", x=(_T * 0.5).tolist())
    assert r.json()["dt"] == 0.5  # type: ignore[attr-defined]
    x = _T.astype(float)
    x[50:] += 0.5
    bad = _post("correlogram", x=x.tolist())
    assert bad.status_code == 422 and "evenly spaced" in bad.json()["detail"]  # type: ignore[attr-defined]
    ok = _post("correlogram", x=x.tolist(), allow_irregular=True)
    assert ok.status_code == 200 and ok.json()["irregular"] is True  # type: ignore[attr-defined]


def test_stationarity_decompose_changepoint() -> None:
    s = _post("stationarity", regression="ct").json()  # type: ignore[attr-defined]
    assert {"adf", "kpss", "verdict"} <= set(s)
    d = _post("decompose", period=12, model="additive").json()  # type: ignore[attr-defined]
    assert len(d["trend"]) == 144 and d["trend"][0] is None and len(d["seasonal_figure"]) == 12
    steps = (np.repeat([0.0, 3.0], 60) + np.random.default_rng(0).normal(0, 0.4, 120)).tolist()
    c = client.post("/api/timeseries/changepoint", json={"y": steps, "method": "binseg"}).json()
    assert c["changepoints"] == [60]


def test_arima_and_501_without_statsmodels(monkeypatch: pytest.MonkeyPatch) -> None:
    r = _post("arima", p=1, d=1, q=1, steps=5).json()  # type: ignore[attr-defined]
    assert len(r["forecast"]["mean"]) == 5 and r["order"] == [1, 1, 1]
    monkeypatch.setitem(sys.modules, "statsmodels.tsa.arima.model", None)
    resp = _post("arima")
    assert resp.status_code == 501 and "quantized-lab[stats]" in resp.json()["detail"]  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("correlogram", {"y": [1.0, 2.0]}),
        ("correlogram", {"y": [1.0] * 20}),
        ("stationarity", {"tests": "x"}),
        ("decompose", {"period": 100}),
        ("decompose", {"period": 12, "model": "multiplicative", "y": [-1.0] * 40}),
        ("changepoint", {"method": "nope"}),
        ("arima", {"p": 9}),
    ],
)
def test_refusals_are_422(path: str, body: dict[str, object]) -> None:
    payload = {"y": _Y, **body}
    assert client.post(f"/api/timeseries/{path}", json=payload).status_code == 422


def test_nan_cannot_travel_and_nulls_are_refused() -> None:
    r = client.post("/api/timeseries/correlogram", json={"y": [1.0, None] + [1.0] * 20})
    assert r.status_code == 422


def test_stationarity_refuses_values_whose_differences_overflow() -> None:
    # Bug hunt (live): +-1e308 made the ADF first differences inf and
    # statsmodels raised MissingDataError (an unhandled 500). Now a 422.
    r = client.post(
        "/api/timeseries/stationarity", json={"y": [1e308 * (-1) ** i for i in range(20)]}
    )
    assert r.status_code == 422 and "too large" in r.json()["detail"]
