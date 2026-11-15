"""``.opju`` column ids whose low byte is zero (256, 512, 768, ...).

The id chunk ``81 <len> <hi> ...`` (``0x81`` skips 4 zero bytes, so the id's
zero LOW byte is folded into the skip and the first literal is the high
byte) is one form of the single column-id chunk decoder,
``opju_curve_token.chunk_id``, which both the id table and the curve-token
reader use. This module keeps the narrow entry point for that form.

Corpus (359 ``.opju``, 2026-11-15): 107 column records in the ``81 02``
form pass the same field walk and designation-marker check as the other
forms; tokens use ``81 02 <hi> <next>`` and ``81 01 <hi>``. Evidence:
``ORIGIN_FILE_DECODE_PLAN`` items 67-68 (Origin 2026b COM).
"""

from __future__ import annotations

from quantized.io.origin_project.opju_curve_token import chunk_id

__all__ = ["zero_low_id_chunk"]


def zero_low_id_chunk(b: bytes, p: int) -> tuple[int, int] | None:
    """``(column id, bytes consumed)`` for the zero-low-byte id chunk whose
    ``81`` tag is at ``p``; ``None`` for any other form or a truncated one."""
    if p >= len(b) or b[p] != 0x81:
        return None
    got = chunk_id(b, p)
    return None if got is None else (got[0], got[1] - p)
