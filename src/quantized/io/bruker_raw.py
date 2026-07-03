"""Bruker/Siemens Diffrac-AT ``.raw`` binary XRD parser, version "RAW1.01".

Also known in ``xylib`` as "Bruker RAW ver. 3" (``bruker_raw.cpp``,
``load_version1_01``). Fixed-layout little-endian binary produced by Siemens/
Bruker D-series diffractometers (Diffrac-AT / DIFFRAC^plus).

Byte layout (offsets 0-indexed, little-endian). Cross-checked against xylib's
ASCII ``.UXD`` export of the same raw file::

    File header (712 bytes):
        0    8  bytes  magic  b'RAW1.01\\x00'
        12   4  <I     range_cnt   (number of scan ranges)
        608  4  ascii  anode_material
        616  8  <d     alpha_average  (Ka average wavelength, A)
        624  8  <d     alpha1
        632  8  <d     alpha2

    Per-range header (nominally 304 bytes, but read header_len):
        0    4  <I     header_len   (== 304 for RAW1.01)
        4    4  <I     steps        (number of data points)
        16   8  <d     start_2theta (deg)
        176  8  <d     step_size    (deg)
        192  4  <f     time_per_step (s)
        256  4  <I     supplementary_headers_size

    Intensity data (per range):
        starts at range_start + header_len + supplementary_headers_size
        <steps>  float32  counts (stored as float even when integer)
        next range (if any) starts immediately after: data_start + steps*4

The supplementary-header block is variable (0 in some files, 40 in others), so
``data_start`` must be computed from the file's own header_len + supp size, not
a hardcoded 304 — a one-file test would miss this.

Reference: xylib (github.com/wojdyr/xylib), ``bruker_raw.cpp``. Sample files
``xylib_BT86.raw`` / ``xylib_Cu3Au.raw`` (LGPL-2.1, attribution) seed the
parity tests.
"""

from __future__ import annotations

import struct
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct

__all__ = ["import_bruker_raw", "is_bruker_raw"]

_FILE_HEADER_LEN = 712
_RANGE_HEADER_LEN = 304
_MAGIC = b"RAW1.01\x00"


def is_bruker_raw(path: Path) -> bool:
    """Sniff a ``.raw`` as Bruker RAW1.01 via its magic bytes.

    Rigaku ``.raw`` uses magic ``FI``, so there is no collision. Other Bruker
    versions (``RAW2``/``RAW4.00``) start with ``RAW`` too but are not the
    RAW1.01 layout; this sniffer accepts only RAW1.01 so the registry does not
    mis-route them.
    """
    with Path(path).open("rb") as fh:
        return fh.read(8) == _MAGIC


def import_bruker_raw(
    filepath: str | Path,
    *,
    use_counts_per_sec: bool = False,
    allow_partial: bool = False,
) -> DataStruct:
    """Import a Bruker RAW1.01 ``.raw`` (2theta vs intensity).

    Parameters
    ----------
    use_counts_per_sec
        Divide counts by ``time_per_step`` and label the channel ``counts/s``.
    allow_partial
        Multi-range files import range 0 only. Without this flag a multi-range
        file raises (so the truncation is never silent); with it, range 0 is
        returned and the extra ranges are recorded in metadata.

    Returns
    -------
    DataStruct
        ``time`` = 2theta (deg), one ``Intensity`` channel.
    """
    path = Path(filepath)
    raw = path.read_bytes()
    n_bytes = len(raw)
    if n_bytes < _FILE_HEADER_LEN + _RANGE_HEADER_LEN:
        raise ValueError(f"file too small to be a Bruker RAW1.01 ({n_bytes} bytes): {path.name}")
    if raw[0:8] != _MAGIC:
        raise ValueError(f"bad magic {raw[0:8]!r} (expected {_MAGIC!r}): {path.name}")

    range_cnt = int(struct.unpack_from("<I", raw, 12)[0])
    if range_cnt < 1:
        raise ValueError(f"no scan ranges in file: {path.name}")

    range_start = _FILE_HEADER_LEN
    header_len = int(struct.unpack_from("<I", raw, range_start + 0)[0])
    steps = int(struct.unpack_from("<I", raw, range_start + 4)[0])
    start_2theta = float(struct.unpack_from("<d", raw, range_start + 16)[0])
    step_size = float(struct.unpack_from("<d", raw, range_start + 176)[0])
    time_per_step = float(struct.unpack_from("<f", raw, range_start + 192)[0])
    supp_len = int(struct.unpack_from("<I", raw, range_start + 256)[0])

    if header_len < _RANGE_HEADER_LEN:
        raise ValueError(f"implausible range header length ({header_len}): {path.name}")
    if steps < 1:
        raise ValueError(f"range has no data points: {path.name}")
    if step_size <= 0 or step_size > 10:
        raise ValueError(f"implausible step size ({step_size:.6g} deg): {path.name}")

    data_start = range_start + header_len + supp_len
    if data_start + steps * 4 > n_bytes:
        raise ValueError(
            f"range claims {steps} points but only {(n_bytes - data_start) // 4} fit: {path.name}"
        )

    if range_cnt > 1 and not allow_partial:
        raise ValueError(
            f"multi-range .raw detected ({range_cnt} ranges); pass allow_partial=True "
            f"to import the first range only: {path.name}"
        )

    intensities = np.frombuffer(raw, dtype="<f4", count=steps, offset=data_start).astype(float)
    two_theta = start_2theta + np.arange(steps) * step_size

    if use_counts_per_sec and time_per_step > 0:
        values = intensities / time_per_step
        unit = "counts/s"
    else:
        values = intensities
        unit = "counts"

    anode = raw[608:612].split(b"\x00", 1)[0].decode("ascii", "replace").strip()
    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_bruker_raw",
        "format_version": "RAW1.01",
        "x_column_name": "2-Theta",
        "x_column_unit": "deg",
        "num_points": steps,
        "start_angle": start_2theta,
        "end_angle": float(two_theta[-1]),
        "step_size": step_size,
        "time_per_step": time_per_step,
        "range_count": range_cnt,
        "anode_material": anode,
        "alpha_average": float(struct.unpack_from("<d", raw, 616)[0]),
    }
    return DataStruct.create(
        two_theta, values, labels=["Intensity"], units=[unit], metadata=metadata
    )
