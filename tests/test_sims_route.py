"""Route tests for POST /api/sims/process (audit P2.3). The formulas are
pinned in ``test_calc_sims.py``; these pin the wire shape and the 422s."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import create_app

client = TestClient(create_app())
URL = "/api/sims/process"

PROFILE: dict[str, Any] = {
    "time": [0.0, 10.0, 20.0, 30.0],
    "values": [[40.0, 1000.0], [20.0, 1000.0], [4.0, 2000.0], [2.0, 2000.0]],
    "labels": ["B", "Si"],
    "units": ["c/s", "c/s"],
    "metadata": {"x_column_name": "Time", "x_column_unit": "s"},
}


def test_process_returns_derived_dataset_stages_and_warnings() -> None:
    res = client.post(
        URL,
        json={
            "dataset": PROFILE,
            "calibration": {"method": "crater", "crater_depth": 0.3, "crater_unit": "um"},
            "normalization": {"reference": 1},
            "smoothing": {"method": "moving", "window": 1},
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["dataset"]["time"] == pytest.approx([0.0, 100.0, 200.0, 300.0])
    assert body["dataset"]["metadata"]["x_column_unit"] == "nm"
    assert body["dataset"]["units"] == ["ratio to Si", "c/s"]
    assert [s["stage"] for s in body["stages"]] == ["calibration", "normalization", "smoothing"]
    assert body["stages"][0]["sputter_rate_nm_per_s"] == pytest.approx(10.0)
    assert [w["code"] for w in body["warnings"]] == ["assumed-total-time"]


def test_blank_values_travel_as_null() -> None:
    ds = {**PROFILE, "values": [[40.0, 1000.0], [20.0, 0.0], [4.0, 2000.0], [2.0, 2000.0]]}
    res = client.post(URL, json={"dataset": ds, "normalization": {"reference": 1}})
    assert res.status_code == 200
    assert res.json()["dataset"]["values"][1][0] is None


def test_refusals_are_422_with_the_reason() -> None:
    cases: list[dict[str, Any]] = [
        {"dataset": PROFILE},
        {
            "dataset": {**PROFILE, "metadata": {}},
            "calibration": {"method": "rate", "sputter_rate": 1},
        },
        {"dataset": PROFILE, "background": {"lo": 500, "hi": 600}},
        {"dataset": PROFILE, "normalization": {"reference": 5}},
    ]
    for body in cases:
        res = client.post(URL, json=body)
        assert res.status_code == 422, body
        assert isinstance(res.json()["detail"], str)
    assert (
        client.post(URL, json={"dataset": PROFILE, "smoothing": {"window": 0}}).status_code == 422
    )


def test_out_of_range_reference_is_refused_with_its_own_message_not_backgrounds() -> None:
    # 2026-09 review finding 9: with a background stage ALSO running, an
    # out-of-range normalization reference used to be swept into that
    # stage's own `skip` list and refused with ITS "column to leave
    # unchanged" wording -- misleading, since the problem is the reference.
    res = client.post(
        URL,
        json={
            "dataset": PROFILE,
            "background": {"lo": 0, "hi": 10},
            "normalization": {"reference": 5},
        },
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert "normalization reference" in detail
    assert "leave unchanged" not in detail


# ── /api/sims/compare and /api/sims/region (audit P2.3, boxes 3-4) ─────────

DEPTH: dict[str, Any] = {
    "time": [0.0, 10.0, 20.0, 30.0, 40.0],
    "values": [[1e18, 5e22], [3e18, 5e22], [5e18, 5e22], [3e18, 5e22], [1e18, 5e22]],
    "labels": ["B", "Si"],
    "units": ["atoms/cm3", "atoms/cm3"],
    "metadata": {"x_column_name": "Depth", "x_column_unit": "nm"},
}


def test_compare_returns_the_block_table_with_blanks_as_null() -> None:
    other = {**DEPTH, "time": [0.0, 100.0], "values": [[1.0, 2.0], [3.0, 4.0]],
             "metadata": {"x_column_unit": "A"}}
    res = client.post("/api/sims/compare", json={
        "profiles": [{"name": "a.csv", "dataset": DEPTH}, {"name": "b.csv", "dataset": other}],
        "species": ["B"],
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["dataset"]["labels"] == ["B — a", "B — b"]
    assert body["dataset"]["time"] == pytest.approx([0, 10, 20, 30, 40, 0, 10])
    assert body["dataset"]["values"][5] == [None, 1.0]
    assert [t["rows"] for t in body["traces"]] == [[0, 5], [5, 7]]
    assert [w["code"] for w in body["warnings"]] == ["x-converted"]


def test_compare_refusals_are_422() -> None:
    for body in (
        {"profiles": [], "species": ["B"]},
        {"profiles": [{"name": "a", "dataset": DEPTH}], "species": []},
        {"profiles": [{"name": "a", "dataset": DEPTH}], "species": ["P"]},
    ):
        res = client.post("/api/sims/compare", json=body)
        assert res.status_code == 422, body


def test_region_returns_measures_and_csv() -> None:
    res = client.post("/api/sims/region", json={
        "dataset": DEPTH, "dataset_name": "implant.csv", "lo": 0, "hi": 40, "columns": [0],
    })
    assert res.status_code == 200, res.text
    body = res.json()
    (b,) = body["species"]
    assert b["integral"] == pytest.approx(1.2e13) and b["integral_unit"] == "atoms/cm^2"
    assert b["junction_depth"] == pytest.approx(7.5)
    assert b["crossings"][1] == {"depth": pytest.approx(32.5), "direction": "falling"}
    assert body["csv"].startswith("# SIMS region measures\n# dataset: implant.csv\n")


def test_region_refusals_are_422() -> None:
    for body in (
        {"dataset": DEPTH, "lo": 100, "hi": 200},
        {"dataset": DEPTH, "lo": 0, "hi": 40, "threshold": 2},
        {"dataset": DEPTH, "lo": 0, "hi": 40, "columns": [9]},
        {"dataset": DEPTH, "lo": 0, "hi": 40, "threshold_mode": "median"},
    ):
        res = client.post("/api/sims/region", json=body)
        assert res.status_code == 422, body


def test_region_result_emits_a_report_sheet() -> None:
    region = client.post("/api/sims/region", json={"dataset": DEPTH, "lo": 0, "hi": 40}).json()
    res = client.post("/api/report/emit", json={
        "kind": "sims_region", "result": region, "title": "SIMS region — implant",
        "source_refs": [{"kind": "dataset", "id": "d1", "name": "implant.csv"}],
    })
    assert res.status_code == 200, res.text
    report = res.json()["report"]
    assert report["title"] == "SIMS region — implant"
    table = report["sections"][0]["blocks"][0]
    assert table["columns"][:3] == ["Species", "Unit", "Integral"]
    assert [r[0] for r in table["rows"]] == ["B", "Si"]
    texts = " ".join(b["text"] for b in report["sections"][0]["blocks"][1:])
    assert "Depth 0 to 40 nm" in texts and "50% of each species' peak" in texts
    assert report["source_refs"] == [{"kind": "dataset", "id": "d1", "name": "implant.csv"}]
