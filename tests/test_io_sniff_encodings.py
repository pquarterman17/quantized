"""Content sniffers see the same text the parsers do (round-4 import audit).

``decode_text`` already read a UTF-16 file with a BOM (Excel's "Unicode
Text", Windows PowerShell's default) for every parser, but the sniffers
read their header through ``read_head`` as latin-1, so ``[header]`` arrived
as ``[\\x00h\\x00e...`` and a UTF-16 Quantum Design / refl1d / SIMS file was
routed nowhere (or to the wrong parser). JCAMP read its whole file as
latin-1, and the XRD-export sniffer split its first line on ``\\n`` only.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.registry import import_auto
from quantized.io.xrd_csv import format_xrd_csv

_QD = (
    "[Header]\nBYAPP,VSM,1\n[Data]\n"
    "Comment,Time Stamp (sec),Temperature (K),Magnetic Field (Oe),Moment (emu)\n"
    ",1,300,-100,-1e-3\n,2,300,0,0\n,3,300,100,1e-3\n"
)

_JCAMP = (
    "##TITLE= test\n##JCAMP-DX= 4.24\n##DATA TYPE= INFRARED SPECTRUM\n"
    "##XUNITS= 1/CM\n##YUNITS= ABSORBANCE\n##XFACTOR= 1\n##YFACTOR= 1\n"
    "##FIRSTX= 400\n##LASTX= 403\n##NPOINTS= 4\n##XYDATA=(X++(Y..Y))\n"
    "400 1 2 3 4\n##END=\n"
)


def _write(tmp_path: Path, name: str, data: bytes) -> Path:
    path = tmp_path / name
    path.write_bytes(data)
    return path


def test_utf16_quantum_design_dat_reaches_its_parser(tmp_path: Path) -> None:
    ds = import_auto(_write(tmp_path, "vsm.dat", _QD.encode("utf-16")))
    assert ds.metadata["parser_name"] == "import_qd_vsm"
    assert ds.metadata["technique"] == "magnetometry.mvsh"
    assert ds.values[:, 0].tolist() == [-1e-3, 0.0, 1e-3]


def test_utf16_refl1d_profile_is_sniffed(fixtures_dir: Path, tmp_path: Path) -> None:
    text = (fixtures_dir / "refl1d_nbau_profile.dat").read_text(encoding="utf-8")
    ds = import_auto(_write(tmp_path, "profile.dat", text.encode("utf-16")))
    assert ds.metadata["parser_name"] == "import_refl1d_dat"


def test_utf16_sims_csv_is_sniffed(fixtures_dir: Path, tmp_path: Path) -> None:
    src = fixtures_dir / "sims_barrier.csv"
    reference = import_auto(src)
    ds = import_auto(_write(tmp_path, "sims.csv", src.read_text(encoding="utf-8").encode("utf-16")))
    assert ds.metadata["technique"] == "sims"
    assert ds.labels == reference.labels
    np.testing.assert_array_equal(ds.values, reference.values)


def test_utf16_jcamp_parses(tmp_path: Path) -> None:
    ds = import_auto(_write(tmp_path, "s.jdx", _JCAMP.encode("utf-16")))
    assert ds.time.tolist() == [400.0, 401.0, 402.0, 403.0]
    assert ds.values[:, 0].tolist() == [1.0, 2.0, 3.0, 4.0]


def test_utf8_jcamp_units_are_not_mojibake(tmp_path: Path) -> None:
    text = _JCAMP.replace("##TITLE= test", "##TITLE= film at 20 °C")
    ds = import_auto(_write(tmp_path, "s.jdx", text.encode("utf-8")))
    assert ds.metadata["title"] == "film at 20 °C"


def test_cr_only_xrd_export_keeps_its_technique(tmp_path: Path) -> None:
    """Classic-Mac line endings: the export marker is still the first line."""
    scan = DataStruct.create(
        np.array([10.0, 10.1, 10.2]),
        np.array([[1.0], [2.0], [3.0]]),
        labels=["Intensity"],
        units=["counts"],
        metadata={"x_column_name": "2-Theta", "x_column_unit": "deg", "counting_time": 1.0},
    )
    text = format_xrd_csv(scan).replace("\n", "\r")
    ds = import_auto(_write(tmp_path, "scan.csv", text.encode("utf-8")))
    assert ds.metadata["technique"] == "xrd.powder"
