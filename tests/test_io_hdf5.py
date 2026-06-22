"""HDF5 exporter: golden parity vs MATLAB + behaviour / edge cases.

Port of MATLAB ``+utilities/exportHDF5.m``. HDF5 *bytes* differ between MATLAB
``h5write`` and Python ``h5py``, so the golden freezes the **logical content**:
every dataset path / shape / class / values and every attribute name -> value,
read back from the MATLAB-written file via ``h5info``/``h5read``/``h5readatt``
(see ``tools/matlab/freeze_hdf5_only.m``).

The parity test builds an equivalent ``DataStruct`` (using the same camelCase
metadata keys the MATLAB synthetic struct used), writes it with
``quantized.io.hdf5.write_hdf5``, reopens with ``h5py``, and asserts the dataset
tree + dtypes + values + attributes match the frozen MATLAB structure.

Two implementation-named attributes are intentionally *not* required to match
the frozen value: ``toolboxName`` (``quantized`` vs ``quantized_matlab``) and
``createdAt`` (a non-deterministic timestamp). Both must still be present.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import h5py
import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io._hdf5_layout import encode_padded_ascii
from quantized.io.hdf5 import write_hdf5

# Attributes whose value is implementation-specific / non-deterministic: the
# Python writer is allowed to differ on the value but must still emit the attr.
_VALUE_EXEMPT_ATTRS = {"toolboxName", "createdAt"}

# MATLAB integer-typed datasets/attrs map onto these numpy dtype kinds.
_INT_CLASSES = {"uint8", "int32", "uint32"}


def _synthetic_datastruct() -> tuple[DataStruct, DataStruct, dict[str, float], list]:
    """Reconstruct the exact logical input frozen in freeze_hdf5_only.m."""
    time = [10.0, 20.0, 30.0, 40.0]
    values = [[1.5, -2.0], [3.25, 4.0], [5.0, 6.5], [7.75, 8.0]]
    labels = ["2-Theta", "Intensity (a.u.)"]
    units = ["deg", "cps"]
    meta: dict[str, Any] = {
        "parserName": "importSynthetic",
        "xColumnName": "2-Theta",
        "xColumnUnit": "deg",
        "source": "synth.dat",
        "parserSpecific": {
            "countingTime": 23.97,
            "numPoints": 4,
            "detector": "PIXcel",
            "scanAxis": "2Theta-Omega",
        },
    }
    data = DataStruct.create(time, values, labels=labels, units=units, metadata=meta)
    corr_values = [[v + 0.1 for v in row] for row in values]
    corr = DataStruct.create(
        time, corr_values, labels=labels, units=units, metadata=meta
    )
    corrections = {"xOff": 0.05, "yOff": 0.0, "bgSlope": 0.0, "bgInt": 0.0}
    peaks = [
        {
            "center": 31.2,
            "fwhm": 0.12,
            "height": 1000.0,
            "xRange": [30.0, 32.0],
            "status": "fitted",
            "bg": 10.0,
            "model": "Gaussian",
        },
        {
            "center": 45.8,
            "fwhm": 0.20,
            "height": 500.0,
            "xRange": [45.0, 47.0],
            "status": "manual",
            "bg": 12.0,
            "model": "Lorentzian",
        },
    ]
    return data, corr, corrections, peaks


def _norm_path(path: str) -> str:
    """Collapse MATLAB's leading ``//`` (root) into a single ``/``."""
    return "/" + path.lstrip("/")


@pytest.mark.golden
def test_hdf5_matches_matlab_tree(
    load_golden: Callable[[str], dict[str, Any]], tmp_path: Path
) -> None:
    """Python-written HDF5 tree/dtypes/values/attrs match frozen MATLAB content."""
    ref = load_golden("hdf5_synth_default.json")
    data, corr, corrections, peaks = _synthetic_datastruct()

    out = tmp_path / "synth.h5"
    write_hdf5(
        data,
        out,
        corr_data=corr,
        corrections=corrections,
        include_peaks=True,
        peaks=peaks,
    )

    with h5py.File(out, "r") as hf:
        _check_datasets(hf, ref["datasets"])
        _check_attributes(hf, ref["attributes"])


def _check_datasets(hf: h5py.File, ref_datasets: list[dict[str, Any]]) -> None:
    """Every frozen dataset is present with matching shape/dtype/values."""
    for entry in ref_datasets:
        path = _norm_path(entry["path"])
        assert path in hf, f"missing dataset: {path}"
        dset = hf[path]
        assert isinstance(dset, h5py.Dataset), f"{path} is not a dataset"
        arr = np.asarray(dset[()])

        # dtype kind parity (int vs float).
        if entry["class"] in _INT_CLASSES:
            assert np.issubdtype(arr.dtype, np.integer), (
                f"{path}: expected integer dtype, got {arr.dtype}"
            )
        else:
            assert np.issubdtype(arr.dtype, np.floating), (
                f"{path}: expected float dtype, got {arr.dtype}"
            )

        if entry.get("strvalue"):
            # Padded-ASCII string matrix: reconstruct expected matrix and compare.
            expected = encode_padded_ascii(entry["strvalue"])
            np.testing.assert_array_equal(
                arr, expected, err_msg=f"{path}: string matrix mismatch"
            )
        else:
            # MATLAB jsonencode flattens column-major; reshape to frozen shape.
            shape = tuple(entry["shape"])
            flat = np.atleast_1d(np.asarray(entry["values"], dtype=float))
            expected = flat.reshape(shape, order="F")
            np.testing.assert_allclose(
                arr.astype(float),
                expected,
                rtol=1e-12,
                atol=1e-12,
                err_msg=f"{path}: values mismatch",
            )


