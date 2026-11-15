"""Igor .ibw import (io.igor_ibw): an in-house reader of the TN003 binary wave
layout, versions 2 and 5, both byte orders, with units and x scaling kept
(gap-5 lane D). The licence gate (no GPL/LGPL reader dependency) is pinned in
test_io_import_formats_registry.py."""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest

from fixtures.make_import_fixtures import GRID, Y, ibw_bytes
from quantized.io.registry import import_auto, resolve_parser

FX = Path(__file__).parent / "fixtures" / "import_formats"


def _write(tmp_path: Path, raw: bytes, name: str = "w.ibw") -> Path:
    p = tmp_path / name
    p.write_bytes(raw)
    return p


def test_v5_wave_keeps_scaling_units_name_and_note() -> None:
    ds = import_auto(FX / "wave_v5.ibw")
    assert ds.labels == ("moment",)
    assert ds.units == ("emu",)
    assert ds.time.tolist() == [10.0 + 0.5 * i for i in range(6)]  # x0 + dx * i
    assert ds.metadata["x_column_unit"] == "Oe"
    assert ds.metadata["igor_x0"] == [10.0]
    assert ds.metadata["igor_dx"] == [0.5]
    assert ds.metadata["igor_note"] == "fixture wave"
    assert ds.values[:, 0].tolist() == Y.tolist()


def test_v2_wave_float32_with_units() -> None:
    ds = import_auto(FX / "wave_v2.ibw")
    assert ds.labels == ("moment2",) and ds.units == ("V",)
    assert ds.time.tolist() == [1.0 + 0.25 * i for i in range(6)]
    assert ds.metadata["x_column_unit"] == "s"
    assert ds.metadata["igor_note"] == "v2 note"
    assert np.allclose(ds.values[:, 0], Y)


def test_2d_wave_is_a_map_with_its_own_axes() -> None:
    ds = import_auto(FX / "wave2d_v5.ibw")
    assert ds.metadata["is2D"] is True
    assert ds.metadata["map_shape"] == [3, 4]
    assert ds.units == ("um", "mm", "cts")
    # Igor's first dimension (rows) is X and runs fastest
    assert ds.values[:, 0].tolist() == [1.0 + 0.1 * i for i in range(4)] * 3
    assert ds.values[:, 1].tolist() == [-3.0] * 4 + [-1.0] * 4 + [1.0] * 4
    assert ds.values[:, 2].tolist() == GRID.ravel().tolist()


@pytest.mark.parametrize("version", [2, 5])
@pytest.mark.parametrize("big", [False, True])
def test_both_byte_orders(tmp_path: Path, version: int, big: bool) -> None:
    raw = ibw_bytes(Y, version=version, big_endian=big, dx=(2.0,), x0=(-1.0,))
    ds = import_auto(_write(tmp_path, raw))
    assert ds.values[:, 0].tolist() == Y.tolist()
    assert ds.time[:2].tolist() == [-1.0, 1.0]


@pytest.mark.parametrize(
    ("wave_type", "dtype"),
    [(0x10, "i2"), (0x20, "i4"), (0x50, "u2"), (2, "f4")],
)
def test_integer_and_float_wave_types(tmp_path: Path, wave_type: int, dtype: str) -> None:
    data = np.array([0, 1, 200, 30000], dtype=dtype)
    ds = import_auto(_write(tmp_path, ibw_bytes(data, wave_type=wave_type)))
    assert ds.values[:, 0].tolist() == data.astype(float).tolist()


def test_resolves_to_the_ibw_parser() -> None:
    assert resolve_parser(FX / "wave_v5.ibw").__name__ == "import_ibw"


def test_damaged_header_fails_the_checksum(tmp_path: Path) -> None:
    raw = bytearray(ibw_bytes(Y))
    raw[100] ^= 0xFF
    with pytest.raises(ValueError, match="checksum"):
        import_auto(_write(tmp_path, bytes(raw)))


def test_truncated_data_is_refused(tmp_path: Path) -> None:
    raw = ibw_bytes(np.arange(100.0))
    with pytest.raises(ValueError, match="truncated"):
        import_auto(_write(tmp_path, raw[:-300]))


def test_text_complex_and_3d_waves_are_refused_with_a_reason(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="text wave"):
        import_auto(_write(tmp_path, ibw_bytes(np.zeros(4), wave_type=0)))
    with pytest.raises(ValueError, match="complex"):
        import_auto(_write(tmp_path, ibw_bytes(np.zeros(4), wave_type=5)))
    with pytest.raises(ValueError, match="3-dimensional"):
        import_auto(_write(tmp_path, ibw_bytes(np.zeros((2, 3, 4)))))


def test_unsupported_and_foreign_files_are_refused(tmp_path: Path) -> None:
    v3 = struct.pack("<h", 3) + bytes(200)
    with pytest.raises(ValueError, match="version 3 is not supported"):
        import_auto(_write(tmp_path, v3))
    with pytest.raises(ValueError, match="not an Igor binary wave"):
        import_auto(_write(tmp_path, b"\x7f\x00hello world" * 20))


def test_a_point_count_that_disagrees_with_the_dimensions_is_refused(tmp_path: Path) -> None:
    raw = bytearray(ibw_bytes(Y))
    struct.pack_into("<i", raw, 64 + 12, 99)  # npnts
    struct.pack_into("<h", raw, 2, 0)
    total = sum(struct.unpack("<192h", bytes(raw[:384])))
    struct.pack_into("<H", raw, 2, (-total) & 0xFFFF)  # so only the point count is wrong
    with pytest.raises(ValueError, match="declares 99 points"):
        import_auto(_write(tmp_path, bytes(raw)))
