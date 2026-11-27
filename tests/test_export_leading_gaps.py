"""An X that starts with missing cells -- screen == export, the BACKEND half.

``frontend/src/lib/leadingGapsFixture.test.ts`` states the rule (a row with no
x draws no point and ranges neither axis; every row keeps its source index) and
pins, per case, the view and the source rows drawn in ``leading_gaps.json``.
The exported figure must land on the same x range, y range and drawn rows.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.decimate import is_ascending

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "leading_gaps.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


def _figure(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    assert kept, "no figure was saved"
    return kept[-1]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_export_ranges_and_draws_as_the_canvas(
    monkeypatch: pytest.MonkeyPatch, case: dict[str, Any]
) -> None:
    ax = _figure(monkeypatch, case["request"]).axes[0]
    want = case["want"]
    assert ax.get_xlim() == pytest.approx(tuple(want["x"]), rel=1e-9, abs=1e-6)
    assert ax.get_ylim() == pytest.approx(tuple(want["y"]), rel=1e-9, abs=1e-9)
    xy = np.asarray(ax.lines[0].get_xydata(), dtype=float)
    assert len(xy) == len(case["request"]["dataset"]["time"])  # source rows, not re-indexed
    assert np.flatnonzero(np.isfinite(xy).all(axis=1)).tolist() == want["rows"]


def test_a_leading_gap_is_not_ascending_and_is_not_decimated() -> None:
    assert not is_ascending(np.array([np.nan, np.nan, 1.0, 2.0]))
    assert is_ascending(np.array([1.0, np.nan, 2.0]))  # a middle gap still is
    assert is_ascending(np.array([]))


def test_an_all_blank_x_is_refused_or_empty_never_a_crash(monkeypatch: pytest.MonkeyPatch) -> None:
    body = json.loads(json.dumps(CASES[0]["request"]))
    body["dataset"]["time"] = [None] * len(body["dataset"]["time"])
    r = client.post("/api/export/figure", json=body)
    assert r.status_code in (200, 422), r.text  # a figure with nothing drawn, or a stated reason
    s = client.post("/api/plot/series", json={"dataset": body["dataset"], "y_keys": [0]})
    assert s.status_code in (200, 422), s.text


def test_the_plot_route_keeps_every_row_of_a_leading_gap_payload() -> None:
    n = 5000
    time: list[float | None] = [None, None, None, *[float(i) for i in range(n - 3)]]
    ds = {
        "time": time,
        "values": [[float(i)] for i in range(n)],
        "labels": ["Y"],
        "units": [""],
        "metadata": {},
    }
    r = client.post("/api/plot/series", json={"dataset": ds, "y_keys": [0], "decimate_width": 200})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["decimated"] is False and body["rows"] is None
    assert len(body["data"][0]) == n