def _check_attributes(hf: h5py.File, ref_attrs: list[dict[str, Any]]) -> None:
    """Every frozen attribute is present with matching value (modulo exemptions)."""
    for entry in ref_attrs:
        path = _norm_path(entry["path"])
        name = entry["name"]
        assert path in hf, f"missing object for attr: {path}"
        obj = hf[path]
        assert name in obj.attrs, f"{path}: missing attribute {name}"
        if name in _VALUE_EXEMPT_ATTRS:
            continue  # implementation-specific value; presence checked above

        actual = obj.attrs[name]
        expected = entry["value"]
        if entry["class"] == "char":
            actual_str = (
                actual.decode() if isinstance(actual, bytes) else str(actual)
            )
            assert actual_str == expected, (
                f"{path}.{name}: {actual_str!r} != {expected!r}"
            )
        else:
            np.testing.assert_allclose(
                np.asarray(actual, dtype=float).ravel(),
                np.atleast_1d(np.asarray(expected, dtype=float)),
                rtol=1e-12,
                atol=1e-12,
                err_msg=f"{path}.{name}",
            )


# ── Behaviour / edge cases (no golden needed) ────────────────────────────────


def _basic_ds() -> DataStruct:
    return DataStruct.create(
        [1.0, 2.0, 3.0],
        [[10.0, 100.0], [20.0, 200.0], [30.0, 300.0]],
        labels=["A", "B"],
        units=["K", "emu"],
        metadata={"parser_name": "p", "x_column_name": "Temp", "extra": 5.0},
    )


def test_minimal_export_has_raw_group(tmp_path: Path) -> None:
    out = tmp_path / "min.h5"
    write_hdf5(_basic_ds(), out)
    with h5py.File(out, "r") as hf:
        assert "/raw/time" in hf
        assert "/raw/values" in hf
        assert hf.attrs["hasCorrected"] == 0
        assert hf.attrs["hasPeaks"] == 0
        assert hf.attrs["correctionsApplied"] == 0
        assert "/corrected" not in hf
        assert "/peaks" not in hf


def test_roundtrip_values_and_labels(tmp_path: Path) -> None:
    ds = _basic_ds()
    out = tmp_path / "rt.h5"
    write_hdf5(ds, out)
    with h5py.File(out, "r") as hf:
        np.testing.assert_allclose(np.asarray(hf["/raw/values"]), ds.values)
        np.testing.assert_allclose(
            np.asarray(hf["/raw/time"]).ravel(), ds.time
        )
        labels = _decode_ascii_matrix(np.asarray(hf["/raw/labels"]))
        units = _decode_ascii_matrix(np.asarray(hf["/raw/units"]))
        assert labels == list(ds.labels)
        assert units == list(ds.units)
        assert hf["/raw"].attrs["nChannels"] == 2


def test_snake_case_metadata_maps_to_camel_attrs(tmp_path: Path) -> None:
    out = tmp_path / "meta.h5"
    write_hdf5(_basic_ds(), out)
    with h5py.File(out, "r") as hf:
        assert _attr_str(hf["/metadata"], "parserName") == "p"
        assert _attr_str(hf["/metadata"], "xColumnName") == "Temp"
        # leftover flat key lands in parserSpecific
        assert hf["/metadata/parserSpecific"].attrs["extra"] == 5.0


def test_empty_metadata(tmp_path: Path) -> None:
    ds = DataStruct.create([1.0, 2.0], [[1.0], [2.0]], labels=["x"], units=["u"])
    out = tmp_path / "empty.h5"
    write_hdf5(ds, out)
    with h5py.File(out, "r") as hf:
        # common attrs default to empty string, never missing
        assert _attr_str(hf["/metadata"], "parserName") == ""
        assert _attr_str(hf["/metadata"], "source") == ""


def test_missing_units_default_to_empty(tmp_path: Path) -> None:
    ds = DataStruct.create([1.0, 2.0], [[1.0], [2.0]], labels=["x"])
    out = tmp_path / "nounits.h5"
    write_hdf5(ds, out)
    with h5py.File(out, "r") as hf:
        # DataStruct fills units with '' -> padded-ASCII single empty row
        units = _decode_ascii_matrix(np.asarray(hf["/raw/units"]))
        assert units == [""]


