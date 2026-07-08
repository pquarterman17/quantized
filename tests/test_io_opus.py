"""Bruker OPUS ``.opus`` binary parser: synthetic-fixture tests.

No MATLAB source exists to port/freeze (``importOpus.m`` was never written —
see ``quantized/io/opus.py`` module docstring and PORT_CHECKLIST line 46), so
there is no ``@pytest.mark.golden`` case here, and (unlike ``spc.py``) no
real sample file was available either. These fixtures are built byte-for-
byte from the documented OPUS block-directory layout, independently of
``quantized.io.opus`` (the directory/param-record packing below is
hand-written, not imported from the module under test).
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.opus import import_opus, is_opus

_HEADER_LEN = 504
_DIR_START = 24
_DIR_ENTRY_SIZE = 12


class _OpusBuilder:
    """Assembles a synthetic OPUS file: header directory + chunk payloads."""

    def __init__(self) -> None:
        self._chunks: list[bytes] = []
        self._entries: list[tuple[int, int, int, int, int]] = []  # + chunk index

    def add_series(self, data_type: int, channel_type: int, values: list[float]) -> None:
        chunk = struct.pack(f"<{len(values)}f", *values)
        self._entries.append((data_type, channel_type, 0, len(values), len(self._chunks)))
        self._chunks.append(chunk)

    def add_params(
        self, data_type: int, channel_type: int, params: list[tuple[str, object]]
    ) -> None:
        chunk = b""
        for name, value in params:
            if isinstance(value, int):
                type_idx, payload = 0, struct.pack("<i", value)
            elif isinstance(value, float):
                type_idx, payload = 1, struct.pack("<d", value)
            else:
                raw = value.encode("latin-1") + b"\x00"
                if len(raw) % 2:
                    raw += b"\x00"
                type_idx, payload = 2, raw
            size_words = len(payload) // 2
            chunk += name.encode("ascii")[:3].ljust(3, b"\x00") + b"\x00"
            chunk += struct.pack("<HH", type_idx, size_words) + payload
        chunk += b"END\x00" + struct.pack("<HH", 0, 0)
        n_words = (len(chunk) + 3) // 4
        chunk = chunk.ljust(n_words * 4, b"\x00")
        self._entries.append((data_type, channel_type, 0, n_words, len(self._chunks)))
        self._chunks.append(chunk)

    def add_text(self, text_type: int, text: str) -> None:
        raw = text.encode("latin-1") + b"\x00"
        n_words = (len(raw) + 3) // 4
        raw = raw.ljust(n_words * 4, b"\x00")
        self._entries.append((0, 0, text_type, n_words, len(self._chunks)))
        self._chunks.append(raw)

    def build(self) -> bytes:
        header = bytearray(_HEADER_LEN)
        body = bytearray()
        offsets: list[int] = []
        cursor = _HEADER_LEN
        for chunk in self._chunks:
            offsets.append(cursor)
            body += chunk
            cursor += len(chunk)
        dir_cursor = _DIR_START
        for (data_type, channel_type, text_type, chunk_size, chunk_idx) in self._entries:
            if dir_cursor + _DIR_ENTRY_SIZE > _HEADER_LEN:
                break
            header[dir_cursor] = data_type
            header[dir_cursor + 1] = channel_type
            header[dir_cursor + 2] = text_type
            struct.pack_into("<II", header, dir_cursor + 4, chunk_size, offsets[chunk_idx])
            dir_cursor += _DIR_ENTRY_SIZE
        return bytes(header) + bytes(body)


def _write(tmp_path: Path, name: str, content: bytes) -> Path:
    p = tmp_path / name
    p.write_bytes(content)
    return p


def test_primary_ab_block_with_parameters(tmp_path: Path) -> None:
    b = _OpusBuilder()
    ab = [0.1, 0.2, 0.3, 0.15]
    b.add_series(15, 0, ab)
    b.add_params(31, 0, [("FXV", 4000.0), ("LXV", 400.0), ("NPT", len(ab)), ("DXU", "WN")])
    path = _write(tmp_path, "sample.opus", b.build())

    ds = import_opus(path)
    assert ds.labels == ("Absorbance",)
    assert_allclose(ds.values[:, 0], ab)
    assert_allclose(ds.time[0], 4000.0)
    assert_allclose(ds.time[-1], 400.0)
    assert ds.metadata["primary_block"] == "AB"
    assert ds.metadata["x_column_name"] == "Wavenumber (cm-1)"


def test_fallback_to_scsm_when_no_ab(tmp_path: Path) -> None:
    b = _OpusBuilder()
    sc = [1.0, 2.0, 3.0]
    b.add_series(7, 4, sc)  # ScSm
    b.add_params(23, 4, [("FXV", 0.0), ("LXV", 2.0), ("NPT", 3)])
    ds = import_opus(_write(tmp_path, "scsm.opus", b.build()))
    assert ds.metadata["primary_block"] == "ScSm"
    assert_allclose(ds.time, [0.0, 1.0, 2.0])
    assert_allclose(ds.values[:, 0], sc)


def test_text_and_param_blocks_captured(tmp_path: Path) -> None:
    b = _OpusBuilder()
    b.add_series(15, 0, [1.0, 2.0])
    b.add_params(31, 0, [("FXV", 0.0), ("LXV", 1.0), ("NPT", 2)])
    b.add_params(32, 0, [("INS", "IFS 66"), ("RES", 4.0), ("SGN", 16)])
    b.add_text(104, "history line one\nhistory line two")
    ds = import_opus(_write(tmp_path, "meta.opus", b.build()))
    assert ds.metadata["parameters"]["Instrument"]["INS"] == "IFS 66"
    assert_allclose(ds.metadata["parameters"]["Instrument"]["RES"], 4.0)
    assert ds.metadata["parameters"]["Instrument"]["SGN"] == 16
    assert "history line one" in ds.metadata["text"]["History"]
    assert "AB" in ds.metadata["blocks_found"]
    assert "Instrument" in ds.metadata["blocks_found"]


def test_unknown_block_type_skipped(tmp_path: Path) -> None:
    b = _OpusBuilder()
    b.add_series(15, 0, [5.0, 6.0])
    b.add_params(31, 0, [("FXV", 0.0), ("LXV", 1.0), ("NPT", 2)])
    b._entries.append((250, 250, 0, 1, len(b._chunks)))  # unknown data_type
    b._chunks.append(b"\x00\x00\x00\x00")
    ds = import_opus(_write(tmp_path, "unknown.opus", b.build()))
    assert_allclose(ds.values[:, 0], [5.0, 6.0])  # parses fine, unknown block ignored


def test_no_spectrum_block_raises(tmp_path: Path) -> None:
    b = _OpusBuilder()
    b.add_text(8, "just some info, no spectrum")
    with pytest.raises(ValueError, match="no spectral data block"):
        import_opus(_write(tmp_path, "nospectrum.opus", b.build()))


def test_not_an_opus_file_raises(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        import_opus(_write(tmp_path, "notopus.opus", b"\x00" * 100))


def test_is_opus_sniffer(tmp_path: Path) -> None:
    b = _OpusBuilder()
    b.add_series(15, 0, [1.0])
    b.add_params(31, 0, [("FXV", 0.0), ("LXV", 0.0), ("NPT", 1)])
    good = _write(tmp_path, "good.opus", b.build())
    bad = _write(tmp_path, "bad.opus", b"\x00" * 600)
    assert is_opus(good) is True
    assert is_opus(bad) is False


def test_registry_dispatches_opus_extension(tmp_path: Path) -> None:
    b = _OpusBuilder()
    b.add_series(15, 0, [9.0, 8.0])
    b.add_params(31, 0, [("FXV", 0.0), ("LXV", 1.0), ("NPT", 2)])
    ds = import_auto(_write(tmp_path, "auto.opus", b.build()))
    assert_allclose(ds.values[:, 0], [9.0, 8.0])


def test_descending_wavenumber_sweep_preserved(tmp_path: Path) -> None:
    """Real FTIR spectra commonly sweep FXV > LXV (e.g. 4000 -> 400 cm-1)."""
    b = _OpusBuilder()
    ab = np.linspace(0.0, 1.0, 8).tolist()
    b.add_series(15, 0, ab)
    b.add_params(31, 0, [("FXV", 4000.0), ("LXV", 400.0), ("NPT", 8), ("DXU", "WN")])
    ds = import_opus(_write(tmp_path, "sweep.opus", b.build()))
    assert ds.time[0] > ds.time[-1]
    assert_allclose(ds.time, np.linspace(4000.0, 400.0, 8))
