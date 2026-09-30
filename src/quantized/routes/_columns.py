"""Framed binary column transport for ``/api/plot/series`` (opt-in).

The full-resolution JSON payload is the largest thing the plot route ships:
at 1M x 7 rows it is ~146 MB of text that took ~1.15 s to encode server-side
and ~0.9 s of ``JSON.parse`` on the browser's main thread, for data that is
56 MB of float64 once it lands in a typed array. A client that asks for it
(``Accept: application/x-quantized-columns``) gets that array instead:

    magic ``b"QZC1"`` (4 bytes)
    header length, uint32 little-endian (4 bytes)
    header JSON, UTF-8, space-padded so the columns start 8-byte aligned
    ``n_columns`` columns of ``n_rows`` float64 little-endian each

The header is the JSON payload with ``data`` removed and ``n_columns``/
``n_rows`` added, so a decoder that re-attaches ``data`` rebuilds the exact
JSON shape (``series``, ``x``, ``y``, ``decimated``, ``window`` and whatever
a later route adds all ride along unchanged). Non-finite values (NaN, +Inf,
-Inf) are written as NaN: the JSON path's ``null`` gap. ``-0.0`` survives (it
does in JSON too). The 8-byte alignment matters because a browser's
``Float64Array(buffer, byteOffset)`` view refuses an unaligned offset.

Lives in routes/ because it is transport (like ``_payload.py``), not domain:
pure bytes in/out, no FastAPI objects, so the route stays a thin adapter and
the round trip is unit-testable without a server.
"""

from __future__ import annotations

import json
import struct
from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["COLUMNS_MEDIA_TYPE", "decode_columns", "encode_columns", "wants_columns"]

COLUMNS_MEDIA_TYPE = "application/x-quantized-columns"

_MAGIC = b"QZC1"
_PREFIX = struct.Struct("<4sI")  # magic + header length
_ALIGN = 8


def wants_columns(accept: str | None) -> bool:
    """True when an ``Accept`` header lists the column media type.

    Parameters (``;q=...``) and surrounding whitespace are ignored; a wildcard
    (``*/*``, the browser default) does NOT opt in -- the JSON payload stays
    the default, and only a client that names the type gets binary.
    """
    if not accept:
        return False
    for part in accept.split(","):
        if part.split(";", 1)[0].strip().lower() == COLUMNS_MEDIA_TYPE:
            return True
    return False


def encode_columns(header: dict[str, Any], columns: Sequence[NDArray[Any]]) -> bytes:
    """Frame ``header`` + equal-length 1-D ``columns`` as the binary body.

    ``header`` must not carry ``data``/``n_columns``/``n_rows`` -- those are
    this frame's own fields (the caller strips ``data``; the counts are
    derived here). Every column must be 1-D and the same length; the values
    are cast to float64 (a bool/int column encodes as its float value).
    """
    for key in ("data", "n_columns", "n_rows"):
        if key in header:
            raise ValueError(f"header must not contain {key!r}")
    cols = [np.asarray(c, dtype=np.float64) for c in columns]
    if any(c.ndim != 1 for c in cols):
        raise ValueError("every column must be 1-D")
    n_rows = int(cols[0].shape[0]) if cols else 0
    if any(c.shape[0] != n_rows for c in cols):
        raise ValueError("every column must have the same length")

    full = dict(header)
    full["n_columns"] = len(cols)
    full["n_rows"] = n_rows
    text = json.dumps(full, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    header_bytes = text.encode("utf-8")
    pad = (-(_PREFIX.size + len(header_bytes))) % _ALIGN
    header_bytes += b" " * pad

    parts = [_PREFIX.pack(_MAGIC, len(header_bytes)), header_bytes]
    if n_rows and cols:
        block = np.empty((len(cols), n_rows), dtype="<f8")
        for i, col in enumerate(cols):
            block[i] = col
        # The wire contract: a gap is NaN, whatever the calc produced (the
        # JSON path maps every non-finite float to null the same way).
        block[~np.isfinite(block)] = np.nan
        parts.append(block.tobytes())
    return b"".join(parts)


def decode_columns(body: bytes) -> tuple[dict[str, Any], list[NDArray[np.float64]]]:
    """Inverse of :func:`encode_columns` -- ``(header, columns)``.

    The returned header is what the caller passed to ``encode_columns``
    (``n_columns``/``n_rows`` stripped again); the columns are float64 with
    NaN gaps. Raises ``ValueError`` on a body that does not carry the frame.
    """
    if len(body) < _PREFIX.size:
        raise ValueError("column frame too short")
    magic, header_len = _PREFIX.unpack_from(body, 0)
    if magic != _MAGIC:
        raise ValueError("not a column frame (bad magic)")
    offset = _PREFIX.size + header_len
    if offset % _ALIGN or offset > len(body):
        raise ValueError("column frame header is misaligned or truncated")
    header = json.loads(body[_PREFIX.size : offset].decode("utf-8"))
    n_columns = int(header.pop("n_columns"))
    n_rows = int(header.pop("n_rows"))
    expected = offset + n_columns * n_rows * 8
    if len(body) != expected:
        raise ValueError(f"column frame is {len(body)} bytes, expected {expected}")
    flat = np.frombuffer(body, dtype="<f8", offset=offset, count=n_columns * n_rows)
    block = flat.reshape(n_columns, n_rows).astype(np.float64)
    return header, [block[i] for i in range(n_columns)]
