"""``.opju`` (CPYUA) real-corpus-form axis record decoding (item 33).

Split out of ``figures_opju.py`` to stay under the repo's 500-line
god-module ceiling; this is purely an extraction, not a new subsystem — see
``figures_opju.py``'s module docstring for the full "Real-corpus form"
narrative (record grammar, value-token encodings) this implements:

```
03 00 00 1f                       layer anchor
[optional flag token]             1-2 bytes, skipped (see below)
[X from] [X to] [X step]          value tokens; ``from`` elided when 0.0
81 <id> <plen> 00 00 01 …         separator (layer geometry; plen VARIES
                                  and is only a search-window hint)
[Y from] [Y to] [Y step]          value tokens (tagged/RLE only)
81 <id> <plen> 00 00 01 …         end separator
```

Value tokens: **tagged compact** (``8T nn <nn bytes>``, tag ``0x81..0x8f``,
payload = the double's BE top-``nn`` reversed), **RLE-compressed literal**
(a byte-run inside the 8 LE double bytes collapses to a ``c2``/``c3``
escape — ``c2`` = a run of exactly 5 repeated bytes, ``c3`` = exactly 6; the
byte after the repeated byte is a context/tag byte, skipped, not a count),
and **bare compact** (1-3 significant bytes, no tag, right after a flag
token). The optional X flag token (``89 01``/``89 18``/``97 03``/``91 09`` =
2 bytes; a bare ``91`` before a run-first RLE value = 1 byte; absent when
the record opens with a tagged value) is skipped via a deterministic length
rule; its semantics stay undecoded.

**Y-axis scale flag — solved 2026-07-04** (the rf_* 4-file by-construction
oracle: ``rf_linlin``/``rf_logx``/``rf_logy``/``rf_loglog.opju``, the SAME
single-curve graph with identical custom ranges ``x=[0.2,20]``/
``y=[50,2000]``, differing only in ``layer.x.type``/``layer.y.type``). The
end separator's geometry payload is followed by a fixed 4-byte layer-style
marker ``00 10 10 00``; the 2 bytes immediately before it are an exact Y
lin/log flag -- ``01 00`` linear, ``08 01`` log10 -- independent of the
geometry payload's own (variable) shape/length and of X's own type/encoding
(which shifts the marker's absolute position but never the flag's value or
its relationship to the marker). Validated exact against all 14 real-corpus
anchors (RockingCurve's 3 log-Y layers read ``08 01``; XAS 3 + UnpolPlots 4
+ "Fixed Lambdas SI" 4, all linear-Y, read ``01 00``) -- see
``docs/origin_project_format.md`` §6.2 for the full byte-level trail. This
mirrors the independently-discovered ``.opj`` flag (``figures.py``'s
``_y_scale_flag``, same two byte values, different fixed offset) -- strong
cross-container corroboration that both are real, not coincidental.

**X-axis scale flag — solved 2026-07-06** (the same rf_* oracle, byte-diffed
pairwise: ``rf_logx`` vs ``rf_linlin`` and ``rf_loglog`` vs ``rf_logy`` differ
ONLY in X): the geometry payload between the two separators ENDS with an
X-scale field carrying the very same two byte values as the Y flag --
``01`` = linear, ``08 01`` = log10 -- immediately before the Y span's first
token, with 0-2 trailing ``00`` pad bytes in between (pad count varies with
the Y token encoding; the flag bytes never do). ``_real_x_log_flag`` reads it
by scanning backward from the decoded Y-span start over the ``00`` pads.
Corpus-proof (see ``docs/origin_re/ORIGIN_CONVENTIONS.md`` §6.2): all 9
by-construction specimens read exactly (rf quad, fig_linx/logx/xylog via the
same bytes on the specimen path, ``axis_custom``), the real-corpus log-x
graph ``Fixed Lambdas SI!Graph6`` (2 layers, GT ``layer.x.type=2``, a 3.8x
span the decade heuristic mislabels linear) reads ``08 01``, and every
GT-linear real record (~70 across Hc2/RockingCurve/XAS/UnpolPlots/Fixed
Lambdas) reads ``01`` -- zero false positives. Six Hc2 records end ``02``
instead (an unrecognized value, possibly another scale type): those return
``None`` and keep the decade heuristic -- never guessed. (The ``85 02 f0
3f`` sequence once suspected to be a scale flag is in fact a tagged
``y_from = 1.0``; the real flag sits before the Y span, not inside it.)

**Panel-layer records (``03 00 00 5f`` anchor) + bare-literal Y spans.**
Multi-layer panel/composite windows (Fixed Lambdas SI ``Graph5``/``Graph6``,
RockingCurve/UnpolPlots ``Graph3``) anchor their per-layer records with
``03 00 00 5f`` (= ``1f | 0x40``), not ``1f`` -- same record grammar inside.
Fixed Lambdas' panel layers additionally encode their Y spans as bare 8-byte
LE literals (elsewhere Y is tagged/RLE only), so the Y scan gets a
LAST-RESORT bare retry that is accepted ONLY where `_real_x_log_flag`
authenticates the Y-span start (the exact flag bytes right before it) --
binary noise cannot satisfy both the flag pattern and a unique exact fill,
so previously-decoding records parse byte-identically (retry-only, like
``_SEP_WIDE``).
"""

