"""Specimen-form + hybrid Origin ``.opju`` axis-record parsing.

Split from ``opju_axis_real_form.py`` (2026-07-06, the 500-line god-module
guard). Same axis-record domain as the real form: this file owns the
DEFAULT-DIALOG ("specimen") record grammar and the LAST-RESORT hybrid parser,
while ``opju_axis_real_form`` owns the real-corpus token grammar and the
real-form record parser. The two share the low-level value-token readers
(imported below) so a decode stays byte-identical whichever entry point runs.

Three record forms, tried in this order by ``figures_opju``:

1. specimen form (``_parse_specimen_record``) — the default plot-dialog
   layout: literal / tag-compact value tokens around a ``_Y_TRANSITION``
   marker, with an exact ``7b 40``-family X-scale flag;
2. real-corpus form (``opju_axis_real_form._parse_real_record``) — RLE/tagged
   tokens with ``81/80`` separators and geometry-tail scale flags;
3. hybrid (``parse_hybrid_record``) — a specimen skeleton whose spans hold
   real-form value tokens (a plotted-then-``layer.plotN.*``-customized graph).
   Gated behind BOTH 1 and 2 failing, so it can never change a record they
   already decode; fail-closed on any ambiguous span (never a guessed range).

Pure leaf: bytes in → floats out. No fastapi/pydantic/routes imports.
"""

from __future__ import annotations

from quantized.io.origin_project.opju_axis_real_form import (
    _STEP_TAG,
    _TAG_SEARCH_SPAN,
    _Y_TRANSITION,
    _decode_compact,
    _decode_raw8,
    real_form_bare_pair,
)

__all__ = ["parse_hybrid_record"]


def _value_candidates(b: bytes, pos: int, end: int) -> list[tuple[float, int]]:
    """Every plausible ``(value, bytes_consumed)`` parse starting at ``pos``.

    The bare (no-tag) raw8 shape is rejected when ``pos`` itself starts with a
    byte in the real-form flag-token range ``0x81..0x8f`` (mirroring
    ``_real_bare8``'s identical guard): a genuine specimen-form literal never
    starts there, but a real-form flag token (e.g. ``89 01`` before an
    RLE-compressed value) does, and would otherwise misdecode as a plausible-
    looking bare double -- the false positive that made the rf_* oracle
    quad's linear-X records (whose 8 leading bytes are flag+RLE, not a
    literal) parse via the specimen path with a wrong ``x_from`` and a
    type-byte reading that (unlike the true real-form flag) carries no Y
    information at all."""
    avail = end - pos
    out: list[tuple[float, int]] = []
    if avail >= 8 and not (pos < end and 0x81 <= b[pos] <= 0x8F):
        v = _decode_raw8(b[pos : pos + 8])
        if v is not None:
            out.append((v, 8))
    if avail >= 10:
        v = _decode_raw8(b[pos + 2 : pos + 10])
        if v is not None:
            out.append((v, 10))
    for k in (1, 2, 3):
        if avail >= 2 + k:
            v = _decode_compact(b[pos + 2 : pos + 2 + k])
            if v is not None:
                out.append((v, 2 + k))
    return out


def _parse_pair(b: bytes, pos: int, end: int) -> tuple[float, float] | None:
    """Decode ``(from, to)`` from the byte span ``[pos, end)``, or ``None``.

    Every admissible split (``from`` elided, or ``from``+``to`` both present)
    is tried; accepted only if exactly one split consumes the span exactly with
    two plausible values.
    """
    candidates: set[tuple[float, float]] = set()
    for v, n in _value_candidates(b, pos, end):  # from elided (== 0.0): one token = "to"
        if pos + n == end:
            candidates.add((0.0, v))
    for vf, nf in _value_candidates(b, pos, end):  # from present, then to
        p2 = pos + nf
        for vt, nt in _value_candidates(b, p2, end):
            if p2 + nt == end:
                candidates.add((vf, vt))
    return candidates.pop() if len(candidates) == 1 else None


