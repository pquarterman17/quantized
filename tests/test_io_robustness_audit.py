"""Import-parser robustness audit (IO lane): damaged or unusual files.

Each test pins one input that used to crash with a non-``ValueError`` (a 500 at
the route) or to import silently wrong. Fixtures are generated here from the
repo's synthetic fixtures; nothing private.
"""

from __future__ import annotations

import random
from pathlib import Path

import numpy as np
import pytest

from quantized.io import import_auto
from quantized.io.base import decode_text
from quantized.io.delimited import import_csv
from quantized.io.qd import import_qd_vsm

FIX = Path(__file__).parent / "fixtures"


def _write(tmp_path: Path, name: str, data: bytes | str) -> Path:
    path = tmp_path / name
    path.write_bytes(data if isinstance(data, bytes) else data.encode())
    return path


def _corrupt(raw: bytes, seed: int) -> bytes:
    rng = random.Random(seed)
    buf = bytearray(raw)
    for _ in range(max(1, len(buf) // 500)):
        buf[rng.randrange(len(buf))] = rng.randrange(256)
    return bytes(buf)


# --- text decoding ------------------------------------------------------------


def test_utf16_without_bom_decodes() -> None:
    text = "T (K),M (emu)\n1,2\n3,4\n"
    assert decode_text(text.encode("utf-16-le")) == text
    assert decode_text(text.encode("utf-16-be")) == text


def test_utf16_without_bom_imports_as_a_table(tmp_path: Path) -> None:
    path = _write(tmp_path, "u16.csv", "a,b\n1,2\n3,4\n5,6\n".encode("utf-16-le"))
    ds = import_csv(path)
    assert ds.labels == ("b",)
    assert ds.values[:, 0].tolist() == [2.0, 4.0, 6.0]


def test_dos_eof_marker_adds_no_nan_row(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "z.csv", "a,b\n1,2\n3,4\n\x1a"))
    assert ds.values[:, 0].tolist() == [2.0, 4.0]


# --- delimited layout ---------------------------------------------------------


def test_excel_sep_hint_line_is_not_the_header(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "s.csv", "sep=;\na;b\n1;2\n3;4\n"))
    assert ds.metadata["x_column_name"] == "a"
    assert ds.labels == ("b",)
    assert ds.values[:, 0].tolist() == [2.0, 4.0]


@pytest.mark.parametrize("sep", ["   ", " "])
def test_space_aligned_header_names_containing_spaces(tmp_path: Path, sep: str) -> None:
    # Single-space separated names only regroup when a bracketed unit marks them.
    head = f"Field (Oe){sep}Moment (emu){sep}Err (emu)\n"
    ds = import_csv(_write(tmp_path, "h.dat", head + "1 2 3\n3 4 5\n5 6 7\n"))
    assert ds.metadata["x_column_name"] == "Field"
    assert ds.labels == ("Moment", "Err")
    assert ds.units == ("emu", "emu")
    assert ds.values.tolist() == [[2.0, 3.0], [4.0, 5.0], [6.0, 7.0]]


# --- fail closed with ValueError instead of a stray exception ------------------


def test_qd_data_heading_as_last_line(tmp_path: Path) -> None:
    path = _write(tmp_path, "t.dat", "[Header]\nTITLE,x\n[Data]\n")
    with pytest.raises(ValueError, match=r"\[Data\]"):
        import_qd_vsm(path)


def test_qd_missing_x_column_is_value_error(tmp_path: Path) -> None:
    path = _write(
        tmp_path, "q.dat", "[Header]\nTITLE,x\n[Data]\nComment,Foo\nx,1\ny,2\n"
    )
    with pytest.raises(ValueError, match="x-axis"):
        import_qd_vsm(path)


def test_lakeshore_loop_without_temperature_column(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "loop.csv",
        "Lake Shore VSM\nSample\nField (Oe),Moment (emu)\n1,2\n3,4\n",
    )
    with pytest.raises(ValueError, match="x-axis"):
        import_auto(path)


def test_pnr_without_tabs_is_refused(tmp_path: Path) -> None:
    path = _write(tmp_path, "x.pnr", "Q R\n1/A x\n1 2\n3 4\n")
    with pytest.raises(ValueError, match="tab-delimited"):
        import_auto(path)


def test_sims_corrupt_depth_range_is_refused_not_memoryerror(tmp_path: Path) -> None:
    # Element B's depth axis has a 1e-6 step while A spans 1e6: a union grid of
    # 1e12 points used to raise MemoryError.
    lines = [
        "SIMS Analysis Laboratory",
        ":Sample X",
        "",
        "H,,C,,",
        "Depth,CONC.,Depth,CONC.",
        "(nm),(atoms/cc),(nm),(atoms/cc)",
        "",
        "0,1e20,0,1e20",
        "1000000,1e19,0.000001,1e19",
        "2000000,1e18,0.000002,1e18",
    ]
    path = _write(tmp_path, "sims.csv", "\n".join(lines) + "\n")
    with pytest.raises(ValueError):
        import_auto(path)


def test_empty_and_header_zeroed_mat_v5(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="MAT-file"):
        import_auto(_write(tmp_path, "e.mat", b""))
    raw = (FIX / "import_formats" / "workspace_v5.mat").read_bytes()
    with pytest.raises(ValueError, match="MAT-file"):
        import_auto(_write(tmp_path, "z.mat", b"\x00" * 64 + raw[64:]))


def test_truncated_mat_v73(tmp_path: Path) -> None:
    raw = (FIX / "import_formats" / "workspace_v73.mat").read_bytes()
    with pytest.raises(ValueError):
        import_auto(_write(tmp_path, "t.mat", raw[: len(raw) // 100]))


@pytest.mark.parametrize("name", ["nexus_1d.nxs", "quantized_export.h5", "generic.h5"])
def test_corrupted_hdf5_never_raises_a_stray_exception(tmp_path: Path, name: str) -> None:
    raw = (FIX / "import_formats" / name).read_bytes()
    for seed in range(12):
        path = _write(tmp_path, f"c{seed}{Path(name).suffix}", _corrupt(raw, seed))
        try:
            import_auto(path)
        except ValueError:
            pass  # the intended parse error (RuntimeError / OSError / KeyError were the bug)


@pytest.mark.parametrize(
    ("name", "keep"), [("gray8.png", 0.75), ("photo.jpg", 0.9), ("gray16.tif", 0.5)]
)
def test_truncated_image_is_value_error(tmp_path: Path, name: str, keep: float) -> None:
    raw = (FIX / "import_formats" / name).read_bytes()
    path = _write(tmp_path, name, raw[: int(len(raw) * keep)])
    with pytest.raises(ValueError, match="image"):
        import_auto(path)


@pytest.mark.parametrize("keep", [0.01, 0.9, 0.99])
def test_truncated_legacy_xls_is_value_error(tmp_path: Path, keep: float) -> None:
    raw = (FIX / "tiny_legacy.xls").read_bytes()
    path = _write(tmp_path, "t.xls", raw[: int(len(raw) * keep)])
    with pytest.raises(ValueError):
        import_auto(path)


def test_clean_fixtures_still_import() -> None:
    # Guard against the new wrappers swallowing good files.
    for rel in ("import_formats/nexus_1d.nxs", "import_formats/gray8.png", "tiny_legacy.xls"):
        ds = import_auto(FIX / rel)
        assert np.asarray(ds.values).size > 0