from __future__ import annotations

import re
import struct

__all__: list[str] = []  # internal to the .opju figures subsystem; imported by name

# `8x <id> <plen> 00 00 01` separates the X span from the layer-geometry
# payload and the geometry from the Y span. Two lead bytes exist: `81`
# (the original form, every record validated through 2026-07-04) and `80`
# (found 2026-07-05 on Hc2's Graph8/Graph12-family records, always paired
# with a final span token carrying one trailing subfield byte -- see
# `_real_tagged_trailer`). The strict `81` form is always tried first and
# the wide form only as a retry, so previously-decoding records parse
# byte-identically (see `_parse_real_record`).
_SEP_STRICT = re.compile(rb"\x81..\x00\x00\x01", re.DOTALL)
_SEP_WIDE = re.compile(rb"[\x80\x81]..\x00\x00\x01", re.DOTALL)
# Specimen-form record markers (moved with _parse_specimen_record from
# figures_opju, 2026-07-06).
_Y_TRANSITION = bytes([0x81, 0x04, 0x06, 0x00, 0x00, 0x01, 0xC3, 0x66])
_STEP_TAG = bytes([0x83, 0x02])

_TAG_SEARCH_SPAN = 2_000  # max bytes allowed between an anchor and its separator/marker
# Y may start up to this many bytes past the nominal payload end. 7, not 6:
# the geometry payload runs 11 bytes past `y_lo` when plen=5 (Hc2 Graph1 /
# the Graph3 6-curve family, oracle-verified), which the old 6-byte scan
# missed by exactly one.
_Y_START_SCAN = 7

# Y-scale flag: the fixed layer-style marker that follows the end separator's
# geometry payload, and the 2-byte flag immediately before it (see module docstring).
_Y_STYLE_MARKER = bytes([0x00, 0x10, 0x10, 0x00])
_Y_LIN_FLAG = bytes([0x01, 0x00])
_Y_LOG_FLAG = bytes([0x08, 0x01])
_Y_FLAG_SEARCH_SPAN = 150  # observed within ~10-20 bytes in every instance seen


def _plausible(v: float) -> bool:
    return v == v and (v == 0.0 or 1e-9 <= abs(v) <= 1e9)


def _decode_compact(chunk: bytes) -> float | None:
    """1-3 significant bytes: BE top-N of the double, stored reversed."""
    n = len(chunk)
    be = bytes(reversed(chunk)) + b"\x00" * (8 - n)
    v = struct.unpack(">d", be)[0]
    return v if _plausible(v) else None


