"""MATLAB .mat import (io.matlab_mat): v5 via scipy.io, v7.3 via h5py; numeric
arrays and structs of arrays become columns, names kept (gap-5 lane D)."""

from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np
import pytest
from scipy.io import savemat

from fixtures.make_import_fixtures import X, Y
from quantized.datastruct import DataStruct
from quantized.io import matlab_mat
from quantized.io.registry import import_auto, import_auto_sheets, resolve_parser

FX = Path(__file__).parent / "fixtures" / "import_formats"


def _by_sheet(path: Path) -> dict[str, DataStruct]:
    return {b.metadata["sheet_name"]: b for b in import_auto_sheets(path)}


def test_v5_variables_become_named_columns() -> None:
    books = _by_sheet(FX / "workspace_v5.mat")
    ws = books["workspace"]
    assert ws.labels == ("t", "signal", "mat2_1", "mat2_2")
    assert ws.values[:, 0].tolist() == X.tolist()
    assert ws.values[:, 1].tolist() == Y.tolist()
    assert ws.values[:, 2].tolist() == [0.0, 2.0, 4.0, 6.0, 8.0, 10.0]
    assert ws.time.tolist() == list(range(6))
    assert ws.metadata["x_column_name"] == "index"


def test_v5_struct_is_its_own_book_and_nested_fields_flatten_by_length() -> None:
    books = _by_sheet(FX / "workspace_v5.mat")
    scan = books["scan (n=6)"]
    assert scan.labels == ("H", "M")
    inner = books["scan (n=3)"]
    assert inner.labels == ("inner.c",)


def test_scalars_ride_in_metadata_and_skipped_variables_are_named() -> None:
    first = import_auto_sheets(FX / "workspace_v5.mat")[0]
    assert first.metadata["mat_scalars"] == {"k": 2.5}
    assert any("'title'" in n for n in first.metadata["notes"])


def test_v73_hdf5_layout_is_read_with_dimensions_unreversed() -> None:
    books = _by_sheet(FX / "workspace_v73.mat")
    ws = books["workspace"]
    assert set(ws.labels) == {"t", "mat2_1", "mat2_2"}
    col = ws.labels.index("t")
    assert ws.values[:, col].tolist() == X.tolist()
    m1 = ws.labels.index("mat2_2")
    assert ws.values[:, m1].tolist() == [1.0, 3.0, 5.0, 7.0, 9.0, 11.0]
    scan = books["scan"]
    assert scan.labels == ("H", "M")
    assert scan.values[:, 1].tolist() == Y.tolist()


def test_v5_and_v73_agree_on_the_same_data() -> None:
    a = {b.metadata["sheet_name"]: b for b in import_auto_sheets(FX / "workspace_v5.mat")}
    b = {b.metadata["sheet_name"]: b for b in import_auto_sheets(FX / "workspace_v73.mat")}
    assert np.array_equal(a["scan (n=6)"].values, b["scan"].values)


def test_extension_resolves_to_the_mat_parser() -> None:
    assert resolve_parser(FX / "workspace_v5.mat").__name__ == "import_mat"


def test_complex_cell_and_nd_arrays_are_named_not_imported(tmp_path: Path) -> None:
    p = tmp_path / "mixed.mat"
    savemat(
        p,
        {
            "ok": np.arange(4.0),
            "z": np.array([1 + 2j, 3 - 1j, 0 + 1j]),
            "cube": np.zeros((2, 2, 2)),
            "c": np.array([np.arange(2.0), "x"], dtype=object),
        },
    )
    (ds,) = import_auto_sheets(p)
    assert ds.labels == ("ok",)
    notes = " ".join(ds.metadata["notes"])
    assert "'z' is not imported: complex" in notes
    assert "'cube' is 3-D" in notes
    assert "'c'" in notes


def test_wide_matrix_becomes_a_map_over_its_indices(tmp_path: Path) -> None:
    p = tmp_path / "img.mat"
    savemat(p, {"img": np.arange(5 * 300.0).reshape(5, 300)})
    (ds,) = import_auto_sheets(p)
    assert ds.metadata["is2D"] is True
    assert ds.metadata["map_shape"] == [5, 300]
    assert ds.values[:, 2].tolist() == list(np.arange(1500.0))


def test_columns_of_different_length_are_split_not_paired(tmp_path: Path) -> None:
    p = tmp_path / "lens.mat"
    savemat(p, {"a": np.arange(5.0), "b": np.arange(5.0) * 2, "c": np.arange(7.0)})
    books = _by_sheet(p)
    assert books["workspace (n=5)"].labels == ("a", "b")
    assert books["workspace (n=7)"].labels == ("c",)


def test_only_scalars_and_text_is_refused_with_the_reasons(tmp_path: Path) -> None:
    p = tmp_path / "nothing.mat"
    savemat(p, {"name": "run 4", "s": 3.0})
    with pytest.raises(ValueError, match="nothing to import"):
        import_auto(p)


def test_a_variable_over_the_element_cap_is_refused_from_its_header(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    p = tmp_path / "big.mat"
    savemat(p, {"big": np.arange(100.0), "small": np.arange(3.0)})
    monkeypatch.setattr(matlab_mat, "MAX_DATASET_ELEMENTS", 10)
    (ds,) = import_auto_sheets(p)
    assert ds.labels == ("small",)
    assert any("'big' declares 100 elements" in n for n in ds.metadata["notes"])


def test_garbage_mat_is_refused_cleanly(tmp_path: Path) -> None:
    p = tmp_path / "junk.mat"
    p.write_bytes(b"not a mat file at all " * 20)
    with pytest.raises(ValueError, match="not a readable MATLAB MAT-file"):
        import_auto(p)


def test_v73_complex_and_struct_arrays_are_skipped(tmp_path: Path) -> None:
    p = tmp_path / "v73.mat"
    with h5py.File(p, "w", userblock_size=512) as f:
        ok = f.create_dataset("ok", data=np.arange(4.0).reshape(1, 4))
        ok.attrs["MATLAB_class"] = np.bytes_("double")
        cplx = np.zeros((1, 3), dtype=[("real", "f8"), ("imag", "f8")])
        f.create_dataset("z", data=cplx).attrs["MATLAB_class"] = np.bytes_("double")
        sp = f.create_group("sp")
        sp.attrs["MATLAB_class"] = np.bytes_("double")
        sp.attrs["MATLAB_sparse"] = np.uint64(3)
        f.create_group("#refs#")
    raw = bytearray(p.read_bytes())
    raw[:31] = b"MATLAB 7.3 MAT-file, fixture gen"[:31]
    p.write_bytes(bytes(raw))
    (ds,) = import_auto_sheets(p)
    assert ds.labels == ("ok",)
    assert ds.values[:, 0].tolist() == [0.0, 1.0, 2.0, 3.0]
