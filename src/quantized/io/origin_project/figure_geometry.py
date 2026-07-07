"""Layer-frame and page geometry for Origin graph windows (§13.2 #7).

A graph *page* has a size in "page units"; each *layer* (panel) occupies a
frame rect on it. Both containers store the same quantities, in the same
units the annotation/legend object boxes use (``annotation_marks``), so
frame + page size place every panel of a multi-panel window and every
positioned object — the full faithful-layout geometry chain.

**`.opj` (CPYA)** — solved 2026-07-06 against the live-COM
``layer_geometry.json`` oracle (``export_layer_geometry.py``):

* layer frame: u16 LE quad at layer-continuation payload offsets
  **113/115/117/119** = (left, top, right, bottom) page units — 41/44
  oracle layers exact (the 3 misses are Moke's LINKED composite layers
  where COM itself reports out-of-page link-mode values);
* page size: u16 LE (width, height) pair at window-header payload offset
  **35** — 39/39 oracle windows exact.

**`.opju` (CPYUA)**:

* layer frame: the marker ``12 00 20 22`` within ~300 bytes after the
  layer's axis-record anchor, immediately followed by the same u16 quad —
  30/30 oracle layers exact where the marker exists; absent on some
  composite/embedded layers (fail-closed ``None``);
* page size: near the page-header start, a u16 (width, height) pair with
  variable framing — recovered by scanning the first bytes of the page
  span for a plausible pair that CONTAINS every decoded layer frame
  (a structural validation, not a fixed offset); ``None`` when no
  candidate or several disagree.

Pure leaf: bytes in → ints out.
"""

from __future__ import annotations

import struct

__all__ = ["opj_layer_frame", "opj_page_size", "opju_layer_frame", "opju_page_size"]

_OPJ_FRAME_OFFSET = 113
_OPJ_PAGE_SIZE_OFFSET = 35
_OPJU_FRAME_MARK = b"\x12\x00\x20\x22"
_OPJU_FRAME_SCAN = 300
_OPJU_PAGE_SCAN = 80


def _plausible_quad(q: tuple[int, int, int, int]) -> bool:
    left, top, right, bottom = q
    return left < right and top < bottom


def opj_layer_frame(layer_payload: bytes) -> tuple[int, int, int, int] | None:
    """The ``.opj`` layer frame quad ``(left, top, right, bottom)`` in page
    units, or ``None`` when missing/degenerate (older layer-block variants) —
    callers fall back to the fraction-pair position model."""
    if len(layer_payload) < _OPJ_FRAME_OFFSET + 8:
        return None
    quad = struct.unpack_from("<4H", layer_payload, _OPJ_FRAME_OFFSET)
    if not _plausible_quad(quad):
        return None
    return int(quad[0]), int(quad[1]), int(quad[2]), int(quad[3])


def opj_page_size(header_payload: bytes) -> dict[str, int] | None:
    """The graph page's (width, height) in page units from its window-header
    payload, or ``None`` when implausible — never guessed."""
    if len(header_payload) < _OPJ_PAGE_SIZE_OFFSET + 4:
        return None
    w, h = struct.unpack_from("<2H", header_payload, _OPJ_PAGE_SIZE_OFFSET)
    if not (200 <= w <= 60000 and 200 <= h <= 60000):
        return None
    return {"width": int(w), "height": int(h)}


def opju_layer_frame(b: bytes, anchor: int, end: int) -> tuple[int, int, int, int] | None:
    """The ``.opju`` layer frame quad for the axis record at ``anchor``, or
    ``None`` when the marker isn't in range (composite/embedded layers)."""
    j = b.find(_OPJU_FRAME_MARK, anchor, min(end, anchor + _OPJU_FRAME_SCAN))
    if j < 0 or j + 4 + 8 > len(b):
        return None
    quad = struct.unpack_from("<4H", b, j + 4)
    if not _plausible_quad(quad):
        return None
    return int(quad[0]), int(quad[1]), int(quad[2]), int(quad[3])


def opju_page_size(
    b: bytes, page_start: int, frames: list[tuple[int, int, int, int]]
) -> dict[str, int] | None:
    """The ``.opju`` graph page's (width, height): the unique plausible u16
    pair near the page-header start that CONTAINS every decoded layer frame
    (right <= width, bottom <= height, within 8x of the frames' extent so an
    absurdly large accidental pair can't win). ``None`` without frames to
    validate against, or when no/multiple distinct candidates pass."""
    if not frames:
        return None
    max_r = max(f[2] for f in frames)
    max_b = max(f[3] for f in frames)
    found: set[tuple[int, int]] = set()
    hi = min(len(b) - 4, page_start + _OPJU_PAGE_SCAN)
    for off in range(page_start, hi):
        w, h = struct.unpack_from("<2H", b, off)
        if max_r <= w <= 8 * max_r and max_b <= h <= 8 * max_b:
            found.add((int(w), int(h)))
    if len(found) != 1:
        return None  # ambiguous or absent: no page size, never guessed
    w, h = next(iter(found))
    return {"width": w, "height": h}
