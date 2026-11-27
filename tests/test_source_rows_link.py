"""A subset's link to its source rows (``__quantized_source_rows``, ROW_RANGE_CONTRACT 4, R3).

The key is private to the project file: backend row operations slice or drop it with the rows
(the frontend's ``sliceRowSidecars`` is the model), and no export writes it.
"""

from __future__ import annotations

import json
from pathlib import Path

from quantized.datastruct import DataStruct
from quantized.io.convert_containers import write_json
from quantized.io.convert_meta import flatten_metadata, public_metadata
from quantized.row_sidecars import SOURCE_ROWS_KEY, drop_row_sidecars, slice_row_sidecars

LINK = {"source": "d1", "rows": {"0": "r1:aaaa11", "1": "r1:bbbb22", "3": "r1:cccc33"}}


def test_slicing_renumbers_the_links_of_the_kept_rows() -> None:
    out = slice_row_sidecars({SOURCE_ROWS_KEY: LINK, "other": 1}, [3, 0, 2])
    kept = {"0": "r1:cccc33", "1": "r1:aaaa11"}  # row 2 had no link
    assert out[SOURCE_ROWS_KEY] == {"source": "d1", "rows": kept}
    assert out["other"] == 1


def test_a_link_left_with_no_row_is_dropped_and_the_input_is_untouched() -> None:
    assert SOURCE_ROWS_KEY not in slice_row_sidecars({SOURCE_ROWS_KEY: LINK}, [2])
    assert LINK["rows"]["0"] == "r1:aaaa11"


def test_a_malformed_link_reads_as_none() -> None:
    for bad in ("x", {"source": "d1"}, {"rows": []}, None):
        assert SOURCE_ROWS_KEY not in slice_row_sidecars({SOURCE_ROWS_KEY: bad}, [0, 1])


def test_dropping_removes_the_link() -> None:
    assert SOURCE_ROWS_KEY not in drop_row_sidecars({SOURCE_ROWS_KEY: LINK})


def test_no_export_reaches_the_key(tmp_path: Path) -> None:
    meta = {SOURCE_ROWS_KEY: LINK, "sample": "Si"}
    assert SOURCE_ROWS_KEY not in public_metadata(meta)
    rows, _ = flatten_metadata(meta)
    assert all(SOURCE_ROWS_KEY not in key and "r1:aaaa11" not in value for key, value in rows)
    data = DataStruct.create([1.0, 2.0], [[1.0], [2.0]], labels=["a"], units=[""], metadata=meta)
    path = tmp_path / "out.json"
    write_json(path, [("d", data)])
    raw = path.read_bytes()
    assert b"__quantized_source_rows" not in raw and b"r1:aaaa11" not in raw
    assert json.loads(raw)["datasets"][0]["metadata"]["sample"] == "Si"