def _decode_raw8(chunk: bytes) -> float | None:
    if len(chunk) != 8:
        return None
    v = struct.unpack("<d", chunk)[0]
    return v if _plausible(v) else None


def _real_tagged(b: bytes, p: int, end: int) -> tuple[float, int] | None:
    """``8T nn <nn bytes>``: payload reversed is the double's BE top-``nn``."""
    if p + 2 > end:
        return None
    tag, nn = b[p], b[p + 1]
    if not (0x81 <= tag <= 0x8F) or not (1 <= nn <= 8) or p + 2 + nn > end:
        return None
    v = _decode_compact(b[p + 2 : p + 2 + nn])
    return (v, 2 + nn) if v is not None else None


def _real_rle(b: bytes, p: int, end: int) -> tuple[float, int] | None:
    """RLE-compressed 8-byte literal: ``c2`` = run of 5, ``c3`` = run of 6.

    Lead form (marker at ``p+1``) and run-first form (marker at ``p``); the
    byte after the repeated byte is a context/tag byte and is skipped; literal
    suffix bytes complete the 8-byte LE double (see the module docstring).
    """
    for lead_len in (1, 0):
        mpos = p + lead_len
        if mpos + 3 > end:
            continue
        marker = b[mpos]
        if marker == 0xC2:
            run = 5
        elif marker == 0xC3:
            run = 6
        else:
            continue
        suffix_len = 8 - lead_len - run
        tok_end = mpos + 3 + suffix_len
        if suffix_len < 0 or tok_end > end:
            continue
        raw = b[p : p + lead_len] + bytes([b[mpos + 1]]) * run + b[mpos + 3 : tok_end]
        v = struct.unpack("<d", raw)[0]
        if _plausible(v):
            return (v, tok_end - p)
    return None


def _real_bare8(b: bytes, p: int, end: int) -> tuple[float, int] | None:
    """Bare 8-byte LE literal. A leading byte in the tag range ``0x81..0x8f``
    that failed to decode as a tagged value marks a flag/control position, not
    a literal — no corpus literal starts with such a byte."""
    if p + 8 > end or 0x81 <= b[p] <= 0x8F:
        return None
    v = _decode_raw8(b[p : p + 8])
    return (v, 8) if v is not None else None


def _real_tagged_trailer(b: bytes, p: int, end: int) -> tuple[float, int] | None:
    """``8T nn <nn-1 value bytes> <trailer>`` — a tagged compact whose payload
    carries ONE trailing subfield byte (a small int, ``02``/``04`` observed).

    Found 2026-07-05 on Hc2's ``80``-lead-separator records: the span's FINAL
    (step) token gains one payload byte and the separator lead flips 81->80
    in lockstep (e.g. ``83 03 14 40 02`` = step 5.0 + trailer 02 on Graph8,
    vs ``83 02 14 40`` on the byte-identical Graph4). Only ever offered for
    the last token of a span (see ``_real_fills``) so it cannot re-split
    ``from``/``to`` values, and the trailer is constrained to a small int.
    """
    if p + 2 > end:
        return None
    tag, nn = b[p], b[p + 1]
    if not (0x81 <= tag <= 0x8F) or not (2 <= nn <= 8) or p + 2 + nn > end:
        return None
    if not 0x01 <= b[p + 2 + nn - 1] <= 0x0F:
        return None
    v = _decode_compact(b[p + 2 : p + 2 + nn - 1])
    return (v, 2 + nn) if v is not None else None


def _real_candidates(
    b: bytes, p: int, end: int, bare: bool, last: bool = False
) -> list[tuple[float, int]]:
    out: list[tuple[float, int]] = []
    t = _real_tagged(b, p, end)
    if t is not None:
        out.append(t)
    r = _real_rle(b, p, end)
    if r is not None:
        out.append(r)
    if last:
        tt = _real_tagged_trailer(b, p, end)
        if tt is not None:
            out.append(tt)
    if bare:
        w = _real_bare8(b, p, end)
        if w is not None:
            out.append(w)
        if p < end and not (0x81 <= b[p] <= 0x8F):
            for k in (1, 2, 3):  # tag-less compact (seen right after a flag token)
                if p + k <= end:
                    v = _decode_compact(b[p : p + k])
                    if v is not None:
                        out.append((v, k))
    return out


