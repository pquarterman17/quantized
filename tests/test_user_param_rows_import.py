"""The importer shape the worksheet's user-parameter rows read.

``frontend/src/lib/userParams.ts`` treats a ``metadata.label_rows`` entry with
``role == "label"`` and a caption in its ``x`` cell as a user parameter (an
extra descriptive row above the data, e.g. ``Sample,S1,S2,S3``). The header
and units rows layout detection consumed are NOT parameters, and a numeric
descriptive row cannot be told from data, so it is never promoted. Pin that
contract here so a parser change cannot silently drop or invent parameters.
"""

from __future__ import annotations

from pathlib import Path

from quantized.io.registry import import_auto


def test_extra_descriptive_text_row_is_a_labelled_parameter_row(tmp_path: Path) -> None:
    path = tmp_path / "params.csv"
    path.write_text(
        "Sample,S1,S2,S3\nOperator,Ann,Bob,Cy\nTime,V1,V2,V3\n1,0.1,0.2,0.3\n2,0.4,0.5,0.6\n3,0.7,0.8,0.9\n"
    )
    rows = import_auto(path).metadata["label_rows"]
    params = [r for r in rows if r["role"] == "label" and r["x"]]
    assert [(r["x"], r["cells"]) for r in params] == [("Sample", ["S1", "S2", "S3"])]
    # the rows detection consumed as header / units are never parameters
    assert {r["role"] for r in rows if r["x"] in ("Operator", "Time")} == {"header", "units"}


def test_numeric_row_above_the_data_is_data_not_a_parameter(tmp_path: Path) -> None:
    path = tmp_path / "numeric.csv"
    path.write_text("Sample,S1,S2,S3\nTemperature,10,20,30\nTime,V1,V2,V3\n1,0.1,0.2,0.3\n2,0.4,0.5,0.6\n")
    meta = import_auto(path).metadata
    rows = meta.get("label_rows", [])
    assert not [r for r in rows if r["role"] == "label" and r["x"] == "Temperature"]


def test_title_and_second_header_rows_have_the_shapes_the_frontend_refuses(tmp_path: Path) -> None:
    """``userParams.ts`` must not promote these: a title/date row has no value cells,
    and a short-name row above the long names is a second header (see
    ``frontend/src/lib/userParams.test.ts`` for the matching cases)."""
    title = tmp_path / "title.csv"
    title.write_text("Hysteresis loop sample A\nField (Oe),Moment (emu)\n1,2\n3,4\n5,6\n")
    rows = import_auto(title).metadata["label_rows"]
    assert rows[0] == {"index": 0, "role": "label", "x": "Hysteresis loop sample A", "cells": [""]}

    two = tmp_path / "two.csv"
    two.write_text("H,M1,M2\nApplied field,Moment 1,Moment 2\nOe,emu,emu\n1,2,3\n4,5,6\n7,8,9\n")
    rows = import_auto(two).metadata["label_rows"]
    assert rows[0]["role"] == "label" and rows[0]["x"] == "H" and rows[0]["cells"] == ["M1", "M2"]
