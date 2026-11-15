"""Hardening of the HDF5/NeXus importer (gap-5 lane D review): other files are
never read, chunk bombs are refused, one bad dataset costs only itself, the
MATLAB export layout is decided once per group, legacy NeXus keeps its axes."""

from __future__ import annotations

import tracemalloc
from pathlib import Path

import h5py
import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io.hdf5 import write_hdf5
from quantized.io.registry import import_auto, import_auto_sheets

FX = Path(__file__).parent / "fixtures" / "import_formats"


def _secret(tmp_path: Path) -> Path:
    p = tmp_path / "secret_dir" / "secret.h5"
    p.parent.mkdir()
    with h5py.File(p, "w") as f:
        f["grp/data"] = np.array([11.0, 22.0, 33.0])
        raw = f.create_group("raw")
        raw["time"] = np.array([[1.0]])
        raw["values"] = np.array([[1234.5, 6789.0]])
    return p


# --- H1: objects of another file are never read ---


def test_own_export_pointing_at_another_files_values_is_refused(tmp_path: Path) -> None:
    secret = _secret(tmp_path)
    out = tmp_path / "evil.h5"
    with h5py.File(FX / "quantized_export.h5") as a, h5py.File(out, "w") as b:
        for k, v in a.attrs.items():
            b.attrs[k] = v
        a.copy("raw", b)
        del b["raw/values"]
        b["raw/values"] = h5py.ExternalLink(str(secret), "/raw/values")
    with pytest.raises(ValueError, match="another file"):
        import_auto(out)


def test_own_export_with_an_external_raw_group_is_refused(tmp_path: Path) -> None:
    secret = _secret(tmp_path)
    out = tmp_path / "evil2.h5"
    with h5py.File(out, "w") as b:
        b.attrs["toolboxName"] = "quantized"
        b["raw"] = h5py.ExternalLink(str(secret), "/raw")
    with pytest.raises(ValueError, match="another file"):
        import_auto(out)


def test_soft_link_through_an_external_link_is_refused(tmp_path: Path) -> None:
    secret = _secret(tmp_path)
    out = tmp_path / "soft_ext.nxs"
    with h5py.File(out, "w") as f:
        f["elink"] = h5py.ExternalLink(str(secret), "/grp")
        d = f.create_group("entry/data")
        d.attrs["NX_class"] = "NXdata"
        d.attrs["signal"] = "y"
        d["y"] = h5py.SoftLink("/elink/data")
    with pytest.raises(ValueError, match="another file"):
        import_auto(out)


# --- H3: a chunk is decompressed whole ---


def test_a_huge_declared_chunk_is_refused_before_it_is_decompressed(tmp_path: Path) -> None:
    p = tmp_path / "chunkbomb.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("x", shape=(2,), maxshape=(None,), chunks=(2**26,), compression="gzip")[
            :
        ] = [1.0, 2.0]
        f.create_dataset("ok", data=np.arange(4.0))
    assert p.stat().st_size < 2_000_000
    tracemalloc.start()
    try:
        books = import_auto_sheets(p)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert peak < 64 << 20  # the 512 MiB chunk was never inflated
    assert books[0].labels == ("ok",)
    assert "storage chunk" in " ".join(books[0].metadata["notes"])


# --- M2: one refused dataset costs only itself ---


def test_a_declared_huge_dataset_does_not_cost_the_file_its_good_ones(tmp_path: Path) -> None:
    p = tmp_path / "mixed.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("huge", shape=((1 << 26) + 1,), dtype="f8")
        f.create_dataset("good", data=np.arange(10.0))
    (ds,) = import_auto_sheets(p)
    assert ds.labels == ("good",)
    assert any("huge" in n and "declares" in n for n in ds.metadata["notes"])


def test_a_too_big_matrix_is_refused_from_its_shape_and_spares_the_budget(tmp_path: Path) -> None:
    p = tmp_path / "wide.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("a/wide", shape=(8192, 8192), dtype="f8")  # 64M elements, unwritten
        f.create_dataset("b/good", data=np.arange(5.0))
    tracemalloc.start()
    try:
        (ds,) = import_auto_sheets(p)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert peak < 64 << 20  # not read in full before the refusal
    assert ds.labels == ("good",)
    assert any("/a/wide" in n and "map limit" in n for n in ds.metadata["notes"])


