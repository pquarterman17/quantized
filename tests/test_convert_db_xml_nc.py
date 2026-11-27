"""The SQLite, XML and NetCDF writers of the quick converter (export-writers item 35).

Each is read back with an independent reader (``sqlite3``, ``xml.etree``,
``scipy.io.netcdf_file``): every number, label, unit, categorical level and
metadata value must survive, ``NaN`` must stay a gap, a 2-D map must keep its
shape where the format has one, and no ``__quantized_*`` key may be written.
Inputs are committed fixtures or built here.
"""

from __future__ import annotations

import json
import math
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose
from scipy.io import netcdf_file

from quantized.datastruct import DataStruct
from quantized.io import import_auto
from quantized.io.convert_data import convert_data_file
from quantized.io.convert_meta import PRIVATE_METADATA_KEYS
from quantized.io.convert_netcdf import write_netcdf
from quantized.io.convert_plan import ALL_FORMATS, CONTAINER_FORMATS, plan_outputs
from quantized.io.convert_sqlite import write_sqlite
from quantized.io.convert_xml import write_xml
from quantized.io.netcdf import import_netcdf

FIX = Path(__file__).parent / "fixtures"
RSM = FIX / "xrdml_rsm_synthetic.xrdml"
SCAN = FIX / "xrdml_la2nio4.xrdml"
NEW = ("sqlite", "xml", "nc")
SENTINEL = "ZZ-SENTINEL"


def _ds() -> DataStruct:
    """Gap, an infinity, a unicode unit, a categorical channel, nested and private metadata."""
    md: dict[str, Any] = {
        "x_column_name": "Temperature",
        "x_column_unit": "K",
        "sample": "S1 é",
        "nested": {"a": 1, "b": [1, 2]},
        "nothing": None,
        "bad": float("nan"),
    }
    md.update({k: {"leak": SENTINEL} for k in PRIVATE_METADATA_KEYS})
    return DataStruct.create(
        [1.0, 2.5, 4.0, 8.0],
        [[10.0, 0.0], [float("nan"), 1.0], [30.0, 0.0], [float("inf"), 1.0]],
        labels=["Moment", "Phase"],
        units=["emu", "µm"],
        metadata=md,
        cat_levels={1: ("low", "high")},
    )


# -- SQLite ---------------------------------------------------------------------------------


def test_sqlite_round_trip(tmp_path: Path) -> None:
    p = tmp_path / "o.sqlite"
    write_sqlite(p, [("run 1", _ds()), ("run 2", _ds())])
    con = sqlite3.connect(p)
    try:
        listed = con.execute("SELECT name, table_name, n_points FROM datasets").fetchall()
        assert [r[0] for r in listed] == ["run 1", "run 2"]
        assert len({r[1] for r in listed}) == 2
        name, table, n = listed[0]
        assert n == 4
        cur = con.execute(f'SELECT * FROM "{table}"')
        assert [d[0] for d in cur.description] == ["x", "Moment", "Phase"]
        rows = cur.fetchall()
        assert_allclose([r[0] for r in rows], [1.0, 2.5, 4.0, 8.0])
        assert rows[0][1] == 10.0
        assert rows[1][1] is None  # the gap is NULL
        assert rows[3][1] == math.inf
        assert [r[2] for r in rows] == [0.0, 1.0, 0.0, 1.0]
        ch = con.execute(
            "SELECT position, label, unit, role, levels FROM channels WHERE dataset=? "
            "ORDER BY position",
            (name,),
        ).fetchall()
        assert ch[0][:4] == (0, "Temperature", "K", "x")
        assert ch[1][:4] == (1, "Moment", "emu", "y")
        assert ch[2][2] == "µm" and json.loads(ch[2][4]) == ["low", "high"]
        meta = json.loads(con.execute("SELECT metadata FROM datasets").fetchone()[0])
        assert meta["sample"] == "S1 é" and meta["nested"] == {"a": 1, "b": [1, 2]}
        assert meta["nothing"] is None and meta["bad"] is None
        assert not set(meta) & PRIVATE_METADATA_KEYS
    finally:
        con.close()
    assert SENTINEL.encode() not in p.read_bytes()


