"""The quick converter's writers and owner policies (io/convert_*.py).

Round trip each writer back with the library that reads it (h5py, scipy, json,
numpy, openpyxl), then the owner policies: containers one file / flat formats
one file per dataset, a 2-D map to a flat format is a lossless long table and
keeps its 2-D shape in containers, metadata where the owner put it. Inputs are
committed fixtures or built here; nothing is read from the private corpus.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import h5py
import numpy as np
import pytest
from openpyxl import load_workbook
from scipy.io import loadmat

from quantized.datastruct import DataStruct
from quantized.io import import_auto
from quantized.io.convert_data import convert_data_file
from quantized.io.convert_plan import plan_outputs

FIX = Path(__file__).parent / "fixtures"
RSM = FIX / "xrdml_rsm_synthetic.xrdml"
SCAN = FIX / "xrdml_la2nio4.xrdml"
ALL = ("csv", "xlsx", "xy", "h5", "nxs", "mat", "json", "npz")


def _convert(src: Path, fmt: str, tmp: Path, **kw: Any) -> tuple[dict[str, Any], Path]:
    out = tmp / "out"
    report = convert_data_file(src, out, fmt, **kw)
    assert report["status"] == "ok", report
    return report, out / report["outputs"][0]


def _src_copy(src: Path, tmp: Path) -> Path:
    """The fixture copied beside the outputs, so a run never writes next to the repo."""
    dst = tmp / "in" / src.name
    dst.parent.mkdir(exist_ok=True)
    dst.write_bytes(src.read_bytes())
    return dst


@pytest.fixture
def scan(tmp_path: Path) -> DataStruct:
    from quantized.io import import_auto as load

    return load(_src_copy(SCAN, tmp_path))


@pytest.fixture
def rsm(tmp_path: Path) -> DataStruct:
    return import_auto(_src_copy(RSM, tmp_path))


# ── 1-D scan: every writer round-trips ──────────────────────────────────────


def test_xy_is_whitespace_x_y_with_a_hash_metadata_header(tmp_path: Path, scan: DataStruct) -> None:
    _, path = _convert(_src_copy(SCAN, tmp_path), "xy", tmp_path)
    lines = path.read_text(encoding="utf-8").splitlines()
    head = [ln for ln in lines if ln.startswith("#")]
    body = [ln for ln in lines if not ln.startswith("#")]
    assert any(ln.startswith("# parser_name: import_xrdml") for ln in head)
    assert "# column 1: 2-Theta [deg]" in head and "# column 2: Intensity [cps]" in head
    data = np.loadtxt(body)
    assert data.shape == (scan.n_points, 2)
    np.testing.assert_array_equal(data[:, 0], scan.time)  # repr round trip: bit-exact
    np.testing.assert_array_equal(data[:, 1], scan.values[:, 0])


def test_csv_has_hash_header_then_names_and_units(tmp_path: Path, scan: DataStruct) -> None:
    _, path = _convert(_src_copy(SCAN, tmp_path), "csv", tmp_path)
    lines = path.read_text(encoding="utf-8").splitlines()
    assert lines[0].startswith("# quantized-convert: dataset=")
    first = next(i for i, ln in enumerate(lines) if not ln.startswith("#"))
    assert lines[first] == "2-Theta,Intensity" and lines[first + 1] == "deg,cps"
    back = import_auto(path)
    np.testing.assert_array_equal(back.time, scan.time)
    np.testing.assert_array_equal(back.values, scan.values)


def test_no_metadata_option_drops_the_flat_header(tmp_path: Path) -> None:
    _, path = _convert(_src_copy(SCAN, tmp_path), "csv", tmp_path, metadata=False)
    assert not any(
        ln.startswith("# ") and "parser_name" in ln for ln in path.read_text().splitlines()
    )


@pytest.mark.parametrize("fmt", ["h5", "nxs"])
def test_nexus_layout_is_plottable_and_carries_metadata(
    fmt: str, tmp_path: Path, scan: DataStruct
) -> None:
    _, path = _convert(_src_copy(SCAN, tmp_path), fmt, tmp_path)
    with h5py.File(path) as f:
        entry = f[f.attrs["default"]]
        assert entry.attrs["NX_class"] == "NXentry" and entry.attrs["default"] == "data"
        data = entry["data"]
        # NIAC2014 minimal plottable NXdata: signal + axes + <axis>_indices.
        assert data.attrs["NX_class"] == "NXdata"
        sig, axes = data.attrs["signal"], list(data.attrs["axes"])
        assert sig == "Intensity" and axes == ["2-Theta"]
        assert data.attrs["2-Theta_indices"] == 0
        np.testing.assert_array_equal(data[sig][()], scan.values[:, 0])
        np.testing.assert_array_equal(data[axes[0]][()], scan.time)
        assert data[sig].attrs["units"] == "cps" and data[axes[0]].attrs["units"] == "deg"
        assert entry["metadata"].attrs["parser_name"] == "import_xrdml"
    back = import_auto(path)  # the app's own NeXus reader plots it too
    np.testing.assert_array_equal(back.time, scan.time)


def test_mat_is_a_struct_with_the_five_fields(tmp_path: Path, scan: DataStruct) -> None:
    _, path = _convert(_src_copy(SCAN, tmp_path), "mat", tmp_path)
    m = loadmat(path, squeeze_me=True, struct_as_record=False)
    s = m["Sheet1"]
    for field in ("time", "values", "labels", "units", "metadata"):
        assert field in s._fieldnames
    np.testing.assert_array_equal(s.time, scan.time)
    np.testing.assert_array_equal(np.asarray(s.values).reshape(-1), scan.values[:, 0])
    assert list(np.atleast_1d(s.labels)) == ["Intensity"]
    assert list(np.atleast_1d(s.units)) == ["cps"]
    assert s.metadata.parser_name == "import_xrdml"


def test_json_has_data_and_full_metadata(tmp_path: Path, scan: DataStruct) -> None:
    _, path = _convert(_src_copy(SCAN, tmp_path), "json", tmp_path)
    doc = json.loads(path.read_text(encoding="utf-8"))  # strict JSON: no bare NaN
    ds = doc["datasets"][0]
    assert ds["labels"] == ["Intensity"] and ds["units"] == ["cps"]
    np.testing.assert_array_equal(ds["time"], scan.time)
    assert ds["metadata"]["parser_name"] == "import_xrdml"
    assert set(ds["metadata"]) == set(scan.metadata)  # nothing dropped


def test_npz_loads_without_pickle(tmp_path: Path, scan: DataStruct) -> None:
    _, path = _convert(_src_copy(SCAN, tmp_path), "npz", tmp_path)
    z = np.load(path, allow_pickle=False)
    np.testing.assert_array_equal(z["Sheet1__time"], scan.time)
    np.testing.assert_array_equal(z["Sheet1__values"], scan.values)
    assert list(z["Sheet1__labels"]) == ["Intensity"] and list(z["__datasets__"]) == ["Sheet1"]
    assert json.loads(str(z["Sheet1__metadata"]))["parser_name"] == "import_xrdml"


def test_xlsx_has_a_data_tab_and_a_metadata_sheet(tmp_path: Path, scan: DataStruct) -> None:
    _, path = _convert(_src_copy(SCAN, tmp_path), "xlsx", tmp_path)
    wb = load_workbook(path)
    assert wb.sheetnames == ["Sheet1", "metadata"]
    meta = {r[1]: r[2] for r in wb["metadata"].iter_rows(min_row=2, values_only=True)}
    assert meta["parser_name"] == "import_xrdml"
    assert [c.value for c in wb["metadata"][1]] == ["dataset", "key", "value"]
    # Excel stores doubles to 15-17 digits: equal to a few ulp, not bit-exact
    np.testing.assert_allclose(import_auto(path).time, scan.time, rtol=1e-14)


# ── 2-D maps: long table flat, 2-D shape in containers ──────────────────────


def test_rsm_to_csv_is_a_lossless_long_table(tmp_path: Path, rsm: DataStruct) -> None:
    _, path = _convert(_src_copy(RSM, tmp_path), "csv", tmp_path)
    lines = [ln for ln in path.read_text().splitlines() if not ln.startswith("#")]
    assert lines[0].split(",") == ["2Theta", "Omega", "Intensity", "Qx", "Qz"]  # no duplicate x
    assert lines[1].split(",") == ["deg", "deg", "cps", "Ang^-1", "Ang^-1"]
    rows = np.array([[float(v) for v in ln.split(",")] for ln in lines[2:]])
    assert rows.shape == (rsm.n_points, 5)  # one row per point
    np.testing.assert_array_equal(rows, rsm.values)


def test_rsm_to_xy_is_the_same_long_table(tmp_path: Path, rsm: DataStruct) -> None:
    _, path = _convert(_src_copy(RSM, tmp_path), "xy", tmp_path)
    body = [ln for ln in path.read_text().splitlines() if not ln.startswith("#")]
    np.testing.assert_array_equal(np.loadtxt(body), rsm.values)


@pytest.mark.parametrize("fmt", ["h5", "nxs"])
def test_rsm_h5_keeps_the_2d_shape_as_nxdata(fmt: str, tmp_path: Path, rsm: DataStruct) -> None:
    _, path = _convert(_src_copy(RSM, tmp_path), fmt, tmp_path)
    nf, mp = rsm.metadata["map_shape"]
    with h5py.File(path) as f:
        data = f[f.attrs["default"]]["data"]
        assert data.attrs["signal"] == "Intensity"
        assert data["Intensity"].shape == (nf, mp)
        axes = list(data.attrs["axes"])
        assert axes == ["Omega", "2Theta"]  # frame-wise, then pixel-wise
        assert data["Omega"].shape == (nf,) and data["2Theta"].shape == (mp,)
        assert data.attrs["Omega_indices"] == 0 and data.attrs["2Theta_indices"] == 1
        grid = {k: data[k][()] for k in ("Intensity", "Qx", "Qz")}
        for k, arr in grid.items():
            np.testing.assert_array_equal(arr.reshape(-1), rsm.values[:, rsm.labels.index(k)])
        # the axes broadcast back to the point cloud: nothing lost
        np.testing.assert_array_equal(
            np.broadcast_to(data["2Theta"][()], (nf, mp)).reshape(-1), rsm.values[:, 0]
        )
        np.testing.assert_array_equal(
            np.broadcast_to(data["Omega"][()][:, None], (nf, mp)).reshape(-1), rsm.values[:, 1]
        )
    back = import_auto(path)  # the app's reader sees a map over those axes
    assert back.metadata["map_shape"] == [nf, mp]


def test_rsm_mat_json_npz_xlsx_keep_the_grid(tmp_path: Path, rsm: DataStruct) -> None:
    nf, mp = rsm.metadata["map_shape"]
    inten = rsm.values[:, 2].reshape(nf, mp)
    _, mat = _convert(_src_copy(RSM, tmp_path), "mat", tmp_path)
    s = loadmat(mat, squeeze_me=True, struct_as_record=False)["Sheet1"]
    np.testing.assert_array_equal(s.grid.Intensity, inten)
    _, js = _convert(_src_copy(RSM, tmp_path), "json", tmp_path / "j")
    doc = json.loads(js.read_text(encoding="utf-8"))
    np.testing.assert_array_equal(doc["datasets"][0]["grid"]["Intensity"], inten)
    _, npz = _convert(_src_copy(RSM, tmp_path), "npz", tmp_path / "n")
    np.testing.assert_array_equal(np.load(npz)["Sheet1__grid__Intensity"], inten)
    _, xl = _convert(_src_copy(RSM, tmp_path), "xlsx", tmp_path / "x")
    wb = load_workbook(xl)
    assert wb.sheetnames == ["Sheet1", "Sheet1 grid", "metadata"]
    grid = np.array(
        [[c for c in r] for r in wb["Sheet1 grid"].iter_rows(min_row=2, values_only=True)], float
    )  # a header row (pixel numbers), then the matrix: a row per frame
    np.testing.assert_array_equal(grid, inten)


# ── multi-dataset policy ────────────────────────────────────────────────────


def _two(tmp: Path) -> Path:
    """A two-sheet workbook input."""
    from openpyxl import Workbook

    wb = Workbook()
    a = wb.active
    a.title = "Alpha"
    a.append(["t", "v"])
    for i in range(4):
        a.append([float(i), float(i * i)])
    b = wb.create_sheet("Beta")
    b.append(["t", "w"])
    for i in range(3):
        b.append([float(i), -float(i)])
    path = tmp / "two.xlsx"
    wb.save(path)
    return path


def test_plan_outputs_is_containers_one_file_flat_one_per_dataset() -> None:
    for fmt in ("xlsx", "h5", "nxs", "mat", "json", "npz"):
        assert plan_outputs("s", fmt, ["A", "B"]) == [(f"s.{fmt}", [0, 1])]
    assert plan_outputs("s", "csv", ["A", "B"]) == [("s__A.csv", [0]), ("s__B.csv", [1])]
    assert plan_outputs("s", "xy", ["A", "A"]) == [("s__A.xy", [0]), ("s__A~2.xy", [1])]
    assert plan_outputs("s", "csv", ["only"]) == [("s.csv", [0])]


@pytest.mark.parametrize("fmt", ["xlsx", "h5", "nxs", "mat", "json", "npz"])
def test_container_formats_hold_every_dataset_in_one_file(fmt: str, tmp_path: Path) -> None:
    src = _two(tmp_path)
    report = convert_data_file(src, tmp_path / "o", fmt)
    assert report["status"] == "ok" and report["outputs"] == [f"two.xlsx.{fmt}"]
    path = tmp_path / "o" / report["outputs"][0]
    if fmt == "xlsx":
        assert load_workbook(path).sheetnames == ["Alpha", "Beta", "metadata"]
    elif fmt in ("h5", "nxs"):
        with h5py.File(path) as f:
            assert sorted(k for k in f if isinstance(f[k], h5py.Group)) == ["Alpha", "Beta"]
            assert f["Beta/data"][f["Beta/data"].attrs["signal"]].shape == (3,)
    elif fmt == "mat":
        m = loadmat(path, squeeze_me=True, struct_as_record=False)
        assert m["Alpha"].values.shape == (4,) and m["Beta"].values.shape == (3,)
    elif fmt == "json":
        doc = json.loads(path.read_text(encoding="utf-8"))
        assert [d["name"] for d in doc["datasets"]] == ["Alpha", "Beta"]
    else:
        z = np.load(path)
        assert list(z["__datasets__"]) == ["Alpha", "Beta"] and len(z["Beta__time"]) == 3


@pytest.mark.parametrize("fmt", ["csv", "xy"])
def test_flat_formats_write_one_file_per_dataset(fmt: str, tmp_path: Path) -> None:
    report = convert_data_file(_two(tmp_path), tmp_path / "o", fmt)
    assert report["outputs"] == [f"two.xlsx__Alpha.{fmt}", f"two.xlsx__Beta.{fmt}"]
    assert [b["output"] for b in report["books"]] == report["outputs"]


def test_categorical_channel_survives_every_writer(tmp_path: Path) -> None:
    from quantized.io import convert_containers as cc
    from quantized.io.convert_flat import format_csv, format_xy

    ds = DataStruct.create(
        [0.0, 1.0, 2.0], [[0.0], [1.0], [0.0]], labels=["phase"], units=[""],
        metadata={"x_column_name": "t"}, cat_levels={0: ("low T", "high T")},
    )  # fmt: skip
    assert "low T" in format_csv(ds, "d").decode() and "high T" in format_csv(ds, "d").decode()
    assert "# column 1 levels (value = index): low T|high T" in format_xy(ds, "d").decode().replace(
        "# column 2", "# column 1"
    )
    cc.write_h5(tmp_path / "c.h5", [("d", ds)])
    with h5py.File(tmp_path / "c.h5") as f:
        assert list(f["d/data/phase"].attrs["levels"]) == ["low T", "high T"]
    cc.write_json(tmp_path / "c.json", [("d", ds)])
    assert json.loads((tmp_path / "c.json").read_text())["datasets"][0]["cat_levels"] == {
        "0": ["low T", "high T"]
    }


def test_non_finite_and_odd_metadata_round_trip(tmp_path: Path) -> None:
    from quantized.io import convert_containers as cc

    meta = {
        "nested": {"a": 1, "b": [1.5, 2.5], "c": None, "d": "x"},
        "flag": True, "tags": ["p", "q"], "when": np.float64("nan"), "weird": {1, 2},
        "bad key/with*chars": 3,
    }  # fmt: skip
    ds = DataStruct.create(
        [0.0, 1.0, 2.0], [[np.nan], [np.inf], [-np.inf]], labels=["y"], units=["u"], metadata=meta
    )
    cc.write_json(tmp_path / "m.json", [("d", ds)])
    doc = json.loads((tmp_path / "m.json").read_text())
    assert doc["datasets"][0]["values"] == [[None], ["Infinity"], ["-Infinity"]]
    assert doc["datasets"][0]["metadata"]["nested"]["b"] == [1.5, 2.5]
    cc.write_mat(tmp_path / "m.mat", [("d", ds)])
    s = loadmat(tmp_path / "m.mat", squeeze_me=True, struct_as_record=False)["d"]
    assert np.isnan(s.values[0]) and s.metadata.nested.a == 1 and bool(s.metadata.flag)
    cc.write_h5(tmp_path / "m.h5", [("d", ds)])
    with h5py.File(tmp_path / "m.h5") as f:
        m = f["d/metadata"]
        assert m["nested"].attrs["a"] == 1 and list(m["nested"].attrs["b"]) == [1.5, 2.5]
        assert m.attrs["flag"]
        assert m.attrs["tags__json"] and json.loads(m.attrs["tags"]) == ["p", "q"]
        assert m.attrs["weird__json"]
    cc.write_npz(tmp_path / "m.npz", [("d", ds)])
    assert json.loads(str(np.load(tmp_path / "m.npz")["d__metadata"]))["nested"]["d"] == "x"