def _parse_specimen_record(
    b: bytes, p: int
) -> tuple[float, float, float, float, int, bool | None] | None:
    """Specimen-form axis record at anchor payload ``p``:
    ``(xf, xt, yf, yt, type_byte, x_log)``.

    ``x_log`` is the exact X-scale flag inside the "filler" after the type
    byte -- really ``7b 40`` + ``01`` (linear) / ``08 01`` (log10), the same
    field the real form carries; ``None`` keeps the type-byte/heuristic path.
    ``y_start`` stays at the historical +3 skip: a log X's extra ``08`` byte
    is absorbed by ``_parse_pair``'s 2-byte tag-skip candidate."""
    ytrans = b.find(_Y_TRANSITION, p, min(len(b), p + _TAG_SEARCH_SPAN))
    if ytrans < 0:
        return None
    xstep = b.rfind(_STEP_TAG, p, ytrans)
    if xstep < 0:
        return None
    xpair = _parse_pair(b, p, xstep)
    if xpair is None:
        return None
    if ytrans + len(_Y_TRANSITION) >= len(b):  # marker at EOF — no type byte to read
        return None
    tb = ytrans + len(_Y_TRANSITION)
    type_byte = b[tb]
    x_log: bool | None = None
    if b[tb + 1 : tb + 4] == b"\x7b\x40\x01":
        x_log = False
    elif b[tb + 1 : tb + 5] == b"\x7b\x40\x08\x01":
        x_log = True
    y_start = tb + 1 + 3  # + type byte + "7b 40 ..." filler (see docstring)
    ystep = b.find(_STEP_TAG, y_start, min(len(b), y_start + _TAG_SEARCH_SPAN))
    if ystep < 0:
        return None
    ypair = _parse_pair(b, y_start, ystep)
    if ypair is None:
        return None
    return (*xpair, *ypair, type_byte, x_log)


def parse_hybrid_record(
    b: bytes, p: int
) -> tuple[float, float, float, float, int, bool | None] | None:
    """LAST-RESORT axis record: ``(xf, xt, yf, yt, type_byte, x_log)``.

    Fires ONLY when neither the specimen form nor the real form parsed (§13.2
    #13). Shape: a specimen-form skeleton (``_Y_TRANSITION`` + ``_STEP_TAG``
    markers, ``7b 40``-family X-scale filler) whose X and Y spans hold
    real-corpus RLE/tagged value tokens instead of specimen-form literals --
    what a plotted-then-customized (``layer.plotN.*``) graph writes. Reuses the
    specimen skeleton for span boundaries and the type byte / ``7b 40`` filler
    for the scale flag, but decodes each span with the oracle-validated
    real-form token machinery (``real_form_bare_pair``). Because it is gated
    behind BOTH other parsers failing, it can never change a record they
    already decode. Fail-closed: any span that doesn't yield a unique pair
    returns ``None`` (never a guessed range)."""
    ytrans = b.find(_Y_TRANSITION, p, min(len(b), p + _TAG_SEARCH_SPAN))
    if ytrans < 0 or ytrans + len(_Y_TRANSITION) >= len(b):
        return None
    xstep = b.rfind(_STEP_TAG, p, ytrans)
    if xstep < 0:
        return None
    xpair = real_form_bare_pair(b, p, xstep)
    if xpair is None:
        return None
    tb = ytrans + len(_Y_TRANSITION)
    type_byte = b[tb]
    x_log: bool | None = None
    if b[tb + 1 : tb + 4] == b"\x7b\x40\x01":
        x_log = False
    elif b[tb + 1 : tb + 5] == b"\x7b\x40\x08\x01":
        x_log = True
    y_start = tb + 1 + 3
    ystep = b.find(_STEP_TAG, y_start, min(len(b), y_start + _TAG_SEARCH_SPAN))
    if ystep < 0:
        return None
    ypair = real_form_bare_pair(b, y_start, ystep)
    if ypair is None:
        return None
    return (*xpair, *ypair, type_byte, x_log)
