"""Route test for /api/aggregate/algebra (thin wrapper over the golden
calc.aggregate.dataset_algebra — the math itself is golden-tested elsewhere)."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import create_app
from quantized.calc.aggregate import confidence_band
from quantized.datastruct import DataStruct

client = TestClient(create_app())

_A = {
    "time": [0.0, 1.0, 2.0],
    "values": [[10.0], [20.0], [30.0]],
    "labels": ["A"],
    "units": ["x"],
    "metadata": {},
}
_B = {
    "time": [0.0, 1.0, 2.0],
    "values": [[1.0], [2.0], [3.0]],
    "labels": ["B"],
    "units": ["x"],
    "metadata": {},
}


def test_subtraction_on_shared_grid() -> None:
    r = client.post(
        "/api/aggregate/algebra",
        json={"dataset_a": _A, "dataset_b": _B, "operation": "A-B", "interp_method": "linear"},
    )
    assert r.status_code == 200
    body = r.json()
    # A - B on the shared grid: [9, 18, 27].
    assert [row[0] for row in body["values"]] == [9.0, 18.0, 27.0]
    assert body["metadata"]["operation"] == "A-B"


def test_division_guards_zero_with_null() -> None:
    z = {**_B, "values": [[0.0], [2.0], [3.0]]}
    r = client.post(
        "/api/aggregate/algebra",
        json={"dataset_a": _A, "dataset_b": z, "operation": "A/B"},
    )
    assert r.status_code == 200
    col = [row[0] for row in r.json()["values"]]
    assert col[0] is None  # 10 / 0 → NaN → null
    assert col[1] == 10.0  # 20 / 2


def test_unknown_operation_is_422() -> None:
    r = client.post(
        "/api/aggregate/algebra",
        json={"dataset_a": _A, "dataset_b": _B, "operation": "A^B"},
    )
    assert r.status_code == 422


# ── /api/aggregate/confidence-band (thin wrapper over calc.aggregate.confidence_band) ──


def _set(offset: float) -> dict[str, object]:
    x = [0.0, 1.0, 2.0, 3.0, 4.0]
    return {
        "time": x,
        "values": [[v + offset] for v in x],
        "labels": ["y"],
        "units": ["u"],
        "metadata": {},
    }


def test_confidence_band_matches_calc() -> None:
    sets = [_set(0.0), _set(1.0), _set(2.0)]
    r = client.post("/api/aggregate/confidence-band", json={"datasets": sets, "n_points": 9})
    assert r.status_code == 200
    body = r.json()
    want = confidence_band([DataStruct.from_dict(s) for s in sets], n_points=9)
    for key in ("x", "center", "upper", "lower", "spread"):
        assert body[key] == pytest.approx(np.asarray(want[key]).tolist(), rel=1e-12), key
    assert body["method"] == "mean" and body["nSets"] == 3
    # mean of offsets 0, 1, 2 is +1 over y = x, with sample std 1.
    assert body["center"][0] == pytest.approx(1.0) and body["upper"][0] == pytest.approx(2.0)


def test_confidence_band_median_method() -> None:
    sets = [_set(0.0), _set(1.0), _set(5.0)]
    r = client.post("/api/aggregate/confidence-band", json={"datasets": sets, "method": "median"})
    assert r.status_code == 200
    assert r.json()["center"][0] == pytest.approx(1.0)


def test_confidence_band_needs_two_sets_and_known_method() -> None:
    one = client.post("/api/aggregate/confidence-band", json={"datasets": [_set(0.0)]})
    assert one.status_code == 422
    bad = client.post(
        "/api/aggregate/confidence-band",
        json={"datasets": [_set(0.0), _set(1.0)], "method": "mode"},
    )
    assert bad.status_code == 422
