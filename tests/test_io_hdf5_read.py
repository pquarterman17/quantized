"""HDF5 / NeXus import (io.hdf5_read): the app's own export round-trips exactly,
NXdata axes come from @signal/@axes, generic groups give columns, and anything
ambiguous or hostile is refused with a reason (gap-5 lane D)."""

from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np
import pytest

from fixtures.make_import_fixtures import GRID, X, Y
from quantized.datastruct import DataStruct
from quantized.io.hdf5 import write_hdf5
from quantized.io.hdf5_read import read_hdf5_books
from quantized.io.registry import import_auto, import_auto_sheets, resolve_parser

FX = Path(__file__).parent / "fixtures" / "import_formats"


# --- the app's own export ---------------------------------------------------


def test_own_export_round_trips_exactly() -> None:
    raw, corrected = import_auto_sheets(FX / "quantized_export.h5")
    t = np.array([300.0, 290.0, 280.0, 270.0])
    vals = np.column_stack([t * 1e-3, [0.0, 1.0, 0.0, 2.0]])
    assert raw.time.tolist() == t.tolist()
    assert np.array_equal(raw.values, vals)
    assert raw.labels == ("Moment", "Phase")
    assert raw.units == ("emu", "µm")  # the non-ASCII unit survives the ASCII matrix
    assert raw.metadata["x_column_name"] == "Temperature"
    assert raw.metadata["x_column_unit"] == "K"
    assert raw.cat_levels == {1: ("a", "b", "c")}
    assert raw.metadata["hdf5_corrections"] == {
        "xOff": 1.5, "yOff": 0.0, "bgSlope": -0.25, "bgInt": 0.0,
    }
    assert corrected.metadata["sheet_name"] == "corrected"
    assert np.array_equal(corrected.values, vals * 2.0)


def test_own_export_keeps_its_technique_and_names_the_file(tmp_path: Path) -> None:
    ds = import_auto(FX / "quantized_export.h5")
    assert ds.metadata["technique"] == "magnetometry.mvst"  # from the exported parser name
    assert ds.metadata["source"].endswith("quantized_export.h5")
    assert ds.metadata["exported_from"] == "orig/ppms.dat"


@pytest.mark.parametrize("suffix", [".h5", ".hdf5"])
def test_random_data_round_trips_bit_exact(tmp_path: Path, suffix: str) -> None:
    rng = np.random.default_rng(7)
    ds = DataStruct.create(
        rng.normal(size=50),
        rng.normal(size=(50, 3)) * 1e-9,
        labels=["a", "b", "c"],
        units=["", "Oe", "emu/g"],
        metadata={"x_column_name": "x", "x_column_unit": "s"},
    )
    path = tmp_path / f"rt{suffix}"
    write_hdf5(ds, path)
    (back,) = import_auto_sheets(path)
    assert np.array_equal(back.time, ds.time)
    assert np.array_equal(back.values, ds.values)
    assert back.labels == ds.labels and back.units == ds.units


def test_matlab_column_major_export_is_read(tmp_path: Path) -> None:
    """MATLAB's exportHDF5 writes the same schema with every shape reversed."""
    src = FX / "quantized_export.h5"
    out = tmp_path / "from_matlab.h5"
    with h5py.File(src) as a, h5py.File(out, "w") as b:
        for key, val in a.attrs.items():
            b.attrs[key] = val
        g = b.create_group("raw")
        for name in ("time", "values", "labels", "units"):
            d = g.create_dataset(name, data=a["raw"][name][()].T)
            for k, v in a["raw"][name].attrs.items():
                if k != "utf8":
                    d.attrs[k] = v
        b.create_group("metadata").attrs["xColumnName"] = "Temperature"
    (ds,) = import_auto_sheets(out)
    assert ds.labels == ("Moment", "Phase")
    assert ds.values.shape == (4, 2)
    assert ds.metadata["x_column_name"] == "Temperature"


def test_damaged_own_export_is_refused(tmp_path: Path) -> None:
    out = tmp_path / "bad.h5"
    with h5py.File(FX / "quantized_export.h5") as a, h5py.File(out, "w") as b:
        for key, val in a.attrs.items():
            b.attrs[key] = val
        b.create_group("raw").create_dataset("time", data=np.arange(3.0))
    with pytest.raises(ValueError, match="missing its 'values'"):
        import_auto(out)


# --- NeXus -------------------------------------------------------------------


