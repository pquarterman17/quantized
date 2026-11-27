"""Every route that receives a dataset is driven with one that carries a cell note (plan item 34).

The notes sidecar (``__quantized_cell_notes``) is private to the project file; only the ``.xlsx``
worksheet export writes it (as cell comments, covered in ``test_cell_notes_export.py``). R6 proved
the writers and the export routes. This sweep closes the other half: every POST route whose body
carries a dataset, using the bodies ``test_routes_malformed_dataset.CASES`` keeps valid for each.
That module's completeness test fails when a dataset route is missing from ``CASES``, so a new
route is covered here the day it is added.

What is pinned, per route:

* a note never changes the route's status (it is metadata, not input);
* a file (PDF, SVG, zip, CSV, HDF5, OPJ) holds neither the key nor the note text;
* a JSON result holds neither, UNLESS the route hands the dataset back to the app (the allow-list
  below), and then every note it returns still sits on a cell the returned dataset has.

Three routes are driven with a bigger dataset to show where notes go: a trim and a keep-every-nth
carry each note onto the row it described, and a resample (the rows are replaced) returns none.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

import test_routes_malformed_dataset as sweep
from quantized.row_sidecars import CELL_NOTES_KEY

KEY = CELL_NOTES_KEY.encode()
NOTE = "ZZNOTE-sentinel-7731"

# Routes that return the dataset (or a derived one) to the app, so the sidecar may travel back in
# the JSON. For
# each, the notes must still describe cells that exist. Everything else must not mention the key
# at all.
RETURNS_THE_DATASET = {
    "/api/corrections/apply",
    "/api/transform/sigop",
    "/api/sims/process",
    "/api/map-ops/apply",
    "/api/map-ops/formula",
}


def _with_note(good: dict[str, Any]) -> dict[str, Any]:
    ds = json.loads(json.dumps(good))
    last = len(ds["time"]) - 1
    ds["metadata"] = {
        **ds.get("metadata", {}),
        CELL_NOTES_KEY: {"0": {"1": NOTE}, "-1": {str(last): NOTE + "-x"}},
    }
    return ds


def _datasets_in(node: Any) -> list[dict[str, Any]]:
    """Every dict in a JSON result that looks like a dataset (has time, values and metadata)."""
    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        if {"time", "values", "metadata"} <= node.keys():
            found.append(node)
        for v in node.values():
            found += _datasets_in(v)
    elif isinstance(node, list):
        for v in node:
            found += _datasets_in(v)
    return found


def _assert_notes_land_on_cells(ds: dict[str, Any]) -> None:
    notes = ds["metadata"].get(CELL_NOTES_KEY)
    if not notes:
        return
    rows = len(ds["time"])
    width = len(ds["labels"])
    for col, cells in notes.items():
        assert -1 <= int(col) < width, (col, width)
        for row, text in cells.items():
            assert 0 <= int(row) < rows, (row, rows)
            assert isinstance(text, str) and text


@pytest.mark.parametrize(("path", "body", "good"), sweep.CASES, ids=[c[0] for c in sweep.CASES])
def test_a_note_never_changes_a_route_and_never_leaks(
    path: str, body: Any, good: dict[str, Any]
) -> None:
    plain = sweep.client.post(path, json=body(good))
    noted = sweep.client.post(path, json=body(_with_note(good)))
    assert noted.status_code == plain.status_code == 200, (noted.text[:300], plain.text[:300])
    content = noted.content
    if path in RETURNS_THE_DATASET:
        for ds in _datasets_in(noted.json()):
            _assert_notes_land_on_cells(ds)
        return
    assert KEY not in content, f"{path} echoed the private notes key"
    assert NOTE.encode() not in content, f"{path} echoed a note's text"


def test_a_note_does_not_leak_into_a_figure_that_prints_text() -> None:
    """A PDF compresses its text, so the sweep above cannot see inside one: the same figure as SVG
    can be searched."""
    ds = _with_note(sweep.GOOD_DATASET)
    for fmt in ("svg",):
        r = sweep.client.post("/api/export/figure", json={"dataset": ds, "y_keys": [1], "fmt": fmt})
        assert r.status_code == 200, r.text[:200]
        assert b"<svg" in r.content
        assert KEY not in r.content
        assert NOTE.encode() not in r.content


def test_the_allow_list_names_only_routes_the_sweep_covers() -> None:
    assert RETURNS_THE_DATASET <= {c[0] for c in sweep.CASES}


def _trim_body(ds: dict[str, Any]) -> dict[str, Any]:
    return {"dataset": ds, "params": {"xTrimMin": 3.0}}


def _six_rows() -> dict[str, Any]:
    return {
        "time": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
        "values": [[10.0, 1.0], [20.0, 2.0], [30.0, 3.0], [40.0, 4.0], [50.0, 5.0], [60.0, 6.0]],
        "labels": ["a", "b"],
        "units": ["", ""],
        "metadata": {
            CELL_NOTES_KEY: {
                "0": {"0": "gone", "2": "kept-a", "5": "kept-b"},
                "-1": {"3": "kept-x"},
            },
        },
    }


def test_corrections_trim_route_renumbers_each_note_onto_its_row() -> None:
    r = sweep.client.post("/api/corrections/apply", json=_trim_body(_six_rows()))
    assert r.status_code == 200, r.text[:300]
    out = r.json()
    assert out["time"] == [3.0, 4.0, 5.0, 6.0]  # rows 2..5 survive
    # source row 2 -> 0, 5 -> 3 in column 0; the note on row 0 was trimmed away; x column row 3 -> 1
    assert out["metadata"][CELL_NOTES_KEY] == {
        "0": {"0": "kept-a", "3": "kept-b"},
        "-1": {"1": "kept-x"},
    }


def test_keep_every_nth_route_keeps_the_notes_of_the_kept_rows() -> None:
    r = sweep.client.post(
        "/api/transform/sigop",
        json={"dataset": _six_rows(), "method": "reduce-nth", "channels": [0], "args": {"n": 2}},
    )
    assert r.status_code == 200, r.text[:300]
    out = r.json()["dataset"]
    assert out["time"] == [1.0, 3.0, 5.0]  # source rows 0, 2, 4
    # source row 0 -> 0 ("gone" is on a kept row), row 2 -> 1; row 5 is not kept; the x note on
    # row 3 is not kept
    assert out["metadata"][CELL_NOTES_KEY] == {"0": {"0": "gone", "1": "kept-a"}}


def test_routes_that_replace_the_rows_return_no_notes() -> None:
    """Resampling puts the values on a new grid: no output row IS an input row, so a note has
    nowhere to go."""
    r = sweep.client.post(
        "/api/transform/resample",
        json={"dataset": _six_rows(), "mode": "n_points", "n_points": 4},
    )
    assert r.status_code == 200, r.text[:300]
    assert CELL_NOTES_KEY not in r.json()["dataset"]["metadata"]
    assert KEY not in r.content
