"""Registry, wire, `qz convert` and licence checks for the gap-5 lane D formats
(HDF5/NeXus, MATLAB .mat, Igor .ibw, images). Per-format behaviour is in
test_io_hdf5_read.py, test_io_matlab_mat.py, test_io_igor_ibw.py and
test_io_image_import.py."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.cli_convert import convert_command
from quantized.io import registry

ROOT = Path(__file__).resolve().parents[1]
FX = Path(__file__).parent / "fixtures" / "import_formats"
NEW_EXTS = (".h5", ".hdf5", ".nxs", ".mat", ".ibw", ".png", ".tif", ".tiff", ".jpg", ".jpeg")
client = TestClient(app)


@pytest.mark.parametrize("ext", NEW_EXTS)
def test_each_extension_is_registered_exactly_once(ext: str) -> None:
    """One registry, no dual registration: in the extension map OR the sniffer
    table, never both, and a sniffer chain names each parser once."""
    in_map = ext in registry._EXT_MAP
    chain = registry._SNIFFERS.get(ext, [])
    assert in_map != bool(chain)
    assert len({id(parser) for _, parser in chain}) == len(chain)


def test_hdf5_extensions_are_content_sniffed() -> None:
    for ext in (".h5", ".hdf5", ".nxs"):
        assert [p.__name__ for _, p in registry._SNIFFERS[ext]] == ["import_hdf5"]


def test_multi_book_parsers_are_registered_parsers() -> None:
    registered = {
        *registry._EXT_MAP.values(),
        *(p for c in registry._SNIFFERS.values() for _, p in c),
    }
    assert set(registry._ALL_BOOKS) <= registered
    assert {p.__name__ for p in registry._ALL_BOOKS} == {
        "import_hdf5",
        "import_mat",
        "import_image",
    }


def test_recognised_names() -> None:
    for ext in NEW_EXTS:
        assert registry.is_recognised_data_name(f"x{ext}")


def test_heavy_libraries_stay_lazy() -> None:
    """Importing the registry must not load h5py, Pillow or scipy.io."""
    code = (
        "import sys, quantized.io.registry;"
        "print([m for m in ('h5py', 'PIL', 'scipy.io') if m in sys.modules])"
    )
    out = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, check=True, cwd=ROOT
    )
    assert out.stdout.strip().splitlines()[-1] == "[]"


# --- licence gate ---------------------------------------------------------------


def test_igor_reader_is_in_house_and_no_igor_package_is_a_dependency() -> None:
    """The Igor packages on PyPI are LGPL/GPL, which the Apache-2.0 gate refuses."""
    src = (ROOT / "src" / "quantized" / "io" / "igor_ibw.py").read_text(encoding="utf-8")
    imports = re.findall(r"^\s*(?:from|import)\s+([\w.]+)", src, flags=re.M)
    assert not [m for m in imports if m.lower().startswith(("igor", "igorpy", "pyigor"))]
    pyproject = (ROOT / "pyproject.toml").read_text(encoding="utf-8").lower()
    for pkg in ("igor2", "pyigor", "igorpy", "igor-"):
        assert pkg not in pyproject


def test_repo_gpl_list_names_the_igor_packages() -> None:
    gate = (Path(__file__).parent / "test_repo_integrity.py").read_text(encoding="utf-8")
    assert '"igor2"' in gate


# --- the import wire ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "n_extra"),
    [
        ("nexus_1d.nxs", 0),
        ("nexus_2d.nxs", 0),
        ("generic.h5", 2),
        ("quantized_export.h5", 1),
        ("workspace_v5.mat", 2),
        ("workspace_v73.mat", 1),
        ("wave_v5.ibw", 0),
        ("wave2d_v5.ibw", 0),
        ("gray8.png", 0),
        ("gray16.tif", 0),
        ("pages.tif", 1),
        ("photo.jpg", 0),
    ],
)
def test_upload_returns_json_native_payloads_with_every_book(name: str, n_extra: int) -> None:
    resp = client.post(
        "/api/parsers/upload",
        files={"file": (name, (FX / name).read_bytes(), "application/octet-stream")},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body.get("sheets", [])) == n_extra
    assert body["metadata"]["technique"]
    assert Path(body["metadata"]["source"]).name == name  # the upload's own name, not a temp path


def test_a_refused_file_is_a_422_with_the_reason() -> None:
    resp = client.post(
        "/api/parsers/upload",
        files={"file": ("bad.ibw", b"\x7f\x00junk" * 40, "application/octet-stream")},
    )
    assert resp.status_code == 422
    assert "not an Igor binary wave" in resp.text


# --- qz convert ------------------------------------------------------------------------


def _convert(tmp_path: Path, *args: str) -> tuple[int, dict]:
    out = tmp_path / "out"
    code = convert_command([*args, "--out", str(out)])
    report = json.loads((out / "convert-report.json").read_text(encoding="utf-8"))
    return code, report


def test_convert_writes_one_csv_per_dataset_for_each_format(tmp_path: Path) -> None:
    files = [
        FX / n
        for n in ("generic.h5", "workspace_v5.mat", "wave_v5.ibw", "gray8.png", "nexus_1d.nxs")
    ]
    code, report = _convert(tmp_path, *map(str, files), "--to", "csv")
    assert code == 0 and report["summary"] == {"ok": 5, "partial": 0, "failed": 0}
    names = sorted(p.name for p in (tmp_path / "out").glob("*.csv"))
    assert "wave_v5.ibw.csv" in names and "gray8.png.csv" in names and "nexus_1d.nxs.csv" in names
    assert "generic.h5__scan (n=6).csv" in names or any("scan" in n for n in names)
    assert sum(n.startswith("workspace_v5.mat__") for n in names) == 3
    text = (tmp_path / "out" / "wave_v5.ibw.csv").read_text(encoding="utf-8")
    assert "moment" in text and "emu" in text


def test_convert_xlsx_is_one_workbook_with_a_tab_per_dataset(tmp_path: Path) -> None:
    openpyxl = pytest.importorskip("openpyxl")
    code, report = _convert(tmp_path, str(FX / "generic.h5"), "--to", "xlsx")
    assert code == 0
    wb = openpyxl.load_workbook(tmp_path / "out" / "generic.h5.xlsx")
    assert len(wb.sheetnames) == 3
    assert [b["status"] for b in report["files"][0]["books"]] == ["written"] * 3


def test_convert_refuses_dwk_for_a_non_project_and_keeps_going(tmp_path: Path) -> None:
    code, report = _convert(tmp_path, str(FX / "wave_v5.ibw"), "--to", "dwk")
    assert code == 1
    assert "Origin projects only" in report["files"][0]["error"]


def test_convert_reports_a_bad_file_and_converts_the_rest(tmp_path: Path) -> None:
    bad = tmp_path / "bad.nxs"
    bad.write_bytes(b"not hdf5" * 10)
    code, report = _convert(tmp_path, str(bad), str(FX / "wave_v5.ibw"), "--to", "csv")
    assert code == 1
    assert report["summary"] == {"ok": 1, "partial": 0, "failed": 1}
    assert "not an HDF5 file" in report["files"][0]["error"]


def test_convert_never_overwrites(tmp_path: Path) -> None:
    args = (str(FX / "wave_v5.ibw"), "--to", "csv")
    assert _convert(tmp_path, *args)[0] == 0
    again = convert_command(
        [*args, "--out", str(tmp_path / "out"), "--report", str(tmp_path / "r2.json")]
    )
    report = json.loads((tmp_path / "r2.json").read_text(encoding="utf-8"))
    assert again == 1
    assert "exists, not overwritten" in json.dumps(report)
    forced = convert_command(
        [
            *args,
            "--out",
            str(tmp_path / "out"),
            "--report",
            str(tmp_path / "r3.json"),
            "--overwrite",
        ]
    )
    assert forced == 0