def test_sqlite_label_clashes_and_quotes(tmp_path: Path) -> None:
    ds = DataStruct.create(
        [0.0, 1.0],
        [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
        labels=["x", 'a"b', 'a"b'],
        units=["", "", ""],
    )
    p = tmp_path / "q.sqlite"
    write_sqlite(p, [("d", ds)])
    con = sqlite3.connect(p)
    try:
        cur = con.execute('SELECT * FROM "d"')
        assert len({c[0].lower() for c in cur.description}) == 4
        assert cur.fetchall() == [(0.0, 1.0, 2.0, 3.0), (1.0, 4.0, 5.0, 6.0)]
    finally:
        con.close()


# -- XML ------------------------------------------------------------------------------------


def _xml_columns(root: ET.Element) -> list[tuple[str, str, str, np.ndarray]]:
    ds = root.find("dataset")
    assert ds is not None
    return [
        (
            c.get("role", ""),
            c.get("label", ""),
            c.get("unit", ""),
            np.array([float(t) for t in (c.text or "").split()]),
        )
        for c in ds.findall("column")
    ]


def test_xml_round_trip(tmp_path: Path) -> None:
    p = tmp_path / "o.xml"
    write_xml(p, [("run", _ds())])
    root = ET.parse(p).getroot()  # noqa: S314 - our own file
    assert root.tag == "quantized-convert" and root.get("version") == "1"
    ds = root.find("dataset")
    assert ds is not None and ds.get("name") == "run" and ds.get("points") == "4"
    cols = _xml_columns(root)
    assert [c[:3] for c in cols] == [
        ("x", "Temperature", "K"),
        ("y", "Moment", "emu"),
        ("y", "Phase", "µm"),
    ]
    assert_allclose(cols[0][3], [1.0, 2.5, 4.0, 8.0])
    assert_allclose(cols[1][3], [10.0, np.nan, 30.0, np.inf], equal_nan=True)
    levels = ds.findall("column")[2].get("levels")
    assert levels is not None and json.loads(levels) == ["low", "high"]
    items = {i.get("key"): i.text for i in ds.iter("item")}
    assert items["sample"] == "S1 é" and items["nested.a"] == "1"
    assert not set(items) & PRIVATE_METADATA_KEYS
    assert SENTINEL not in p.read_text(encoding="utf-8")


def test_xml_strips_characters_xml_cannot_hold(tmp_path: Path) -> None:
    ds = DataStruct.create(
        [0.0, 1.0],
        [[1.0], [2.0]],
        labels=["a\x00b"],
        units=["\x0b"],
        metadata={"k\x01": "v\x02w" + "z" * 3000},
    )
    p = tmp_path / "c.xml"
    write_xml(p, [("n\x1fm", ds)])
    root = ET.parse(p).getroot()  # noqa: S314
    d = root.find("dataset")
    assert d is not None and d.get("name") == "nm"
    meta = d.find("metadata")
    assert meta is not None and meta.get("truncated") == "k"  # the cut is never silent


# -- NetCDF ---------------------------------------------------------------------------------


def _nc(path: Path) -> Any:
    return netcdf_file(str(path), "r", mmap=False)


def test_netcdf_round_trip(tmp_path: Path) -> None:
    p = tmp_path / "o.nc"
    write_netcdf(p, [("run 1", _ds()), ("run 1", _ds())])
    nc = _nc(p)
    try:
        assert nc.format == b"quantized-convert"
        index = json.loads(nc.datasets.decode())
        assert [e["name"] for e in index] == ["run 1", "run 1"]
        a, b = (e["prefix"] for e in index)
        assert a != b
        x = nc.variables[f"{a}_x"]
        assert_allclose(x[:], [1.0, 2.5, 4.0, 8.0])
        assert (x.long_name.decode(), x.units.decode()) == ("Temperature", "K")
        m = nc.variables[f"{a}_Moment"]
        assert_allclose(m[:], [10.0, np.nan, 30.0, np.inf], equal_nan=True)
        ph = nc.variables[f"{a}_Phase"]
        assert ph.units.decode() == "µm"
        assert json.loads(ph.levels.decode()) == ["low", "high"]
        meta = json.loads(getattr(nc, f"{a}_metadata").decode())
        assert meta["sample"] == "S1 é" and meta["bad"] is None
        assert not set(meta) & PRIVATE_METADATA_KEYS
    finally:
        nc.close()
    assert SENTINEL.encode() not in p.read_bytes()


def test_netcdf_is_readable_by_the_importer(tmp_path: Path) -> None:
    p = tmp_path / "o.nc"
    ds = DataStruct.create([1.0, 2.0, 3.0], [[4.0], [5.0], [6.0]], labels=["Y"], units=["u"])
    write_netcdf(p, [("d", ds)])
    back = import_netcdf(p)
    assert back.n_points == 3
    seen = {float(v) for v in np.concatenate([back.time, back.values.ravel()])}
    assert {1.0, 2.0, 3.0, 4.0, 5.0, 6.0} <= seen


def test_netcdf_refuses_an_empty_dataset(tmp_path: Path) -> None:
    empty = DataStruct.create([], np.zeros((0, 1)), labels=["Y"], units=[""])
    with pytest.raises(ValueError, match="no rows"):
        write_netcdf(tmp_path / "e.nc", [("e", empty)])


# -- the 2-D map, through the whole converter -----------------------------------------------


def _convert(src: Path, fmt: str, tmp: Path) -> tuple[dict[str, Any], Path]:
    dst = tmp / "in" / src.name
    dst.parent.mkdir(parents=True)
    dst.write_bytes(src.read_bytes())
    report = convert_data_file(dst, tmp / "out", fmt)
    assert report["status"] == "ok", report
    return report, tmp / "out" / report["outputs"][0]


def test_map_keeps_its_rows_and_netcdf_its_grid(tmp_path: Path) -> None:
    rsm = import_auto(RSM)
    assert rsm.metadata["is2D"] is True
    nf, npx = (int(v) for v in rsm.metadata["map_shape"])
    _, sq = _convert(RSM, "sqlite", tmp_path / "a")
    con = sqlite3.connect(sq)
    try:
        table = con.execute("SELECT table_name FROM datasets").fetchone()[0]
        got = np.array(con.execute(f'SELECT * FROM "{table}"').fetchall(), dtype=float)
        assert got.shape == (rsm.n_points, 1 + rsm.n_channels)
        assert_allclose(got[:, 0], rsm.time)
        assert_allclose(got[:, 1:], rsm.values, equal_nan=True)
    finally:
        con.close()
    _, ncp = _convert(RSM, "nc", tmp_path / "b")
    nc = _nc(ncp)
    try:
        prefix = json.loads(nc.datasets.decode())[0]["prefix"]
        grids = [k for k in nc.variables if k.startswith(f"{prefix}_grid_")]
        assert len(grids) == rsm.n_channels
        g = nc.variables[grids[0]][:]
        assert g.shape == (nf, npx)
        assert_allclose(g.ravel(), rsm.values[:, 0], equal_nan=True)
        assert nc.variables[grids[0]].long_name.decode() == rsm.labels[0]
    finally:
        nc.close()
    _, xp = _convert(RSM, "xml", tmp_path / "c")
    cols = _xml_columns(ET.parse(xp).getroot())  # noqa: S314
    assert len(cols) == 1 + rsm.n_channels
    assert_allclose(cols[1][3], rsm.values[:, 0], equal_nan=True)


@pytest.mark.parametrize("fmt", NEW)
def test_scan_converts_end_to_end(fmt: str, tmp_path: Path) -> None:
    report, out = _convert(SCAN, fmt, tmp_path)
    assert out.suffix == f".{fmt}" and out.stat().st_size > 0
    assert report["books"][0]["status"] == "written"


# -- registration ---------------------------------------------------------------------------


@pytest.mark.parametrize("fmt", NEW)
def test_new_formats_are_registered_containers(fmt: str) -> None:
    assert fmt in ALL_FORMATS and fmt in CONTAINER_FORMATS
    assert plan_outputs("stem", fmt, ["a", "b"]) == [(f"stem.{fmt}", [0, 1])]
