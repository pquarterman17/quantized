"""Reading a ``.dwk`` headless (gap audit 5 #6, ``io/workspace_dwk_read``):
every version the app reads, its frozen fixtures, the BUG-017 cell wire form,
the version gate (a newer file is refused, never half-read) and what is kept
around the data."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

import numpy as np
import pytest

import quantized.api as qz
from quantized.desktop_project_file import WORKSPACE_VERSIONS
from quantized.io.workspace_dwk import datasets_workspace_json
from quantized.io.workspace_dwk_read import WorkspaceVersionError, parse_workspace

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "frontend" / "src" / "lib" / "__fixtures__"


def _doc(**over: Any) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [
            {
                "id": "a",
                "name": "run.csv",
                "data": {
                    "time": [0, 1, 2, "-0"],
                    "values": [[1, "NaN"], [2, "Infinity"], [3, "-Infinity"], [4, 5]],
                    "labels": ["m", "e"],
                    "units": ["emu", "emu"],
                    "metadata": {"source_format": "csv"},
                },
                "folderId": "f2",
                "source": {"kind": "path", "path": "/data/run.csv"},
                "formulas": [{"name": "e", "expr": "A * 2", "deps": ["A"]}],
                "corrections": {"yOff": 1},
                "notes": "first run",
                "tags": ["cal", " "],
                "someFutureField": {"ignored": True},
            }
        ],
        "folders": [
            {"id": "f1", "name": "Project", "parentId": None},
            {"id": "f2", "name": "Loops", "parentId": "f1"},
        ],
        "activeId": "a",
        "pipeline": [{"kind": "fit", "label": "Fit", "code": "", "params": {"model": "Linear"}}],
        "unknownTopLevel": [1, 2],
    }
    doc.update(over)
    return doc


def test_reads_data_cells_and_the_project_facts() -> None:
    ws = parse_workspace(json.dumps(_doc()))
    d = ws.dataset("run.csv")
    assert ws.version == 4 and ws.active is d and ws.warnings == ()
    np.testing.assert_array_equal(d.data.values[:, 1], [math.nan, math.inf, -math.inf, 5.0])
    assert math.copysign(1.0, d.data.time[3]) < 0  # "-0" keeps its sign
    assert d.data.labels == ("m", "e") and d.data.metadata["source_format"] == "csv"
    assert d.folder_path == ("Project", "Loops")
    assert d.source_path == "/data/run.csv"
    assert d.formulas[0]["expr"] == "A * 2" and d.corrections == {"yOff": 1}
    assert d.notes == "first run" and d.tags == ("cal",) and not d.sampled
    assert ws.pipeline[0]["params"] == {"model": "Linear"}
    assert ws.dataset("a") is d


def test_a_newer_version_is_refused_by_name() -> None:
    newest = max(WORKSPACE_VERSIONS)
    with pytest.raises(WorkspaceVersionError, match=f"version {newest + 1}, written by a newer"):
        parse_workspace(json.dumps(_doc(version=newest + 1)))
    for bad in (0, "4", True, None):
        with pytest.raises(WorkspaceVersionError):
            parse_workspace(json.dumps(_doc(version=bad)))


def test_the_version_gate_is_the_apps() -> None:
    """The set accepted here (the backend's write gate) is exactly the one
    ``lib/workspace.ts`` ``parseWorkspace`` opens."""
    src = (ROOT / "frontend" / "src" / "lib" / "workspace.ts").read_text(encoding="utf-8")
    gate = re.search(r"if \((o\.version !== \d+(?: && o\.version !== \d+)*)\)", src)
    assert gate, "parseWorkspace's version gate moved"
    assert {int(v) for v in re.findall(r"\d+", gate.group(1))} == set(WORKSPACE_VERSIONS)


@pytest.mark.parametrize(
    "cell", [True, "text", "nan", {"v": 1}, [1]], ids=["bool", "text", "lower-nan", "obj", "list"]
)
def test_a_non_numeric_cell_refuses_the_file_naming_the_dataset(cell: Any) -> None:
    doc = _doc()
    doc["datasets"][0]["data"]["values"][0][0] = cell
    with pytest.raises(ValueError, match=r'dataset 0 \("run.csv"\)'):
        parse_workspace(json.dumps(doc))


def test_ragged_rows_or_missing_fields_refuse_the_file() -> None:
    doc = _doc()
    doc["datasets"][0]["data"]["values"][1] = [2]
    with pytest.raises(ValueError, match="different sizes"):
        parse_workspace(json.dumps(doc))
    doc = _doc()
    del doc["datasets"][0]["data"]["metadata"]
    with pytest.raises(ValueError, match="metadata"):
        parse_workspace(json.dumps(doc))
    for text in ("{", "[]", json.dumps({"format": "other", "version": 1})):
        with pytest.raises(ValueError):
            parse_workspace(text)


def test_legacy_null_cells_read_as_missing_with_one_warning() -> None:
    ws = parse_workspace((FIX / "workspace" / "legacy-null-cells.dwk.json").read_text("utf-8"))
    assert len(ws.warnings) == 1 and "read as missing" in ws.warnings[0]
    assert np.isnan(ws.datasets[0].data.values).any()


@pytest.mark.parametrize("name", ["v1", "v2", "v3", "v4", "v4-0.34.0", "v8-window-layout"])
def test_every_frozen_app_fixture_reads(name: str) -> None:
    raw = json.loads((FIX / "workspace" / f"{name}.dwk.json").read_text("utf-8"))
    ws = parse_workspace(json.dumps(raw))
    assert [d.name for d in ws.datasets] == [d["name"] for d in raw["datasets"]]
    for d, r in zip(ws.datasets, raw["datasets"], strict=True):
        assert d.data.n_points == len(r["data"]["time"])
        assert list(d.data.labels) == r["data"]["labels"]


def test_the_converted_origin_project_reads() -> None:
    ws = qz.read_workspace(FIX / "convertedWorkspace.dwk")
    assert ws.datasets and ws.datasets[0].name.startswith("loops:")


def test_a_preview_only_dataset_is_flagged_sampled() -> None:
    doc = _doc()
    doc["datasets"][0]["pending"] = {"kind": "path", "path": "/x.csv", "bookId": "b1"}
    ws = parse_workspace(json.dumps(doc))
    assert ws.datasets[0].sampled and "preview sample" in ws.warnings[0]
    doc["datasets"][0]["pending"]["previewSampled"] = False
    assert not parse_workspace(json.dumps(doc)).datasets[0].sampled


def test_a_packed_source_resolves_against_the_project_folder(tmp_path: Path) -> None:
    doc = _doc()
    doc["datasets"][0]["source"] = {"kind": "bundle", "path": "sources/run.csv"}
    (tmp_path / "p.dwk").write_text(json.dumps(doc), encoding="utf-8")
    d = qz.read_workspace(tmp_path / "p.dwk").datasets[0]
    assert d.source_path is not None and Path(d.source_path) == tmp_path / "sources" / "run.csv"
    doc["datasets"][0]["source"] = {"kind": "bundle", "path": "sources/../../escape.csv"}
    assert parse_workspace(json.dumps(doc), base_dir=tmp_path).datasets[0].source_path is None
    assert (
        parse_workspace(json.dumps(_doc(datasets=doc["datasets"]))).datasets[0].source_path is None
    )


def test_a_damaged_level_table_keeps_the_numbers_and_warns() -> None:
    doc = _doc()
    doc["datasets"][0]["data"]["cat_levels"] = {"7": ["a"]}
    ws = parse_workspace(json.dumps(doc))
    assert ws.datasets[0].data.cat_levels is None and "level table" in ws.warnings[0]


def test_round_trip_through_the_headless_writer(tmp_path: Path) -> None:
    ds = qz.DataStruct.create(
        [0.0, -0.0, 2.0], [[1.0, math.nan], [math.inf, 2.0], [3.0, -math.inf]], labels=["a", "b"]
    )
    text = datasets_workspace_json([("one", ds), ("two", ds)], sources=["/in/one.csv", None])
    ws = parse_workspace(text)
    assert [d.name for d in ws.datasets] == ["one", "two"] and ws.active_id == "ds-1"
    np.testing.assert_array_equal(ws.datasets[1].data.values, ds.values)
    assert ws.datasets[0].source_path == "/in/one.csv" and ws.datasets[1].source_path is None


def test_ambiguous_or_missing_names_raise_key_error() -> None:
    doc = _doc()
    doc["datasets"].append({**doc["datasets"][0], "id": "b"})
    ws = parse_workspace(json.dumps(doc))
    with pytest.raises(KeyError, match="2 datasets"):
        ws.dataset("run.csv")
    with pytest.raises(KeyError, match="no dataset"):
        ws.dataset("nope")
