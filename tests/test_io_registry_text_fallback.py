"""Plain text tables the Open dialogs offer must import (round-4 import audit).

Both Open dialogs offered ``.txt`` (and the desktop one ``.xy``/``.xye``), and
``qz.load("scan.xy")`` is the public API's own docstring example, yet the
registry had no parser for any of them -- and a ``.dat`` that was not one of
the four sniffed instrument formats failed the same way. Each now falls back
to the generic delimited parser, after every instrument sniffer had its turn.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from quantized.desktop_bridge_dialogs import IMPORT_FILE_TYPES
from quantized.io.registry import import_auto, is_recognised_data_name, resolve_parser


@pytest.mark.parametrize("name", ["scan.xy", "scan.XY", "run.txt", "log.dat"])
def test_headerless_two_column_text_imports(tmp_path: Path, name: str) -> None:
    path = tmp_path / name
    path.write_text("10.00 120\n10.02 135\n10.04 128\n", encoding="utf-8")
    ds = import_auto(path)
    assert ds.time.tolist() == [10.0, 10.02, 10.04]
    assert ds.values[:, 0].tolist() == [120.0, 135.0, 128.0]
    assert ds.metadata["technique"] == "generic"


def test_xye_keeps_its_error_column(tmp_path: Path) -> None:
    path = tmp_path / "scan.xye"
    path.write_text("# 2theta I esd\n10.0 100 10\n10.1 121 11\n", encoding="utf-8")
    ds = import_auto(path)
    assert ds.values.tolist() == [[100.0, 10.0], [121.0, 11.0]]


def test_txt_with_header_and_units(tmp_path: Path) -> None:
    path = tmp_path / "rt.txt"
    path.write_text("Temperature (K)\tResistance (Ohm)\n300\t10.5\n290\t10.2\n", encoding="utf-8")
    ds = import_auto(path)
    assert ds.metadata["x_column_name"] == "Temperature"
    assert ds.labels == ("Resistance",)
    assert ds.units == ("Ohm",)


def test_instrument_dat_sniffers_still_win(tmp_path: Path) -> None:
    """The catch-all is LAST: a Quantum Design file still reaches its parser."""
    path = tmp_path / "vsm.dat"
    path.write_text(
        "[Header]\nBYAPP,VSM,1\n[Data]\n"
        "Comment,Time Stamp (sec),Temperature (K),Magnetic Field (Oe),Moment (emu)\n"
        ",1,300,-100,-1e-3\n,2,300,100,1e-3\n",
        encoding="utf-8",
    )
    assert resolve_parser(path).__name__ == "import_qd_vsm"


def test_binary_dat_is_still_refused(tmp_path: Path) -> None:
    """The catch-all reads TEXT only; a binary .dat must not become a table of
    garbage text cells."""
    path = tmp_path / "frame.dat"
    path.write_bytes(bytes(range(256)) * 8)
    with pytest.raises(ValueError, match="no parser registered"):
        import_auto(path)


def test_legacy_xls_is_refused_with_a_reason(tmp_path: Path) -> None:
    path = tmp_path / "old.xls"
    path.write_bytes(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64)
    with pytest.raises(ValueError, match=r"re-save it as \.xlsx"):
        import_auto(path)


def _desktop_data_exts() -> list[str]:
    data = next(t for t in IMPORT_FILE_TYPES if t.startswith("Data files"))
    return sorted({m.lower() for m in re.findall(r"\*(\.[A-Za-z0-9]+)", data)})


def test_desktop_data_filter_offers_only_readable_extensions() -> None:
    """The reverse of test_desktop_import_filter: nothing under "Data files"
    may be an extension every pick of which then fails to import."""
    unreadable = [e for e in _desktop_data_exts() if not is_recognised_data_name(f"x{e}")]
    assert unreadable == []
