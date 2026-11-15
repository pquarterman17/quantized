"""WaveMetrics Igor Pro binary wave (``.ibw``) import -- a small in-house reader.

Written from the published binary-wave layout (WaveMetrics Technical Note
TN003, "Igor Binary Format"), NOT from any existing reader: the Python
packages for this format are LGPL/GPL, which the project's licence gate
refuses (``tests/test_repo_integrity.py``), so none is a dependency and none
was copied. The layout below was checked against real Igor-written files in
both byte orders (version 2 and version 5).

**Versions.** 2 and 5 are read; version 1 and 3 (Igor 1.x-3.x) are refused by
name. The byte order is taken from the version field, which is only a valid
version in the writer's order. The header checksum is verified (a wave with a
bad one is damaged, not guessed at).

**Layout used** (offsets from the start of the file)::

    v5   BinHeader5 (64): version(2) checksum(2) wfmSize(4) formulaSize(4)
         noteSize(4) dataEUnitsSize(4) dimEUnitsSize[4] dimLabelsSize[4] ...
         WaveHeader5 (320) at 64: npnts(i32)@12  type(i16)@16  bname(32)@28
         nDim[4](i32)@68  sfA[4](f64)@84  sfB[4](f64)@116
         dataUnits(4)@148  dimUnits[4][4]@152;  data at 384 (the checksum
         covers bytes 0-383); then formula, note, extended units
    v2   BinHeader2 (16): version(2) wfmSize(4) noteSize(4) pictSize(4)
         checksum(2).  WaveHeader2 at 16: type(i16)@0  bname(20)@6
         dataUnits(4)@34  xUnits(4)@38  npnts(i32)@42  hsA(f64)@48 hsB(f64)@56;
         data at 126 (the checksum covers bytes 0-141); the note starts at
         16 + wfmSize

**Scaling.** Igor gives point ``i`` of dimension ``d`` the coordinate
``x0 + dx * i`` (v5 ``sfB`` / ``sfA``; v2 ``hsB`` / ``hsA``). ``x0`` and ``dx``
are kept: a 1-D wave imports as a table whose x axis IS that scaling (also
recorded as ``metadata.igor_x0`` / ``igor_dx``), a 2-D wave as a map with
its own axes (rows are Igor's first dimension, ``X``; columns ``Y``). Data and
dimension units are carried; the wave note is kept as ``metadata.igor_note``.

**Refused, with a reason:** text waves, complex waves, waves of three or four
dimensions (which slice to import is a choice, not a default), empty waves, a
truncated file, anything over the size caps.

Pure layer.
"""

from __future__ import annotations

import struct
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct
from quantized.io._array_books import MAX_MAP_POINTS, grid_map_datastruct, table_datastruct

__all__ = ["import_ibw", "is_ibw"]

#: Longest 1-D wave read (the same float64-element budget as the HDF5 reader).
MAX_POINTS = 1 << 26

_V5_BIN, _V5_DATA = 64, 384
_V2_BIN, _V2_DATA, _V2_CHECK = 16, 126, 142
_NT_CMPLX, _NT_UNSIGNED = 0x01, 0x40
_BASE_TYPES = {
    0x02: "f4",
    0x04: "f8",
    0x08: "i1",
    0x10: "i2",
    0x20: "i4",
    0x80: "i8",
}


def _byte_order(head: bytes) -> tuple[str, int] | None:
    """``(struct prefix, version)`` when the first two bytes are a version."""
    if len(head) < 2:
        return None
    for prefix in ("<", ">"):
        (version,) = struct.unpack(prefix + "h", head[:2])
        if version in (1, 2, 3, 5):
            return prefix, int(version)
    return None


def is_ibw(path: Path) -> bool:
    """True when the file opens with a plausible Igor binary-wave version."""
    with Path(path).open("rb") as fh:
        return _byte_order(fh.read(2)) is not None


def _text(raw: bytes) -> str:
    return raw.split(b"\x00", 1)[0].decode("latin-1", "replace").strip()


