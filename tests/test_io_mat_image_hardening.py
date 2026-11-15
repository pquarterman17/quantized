"""Hardening of the .mat and image importers and of the native-grid map path
(gap-5 lane D review): compressed-element bombs, v7.3 link cycles, scalar
names, v5/v7.3 consistency, EXIF orientation, page counts, pixel-exact maps,
and the Pack Project privacy gate."""

from __future__ import annotations

import struct
import tracemalloc
import zlib
from pathlib import Path
from typing import Any

import h5py
import numpy as np
import pytest
from PIL import Image
from scipy.io import savemat

from quantized.calc.map import MapState, map_from_datastruct
from quantized.io import matlab_mat
from quantized.io._hdf5_walk import Budget
from quantized.io.registry import (
    import_auto,
    import_auto_sheets,
    is_packable_data_name,
    is_recognised_data_name,
)

FX = Path(__file__).parent / "fixtures" / "import_formats"


# --- H2: compressed elements are inflated under a cap ---


def _v5_bomb(path: Path, nbytes: int) -> None:
    """One compressed variable ``x`` whose header says 1 x 1 but whose double
    data element declares ``nbytes`` of zeros (the file stays tiny)."""

    def tag(kind: int, n: int) -> bytes:
        return struct.pack("<II", kind, n)

    body = (
        tag(6, 8)
        + struct.pack("<II", 6, 0)  # array flags: mxDOUBLE_CLASS
        + tag(5, 8)
        + struct.pack("<ii", 1, 1)  # dimensions 1 x 1
        + tag(1, 1)
        + b"x"
        + b"\x00" * 7  # name
        + tag(9, nbytes)  # miDOUBLE data of nbytes
    )
    matrix = tag(14, len(body) + nbytes) + body
    comp = zlib.compressobj(9)
    out = comp.compress(matrix)
    zeros = b"\x00" * (1 << 20)
    for _ in range(nbytes >> 20):
        out += comp.compress(zeros)
    out += comp.flush()
    head = b"MATLAB 5.0 MAT-file".ljust(116) + b"\x00" * 8 + struct.pack("<H", 0x0100) + b"IM"
    path.write_bytes(head + tag(15, len(out)) + out)


def test_a_compressed_element_declaring_more_than_the_budget_is_never_inflated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    p = tmp_path / "bomb.mat"
    _v5_bomb(p, 64 << 20)
    assert p.stat().st_size < 200_000
    monkeypatch.setattr(matlab_mat, "Budget", lambda: Budget(elements=1 << 20))  # 8 MiB
    tracemalloc.start()
    try:
        with pytest.raises(ValueError, match="nothing to import") as exc:
            import_auto(p)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert "inflates past the size limit" in str(exc.value)
    assert peak < 24 << 20  # the 64 MiB element was never allocated


