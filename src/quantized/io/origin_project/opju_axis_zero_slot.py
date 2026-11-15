"""Which axis endpoint a two-token ``.opju`` span elided (item 64).

An axis span stores ``from, to, step`` as three LE doubles, but the record is
byte-level run-length compressed: a control byte ``0x80 | k`` is a run of
``k + 3`` zero bytes, followed by a literal count and that many literal bytes
(``0xc0 | k`` is the same for a run of a repeated byte -- the ``c2``/``c3``
"RLE" tokens). What the decoder calls a tagged value ``8T nn <nn bytes>`` is
one such run plus the double's top ``nn`` bytes. A 0.0 endpoint has no literal
bytes at all: its eight zeros merge into the NEXT token's run, so a span with
one zero endpoint carries only two value tokens.

Which slot is the zero follows from the step token's run length. Its own
value accounts for ``8 - nn`` low zero bytes; any surplus came from the double
before it. A surplus of exactly 8 means ``to`` is 0.0 (``from, [0.0], step``);
a surplus of 0 means the zero sat earlier, i.e. ``from`` is 0.0 -- the
historical reading. Worked example, Figure 6 Graph3 layer 9 (Origin 2026b COM
``layer.y.from/to`` = -80, 0)::

    85 02 54 c0   run 5+3 = 8 zeros + 54 c0 : 2 pad + -80.0's 6 low zeros
    8b 02 34 40   run 11+3 = 14 zeros + 34 40: to = 0.0 (8) + 20.0's 6

so the span is ``(-80, 0, step 20)``, not ``(0, -80)``. The same accounting
puts the X span's first double at a fixed offset 15 of the expanded record in
every layout checked (Figure 6, Battery Aging Graph1).

Pure leaf: bytes in, verdict out.
"""

from __future__ import annotations

import struct
from collections.abc import Callable, Sequence

__all__: list[str] = []  # internal to the .opju axis decoder


class UnprovenSlot(Exception):  # noqa: N818 -- a control-flow signal, not an error
    """The span exact-fills, but which endpoint is 0.0 is not proven: the
    whole RECORD is declined (fail closed). Returning ``None`` for the span
    alone would let the caller's scan move on to a later, misaligned start
    that happens to fill and decode a plausible wrong range."""


def _top_bytes(chunk: bytes) -> float:
    return float(struct.unpack(">d", bytes(reversed(chunk)) + b"\x00" * (8 - len(chunk)))[0])


def _token_verdict(b: bytes, s: int, end: int, step: float) -> bool | None:
    """For a step token spanning ``[s, end)`` that decoded as ``step``:
    ``True`` when its zero run also carries a whole 0.0 double (the elided
    endpoint is ``to``), ``False`` when it carries none (``from`` is the zero,
    the historical reading), ``None`` for any other surplus (no reading is
    proven).

    Only a tagged token (``81..8f nn``, ``nn`` value bytes -- or ``nn - 1``
    plus a one-byte trailer -- running to ``end``) opens with a zero-run
    control. Its value owns ``8 - <value literal count>`` low zero bytes of
    the run (a literal ``00`` inside the token is not a run byte); the rest
    is surplus. An RLE or bare literal token opens with a literal byte, so no
    zero merged into it: ``False``."""
    if not (s + 2 <= end and 0x81 <= b[s] <= 0x8F and s + 2 + b[s + 1] == end):
        return False
    nn = b[s + 1]
    if _top_bytes(b[s + 2 : s + 2 + nn]) == step:
        value_literals = nn
    elif nn > 1 and _top_bytes(b[s + 2 : s + 1 + nn]) == step:
        value_literals = nn - 1  # trailer form
    else:
        return None
    surplus = (b[s] - 0x80) + 3 - (8 - value_literals)
    if surplus == 0:
        return False
    return True if surplus == 8 else None


def resolve_elided(
    b: bytes,
    end: int,
    value: float,
    step_starts: Sequence[int],
    fills_at: Callable[[int], list[tuple[float, ...]]],
) -> tuple[float, float]:
    """``(from, to)`` of a two-token span ending at ``end`` whose non-zero
    endpoint decoded as ``value``: ``(value, 0.0)`` when the step token's run
    carries the zero, ``(0.0, value)`` (the historical reading) when it does
    not. ``step_starts`` are the step token's candidate starts and
    ``fills_at(q)`` its one-token fills from ``q``; every one must agree, else
    `UnprovenSlot` (never guessed)."""
    verdicts = {_token_verdict(b, q, end, f[0]) for q in step_starts for f in fills_at(q)}
    if len(verdicts) != 1 or None in verdicts:
        raise UnprovenSlot
    return (value, 0.0) if verdicts.pop() else (0.0, value)
