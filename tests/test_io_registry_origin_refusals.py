"""Origin window / template / package files get an Origin-aware refusal.

Audit 2026-11: ``.ogw``/``.ogwu``/``.ogg``/``.ogm``/``.otw``/``.opx`` fell
through to the generic "no parser registered", which says nothing about what
to do. Quantized reads Origin PROJECTS (``.opj``/``.opju``) only.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from quantized.io.registry import import_auto


@pytest.mark.parametrize(
    "ext", [".ogw", ".ogwu", ".ogg", ".oggu", ".ogm", ".ogmu", ".otw", ".otwu", ".otm", ".otmu"]
)
def test_origin_window_and_template_files_explain_the_way_forward(
    tmp_path: Path, ext: str
) -> None:
    path = tmp_path / f"Book1{ext}"
    path.write_bytes(b"CPYA 4.3380 188 W64 #\n" + b"\x00" * 64)
    with pytest.raises(ValueError) as info:
        import_auto(path)
    msg = str(info.value)
    assert "no parser registered" not in msg
    assert "Origin window/template files can't be opened directly" in msg
    assert ".opj" in msg and "Origin Viewer" in msg


def test_origin_package_is_named_as_such(tmp_path: Path) -> None:
    path = tmp_path / "App.opx"
    path.write_bytes(b"PK\x03\x04" + b"\x00" * 64)
    with pytest.raises(ValueError, match=r"Origin package \(\.opx\)"):
        import_auto(path)


@pytest.mark.parametrize("ext", [".otp", ".otpu"])
def test_graph_templates_point_at_the_template_import(tmp_path: Path, ext: str) -> None:
    path = tmp_path / f"Line{ext}"
    path.write_bytes(b"CPYA 4.3227 188 #\n" + b"\x00" * 64)
    with pytest.raises(ValueError, match=r"Import Origin template"):
        import_auto(path)
