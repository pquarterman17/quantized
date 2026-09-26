"""Route tests for POST /api/transform/resample (audit P2.5 align/interpolate).

The interpolation itself is golden-tested against MATLAB in
``test_calc_resample.py``; these pin the route's grid modes and every refusal /
warning the preview shows before a derived dataset is created.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import create_app
from quantized.calc.resample import resample_data
from quantized.datastruct import DataStruct

client = TestClient(create_app())
URL = "/api/transform/resample"


def _ds(x: list[Any], y: list[Any], unit: str = "K") -> dict[str, Any]:
    return {
        "time": x,
        "values": [[v] for v in y],
        "labels": ["M"],
        "units": ["emu"],
        "metadata": {"x_column_unit": unit},
    }


LINE = _ds([0.0, 1.0, 2.0, 3.0, 4.0], [0.0, 10.0, 20.0, 30.0, 40.0])


def _post(**body: Any) -> Any:
    return client.post(URL, json={"dataset": LINE, **body})


def _codes(body: dict[str, Any]) -> list[str]:
    return [w["code"] for w in body["warnings"]]


def _col(body: dict[str, Any]) -> list[Any]:
    return [row[0] for row in body["dataset"]["values"]]


# ── grid modes ────────────────────────────────────────────────────────────────


def test_n_points_is_an_even_grid_over_the_source_range() -> None:
    r = _post(mode="n_points", n_points=9)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dataset"]["time"] == pytest.approx(np.linspace(0, 4, 9).tolist())
    assert _col(body) == pytest.approx([5.0 * k for k in range(9)])
    assert body["rows_in"] == 5 and body["rows_out"] == 9
    assert body["source_range"] == [0.0, 4.0]
    assert body["warnings"] == []
    meta = body["dataset"]["metadata"]
    assert meta["resampled"] is True and meta["resampleMode"] == "n_points"
    assert meta["resampleMethod"] == "linear"


def test_step_uses_the_matlab_colon_rule() -> None:
    body = _post(mode="step", step=1.5).json()
    # 0:1.5:4 -> 0, 1.5, 3 (4 is not landed on exactly, so it is not included).
    assert body["dataset"]["time"] == pytest.approx([0.0, 1.5, 3.0])
    assert _col(body) == pytest.approx([0.0, 15.0, 30.0])


def test_explicit_range_start_stop_step() -> None:
    body = _post(mode="range", start=0.5, stop=2.5, step=0.5).json()
    assert body["dataset"]["time"] == pytest.approx([0.5, 1.0, 1.5, 2.0, 2.5])
    assert _col(body) == pytest.approx([5.0, 10.0, 15.0, 20.0, 25.0])


def test_explicit_range_may_run_downwards() -> None:
    body = _post(mode="range", start=4, stop=0, step=-2).json()
    assert body["dataset"]["time"] == pytest.approx([4.0, 2.0, 0.0])
    assert _col(body) == pytest.approx([40.0, 20.0, 0.0])


def test_match_uses_the_other_datasets_x_and_skips_its_blank_x() -> None:
    body = _post(mode="match", match_x=[0.25, None, 3.75], match_x_unit="K").json()
    assert body["dataset"]["time"] == pytest.approx([0.25, 3.75])
    assert _col(body) == pytest.approx([2.5, 37.5])
    assert _codes(body) == ["rows-dropped"]


@pytest.mark.parametrize("method", ["linear", "pchip", "spline", "makima"])
def test_every_method_matches_the_golden_calc_function(method: str) -> None:
    """The route never touches the numerics: same answer as resample_data."""
    x = [0.0, 0.7, 1.9, 3.1, 4.0, 5.2]
    y = [1.0, 3.0, 2.0, 5.0, 4.0, 6.0]
    r = client.post(
        URL, json={"dataset": _ds(x, y), "mode": "n_points", "n_points": 11, "method": method}
    )
    ref = resample_data(
        DataStruct.create(x, np.array(y).reshape(-1, 1)), n_points=11, method=method
    )
    assert _col(r.json()) == pytest.approx(ref.values[:, 0].tolist(), rel=0, abs=1e-12)


def test_bad_grid_parameters_are_422_with_a_message() -> None:
    assert "at least 2" in _post(mode="n_points", n_points=1).json()["detail"]
    assert "positive" in _post(mode="step", step=0).json()["detail"]
    assert "never reaches" in _post(mode="range", start=0, stop=4, step=-1).json()["detail"]
    assert "more than" in _post(mode="step", step=1e-9).json()["detail"]
    assert _post(mode="bogus").status_code == 422


# ── out of range: blank or clipped, never extrapolated ────────────────────────


def test_out_of_range_points_are_blank_not_extrapolated() -> None:
    body = _post(mode="range", start=-2, stop=6, step=2).json()
    assert body["dataset"]["time"] == pytest.approx([-2.0, 0.0, 2.0, 4.0, 6.0])
    col = _col(body)
    assert col[0] is None and col[-1] is None  # NaN -> null, NOT -20 / 60
    assert col[1:4] == pytest.approx([0.0, 20.0, 40.0])
    w = next(w for w in body["warnings"] if w["code"] == "out-of-range")
    assert w["count"] == 2 and "left blank" in w["text"]


@pytest.mark.parametrize("method", ["linear", "pchip", "spline", "makima"])
def test_no_method_extrapolates(method: str) -> None:
    body = _post(mode="range", start=-1, stop=5, step=1, method=method).json()
    col = _col(body)
    assert col[0] is None and col[-1] is None


def test_clip_drops_the_out_of_range_points() -> None:
    body = _post(mode="range", start=-2, stop=6, step=2, out_of_range="clip").json()
    assert body["dataset"]["time"] == pytest.approx([0.0, 2.0, 4.0])
    assert _col(body) == pytest.approx([0.0, 20.0, 40.0])
    w = next(w for w in body["warnings"] if w["code"] == "out-of-range")
    assert w["count"] == 2 and "dropped" in w["text"]


def test_clip_with_nothing_inside_is_refused() -> None:
    r = _post(mode="range", start=10, stop=20, step=1, out_of_range="clip")
    assert r.status_code == 422 and "no target point" in r.json()["detail"]


# ── NaN inputs ────────────────────────────────────────────────────────────────


def test_blank_x_rows_are_dropped_and_reported() -> None:
    ds = _ds([0.0, None, 2.0, 4.0], [0.0, 99.0, 20.0, 40.0])
    body = client.post(URL, json={"dataset": ds, "mode": "n_points", "n_points": 5}).json()
    assert _col(body) == pytest.approx([0.0, 10.0, 20.0, 30.0, 40.0])
    w = next(w for w in body["warnings"] if w["code"] == "rows-dropped")
    assert w["count"] == 1


def test_blank_y_values_are_skipped_and_reported() -> None:
    ds = _ds([0.0, 1.0, 2.0, 3.0, 4.0], [0.0, None, 20.0, 30.0, 40.0])
    body = client.post(
        URL, json={"dataset": ds, "mode": "range", "start": 0, "stop": 4, "step": 0.5}
    ).json()
    assert _col(body)[2] == pytest.approx(10.0)  # bridged across the gap
    w = next(w for w in body["warnings"] if w["code"] == "blank-values")
    assert w["count"] == 1 and w["columns"] == ["M"]


def test_a_channel_that_stops_short_reports_its_blank_output() -> None:
    ds = _ds([0.0, 1.0, 2.0, 3.0, 4.0], [0.0, 10.0, 20.0, None, None])
    body = client.post(URL, json={"dataset": ds, "mode": "n_points", "n_points": 9}).json()
    col = _col(body)
    assert col[4] == pytest.approx(20.0) and col[5:] == [None, None, None, None]
    w = next(w for w in body["warnings"] if w["code"] == "blank-output")
    assert w["count"] == 4


def test_all_blank_x_is_refused() -> None:
    ds = _ds([None, None, 1.0], [1.0, 2.0, 3.0])
    r = client.post(URL, json={"dataset": ds, "mode": "n_points", "n_points": 5})
    assert r.status_code == 422 and "2 distinct finite x" in r.json()["detail"]


# ── non-monotonic x ───────────────────────────────────────────────────────────

LOOP = _ds([0.0, 1.0, 2.0, 1.0, 0.0], [0.0, 1.0, 2.0, 3.0, 4.0])


def test_a_direction_reversal_is_refused_by_default() -> None:
    r = client.post(URL, json={"dataset": LOOP, "mode": "n_points", "n_points": 3})
    assert r.status_code == 422
    assert "not monotonic" in r.json()["detail"] and "1 time" in r.json()["detail"]


def test_sort_opt_in_sorts_merges_and_says_so() -> None:
    body = client.post(
        URL, json={"dataset": LOOP, "mode": "n_points", "n_points": 3, "unsorted": "sort"}
    ).json()
    # Sorted: x=0 -> mean(0,4)=2, x=1 -> mean(1,3)=2, x=2 -> 2.
    assert _col(body) == pytest.approx([2.0, 2.0, 2.0])
    assert "reordered" in _codes(body) and "duplicate-x" in _codes(body)


def test_monotonic_descending_x_is_accepted_with_an_info_note() -> None:
    ds = _ds([4.0, 3.0, 2.0, 1.0, 0.0], [40.0, 30.0, 20.0, 10.0, 0.0])
    body = client.post(URL, json={"dataset": ds, "mode": "n_points", "n_points": 3}).json()
    assert _col(body) == pytest.approx([0.0, 20.0, 40.0])
    w = next(w for w in body["warnings"] if w["code"] == "reordered")
    assert w["info"] is True


def test_duplicate_x_is_averaged_and_reported() -> None:
    ds = _ds([0.0, 1.0, 1.0, 2.0], [0.0, 8.0, 12.0, 20.0])
    body = client.post(URL, json={"dataset": ds, "mode": "n_points", "n_points": 3}).json()
    assert _col(body) == pytest.approx([0.0, 10.0, 20.0])
    w = next(w for w in body["warnings"] if w["code"] == "duplicate-x")
    assert w["count"] == 1


def test_a_coincident_grid_is_an_identity_with_no_warnings() -> None:
    ds = _ds([0.0, 1.0, 1.0, 2.0], [0.0, 8.0, 12.0, 20.0])
    body = client.post(
        URL,
        json={"dataset": ds, "mode": "match", "match_x": [0.0, 1.0, 1.0, 2.0], "match_x_unit": "K"},
    ).json()
    assert _col(body) == [0.0, 8.0, 12.0, 20.0]
    assert body["warnings"] == []


# ── x unit mismatch (match mode) ──────────────────────────────────────────────


def test_matching_a_grid_in_another_x_unit_is_refused() -> None:
    r = _post(mode="match", match_x=[1.0, 2.0], match_x_unit="Oe")
    assert r.status_code == 422
    assert "X units differ" in r.json()["detail"] and "Oe" in r.json()["detail"]


def test_an_acknowledged_unit_mismatch_is_a_confirm_warning() -> None:
    body = _post(
        mode="match", match_x=[1.0, 2.0], match_x_unit="Oe", allow_unit_mismatch=True
    ).json()
    w = next(w for w in body["warnings"] if w["code"] == "unit-mismatch")
    assert w["confirm"] is True
    assert _col(body) == pytest.approx([10.0, 20.0])


def test_an_unrecorded_unit_is_not_a_mismatch() -> None:
    body = _post(mode="match", match_x=[1.0, 2.0], match_x_unit="").json()
    assert "unit-mismatch" not in _codes(body)


# ── what the calc layer already refuses still reaches the user ────────────────


def test_categorical_channel_on_a_new_grid_is_a_422() -> None:
    ds = {**LINE, "values": [[0.0], [1.0], [0.0], [1.0], [0.0]], "cat_levels": {"0": ["a", "b"]}}
    r = client.post(URL, json={"dataset": ds, "mode": "n_points", "n_points": 9})
    assert r.status_code == 422 and "categorical" in r.json()["detail"]


def test_row_sidecars_are_dropped_on_a_new_grid() -> None:
    ds = {**LINE, "metadata": {"x_column_unit": "K", "row_notes": ["a", "b", "c", "d", "e"]}}
    body = client.post(URL, json={"dataset": ds, "mode": "n_points", "n_points": 3}).json()
    assert body["dataset"]["metadata"].get("x_column_unit") == "K"
    assert not math.isnan(body["source_range"][0])