def test_nexus_1d_axis_errors_and_aux_columns() -> None:
    (ds,) = import_auto_sheets(FX / "nexus_1d.nxs")
    assert ds.time.tolist() == X.tolist()
    assert ds.metadata["x_column_name"] == "two_theta"
    assert ds.metadata["x_column_unit"] == "degrees"
    assert ds.labels == ("counts", "counts_errors", "monitor")
    assert ds.units[0] == "counts"
    assert ds.values[:, 0].tolist() == Y.tolist()
    assert np.allclose(ds.values[:, 1], np.sqrt(Y))
    assert ds.metadata["nexus"] is True
    assert ds.metadata["nexus_axes"] == ["two_theta"]


def test_nexus_2d_signal_is_a_map_with_its_axes() -> None:
    (ds,) = import_auto_sheets(FX / "nexus_2d.nxs")
    assert ds.metadata["is2D"] is True
    assert ds.metadata["map_shape"] == [3, 4]
    assert ds.labels == ("x", "y", "Intensity")
    assert ds.units == ("mm", "mm", "counts")
    # rows run y-outer, x-inner: z[j, i] at (x[i], y[j])
    assert ds.values[:, 0].tolist() == [0.5, 1.5, 2.5, 3.5] * 3
    assert ds.values[:, 1].tolist() == [-1.0] * 4 + [0.0] * 4 + [1.0] * 4
    assert ds.values[:, 2].tolist() == GRID.ravel().tolist()


def test_map_works_with_the_existing_map_path() -> None:
    from quantized.calc.map import map_from_datastruct

    (ds,) = import_auto_sheets(FX / "nexus_2d.nxs")
    m = map_from_datastruct(ds, "x", "y", "Intensity")
    assert m.z_grid.shape[0] > 0 and m.z_grid.shape[1] > 0


def _nx(path: Path, **attrs: object) -> h5py.Group:
    f = h5py.File(path, "w")
    g = f.create_group("e/d")
    g.attrs["NX_class"] = "NXdata"
    for k, v in attrs.items():
        g.attrs[k] = v
    return g


def test_nxdata_without_axes_attr_uses_the_point_index(tmp_path: Path) -> None:
    p = tmp_path / "noaxes.nxs"
    g = _nx(p, signal="s")
    g.create_dataset("s", data=Y)
    g.file.close()
    (ds,) = import_auto_sheets(p)
    assert ds.time.tolist() == list(range(6))
    assert ds.metadata["x_column_name"] == "index"


def test_legacy_signal_dataset_attribute(tmp_path: Path) -> None:
    p = tmp_path / "legacy.nxs"
    g = _nx(p)
    g.create_dataset("data", data=Y).attrs["signal"] = 1
    g.file.close()
    (ds,) = import_auto_sheets(p)
    assert ds.labels == ("data",)


@pytest.mark.parametrize(
    ("what", "build", "message"),
    [
        ("no signal", lambda g: g.create_dataset("s", data=Y), "no @signal"),
        (
            "bin edges",
            lambda g: (
                g.attrs.update(signal="s", axes=["e"]),
                g.create_dataset("s", data=Y),
                g.create_dataset("e", data=np.arange(7.0)),
            ),
            "bin edges",
        ),
        (
            "missing axis",
            lambda g: (g.attrs.update(signal="s", axes=["nope"]), g.create_dataset("s", data=Y)),
            "not a numeric dataset",
        ),
        (
            "wrong axis length",
            lambda g: (
                g.attrs.update(signal="s", axes=["a"]),
                g.create_dataset("s", data=Y),
                g.create_dataset("a", data=np.arange(3.0)),
            ),
            "3 values for 6 points",
        ),
        (
            "axes count",
            lambda g: (g.attrs.update(signal="s", axes=["a", "b"]), g.create_dataset("s", data=Y)),
            "not guessed",
        ),
        (
            "3-D signal",
            lambda g: (g.attrs.update(signal="s"), g.create_dataset("s", data=np.zeros((2, 2, 2)))),
            "only 1-D and 2-D",
        ),
    ],
)
def test_ambiguous_nxdata_is_refused_not_guessed(
    tmp_path: Path, what: str, build: object, message: str
) -> None:
    p = tmp_path / "bad.nxs"
    g = _nx(p)
    build(g)  # type: ignore[operator]
    g.file.close()
    with pytest.raises(ValueError, match=message):
        import_auto(p)


def test_good_books_survive_a_bad_sibling_and_the_bad_one_is_named(tmp_path: Path) -> None:
    p = tmp_path / "mixed.nxs"
    with h5py.File(p, "w") as f:
        ok = f.create_group("ok")
        ok.attrs["NX_class"] = "NXdata"
        ok.attrs["signal"] = "s"
        ok.create_dataset("s", data=Y)
        bad = f.create_group("bad")
        bad.attrs["NX_class"] = "NXdata"
        bad.create_dataset("s", data=Y)
    books = import_auto_sheets(p)
    assert len(books) == 1
    assert "NXdata /bad: no @signal" in books[0].metadata["notes"][0]