def _real_fills(b: bytes, pos: int, end: int, n: int, bare: bool) -> list[tuple[float, ...]]:
    """All ways to place exactly ``n`` value tokens filling ``[pos, end)``.

    The final token position (``n == 1``) additionally admits the
    trailing-subfield tagged form (`_real_tagged_trailer`) — the step slot
    only, so ``from``/``to`` decoding is never affected by it."""
    if n == 0:
        return [()] if pos == end else []
    out: list[tuple[float, ...]] = []
    for v, consumed in _real_candidates(b, pos, end, bare, last=n == 1):
        for rest in _real_fills(b, pos + consumed, end, n - 1, bare):
            out.append((v, *rest))
    return out


def _real_span_pair(
    b: bytes, start: int, end: int, bare: bool
) -> tuple[float, float, float | None] | None:
    """``[from, to, step]`` (n=3) else ``[to, step]`` with from elided (n=2),
    exact-fill; accepted only when the fill set at that arity is unique on
    the ``(from, to)`` pair (the historical acceptance rule — §13.2 #8 added
    the STEP as a third returned value: the tick increment, ``None`` when
    the accepted fills disagree on it)."""
    for n in (3, 2):
        fills = _real_fills(b, start, end, n, bare)
        pairs = {(f[0], f[1]) if n == 3 else (0.0, f[0]) for f in fills}
        if len(pairs) == 1:
            fr, to = pairs.pop()
            steps = {f[2] if n == 3 else f[1] for f in fills}
            return (fr, to, steps.pop() if len(steps) == 1 else None)
        if len(pairs) > 1:
            return None  # ambiguous: drop, never guess
    return None


def _real_x_flag_len(b: bytes, p: int, end: int) -> int:
    """Deterministic length of the optional X flag token (see module docstring):
    0 when the record opens with a tagged value, 1 for a bare ``91`` before a
    run-first RLE value, else 2 (every other observed flag is 2 bytes)."""
    if _real_tagged(b, p, end) is not None:
        return 0
    if p + 1 < end and b[p] == 0x91 and b[p + 1] in (0xC2, 0xC3):
        return 1
    return 2


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
    start = sep_start + 6  # past the separator's own `81 <id> <plen> 00 00 01`
    mpos = b.find(_Y_STYLE_MARKER, start, min(window_end, start + _Y_FLAG_SEARCH_SPAN))
    if mpos < start + 2:
        return None
    flag = b[mpos - 2 : mpos]
    if flag == _Y_LIN_FLAG:
        return False
    if flag == _Y_LOG_FLAG:
        return True
    return None


def _parse_real_record(
    b: bytes, p: int, window_end: int
) -> tuple[float, float, float, float, bool | None, bool | None, float | None, float | None] | None:
    """Real-corpus axis record at anchor payload ``p``:
    ``(xf, xt, yf, yt, x_log, y_log, x_step, y_step)`` -- the last two are
    the tick increments (None when undecoded); ``x_log``/``y_log`` are the exact
    flags from ``_real_x_log_flag``/``_real_y_log_flag`` when isolatable,
    else ``None`` (caller falls back to the decade heuristic).

    Tried with the strict ``81``-lead separator first (every record
    validated through 2026-07-04 parses byte-identically), then retried
    with the wide ``[80|81]`` lead that Hc2's Graph8/Graph12-family records
    need -- a record only ever reaches the wide pass after failing the
    strict one, so the retry can add parses but never change one."""
    for sep_re in (_SEP_STRICT, _SEP_WIDE):
        got = _parse_real_record_sep(b, p, window_end, sep_re)
        if got is not None:
            return got
    return None