def _checksum_ok(raw: bytes, prefix: str, size: int) -> bool:
    if len(raw) < size:
        return False
    words = struct.unpack(f"{prefix}{size // 2}h", raw[:size])
    return int(sum(words)) & 0xFFFF == 0


class _Wave:
    def __init__(self) -> None:
        self.name = ""
        self.dims: list[int] = []
        self.dx: list[float] = []
        self.x0: list[float] = []
        self.data_units = ""
        self.dim_units: list[str] = []
        self.dtype = np.dtype("f4")
        self.data_offset = 0
        self.note = ""


def _dtype(wave_type: int, prefix: str) -> np.dtype[Any]:
    if wave_type == 0:
        raise ValueError("a text wave holds strings, not numbers; not imported")
    if wave_type & _NT_CMPLX:
        raise ValueError("a complex wave is not imported (it has no single real value per point)")
    base = _BASE_TYPES.get(wave_type & ~_NT_UNSIGNED & ~_NT_CMPLX)
    if base is None:
        raise ValueError(f"unknown wave data type 0x{wave_type & 0xFFFF:x}")
    kind = base.replace("i", "u") if wave_type & _NT_UNSIGNED else base
    return np.dtype(prefix + kind)


def _parse_v5(raw: bytes, prefix: str) -> _Wave:
    if len(raw) < _V5_DATA:
        raise ValueError("file is too short for an Igor version 5 wave header")
    if not _checksum_ok(raw, prefix, _V5_DATA):
        raise ValueError("Igor header checksum does not match: the file is damaged")
    wfm, formula, note, de_units = struct.unpack(prefix + "4i", raw[4:20])
    dim_e = struct.unpack(prefix + "4i", raw[20:36])
    w = _Wave()
    wh = _V5_BIN
    npnts, wave_type = struct.unpack(prefix + "ih", raw[wh + 12 : wh + 18])
    w.name = _text(raw[wh + 28 : wh + 60])
    w.dims = [int(n) for n in struct.unpack(prefix + "4i", raw[wh + 68 : wh + 84])]
    w.dx = list(struct.unpack(prefix + "4d", raw[wh + 84 : wh + 116]))
    w.x0 = list(struct.unpack(prefix + "4d", raw[wh + 116 : wh + 148]))
    w.data_units = _text(raw[wh + 148 : wh + 152])
    w.dim_units = [_text(raw[wh + 152 + 4 * d : wh + 156 + 4 * d]) for d in range(4)]
    w.dtype = _dtype(wave_type, prefix)
    w.data_offset = _V5_DATA
    if min(wfm, formula, note, de_units, *dim_e) < 0:
        raise ValueError("Igor wave header has a negative section size")
    counted = int(np.prod([n for n in w.dims if n > 0], dtype=np.int64)) if any(w.dims) else 0
    if counted != npnts:
        raise ValueError(f"Igor wave declares {npnts} points but its dimensions give {counted}")
    tail = _V5_BIN + wfm + formula  # the note, then the extended units
    if note:
        w.note = raw[tail : tail + note].decode("latin-1", "replace").replace("\r", "\n").strip()
    pos = tail + note
    if de_units:
        w.data_units = _text(raw[pos : pos + de_units]) or w.data_units
    pos += de_units
    for d in range(4):
        if dim_e[d]:
            w.dim_units[d] = _text(raw[pos : pos + dim_e[d]]) or w.dim_units[d]
        pos += dim_e[d]
    return w


