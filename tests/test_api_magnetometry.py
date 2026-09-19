"""Integration tests for /api/magnetometry (TestClient). The analysis is golden
in test_calc_magnetometry / test_calc_hysteresis; here we prove the transport
and that a known synthetic loop yields the expected coercivity."""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient


def _loop(hc: float = 150.0) -> tuple[list[float], list[float]]:
    """A symmetric tanh M-H loop with coercivity ~hc (asc/desc branches)."""
    up = np.linspace(-1000, 1000, 100)
    down = np.linspace(1000, -1000, 100)
    m_up = np.tanh((up + hc) / 300)
    m_down = np.tanh((down - hc) / 300)
    h = np.concatenate([up, down])
    m = np.concatenate([m_up, m_down])
    return list(h), list(m)


def test_hysteresis_recovers_coercivity(client: TestClient) -> None:
    h, m = _loop(hc=150.0)
    resp = client.post("/api/magnetometry/hysteresis", json={"h": h, "m": m})
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["HcMean"] - 150.0) < 10.0  # recovers the ~150 Oe coercivity
    assert len(out["Hc"]) == 2
    assert out["MsMean"] > 0.9  # saturates near 1
    assert "SFD" in out and "peakH" in out["SFD"]
    assert set(out["ascending"]) == {"H", "M"}


def test_hysteresis_too_few_points_is_422(client: TestClient) -> None:
    resp = client.post("/api/magnetometry/hysteresis", json={"h": [0, 1], "m": [0, 1]})
    assert resp.status_code == 422


def test_subtract_background_linear(client: TestClient) -> None:
    t = list(np.linspace(2, 300, 100))
    # signal + linear high-T background (slope 0.01, intercept 5)
    m = [0.01 * ti + 5.0 + (50.0 if ti < 50 else 0.0) for ti in t]
    resp = client.post(
        "/api/magnetometry/subtract-background",
        json={"temperature": t, "moment": m},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["slope"] - 0.01) < 1e-3
    assert len(out["corrected"]) == len(t)


def test_convert_units_oe_to_tesla(client: TestClient) -> None:
    resp = client.post(
        "/api/magnetometry/convert-units",
        json={"x": [10000.0], "y": [1.0], "from_field": "Oe", "to_field": "T"},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["x"][0] - 1.0) < 1e-9  # 10000 Oe = 1 T
    assert out["x_unit"] == "T"


def test_null_series_element_is_422_with_one_entry_per_null(client: TestClient) -> None:
    """BUG-021's reproduction, pinned at the wire.

    A JavaScript ``Number.NaN`` has no JSON literal -- ``JSON.stringify`` writes
    it as ``null`` -- and every series field here is pydantic ``list[float]``,
    which rejects ``null`` ONCE PER ELEMENT. A measured M-H loop with four gaps
    therefore produced a 422 whose ``detail`` was a four-entry ARRAY, which the
    frontend's error extractor stringified to
    ``[object Object],[object Object],[object Object],[object Object]``.

    This pins the shape ``lib/api/errorDetail.ts`` formats and the reason
    ``lib/api/finitePairs.ts`` drops gaps before the request. If FastAPI ever
    starts accepting ``null`` here, this test says so.
    """
    t = list(np.linspace(2, 300, 40))
    m: list[float | None] = [0.01 * ti for ti in t]
    for i in (7, 8, 22, 31):
        m[i] = None  # exactly what JSON.stringify(NaN) puts on the wire
    resp = client.post(
        "/api/magnetometry/subtract-background",
        json={"temperature": t, "moment": m},
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert isinstance(detail, list)
    assert len(detail) == 4  # one per null, not one per request
    assert [d["loc"] for d in detail] == [
        ["body", "moment", 7],
        ["body", "moment", 8],
        ["body", "moment", 22],
        ["body", "moment", 31],
    ]
    assert all(d["msg"] == "Input should be a valid number" for d in detail)


def test_hysteresis_background_reports_an_offset_not_an_intercept(
    client: TestClient,
) -> None:
    """The M(H) route's third quantity is ``offset`` (the vertical shift
    removed), not ``intercept``. Running the M(T) route on the same loop
    reports an ``intercept`` that carries +Ms -- the shear BUG-021 is about."""
    # A WELL-SATURATED loop: `_loop`'s 300 Oe transition width still curves
    # inside the 0.7-1.0 tail, which biases a per-tail slope fit. A 60 Oe
    # width saturates by ~400 Oe, so both tails are genuinely flat + chi*H.
    up = np.linspace(-1000, 1000, 100)
    down = np.linspace(1000, -1000, 100)
    h = list(np.concatenate([up, down]))
    m = list(np.concatenate([np.tanh((up + 150.0) / 60), np.tanh((down - 150.0) / 60)]))
    chi, shift = -3e-4, 0.05
    m_bg = [mi + chi * hi + shift for mi, hi in zip(m, h, strict=True)]

    loop_resp = client.post(
        "/api/magnetometry/subtract-hysteresis-background",
        json={"h": h, "m": m_bg},
    )
    assert loop_resp.status_code == 200
    loop_out = loop_resp.json()
    assert set(loop_out) == {"corrected", "slope", "offset"}
    assert abs(loop_out["slope"] - chi) < 1e-5
    assert abs(loop_out["offset"] - shift) < 1e-2
    # The corrected loop is centred: its two saturated tails straddle zero.
    h_arr = np.asarray(h)
    sat = np.abs(h_arr) > 0.9 * float(np.max(np.abs(h_arr)))
    corr = np.asarray(loop_out["corrected"], dtype=float)
    assert abs(float(np.mean(corr[sat]))) < 1e-2

    mt_resp = client.post(
        "/api/magnetometry/subtract-background",
        json={"temperature": h, "moment": m_bg},
    )
    assert mt_resp.status_code == 200
    mt_out = mt_resp.json()
    assert "intercept" in mt_out and "offset" not in mt_out
    # The one-sided fit's intercept carries +Ms (~1), not the true 0.05 shift,
    # and the corrected loop is pushed off centre by roughly that much.
    assert mt_out["intercept"] > 0.5
    mt_corr = np.asarray(mt_out["corrected"], dtype=float)
    assert float(np.mean(mt_corr[sat])) < -0.5