# --- generic HDF5 -------------------------------------------------------------


def test_generic_groups_are_books_of_columns_with_no_guessed_axis() -> None:
    books = import_auto_sheets(FX / "generic.h5")
    by_name = {b.metadata["sheet_name"]: b for b in books}
    assert set(by_name) == {"/table", "/scan (n=6)", "/scan (n=3)"}
    scan = by_name["/scan (n=6)"]
    assert scan.labels == ("field", "moment")  # both columns; neither is promoted to x
    assert scan.units == ("", "emu")
    assert scan.metadata["x_column_name"] == "index"
    assert scan.time.tolist() == list(range(6))
    table = by_name["/table"]
    assert table.labels == ("table[0]", "table[1]")
    assert table.values[:, 1].tolist() == [1.0, 3.0, 5.0, 7.0]


def test_wide_2d_dataset_is_a_map_over_its_indices(tmp_path: Path) -> None:
    p = tmp_path / "img.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("image", data=np.arange(300 * 4.0).reshape(4, 300))
    (ds,) = import_auto_sheets(p)
    assert ds.metadata["is2D"] is True
    assert ds.metadata["map_shape"] == [4, 300]
    assert ds.labels == ("column", "row", "Intensity")


def test_three_d_dataset_is_named_in_the_notes(tmp_path: Path) -> None:
    p = tmp_path / "cube.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("cube", data=np.zeros((2, 2, 2)))
        f.create_dataset("v", data=Y)
    (ds,) = import_auto_sheets(p)
    assert any("/cube is 3-D" in n for n in ds.metadata["notes"])


def test_file_with_nothing_importable_says_why(tmp_path: Path) -> None:
    p = tmp_path / "empty.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("scalar", data=3.0)
        f.create_dataset("name", data=np.bytes_("hello"))
    with pytest.raises(ValueError, match="nothing to import"):
        import_auto(p)


# --- registry / hostile input --------------------------------------------------


@pytest.mark.parametrize("name", ["a.h5", "a.hdf5", "a.nxs", "A.H5"])
def test_extensions_resolve_to_the_hdf5_parser(tmp_path: Path, name: str) -> None:
    p = tmp_path / name
    p.write_bytes((FX / "generic.h5").read_bytes())
    assert resolve_parser(p).__name__ == "import_hdf5"


@pytest.mark.parametrize("suffix", [".h5", ".hdf5", ".nxs"])
def test_non_hdf5_file_is_refused_with_a_clear_message(tmp_path: Path, suffix: str) -> None:
    p = tmp_path / f"fake{suffix}"
    p.write_bytes(b"this is not hdf5\n" * 10)
    with pytest.raises(ValueError, match="not an HDF5 file"):
        import_auto(p)


def test_declared_huge_dataset_is_refused_before_it_is_allocated(tmp_path: Path) -> None:
    """A never-written dataset reads back as its fill value: ~1 KB declares gigabytes."""
    p = tmp_path / "bomb.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("big", shape=(1 << 27,), dtype="f8")
        f.create_dataset("ok", data=Y)
    assert p.stat().st_size < 50_000
    with pytest.raises(ValueError, match="declares"):
        import_auto(p)


def test_external_storage_is_never_read(tmp_path: Path) -> None:
    other = tmp_path / "secret.bin"
    other.write_bytes(np.arange(8.0).tobytes())
    p = tmp_path / "ext.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("leak", shape=(8,), dtype="f8", external=[(str(other), 0, 64)])
    with pytest.raises(ValueError, match="another file"):
        import_auto(p)


def test_external_links_are_not_followed(tmp_path: Path) -> None:
    other = tmp_path / "other.h5"
    with h5py.File(other, "w") as f:
        f.create_dataset("v", data=Y)
    p = tmp_path / "link.h5"
    with h5py.File(p, "w") as f:
        f["ext"] = h5py.ExternalLink(str(other), "/")
        f.create_dataset("mine", data=X)
    (ds,) = import_auto_sheets(p)
    assert ds.labels == ("mine",)


def test_group_cycles_terminate(tmp_path: Path) -> None:
    p = tmp_path / "cycle.h5"
    with h5py.File(p, "w") as f:
        g = f.create_group("a")
        g.create_dataset("v", data=Y)
        g["loop"] = f  # a hard link back to the root
    (ds,) = import_auto_sheets(p)
    assert ds.labels == ("v",)


def test_read_hdf5_books_is_the_registry_book_lister() -> None:
    assert len(read_hdf5_books(FX / "generic.h5")) == 3