def _parse_v2(raw: bytes, prefix: str) -> _Wave:
    if len(raw) < _V2_CHECK:
        raise ValueError("file is too short for an Igor version 2 wave header")
    if not _checksum_ok(raw, prefix, _V2_CHECK):
        raise ValueError("Igor header checksum does not match: the file is damaged")
    wfm, note = struct.unpack(prefix + "ii", raw[2:10])
    wh = _V2_BIN
    (wave_type,) = struct.unpack(prefix + "h", raw[wh : wh + 2])
    w = _Wave()
    w.name = _text(raw[wh + 6 : wh + 26])
    w.data_units = _text(raw[wh + 34 : wh + 38])
    w.dim_units = [_text(raw[wh + 38 : wh + 42]), "", "", ""]
    (npnts,) = struct.unpack(prefix + "i", raw[wh + 42 : wh + 46])
    hs_a, hs_b = struct.unpack(prefix + "dd", raw[wh + 48 : wh + 64])
    w.dims = [int(npnts), 0, 0, 0]
    w.dx, w.x0 = [hs_a, 1.0, 1.0, 1.0], [hs_b, 0.0, 0.0, 0.0]
    w.dtype = _dtype(wave_type, prefix)
    w.data_offset = _V2_DATA
    if wfm < 0 or note < 0:
        raise ValueError("Igor wave header has a negative section size")
    tail = _V2_BIN + wfm
    if note:
        w.note = raw[tail : tail + note].decode("latin-1", "replace").replace("\r", "\n").strip()
    return w


def _read_wave(path: Path) -> tuple[_Wave, NDArray[np.float64], int]:
    raw = path.read_bytes()
    order = _byte_order(raw[:2])
    if order is None:
        raise ValueError(f"not an Igor binary wave (bad version field): {path.name}")
    prefix, version = order
    if version == 5:
        wave = _parse_v5(raw, prefix)
    elif version == 2:
        wave = _parse_v2(raw, prefix)
    else:
        raise ValueError(
            f"Igor binary wave version {version} is not supported (versions 2 and 5 are read); "
            "re-save the wave from a current Igor Pro"
        )
    dims = [n for n in wave.dims if n > 0]
    if not dims:
        raise ValueError("the wave has no points")
    if len(dims) > 2:
        raise ValueError(
            f"a {len(dims)}-dimensional wave ({' x '.join(map(str, dims))}) is not imported: "
            "which 2-D slice to take is a choice; save the slice you want as its own wave"
        )
    total = int(np.prod(dims, dtype=np.int64))
    if total > (MAX_MAP_POINTS if len(dims) == 2 else MAX_POINTS):
        raise ValueError(f"the wave has {total:,} points, over the import limit")
    end = wave.data_offset + total * wave.dtype.itemsize
    if end > len(raw):
        raise ValueError(f"the file is truncated: its data needs {end} bytes, it has {len(raw)}")
    data = np.frombuffer(raw, dtype=wave.dtype, count=total, offset=wave.data_offset)
    return wave, np.asarray(data, dtype=np.float64), version


def import_ibw(filepath: str | Path) -> DataStruct:
    """Import an Igor ``.ibw`` wave: 1-D as a table over its x scaling
    (``x0 + dx * i``), 2-D as a map. Units, scaling and the note are kept."""
    path = Path(filepath)
    wave, data, version = _read_wave(path)
    dims = [n for n in wave.dims if n > 0]
    meta: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_ibw",
        "igor_version": version,
        "igor_wave_name": wave.name,
        "igor_x0": wave.x0[: len(dims)],
        "igor_dx": wave.dx[: len(dims)],
    }
    if wave.note:
        meta["igor_note"] = wave.note
    unit = wave.data_units
    label = wave.name or path.stem
    if len(dims) == 1:
        x = wave.x0[0] + wave.dx[0] * np.arange(dims[0], dtype=float)
        return table_datastruct(
            [(label, data, unit)],
            x=x,
            x_name="x",
            x_unit=wave.dim_units[0],
            metadata=meta,
        )
    nx, ny = dims  # Igor's first dimension (rows) runs fastest: reshape (ny, nx)
    return grid_map_datastruct(
        data.reshape(ny, nx),
        wave.x0[0] + wave.dx[0] * np.arange(nx, dtype=float),
        wave.x0[1] + wave.dx[1] * np.arange(ny, dtype=float),
        x_label="X",
        x_unit=wave.dim_units[0],
        y_label="Y",
        y_unit=wave.dim_units[1],
        z_unit=unit,
        metadata=meta,
    )