def _parse_real_record_sep(
    b: bytes, p: int, window_end: int, sep_re: re.Pattern[bytes]
) -> tuple[float, float, float, float, bool | None, bool | None, float | None, float | None] | None:
    """One separator-form attempt of `_parse_real_record` (see above)."""
    m1 = sep_re.search(b, p, min(window_end, p + _TAG_SEARCH_SPAN))
    if m1 is None:
        return None
    x_start = p + _real_x_flag_len(b, p, m1.start())
    if x_start >= m1.start():
        return None
    xpair = _real_span_pair(b, x_start, m1.start(), bare=True)
    if xpair is None:
        return None
    plen = b[m1.start() + 2]
    y_lo = m1.start() + 6
    m2 = sep_re.search(b, y_lo + plen, min(window_end, y_lo + plen + _TAG_SEARCH_SPAN))
    y_hi = m2.start() if m2 else min(window_end, y_lo + plen + 200)
    y_scan_hi = min(y_lo + plen + _Y_START_SCAN, y_hi)
    # plen is a hint only: Y can start inside or a few bytes past the nominal
    # geometry payload, so scan for the first uniquely exact-filling start.
    # Bare 8-byte literals are excluded from the first pass (a mis-aligned
    # scan start could decode plausible junk) and retried last-resort ONLY
    # where the exact X-scale flag authenticates the Y-span start (the
    # Fixed Lambdas panel-layer form -- see the module docstring). In the
    # retry a start pointing AT a ``00`` pad byte is not a candidate: the
    # true span begins at the first non-``00`` after the flag, and letting a
    # bare literal absorb the pads decodes a wrong-but-plausible value
    # (measured: Fixed Lambdas Graph5 layer 2's y_from, -0.0488.. for -0.05).
    for bare in (False, True):
        for y_start in range(y_lo, y_scan_hi):
            if bare and (
                (y_start < y_hi and b[y_start] == 0x00)
                or _real_x_log_flag(b, y_lo, y_start) is None
            ):
                continue
            ypair = _real_span_pair(b, y_start, y_hi, bare=bare)
            if ypair is not None:
                x_log = _real_x_log_flag(b, y_lo, y_start)
                y_log = _real_y_log_flag(b, m2.start(), window_end) if m2 else None
                return (
                    xpair[0], xpair[1], ypair[0], ypair[1], x_log, y_log,
                    xpair[2], ypair[2],
                )
    return None


# --------------------------------------------------------------------------
# Specimen-form record parsing (moved from figures_opju 2026-07-06, the
# 500-line guard): the value-token readers + the default-dialog record
# parser. Same axis-record domain as the real form above.

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
    type-byte reading that (unlike the true real-form flag, see
    ``_real_y_log_flag``) carries no Y information at all."""
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

    See the module docstring: every admissible split (``from`` elided, or
    ``from``+``to`` both present) is tried; accepted only if exactly one split
    consumes the span exactly with two plausible values.
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


# Real-corpus-form (item 33) value tokens, span decoding, and the Y-scale
# flag live in ``opju_axis_real_form.py`` (kept out of this file to stay under
# the repo's 500-line god-module ceiling) — ``_parse_real_record`` imported
# above is the entry point used below.


# ── shared helpers ────────────────────────────────────────────────────────────


def _parse_specimen_record(
    b: bytes, p: int
) -> tuple[float, float, float, float, int, bool | None] | None:
    """Specimen-form axis record at anchor payload ``p``:
    ``(xf, xt, yf, yt, type_byte, x_log)``.

    ``x_log`` is the exact X-scale flag inside the "filler" after the type
    byte -- really ``7b 40`` + ``01`` (linear) / ``08 01`` (log10), the same
    field the real form carries (see the module docstring); ``None`` keeps
    the type-byte/heuristic path. ``y_start`` stays at the historical +3
    skip: a log X's extra ``08`` byte is absorbed by ``_parse_pair``'s
    2-byte tag-skip candidate, byte-identically to before."""
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
