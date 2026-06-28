"""Route test for /api/aggregate/algebra (thin wrapper over the golden
calc.aggregate.dataset_algebra — the math itself is golden-tested elsewhere)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from quantized.app import create_app

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