def test_multicolumn_values(tmp_path: Path) -> None:
    ds = DataStruct.create(
        [1.0, 2.0],
        [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
        labels=["a", "b", "c"],
        units=["", "", ""],
    )
    out = tmp_path / "multi.h5"
    write_hdf5(ds, out)
    with h5py.File(out, "r") as hf:
        assert np.asarray(hf["/raw/values"]).shape == (2, 3)
        assert hf["/raw"].attrs["nChannels"] == 3


def test_special_chars_in_labels(tmp_path: Path) -> None:
    ds = DataStruct.create(
        [1.0, 2.0],
        [[1.0], [2.0]],
        labels=["χ (m³/mol)"],  # non-ASCII -> replaced byte-for-byte
        units=["m^3"],
    )
    out = tmp_path / "special.h5"
    write_hdf5(ds, out)
    with h5py.File(out, "r") as hf:
        labels = _decode_ascii_matrix(np.asarray(hf["/raw/labels"]))
        # non-ASCII collapses to '?' (one byte each) but stays a single row
        assert len(labels) == 1
        assert labels[0].endswith("(m?/mol)")


def test_corrections_only_when_nonempty(tmp_path: Path) -> None:
    out = tmp_path / "corr.h5"
    write_hdf5(_basic_ds(), out, corrections={"xOff": 0.0, "yOff": 0.0})
    with h5py.File(out, "r") as hf:
        # finite values present -> group written, but applied flag is False (all 0)
        assert "/corrections/xOff" in hf
        assert hf.attrs["correctionsApplied"] == 0

    out2 = tmp_path / "corr2.h5"
    write_hdf5(_basic_ds(), out2, corrections={"x_off": 0.5})
    with h5py.File(out2, "r") as hf:
        assert hf["/corrections/xOff"][()].ravel()[0] == 0.5
        assert hf.attrs["correctionsApplied"] == 1


def test_peaks_group(tmp_path: Path) -> None:
    peaks = [{"center": 10.0, "fwhm": 0.5, "height": 100.0, "status": "fitted"}]
    out = tmp_path / "peaks.h5"
    write_hdf5(_basic_ds(), out, include_peaks=True, peaks=peaks)
    with h5py.File(out, "r") as hf:
        assert hf["/peaks/count"][()].ravel()[0] == 1
        assert hf["/peaks/center"][()].ravel()[0] == 10.0
        # missing xRange -> NaN
        assert np.isnan(hf["/peaks/xRange_lo"][()].ravel()[0])
        # missing model -> default empty string row
        models = _decode_ascii_matrix(np.asarray(hf["/peaks/model"]))
        assert models == [""]
        assert hf.attrs["hasPeaks"] == 1


def test_include_peaks_false_skips_group(tmp_path: Path) -> None:
    out = tmp_path / "nopeaks.h5"
    write_hdf5(_basic_ds(), out, include_peaks=False, peaks=[{"center": 1.0}])
    with h5py.File(out, "r") as hf:
        assert "/peaks" not in hf
        assert hf.attrs["hasPeaks"] == 0


def test_corrected_group(tmp_path: Path) -> None:
    ds = _basic_ds()
    out = tmp_path / "corrected.h5"
    write_hdf5(ds, out, corr_data=ds)
    with h5py.File(out, "r") as hf:
        assert "/corrected/values" in hf
        assert hf.attrs["hasCorrected"] == 1


def test_bad_extension_raises(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"\.h5 or \.hdf5"):
        write_hdf5(_basic_ds(), tmp_path / "out.txt")


def test_missing_directory_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="directory does not exist"):
        write_hdf5(_basic_ds(), tmp_path / "nope" / "out.h5")


def test_overwrite_false_raises_on_existing(tmp_path: Path) -> None:
    out = tmp_path / "exists.h5"
    write_hdf5(_basic_ds(), out)
    with pytest.raises(FileExistsError, match="overwrite=False"):
        write_hdf5(_basic_ds(), out, overwrite=False)


def test_overwrite_true_replaces(tmp_path: Path) -> None:
    out = tmp_path / "replace.h5"
    write_hdf5(_basic_ds(), out)
    write_hdf5(_basic_ds(), out)  # no raise
    assert out.exists()


def test_hdf5_suffix_accepted(tmp_path: Path) -> None:
    out = tmp_path / "out.hdf5"
    write_hdf5(_basic_ds(), out)
    assert out.exists()


# ── small decode helpers (mirror the readers a downstream tool would use) ────


def _decode_ascii_matrix(mat: np.ndarray) -> list[str]:
    """Decode a [M, L] padded-ASCII uint8 matrix to a list of M strings."""
    return [bytes(row.tolist()).decode("ascii").rstrip(" ") for row in mat]


def _attr_str(obj: Any, name: str) -> str:
    val = obj.attrs[name]
    return val.decode() if isinstance(val, bytes) else str(val)