def test_an_oversized_variable_spares_the_others(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(matlab_mat, "Budget", lambda: Budget(elements=1 << 20))
    mixed = tmp_path / "mixed.mat"
    savemat(
        mixed,
        {"big": np.zeros(2 << 20), "small": np.arange(3.0)},  # 16 MiB doubles, compressed
        do_compression=True,
    )
    (ds,) = import_auto_sheets(mixed)
    assert ds.labels == ("small",)
    assert "inflates past the size limit" in " ".join(ds.metadata["notes"])


def test_a_struct_whose_fields_exceed_the_cap_is_skipped_as_a_whole(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    p = tmp_path / "struct.mat"
    savemat(
        p,
        {"s": {"big": np.zeros(2 << 20), "a": np.arange(3.0)}, "ok": np.arange(5.0)},
        do_compression=True,
    )
    monkeypatch.setattr(matlab_mat, "Budget", lambda: Budget(elements=1 << 20))
    (ds,) = import_auto_sheets(p)
    assert ds.labels == ("ok",)
    assert "inflates past the size limit" in " ".join(ds.metadata["notes"])


def test_compressed_files_still_import_normally(tmp_path: Path) -> None:
    p = tmp_path / "c.mat"
    savemat(p, {"a": np.arange(100.0), "s": {"b": np.arange(100.0) * 2}}, do_compression=True)
    books = {b.metadata["sheet_name"]: b for b in import_auto_sheets(p)}
    assert books["workspace"].values[:, 0].tolist() == list(np.arange(100.0))
    assert books["s"].values[:, 0].tolist() == list(np.arange(100.0) * 2)


# --- M1: v7.3 link cycles and diamonds ---


def _v73(path: Path, build: Any) -> None:
    with h5py.File(path, "w", userblock_size=512) as f:
        build(f)
    raw = bytearray(path.read_bytes())
    banner = b"MATLAB 7.3 MAT-file, fixture"
    raw[: len(banner)] = banner
    path.write_bytes(bytes(raw))


def _numeric(group: Any, name: str, data: Any) -> None:
    group.create_dataset(name, data=np.asarray(data, dtype=float).reshape(1, -1)).attrs[
        "MATLAB_class"
    ] = np.bytes_("double")


def test_a_struct_that_links_to_itself_is_skipped_not_a_recursion_error(tmp_path: Path) -> None:
    def build(f: h5py.File) -> None:
        g = f.create_group("s")
        g.attrs["MATLAB_class"] = np.bytes_("struct")
        _numeric(g, "v", [1, 2, 3])
        g["loop"] = g

    p = tmp_path / "cycle.mat"
    _v73(p, build)
    (ds,) = import_auto_sheets(p)
    assert ds.labels == ("v",)
    assert "links back" in " ".join(ds.metadata["notes"])


def test_a_diamond_of_links_does_not_explode(tmp_path: Path) -> None:
    def build(f: h5py.File) -> None:
        groups = []
        for i in range(25):
            g = f.create_group("s" if i == 0 else f"#lvl{i}")
            g.attrs["MATLAB_class"] = np.bytes_("struct")
            groups.append(g)
        _numeric(groups[0], "v", [1, 2])
        for i in range(24):  # two hard links per level to the next: 2**24 paths
            groups[i]["a"] = groups[i + 1]
            groups[i]["b"] = groups[i + 1]

    p = tmp_path / "dag.mat"
    _v73(p, build)
    (ds,) = import_auto_sheets(p)  # returns at once: each group is read once
    assert ds.labels == ("v",)


def test_a_cycle_only_file_is_a_clear_refusal(tmp_path: Path) -> None:
    def build(f: h5py.File) -> None:
        g = f.create_group("s")
        g.attrs["MATLAB_class"] = np.bytes_("struct")
        g["loop"] = g

    p = tmp_path / "cycle2.mat"
    _v73(p, build)
    with pytest.raises(ValueError, match="nothing to import"):
        import_auto(p)


def test_v73_external_links_are_not_read(tmp_path: Path) -> None:
    other = tmp_path / "other.h5"
    with h5py.File(other, "w") as f:
        f["v"] = np.arange(3.0).reshape(1, 3)

    def build(f: h5py.File) -> None:
        _numeric(f, "mine", [1, 2])
        f["theirs"] = h5py.ExternalLink(str(other), "/v")

    p = tmp_path / "ext.mat"
    _v73(p, build)
    (ds,) = import_auto_sheets(p)
    assert ds.labels == ("mine",)


# --- L1 / L4 ---


def test_scalars_are_qualified_by_their_struct_path(tmp_path: Path) -> None:
    p = tmp_path / "sc.mat"
    savemat(
        p,
        {
            "a": 1.0,
            "s1": {"a": 2.0, "x": np.arange(3.0)},
            "s2": {"a": 3.0, "inner": {"a": 4.0}},
            "v": np.arange(3.0),
        },
    )
    first = import_auto_sheets(p)[0]
    assert first.metadata["mat_scalars"] == {"a": 1.0, "s1.a": 2.0, "s2.a": 3.0, "s2.inner.a": 4.0}


def test_v5_and_v73_agree_on_a_1_x_n_x_m_array(tmp_path: Path) -> None:
    arr = np.arange(2 * 300.0).reshape(1, 2, 300)
    v5 = tmp_path / "a5.mat"
    savemat(v5, {"cube": arr, "ok": np.arange(3.0)})

    def build(f: h5py.File) -> None:
        d = f.create_dataset("cube", data=arr.T)  # HDF5 reverses the dimensions
        d.attrs["MATLAB_class"] = np.bytes_("double")
        _numeric(f, "ok", [0, 1, 2])

    v73 = tmp_path / "a73.mat"
    _v73(v73, build)
    for p in (v5, v73):
        (ds,) = import_auto_sheets(p)
        assert ds.labels == ("ok",), p.name
        assert "'cube' is 3-D" in " ".join(ds.metadata["notes"]), p.name


# --- images: L2 / L3 ---


def test_skipped_page_count_is_the_real_one(tmp_path: Path) -> None:
    frames = [Image.new("L", (1024, 1024), k % 250) for k in range(70)]
    p = tmp_path / "many.tif"
    frames[0].save(p, save_all=True, append_images=frames[1:])
    books = import_auto_sheets(p)
    assert len(books) == 4
    assert "66 further page(s) not imported" in books[0].metadata["notes"][0]


def test_exif_orientation_is_applied_and_recorded(tmp_path: Path) -> None:
    arr = np.zeros((20, 40), dtype=np.uint8)  # stored 40 wide, 20 tall
    arr[0, 0] = 255  # top-left marker
    im = Image.fromarray(arr, "L")
    exif = Image.Exif()
    exif[0x0112] = 6  # viewers rotate 90 degrees clockwise: shown 20 wide, 40 tall
    p = tmp_path / "rot.jpg"
    im.save(p, exif=exif, quality=100)
    ds = import_auto(p)
    assert ds.metadata["map_shape"] == [40, 20]
    assert ds.metadata["exif_orientation"] == 6
    assert "EXIF orientation (6)" in ds.metadata["image_conversion"]
    plain = tmp_path / "plain.jpg"
    im.save(plain, quality=100)
    assert import_auto(plain).metadata["map_shape"] == [20, 40]
    assert "exif_orientation" not in import_auto(plain).metadata


# --- M5: pixel-exact maps ---


def test_a_checkerboard_image_maps_to_exactly_its_pixels(tmp_path: Path) -> None:
    board = (np.indices((8, 8)).sum(axis=0) % 2 * 255).astype(np.uint8)
    p = tmp_path / "board.png"
    Image.fromarray(board, "L").save(p)
    ds = import_auto(p)
    m = map_from_datastruct(ds, "X", "Y", "Intensity", MapState(method="linear", nx=200, ny=200))
    assert m.z_grid.shape == (8, 8)
    assert sorted(set(np.asarray(m.z_grid).ravel())) == [0.0, 255.0]  # no invented values
    assert np.array_equal(m.z_grid, board[::-1].astype(float))
    assert m.metadata["interpolated"] is False


def test_resample_true_still_regrids(tmp_path: Path) -> None:
    p = tmp_path / "small.png"
    Image.fromarray(np.arange(16, dtype=np.uint8).reshape(4, 4) * 10, "L").save(p)
    m = map_from_datastruct(
        import_auto(p), "X", "Y", "Intensity", MapState(method="linear", resample=True)
    )
    assert m.z_grid.shape == (200, 200)


def test_a_2048_px_wide_image_is_served_at_native_size(tmp_path: Path) -> None:
    p = tmp_path / "wide.png"
    Image.fromarray((np.arange(2048 * 2) % 256).astype(np.uint8).reshape(2, 2048), "L").save(p)
    m = map_from_datastruct(import_auto(p), "X", "Y", "Intensity")
    assert m.z_grid.shape == (2, 2048)  # the route's nx <= 2000 never applies


def test_descending_axes_of_a_native_grid_are_returned_ascending(tmp_path: Path) -> None:
    from quantized.io._array_books import grid_map_datastruct

    z = np.arange(6.0).reshape(2, 3)
    ds = grid_map_datastruct(
        z, np.array([3.0, 2.0, 1.0]), np.array([5.0, 4.0]),
        x_label="X", x_unit="", y_label="Y", y_unit="",
    )  # fmt: skip
    m = map_from_datastruct(ds, "X", "Y", "Intensity")
    assert m.x_axis.tolist() == [1.0, 2.0, 3.0] and m.y_axis.tolist() == [4.0, 5.0]
    assert m.z_grid.tolist() == [[5.0, 4.0, 3.0], [2.0, 1.0, 0.0]]


def test_route_serves_the_native_grid_and_honours_resample() -> None:
    from fastapi.testclient import TestClient

    from quantized.app import app

    client = TestClient(app)
    name = "gray8.png"
    up = client.post(
        "/api/parsers/upload",
        files={"file": (name, (FX / name).read_bytes(), "image/png")},
    ).json()
    body = {"dataset": up, "x_key": "X", "y_key": "Y", "z_key": "Intensity"}
    native = client.post("/api/plot/map", json=body).json()
    assert (len(native["y_axis"]), len(native["x_axis"])) == (4, 6)
    assert native["interpolated"] is False
    resampled = client.post("/api/plot/map", json={**body, "resample": True}).json()
    assert len(resampled["x_axis"]) == 200


# --- M6: the Pack Project privacy gate ---


@pytest.mark.parametrize(
    "name", ["passport.jpg", "scan.PNG", "id.tiff", "x.tif", "keys.mat", "a.jpeg"]
)
def test_images_and_mat_files_are_not_auto_packable(name: str) -> None:
    assert is_recognised_data_name(name)  # importable ...
    assert not is_packable_data_name(name)  # ... but flagged for sharing, as before


@pytest.mark.parametrize("name", ["run.csv", "scan.nxs", "m.h5", "w.ibw", "p.opju", "s.12"])
def test_data_files_stay_packable(name: str) -> None:
    assert is_packable_data_name(name)


def test_bridge_flags_an_image_source(monkeypatch: pytest.MonkeyPatch) -> None:
    from quantized import desktop_bridge_pack_state as state

    manifest = {
        "sources": [
            {"original_path": "/home/u/Pictures/passport.jpg", "packable": True},
            {"original_path": "/home/u/data/run.csv", "packable": True},
        ],
        "summary": {},
    }
    monkeypatch.setattr(state.data_roots, "is_inside_data_roots", lambda _p: True)
    out = state.flag_attention(manifest)
    flags = {r["original_path"]: [a["code"] for a in r["attention"]] for r in out["sources"]}
    assert flags["/home/u/Pictures/passport.jpg"] == ["unrecognised_extension"]
    assert flags["/home/u/data/run.csv"] == []
