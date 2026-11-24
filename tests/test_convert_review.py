"""Review fixes for the quick converter: silent losses made explicit."""

from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io import convert_containers as cc
from quantized.io import convert_data as cd
from quantized.io.convert_data import convert_data_file


def _csv(tmp: Path, name: str, text: str) -> Path:
    src = tmp / "in" / name
    src.parent.mkdir(exist_ok=True)
    src.write_text(text, encoding="utf-8")
    return src


def test_infinite_values_blank_in_csv_are_reported(tmp_path: Path) -> None:
    src = _csv(tmp_path, "d.csv", "T,M\n1,1\n2,inf\n3,3\n")
    rep = convert_data_file(src, tmp_path / "out", "csv")
    assert rep["status"] == "ok", rep
    notes = " ".join(n for b in rep["books"] for n in b["notes"])
    assert "infinite" in notes and "csv" in notes
    again = convert_data_file(src, tmp_path / "out2", "xy")
    assert not any("infinite" in n for b in again["books"] for n in b["notes"])


def test_infinite_note_survives_no_metadata(tmp_path: Path) -> None:
    src = _csv(tmp_path, "d.csv", "T,M\n1,1\n2,inf\n3,3\n")
    rep = convert_data_file(src, tmp_path / "out", "xlsx", metadata=False)
    assert any("infinite" in n for b in rep["books"] for n in b["notes"])


def test_all_nan_dataset_is_reported_not_silently_dropped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    nan = DataStruct.create([1.0, 2.0], [[np.nan], [np.nan]], labels=["M"], units=["u"])
    good = DataStruct.create([1.0, 2.0], [[1.0], [2.0]], labels=["M"], units=["u"])
    monkeypatch.setattr(cd, "import_auto_sheets", lambda _p: [nan, good])
    src = _csv(tmp_path, "d.csv", "x\n")
    rep = convert_data_file(src, tmp_path / "out", "xlsx")
    assert rep["status"] == "ok"
    assert any("no finite numbers" in n for b in rep["books"] for n in b["notes"])
    monkeypatch.setattr(cd, "import_auto_sheets", lambda _p: [nan])
    rep = convert_data_file(src, tmp_path / "out2", "csv")
    assert rep["status"] == "failed" and rep["error"] == "no dataset holds numbers"


def test_unknown_raw_error_points_at_xrdml(tmp_path: Path) -> None:
    src = tmp_path / "in" / "scan.raw"
    src.parent.mkdir()
    src.write_bytes(b"RAW_1.01\0\0\0\0junk")
    rep = convert_data_file(src, tmp_path / "out", "csv")
    assert rep["status"] == "failed"
    assert "PANalytical" in rep["error"] and ".xrdml" in rep["error"]
    assert not (tmp_path / "out").exists() or not list((tmp_path / "out").iterdir())


def test_h5_duplicate_channel_labels_keep_all_data_and_right_signal(tmp_path: Path) -> None:
    ds = DataStruct.create(
        [0.0, 1.0], [[1.0, 10.0], [2.0, 20.0]], labels=["I", "I"], units=["a", "b"],
        metadata={"x_column_name": "t"},
    )  # fmt: skip
    cc.write_h5(tmp_path / "d.h5", [("d", ds)])
    with h5py.File(tmp_path / "d.h5") as f:
        g = f["d/data"]
        assert g.attrs["signal"] == "I"
        aux = list(g.attrs["auxiliary_signals"])
        assert aux == ["I (2)"]
        assert np.allclose(g["I"][:], [1, 2]) and np.allclose(g["I (2)"][:], [10, 20])
        assert g["I (2)"].attrs["units"] == "b"


def test_non_ascii_input_and_output_dirs_round_trip(tmp_path: Path) -> None:
    src = _csv(tmp_path, "mesure_é日本.csv", "T,M\n1,1\n2,2\n")
    out = tmp_path / "sortie_ü"
    for fmt in ("csv", "xy", "h5", "mat", "json", "npz", "xlsx"):
        rep = convert_data_file(src, out, fmt)
        assert rep["status"] == "ok", rep
        assert (out / rep["outputs"][0]).stat().st_size > 0
    assert not [p for p in out.iterdir() if p.name.startswith(".")]
