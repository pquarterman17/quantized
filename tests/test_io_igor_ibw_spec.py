"""Igor .ibw reader against waves assembled BYTE BY BYTE from the published
layout (WaveMetrics Technical Note TN003, "Igor Binary Format"), independent of
``tests/fixtures/make_import_fixtures.ibw_bytes`` (which shares the reader's
own offsets and so could not catch a shared misreading).

Every field below is a literal hex group with the TN003 field it encodes. The
two checksums are literals too (the value that makes the 16-bit words of the
checksummed span sum to zero mod 65536, as TN003 defines it); the test
re-derives that sum so a mistyped literal cannot hide. The reader was also run
against real Igor-written v2/v5 files in both byte orders, out of tree (their
licence does not allow committing them here).
"""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from quantized.io.registry import import_auto

_ZERO4 = "00 00 00 00"


def _hx(text: str) -> bytes:
    return bytes.fromhex(text.replace(" ", ""))


def _v5_wave() -> bytes:
    """Version 5 (little-endian): wave "w", 3 x float32 [1.5, 2.5, 3.5],
    x0 = 10, dx = 2, data units "V", x units "s"."""
    bin_header = _hx(
        "05 00"  # BinHeader5.version = 5
        "43 7d"  # BinHeader5.checksum (literal 0x7d43)
        "4c 01 00 00"  # wfmSize = 320 (WaveHeader5) + 12 (data) = 332
        f"{_ZERO4}"  # formulaSize
        f"{_ZERO4}"  # noteSize
        f"{_ZERO4}"  # dataEUnitsSize
        f"{_ZERO4 * 4}"  # dimEUnitsSize[4]
        f"{_ZERO4 * 4}"  # dimLabelsSize[4]
        f"{_ZERO4}"  # sIndicesSize
        f"{_ZERO4}"  # optionsSize1
        f"{_ZERO4}"  # optionsSize2
    )
    assert len(bin_header) == 64  # sizeof(BinHeader5)
    wave_header = bytearray(320)  # sizeof(WaveHeader5) without wData
    wave_header[12:16] = _hx("03 00 00 00")  # npnts = 3
    wave_header[16:18] = _hx("02 00")  # type = NT_FP32 (0x02)
    wave_header[28:29] = b"w"  # bname[32] = "w\0..."
    wave_header[68:72] = _hx("03 00 00 00")  # nDim[0] = 3 (rows); nDim[1..3] = 0
    wave_header[84:92] = _hx("00 00 00 00 00 00 00 40")  # sfA[0] = 2.0 (delta x), IEEE double LE
    wave_header[116:124] = _hx("00 00 00 00 00 00 24 40")  # sfB[0] = 10.0 (x0)
    wave_header[148:149] = b"V"  # dataUnits[4]
    wave_header[152:153] = b"s"  # dimUnits[0][4]
    data = _hx("00 00 c0 3f  00 00 20 40  00 00 60 40")  # float32 1.5, 2.5, 3.5
    return bin_header + bytes(wave_header) + data


def _v2_wave() -> bytes:
    """Version 2 (little-endian): wave "w", 3 x float32 [1.5, 2.5, 3.5],
    x0 = 1, dx = 0.5, data units "V", x units "s"."""
    bin_header = _hx(
        "02 00"  # BinHeader2.version = 2
        "7e 00 00 00"  # wfmSize = 110 (WaveHeader2 before wData) + 16 (wData[4]) = 126
        f"{_ZERO4}"  # noteSize
        f"{_ZERO4}"  # pictSize
        "2b be"  # BinHeader2.checksum (literal 0xbe2b)
    )
    assert len(bin_header) == 16  # sizeof(BinHeader2)
    wave_header = bytearray(110)  # WaveHeader2 up to wData
    wave_header[0:2] = _hx("02 00")  # type = NT_FP32
    wave_header[6:7] = b"w"  # bname[20]
    wave_header[34:35] = b"V"  # dataUnits[4]
    wave_header[38:39] = b"s"  # xUnits[4]
    wave_header[42:46] = _hx("03 00 00 00")  # npnts = 3
    wave_header[48:56] = _hx("00 00 00 00 00 00 e0 3f")  # hsA = 0.5 (delta x)
    wave_header[56:64] = _hx("00 00 00 00 00 00 f0 3f")  # hsB = 1.0 (x0)
    data = _hx("00 00 c0 3f  00 00 20 40  00 00 60 40")  # float32 1.5, 2.5, 3.5
    data += b"\x00" * 4  # wData[] is at least 4 floats: 16 bytes
    return bin_header + bytes(wave_header) + data


def _words_sum(raw: bytes, n: int) -> int:
    return sum(struct.unpack(f"<{n // 2}h", raw[:n])) & 0xFFFF


def test_literal_checksums_are_the_tn003_ones() -> None:
    assert _words_sum(_v5_wave(), 384) == 0  # BinHeader5 + WaveHeader5
    assert _words_sum(_v2_wave(), 142) == 0  # BinHeader2 + WaveHeader2 (incl. wData[4])


@pytest.mark.parametrize(
    ("build", "x0", "dx", "x_unit"),
    [(_v5_wave, 10.0, 2.0, "s"), (_v2_wave, 1.0, 0.5, "s")],
)
def test_hand_assembled_wave_reads_back_per_the_spec(
    tmp_path: Path, build: object, x0: float, dx: float, x_unit: str
) -> None:
    path = tmp_path / "spec.ibw"
    path.write_bytes(build())  # type: ignore[operator]
    ds = import_auto(path)
    assert ds.labels == ("w",)
    assert ds.units == ("V",)
    assert ds.values[:, 0].tolist() == [1.5, 2.5, 3.5]
    assert ds.time.tolist() == [x0, x0 + dx, x0 + 2 * dx]
    assert ds.metadata["x_column_unit"] == x_unit
