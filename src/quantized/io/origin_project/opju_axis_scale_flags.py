"""``.opju`` real-form axis-record scale flags (X and Y lin/log).

Split out of ``opju_axis_real_form.py`` (500-line module guard); a pure
extraction. Both readers are exact byte-pattern flags, not heuristics -- see
``opju_axis_real_form``'s module docstring for the rf_* by-construction oracle
that pinned them and the real-corpus proof. They depend only on the bytes
around the geometry payload, never on the value-token grammar.
"""

from __future__ import annotations

__all__: list[str] = []  # internal to the .opju figures subsystem

# Y-scale flag: the fixed layer-style marker that follows the end separator's
# geometry payload, and the 2-byte flag immediately before it (see module docstring).
_Y_STYLE_MARKER = bytes([0x00, 0x10, 0x10, 0x00])
_Y_LIN_FLAG = bytes([0x01, 0x00])
_Y_LOG_FLAG = bytes([0x08, 0x01])
_Y_FLAG_SEARCH_SPAN = 150  # observed within ~10-20 bytes in every instance seen


def _real_x_log_flag(b: bytes, y_lo: int, y_start: int) -> bool | None:
    """Exact X-axis lin/log flag: the geometry payload's trailing field,
    read backward from the Y-span start over 0-2 ``00`` pad bytes --
    ``01`` = linear, ``08 01`` = log10 (the same byte values as the Y flag;
    see the module docstring for the rf_*-diff derivation and the corpus
    proof). Any other tail returns ``None`` (decade heuristic; e.g. the six
    Hc2 records whose field reads ``02``) -- never guessed."""
    q = y_start
    while q > y_lo and b[q - 1] == 0x00:
        q -= 1
    if q - y_lo >= 2 and b[q - 2 : q] == b"\x08\x01":
        return True
    if q - y_lo >= 1 and b[q - 1] == 0x01 and (q - y_lo < 2 or b[q - 2] != 0x08):
        return False
    return None


def _real_y_log_flag(b: bytes, sep_start: int, window_end: int) -> bool | None:
    """Exact Y-axis lin/log flag for the real-corpus form.

    Pinned from a 4-file by-construction oracle (``rf_linlin``/``rf_logx``/
    ``rf_logy``/``rf_loglog.opju`` -- the same single-curve graph with
    identical custom ranges, differing only in ``layer.x.type``/
    ``layer.y.type``): the two bytes right before the fixed ``00 10 10 00``
    layer-style marker that follows the end separator are ``01 00`` for a
    linear Y axis and ``08 01`` for log10, regardless of X's own type or
    encoding (which shifts the marker's absolute position but never its
    value or the flag's relationship to it). Validated exact against all 14
    real-corpus anchors (RockingCurve's 3 log-Y layers read ``08 01``; XAS
    3 + UnpolPlots 4 + "Fixed Lambdas SI" 4, all linear-Y, read ``01 00``).
    Any other value, or no marker found within the search span, returns
    ``None`` so the decade heuristic takes over -- never guessed.
    """
    start = sep_start + 6  # past the separator's own `8x <id> <plen> 00 <flag> 01`
    mpos = b.find(_Y_STYLE_MARKER, start, min(window_end, start + _Y_FLAG_SEARCH_SPAN))
    if mpos < start + 2:
        return None
    flag = b[mpos - 2 : mpos]
    if flag == _Y_LIN_FLAG:
        return False
    if flag == _Y_LOG_FLAG:
        return True
    return None
