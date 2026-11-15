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
