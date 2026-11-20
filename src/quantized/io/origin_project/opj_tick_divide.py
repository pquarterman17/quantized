"""An ``.opj`` axis's tick-label "Divide by" factor (Origin's Tick Labels >
Display > Divide by).

**Decode (2026-11-20, lane M).** Each graph layer may carry one small named
object per axis side, ``OB`` / ``OT`` / ``OL`` / ``OR`` (bottom, top, left,
right): a 133-byte header (type byte ``0x06``) whose next block is the
factor as a NUL-terminated decimal string. Origin draws that axis' tick
labels as ``value / factor`` and adds no multiplier text; the axis title
carries the unit. ``0`` means no factor. These objects were earlier filed as
"composite-layout axis-break sub-objects" (``figures.py``) and ignored.

**Evidence.** Origin's own exports of the owner corpus:

* Moke.opj Graph10: layers 1-2 ``OB = 10`` over a +-7000 Oe X range, labels
  read -600..600 with title "H (mT)"; layer 3 ``OL = 10`` (0..3000 drawn as
  0..300, "Hex (mT)"); layer 4 ``OR = 10`` (400..1500 drawn as 40..140).
* SuperlatticeFits.opj Graph10: layers 2/4/6 ``OR = 10``, right axes
  250..420 drawn as 25..40.
* MnN_Diffusion_PNR.opj Graph6: ``OB = 0.1`` over Q 0..0.155, labels read
  0.00..1.50 ("Q (nm^-1)" from data in A^-1).
* Negative controls: XMCD.opj GraphT* ``OB = 0`` (760..820 eV drawn as is),
  Moke Graph10 layer 3 ``OR = 0``.

Whole corpus (both corpora, every ``.opj`` graph window): ``OB`` 0.1 x88,
10 x40, 0 x50; ``OR`` 10 x15, 0 x21; ``OL`` 10 x8, 0.00291 x2; no ``OT``;
no other value. Only owner projects set a non-zero factor. The ``.opju``
container carries no such named objects (UnpolPlots Graph1's X factor 10 and
Hc2's Y factor stay undecoded there; see ``docs/origin_re``).

Pure library: bytes in, values out.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

__all__ = ["DIVIDE_SIDES", "opj_tick_divide"]

# Object name -> the axis side whose tick labels it divides.
DIVIDE_SIDES = {"OB": "bottom", "OT": "top", "OL": "left", "OR": "right"}

_FACTOR_TYPE = 0x06  # header payload[2] of every corpus instance


def opj_tick_divide(
    name: str | None, blocks: Sequence[tuple[int, bytes]], k: int, end: int
) -> tuple[str, float] | None:
    """``(side, factor)`` for the named 133-byte header at ``blocks[k]`` when it
    is a tick-label factor object with a factor other than 0 or 1, else
    ``None`` (absent, unparsable, or no division: never guessed)."""
    side = DIVIDE_SIDES.get(name or "")
    if side is None or blocks[k][1][2:3] != bytes([_FACTOR_TYPE]) or k + 1 >= end:
        return None
    size, body = blocks[k + 1]
    if size == 133 or not 2 <= len(body) <= 32 or body[-1] != 0:
        return None
    try:
        factor = float(body.split(b"\x00", 1)[0].decode("ascii"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not math.isfinite(factor) or factor <= 0 or factor == 1:
        return None
    return side, factor
