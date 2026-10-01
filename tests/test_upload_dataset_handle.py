"""The import routes cache the parsed dataset and advertise its handle.

Before this, the first ``/api/plot/series`` after an upload POSTed the whole
dataset straight back to the server that had just parsed it (1M x 6 rows: about
5 s of JSON both ways). The upload response now carries the same
``X-Dataset-Handle`` header the plot/map/RSM routes already send, so the
client's first plot can reference the parsed dataset instead of re-sending it.

Load-invariant pins (no clocks): the header is present, the body is unchanged
(no new field), and a plot request by handle is a fixed few dozen bytes yet
returns exactly what posting the full dataset returns.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.datastruct import DataStruct
from quantized.routes import _datasetcache as dc

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "qd_edp124.dat"


@pytest.fixture(autouse=True)
def _clear_cache_between_tests():
    dc.clear_cache()
    yield
    dc.clear_cache()


def _csv(rows: int) -> bytes:
    lines = ["t,a,b"] + [f"{i},{i * 0.5},{(i % 7) - 3}" for i in range(rows)]
    return ("\n".join(lines) + "\n").encode()


def _upload(name: str, content: bytes):
    return client.post(
        "/api/parsers/upload", files={"file": (name, content, "application/octet-stream")}
    )


@pytest.mark.parametrize(
    ("name", "content"),
    [("qd_edp124.dat", FIXTURE.read_bytes()), ("big.csv", _csv(2000))],
    ids=["qd", "csv"],
)
def test_upload_returns_a_handle_the_first_plot_can_use(name: str, content: bytes) -> None:
    resp = _upload(name, content)
    assert resp.status_code == 200
    handle = resp.headers.get("X-Dataset-Handle")
    assert handle, "the upload response must advertise the parsed dataset's handle"
    body = resp.json()
    assert "dataset_handle" not in body  # header only: the body shape is unchanged

    by_handle_req = json.dumps({"dataset_handle": handle})
    by_data_req = json.dumps({"dataset": body})
    by_handle = client.post(
        "/api/plot/series", content=by_handle_req, headers={"Content-Type": "application/json"}
    )
    by_data = client.post(
        "/api/plot/series", content=by_data_req, headers={"Content-Type": "application/json"}
    )
    assert by_handle.status_code == 200, by_handle.text
    assert by_handle.json() == by_data.json()
    # The saving itself, as a byte count: the handle request does not grow with
    # the dataset.
    assert len(by_handle_req) < 100 < len(by_data_req) // 100


def test_upload_handle_is_the_content_hash_of_the_returned_body() -> None:
    """A later 409 resend of the body the client holds lands on the SAME entry,
    so the upload never creates a second, divergent copy."""
    resp = _upload("big.csv", _csv(500))
    ds = DataStruct.from_dict(resp.json())
    assert resp.headers["X-Dataset-Handle"] == dc.hash_dataset(ds)
    np.testing.assert_array_equal(
        dc.resolve_dataset(resp.headers["X-Dataset-Handle"]).values, ds.values
    )


def test_import_by_path_also_returns_a_handle() -> None:
    resp = client.post("/api/parsers/import", json={"path": str(FIXTURE)})
    assert resp.status_code == 200
    assert resp.headers.get("X-Dataset-Handle") == dc.hash_dataset(
        DataStruct.from_dict(resp.json())
    )


def test_oversize_upload_advertises_no_handle(monkeypatch: pytest.MonkeyPatch) -> None:
    """A dataset too large to stay resident gets no header, never a doomed one."""
    monkeypatch.setattr(dc, "_MAX_TOTAL_BYTES", 16)
    resp = _upload("big.csv", _csv(50))
    assert resp.status_code == 200
    assert "X-Dataset-Handle" not in resp.headers
