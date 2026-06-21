"""Rigaku SmartLab ``.raw`` binary parser. Port of MATLAB parser.importRigaku_raw.

Binary layout (magic "FI", little-endian, 1-indexed offsets in the MATLAB
source shown here 0-indexed):
    0..1       magic "FI"
    2958..2961 counting time per step (float32, s)
    2962..2965 start 2theta (float32, deg)
    2966..2969 end 2theta   (float32, deg)
    2970..2973 step size     (float32, deg)
    3154..3157 number of points (uint32)
    3158..      intensity data (float32, 4 bytes/point)
"""

from __future__ import annotations

import struct
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct

__all__ = ["import_rigaku_raw", "is_rigaku_raw"]

_HEADER_SIZE = 3158
_MIN_FILE_SIZE = 3162  # header + at least one float32


def is_rigaku_raw(path: Path) -> bool:
    """Sniff a ``.raw`` as Rigaku SmartLab via the 'FI' magic bytes."""
    with Path(path).open("rb") as fh:
        return fh.read(2) == b"FI"


def import_rigaku_raw(
    filepath: str | Path,
    *,
    use_counts_per_sec: bool = False,
    allow_partial: bool = False,
) -> DataStruct:
    """Import a Rigaku SmartLab ``.raw`` (2theta vs intensity)."""
    path = Path(filepath)
    raw = path.read_bytes()
    n_bytes = len(raw)
    if n_bytes < _MIN_FILE_SIZE:
        raise ValueError(f"file too small to be a Rigaku .raw ({n_bytes} bytes): {path.name}")
    if raw[0:2] != b"FI":
        raise ValueError(f"bad magic {raw[0:2]!r} (expected b'FI'): {path.name}")

    counting_time = float(struct.unpack_from("<f", raw, 2958)[0])
    start_angle = float(struct.unpack_from("<f", raw, 2962)[0])
    end_angle = float(struct.unpack_from("<f", raw, 2966)[0])
    step_size = float(struct.unpack_from("<f", raw, 2970)[0])
    num_points = int(struct.unpack_from("<I", raw, 3154)[0])

    if step_size == 0:
        raise ValueError(f"zero step size (variable-step scans unsupported): {path.name}")
    if step_size < 0 or step_size > 10:
        raise ValueError(f"implausible step size ({step_size:.6g} deg): {path.name}")

    n_avail = (n_bytes - _HEADER_SIZE) // 4
    if num_points == 0 or num_points > n_avail:
        if n_avail == 0:
            raise ValueError(f"no data bytes after header: {path.name}")
        num_points = n_avail

    first_range_end = _HEADER_SIZE + num_points * 4
    if n_bytes > first_range_end + 3 and not allow_partial:
        raise ValueError(
            f"multi-range .raw detected ({n_bytes - first_range_end} bytes after first "
            f"range); pass allow_partial=True to import the first range only: {path.name}"
        )

    intensities = np.frombuffer(raw, dtype="<f4", count=num_points, offset=_HEADER_SIZE).astype(
        float
    )
    two_theta = start_angle + np.arange(num_points) * step_size

    if use_counts_per_sec and counting_time > 0:
        values = intensities / counting_time
        unit = "counts/s"
    else:
        values = intensities
        unit = "counts"

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_rigaku_raw",
        "x_column_name": "2-Theta",
        "x_column_unit": "deg",
        "num_points": num_points,
        "start_angle": start_angle,
        "end_angle": end_angle,
        "step_size": step_size,
        "counting_time": counting_time,
    }
    return DataStruct.create(
        two_theta, values, labels=["Intensity"], units=[unit], metadata=metadata
    )
