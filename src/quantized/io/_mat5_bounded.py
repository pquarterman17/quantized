"""A MATLAB v5 MAT-file with every compressed element inflated under a cap.

``scipy.io.loadmat`` inflates a ``miCOMPRESSED`` variable by the byte count its
own tag declares, so a ~400 KB file whose double-array element declares 400 MiB
of zeros allocates all of it before any size check can run (``whosmat`` reports
only the matrix header's dims, which the file's author controls independently).
:func:`bounded_mat5` walks the top-level tags itself, inflates each compressed
element with ``zlib.decompressobj().decompress(chunk, max_length)`` so the
allocation can never pass the remaining read budget, and returns the file as an
UNCOMPRESSED stream scipy can read safely: a compressed element's inflated
bytes are exactly a ``miMATRIX`` element (tag included). Struct fields live
inside their variable's element, so one cap covers them too.

An element over the cap, or past the whole-file budget, is skipped and
reported; the others still import.

Pure layer.
"""

from __future__ import annotations

import io
import struct
import zlib
from pathlib import Path

from quantized.io._hdf5_walk import Budget

__all__ = ["bounded_mat5", "is_mat5"]

_HEADER = 128
_MI_MATRIX, _MI_COMPRESSED = 14, 15
_SLACK = 1 << 16  # element headers, names and padding around the numbers


def is_mat5(head: bytes) -> bool:
    return head.startswith(b"MATLAB 5.0")


def _inflate(chunk: bytes, limit: int) -> bytes:
    inflater = zlib.decompressobj()
    try:
        out = inflater.decompress(chunk, limit + 1)
        if len(out) > limit or inflater.unconsumed_tail:
            raise ValueError("it inflates past the size limit")
        return out + inflater.flush()
    except zlib.error as exc:
        raise ValueError(f"damaged compressed element ({exc})") from exc


def bounded_mat5(path: Path, budget: Budget) -> tuple[io.BytesIO, list[str]]:
    """``(uncompressed v5 stream, notes)`` for the v5 file at ``path``."""
    size = path.stat().st_size
    out = io.BytesIO()
    notes: list[str] = []
    with path.open("rb") as fh:
        head = fh.read(_HEADER)
        if len(head) < _HEADER:
            raise ValueError(f"not a readable MATLAB MAT-file (truncated header): {path.name}")
        prefix = ">" if head[126:128] == b"MI" else "<"
        out.write(head)
        pos = _HEADER
        while pos + 8 <= size:
            fh.seek(pos)
            kind, nbytes = struct.unpack(prefix + "II", fh.read(8))
            body_start = pos + 8
            if nbytes > size - body_start:
                raise ValueError(f"not a readable MATLAB MAT-file (truncated element): {path.name}")
            if kind == _MI_COMPRESSED:
                limit = max(budget.elements, 0) * 8 + _SLACK
                try:
                    data = _inflate(fh.read(nbytes), limit)
                    budget.take("a compressed MAT element", (len(data) + 7) // 8)
                except ValueError as exc:
                    notes.append(f"A compressed variable was not read: {exc}.")
                    pos = body_start + nbytes
                    continue
                out.write(data + b"\x00" * (-len(data) % 8))
                pos = body_start + nbytes
            else:
                padded = nbytes + (-nbytes % 8) if kind == _MI_MATRIX else nbytes
                chunk = fh.read(min(padded, size - body_start))
                try:
                    budget.take("a MAT element", (len(chunk) + 7) // 8)
                except ValueError as exc:
                    notes.append(f"A variable was not read: {exc}.")
                    pos = body_start + len(chunk)
                    continue
                out.write(struct.pack(prefix + "II", kind, nbytes) + chunk)
                pos = body_start + len(chunk)
    out.seek(0)
    return out, notes
