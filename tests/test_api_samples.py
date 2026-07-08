"""Integration test for /api/samples (TestClient): the bundled first-run demo.

Proves the packaged demo CSV round-trips through the ordinary import_auto
path (same parser any user file goes through) and comes back as a normal
DataStruct payload — the "first-run" story from GAP_ECOSYSTEM_PLAN #41.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_demo_dataset_shape() -> None:
    resp = client.get("/api/samples/demo")
    assert resp.status_code == 200
    payload = resp.json()
    assert set(payload) == {"time", "values", "labels", "units", "metadata"}
    n = len(payload["time"])
    assert n > 10
    assert len(payload["values"]) == n
    assert all(len(row) == 1 for row in payload["values"])
    assert payload["labels"] == ["Moment"]
    assert payload["units"] == ["emu"]


def test_demo_dataset_is_finite_and_sorted() -> None:
    payload = client.get("/api/samples/demo").json()
    times = payload["time"]
    assert all(v is not None for v in times)
    assert times == sorted(times)
    values = [row[0] for row in payload["values"]]
    assert all(v is not None for v in values)


def test_demo_dataset_metadata_names_the_field_axis() -> None:
    payload = client.get("/api/samples/demo").json()
    assert payload["metadata"]["x_column_name"] == "Field"
    assert payload["metadata"]["x_column_unit"] == "Oe"
