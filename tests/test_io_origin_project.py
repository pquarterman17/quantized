"""Origin project (.opj / .opju) recognition + guidance.

The clean-room binary decoders are built against local sample files (see
tests/realdata/origin/); until then quantized recognizes the formats and raises
an actionable error pointing at the export-via-Origin-Viewer fallback. These
tests pin the recognition + registry wiring + error contract so the real decoder
slots in without regressing the fallback (which stays the path for undecodable
versions / .opju).
"""

from __future__ import annotations

import pytest

from quantized.io.origin_project import OriginProjectError, read_origin_project
from quantized.io.registry import import_auto, resolve_parser


def test_registry_resolves_origin_extensions(tmp_path) -> None:
    for ext in (".opj", ".opju", ".OPJ", ".OpjU"):  # resolve lowercases the suffix
        f = tmp_path / f"project{ext}"
        f.write_bytes(b"\x00\x00")  # content is irrelevant to recognition
        assert resolve_parser(f) is read_origin_project


def test_opj_import_raises_actionable_guidance(tmp_path) -> None:
    f = tmp_path / "legacy.opj"
    f.write_bytes(b"\x00\x00")
    with pytest.raises(OriginProjectError) as exc:
        import_auto(f)
    msg = str(exc.value)
    assert "legacy.opj" in msg
    assert "Origin Viewer" in msg  # the working fallback is named
    assert "CSV" in msg


def test_opju_import_flags_no_open_reader_reality(tmp_path) -> None:
    f = tmp_path / "recent.opju"
    f.write_bytes(b"\x00\x00")
    with pytest.raises(OriginProjectError) as exc:
        import_auto(f)
    msg = str(exc.value)
    assert "recent.opju" in msg
    assert "no open-source reader" in msg
    assert "Origin Viewer" in msg


def test_error_is_a_valueerror_so_the_route_maps_it_to_422() -> None:
    # routes/parsers.py catches ValueError → HTTP 422 with the message intact.
    assert issubclass(OriginProjectError, ValueError)