def test_a_big_nxdata_signal_is_refused_before_it_is_read(tmp_path: Path) -> None:
    p = tmp_path / "bigsig.nxs"
    with h5py.File(p, "w") as f:
        g = f.create_group("e/d")
        g.attrs["NX_class"] = "NXdata"
        g.attrs["signal"] = "s"
        g.create_dataset("s", shape=(4000, 4000), dtype="f8")
        ok = f.create_group("e/ok")
        ok.attrs["NX_class"] = "NXdata"
        ok.attrs["signal"] = "y"
        ok.create_dataset("y", data=np.arange(3.0))
    tracemalloc.start()
    try:
        (ds,) = import_auto_sheets(p)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert peak < 64 << 20
    assert ds.labels == ("y",)
    assert "point limit" in " ".join(ds.metadata["notes"])


# --- M3: the MATLAB export layout is decided once per group ---


def _matlab_layout_copy(src: Path, dst: Path) -> None:
    """The same export with every array's shape reversed, as MATLAB writes it."""
    with h5py.File(src) as a, h5py.File(dst, "w") as b:
        for k, v in a.attrs.items():
            b.attrs[k] = v
        g = b.create_group("raw")
        for k, v in a["raw"].attrs.items():
            g.attrs[k] = v
        for name in ("time", "values", "labels", "units", "nRows"):
            d = g.create_dataset(name, data=a["raw"][name][()].T)
            for k, v in a["raw"][name].attrs.items():
                if k != "utf8":
                    d.attrs[k] = v


@pytest.mark.parametrize(
    ("n", "labels"),
    [
        (3, ["aa", "bb", "cc"]),  # 3 points x 3 channels: values are square
        (5, ["Field", "M", "T", "R", "phi"]),  # 5 channels, longest label 5: labels are square
        (1, ["only"]),
    ],
)
def test_square_matrices_in_the_matlab_layout_read_correctly(
    tmp_path: Path, n: int, labels: list[str]
) -> None:
    m = len(labels)
    values = np.arange(n * m, dtype=float).reshape(n, m)
    ds = DataStruct.create(np.arange(n, dtype=float) * 10, values, labels=labels, units=["u"] * m)
    native = tmp_path / "native.h5"
    write_hdf5(ds, native)
    swapped = tmp_path / "matlab.h5"
    _matlab_layout_copy(native, swapped)
    for path in (native, swapped):
        (back,) = import_auto_sheets(path)
        assert np.array_equal(back.values, values), path.name
        assert back.labels == tuple(labels), path.name
        assert back.units == ("u",) * m
        assert back.time.tolist() == (np.arange(n) * 10.0).tolist()


# --- M4: legacy NeXus ---


def _legacy(tmp_path: Path, name: str, *, signal_axes: str | None, axis_attrs: bool) -> Path:
    p = tmp_path / name
    with h5py.File(p, "w") as f:
        g = f.create_group("entry/data")
        g.attrs["NX_class"] = "NXdata"
        c = g.create_dataset("counts", data=np.arange(12.0).reshape(3, 4))
        c.attrs["signal"] = 1
        if signal_axes is not None:
            c.attrs["axes"] = signal_axes
        t = g.create_dataset("temperature", data=np.array([100.0, 200.0, 300.0]))
        e = g.create_dataset("energy", data=np.array([1.0, 2.0, 3.0, 4.0]))
        if axis_attrs:
            t.attrs["axis"] = 1
            e.attrs["axis"] = 2
    return p


@pytest.mark.parametrize(
    ("signal_axes", "axis_attrs"), [("temperature:energy", False), (None, True)]
)
def test_legacy_nexus_axes_are_read_not_replaced_by_indices(
    tmp_path: Path, signal_axes: str | None, axis_attrs: bool
) -> None:
    (ds,) = import_auto_sheets(
        _legacy(tmp_path, "legacy.nxs", signal_axes=signal_axes, axis_attrs=axis_attrs)
    )
    assert ds.labels == ("energy", "temperature", "Intensity")
    assert ds.values[:4, 0].tolist() == [1.0, 2.0, 3.0, 4.0]
    assert ds.values[::4, 1].tolist() == [100.0, 200.0, 300.0]


def test_legacy_nexus_with_axes_for_only_some_dimensions_is_refused(tmp_path: Path) -> None:
    p = _legacy(tmp_path, "partial.nxs", signal_axes=None, axis_attrs=False)
    with h5py.File(p, "r+") as f:
        f["entry/data/temperature"].attrs["axis"] = 1  # no axis=2 anywhere
    with pytest.raises(ValueError, match="only some dimensions"):
        import_auto(p)


def test_legacy_nexus_naming_no_axes_says_it_used_the_point_index(tmp_path: Path) -> None:
    p = _legacy(tmp_path, "none.nxs", signal_axes=None, axis_attrs=False)
    (ds,) = import_auto_sheets(p)
    assert ds.labels[:2] == ("column", "row")
    assert "point index is used" in " ".join(ds.metadata["notes"])
