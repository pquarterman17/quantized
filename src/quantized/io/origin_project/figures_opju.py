"""Extract figure definitions from ``.opju`` (CPYUA) graph windows (items 14+33).

CPYUA stores a graph *layer*'s axis descriptor as a self-contained record, found
by scanning for the 4-byte marker ``03 00 00 1f`` (validated: it opens every
axis record in every graph tested — controlled specimens *and* real corpus
files, across both CPYUA builds seen, ``4.3380`` and ``4.3811``). Two record
forms exist, both decoded here:

**Specimen form** (default-dialog graphs, the item-14 shape): after the marker
come the X-axis ``(from, to)`` values, a step field, a fixed 8-byte marker
``81 04 06 00 00 01 c3 66`` whose *next byte* is the Y-axis scale-type flag
(``0x03`` linear / ``0x0d`` log10, pinned from a controlled single-variable
diff pair), a fixed 3-byte filler, then Y ``(from, to)`` + step. Values are a
2-byte tag + 8-byte LE float64 literal, a bare literal, or a 2-byte tag + 1-3
*significant* bytes (the double's big-endian top-N bytes stored reversed); an
exactly-zero ``from`` is elided entirely. The tag itself was never cracked, so
every admissible split of a value span is tried and accepted **only** when
exactly one split parses plausibly and consumes the span exactly.

**Real-corpus form** (bound curves / non-default axis dialogs, the item-33
shape, solved 2026-07-04 against the 4-file ground-truth oracle — see
``docs/origin_re/opju_container.md``):

```
03 00 00 1f                       layer anchor
[optional flag token]             1-2 bytes, skipped (see below)
[X from] [X to] [X step]          value tokens; ``from`` elided when 0.0
81 <id> <plen> 00 00 01 …         separator (layer geometry; plen VARIES
                                  and is only a search-window hint)
[Y from] [Y to] [Y step]          value tokens (tagged/RLE only)
81 <id> <plen> 00 00 01 …         end separator
```

Real-form value tokens add two encodings to the specimen set:

* **tagged compact**: ``8T nn <nn bytes>`` with tag byte in ``0x81..0x8f`` and
  ``nn`` = payload length — payload is the double's BE top-``nn`` reversed;
* **RLE-compressed literal**: a byte-run inside the 8 LE double bytes
  collapses to a ``c2``/``c3`` escape. **Count law (solved by constraint-fit
  across every instance in the corpus): ``c2`` = a run of exactly 5 repeated
  bytes, ``c3`` = exactly 6.** The byte *after* the repeated byte is a
  context/tag byte (values 01/02/03/0a observed for identical run structures —
  NOT a count; skipped), then literal suffix bytes complete the 8. Two
  alignments occur: lead form ``<lead> c2/c3 <rep> <ctx> <suffix…>`` (run
  covers double bytes 1..N) and run-first form ``c2/c3 <rep> <ctx> <suffix…>``
  (run covers bytes 0..N-1; e.g. 1.4 = ``c3 66 03 f6 3f``);
* **bare compact**: 1-3 significant bytes with *no* tag, directly after a flag
  token (e.g. ``f0 3f`` = 1.0).

The optional X flag token (``89 01``/``89 18``/``97 03``/``91 09`` = 2 bytes;
a bare ``91`` directly before a run-first RLE value = 1 byte; absent when the
record opens with a tagged value) is skipped via that deterministic length
rule; its semantics stay undecoded — across the oracle corpus it shows **no**
correlation with axis lin/log types (every flagged X-axis is linear in GT).
The ``85 02 f0 3f`` sequence once suspected to be a y-log flag is in fact a
tagged ``y_from = 1.0`` (proven by whole-span exact-fill + ground truth), so
the real form carries **no** isolated scale-type flag: ``x_log``/``y_log``
fall back to the same decade heuristic the ``.opj`` reader uses (which is
correct for all 14 corpus anchors). Spans decode by exact-fill: X tries
``[from, to, step]`` then ``[to, step]`` (from elided) after the flag skip; Y
scans for its start (the separator payload length varies) using tagged/RLE
tokens only. A span whose fills disagree is dropped, never guessed.

Validated end-to-end against Origin's own ground-truth export: all 6 specimen
layers (``fig_lin``/``fig_log``/``fig_pairs``) decode exactly via the specimen
form, and **all 14 real-corpus anchors** (RockingCurve 3, XAS 3, UnpolPlots 4,
"Fixed Lambdas SI" 4) decode with exact axis ranges and correct lin/log via
the real form. Composite windows (e.g. RockingCurve ``Graph3``) reference
already-encoded layers, so anchors are fewer than GT layers; GT layers whose
ranges duplicate a matched anchor are covered by it.

Curve-to-dataset binding is unresolved here just as it is for ``.opj``
(``figures.py``): neither reader decodes the DataPlot column selector. This
module fills ``source_hint`` from the ``<BKNAME>...</BKNAME>`` OriginStorage
XML tag when one appears near the graph (an unambiguous, low-false-positive
signal, unlike blind name-scanning) and ``n_curves`` from the legend text's
``\\l(n)`` indices, mirroring ``figures.py`` exactly. The per-layer graph
*window name* (Origin's "Graph1" etc.) is not recoverable with the current
understanding, so ``name`` is always ``""``.
"""

from __future__ import annotations

import re
import struct
from typing import Any

from quantized.io.origin_project.figures import _AUTO_TITLE, _LEGEND_RE, _log_heuristic, _texts_in

__all__ = ["extract_figures_opju"]

_ANCHOR = bytes.fromhex("0300001f")
_Y_TRANSITION = bytes([0x81, 0x04, 0x06, 0x00, 0x00, 0x01, 0xC3, 0x66])
_STEP_TAG = bytes([0x83, 0x02])
_TYPE_LOG = 0x0D
_TYPE_LIN = 0x03
_BKNAME_RE = re.compile(rb"<BKNAME>([^<]+)</BKNAME>")
_TEXT_WINDOW = 20_000  # bytes scanned per layer for legend/annotation/source-hint text
_TAG_SEARCH_SPAN = 2_000  # max bytes allowed between an anchor and its transition/step tags

# Real-corpus form (item 33): `81 <id> <plen> 00 00 01` separates the X span
# from the layer-geometry payload and the geometry from the Y span.
_SEP_RE = re.compile(rb"\x81..\x00\x00\x01", re.DOTALL)
_Y_START_SCAN = 6  # Y may start up to this many bytes past the nominal payload end


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


# ── specimen-form value spans (item 14) ───────────────────────────────────────


def _value_candidates(b: bytes, pos: int, end: int) -> list[tuple[float, int]]:
    """Every plausible ``(value, bytes_consumed)`` parse starting at ``pos``."""
    avail = end - pos
    out: list[tuple[float, int]] = []
    if avail >= 8:
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


# ── real-corpus-form value tokens (item 33) ───────────────────────────────────


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


def _real_candidates(b: bytes, p: int, end: int, bare: bool) -> list[tuple[float, int]]:
    out: list[tuple[float, int]] = []
    t = _real_tagged(b, p, end)
    if t is not None:
        out.append(t)
    r = _real_rle(b, p, end)
    if r is not None:
        out.append(r)
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
    """All ways to place exactly ``n`` value tokens filling ``[pos, end)``."""
    if n == 0:
        return [()] if pos == end else []
    out: list[tuple[float, ...]] = []
    for v, consumed in _real_candidates(b, pos, end, bare):
        for rest in _real_fills(b, pos + consumed, end, n - 1, bare):
            out.append((v, *rest))
    return out


def _real_span_pair(b: bytes, start: int, end: int, bare: bool) -> tuple[float, float] | None:
    """``[from, to, step]`` (n=3) else ``[to, step]`` with from elided (n=2),
    exact-fill; accepted only when the fill set at that arity is unique."""
    for n in (3, 2):
        fills = _real_fills(b, start, end, n, bare)
        pairs = {(f[0], f[1]) if n == 3 else (0.0, f[0]) for f in fills}
        if len(pairs) == 1:
            return pairs.pop()
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


def _parse_real_record(
    b: bytes, p: int, window_end: int
) -> tuple[float, float, float, float] | None:
    """Real-corpus axis record at anchor payload ``p``: ``(xf, xt, yf, yt)``."""
    m1 = _SEP_RE.search(b, p, min(window_end, p + _TAG_SEARCH_SPAN))
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
    m2 = _SEP_RE.search(b, y_lo + plen, min(window_end, y_lo + plen + _TAG_SEARCH_SPAN))
    y_hi = m2.start() if m2 else min(window_end, y_lo + plen + 200)
    # plen is a hint only: Y can start inside or a few bytes past the nominal
    # geometry payload, so scan for the first uniquely exact-filling start.
    for y_start in range(y_lo, min(y_lo + plen + _Y_START_SCAN, y_hi)):
        ypair = _real_span_pair(b, y_start, y_hi, bare=False)
        if ypair is not None:
            return (*xpair, *ypair)
    return None


# ── shared helpers ────────────────────────────────────────────────────────────


def _find_all(b: bytes, pat: bytes) -> list[int]:
    out = []
    i = b.find(pat)
    while i >= 0:
        out.append(i)
        i = b.find(pat, i + 1)
    return out


def _source_hint(b: bytes, anchor: int) -> str:
    m = _BKNAME_RE.search(b, anchor, min(len(b), anchor + _TEXT_WINDOW))
    return m.group(1).decode("latin1", errors="replace") if m else ""


def _parse_specimen_record(b: bytes, p: int) -> tuple[float, float, float, float, int] | None:
    """Specimen-form axis record at anchor payload ``p``:
    ``(xf, xt, yf, yt, type_byte)``."""
    ytrans = b.find(_Y_TRANSITION, p, min(len(b), p + _TAG_SEARCH_SPAN))
    if ytrans < 0:
        return None
    xstep = b.rfind(_STEP_TAG, p, ytrans)
    if xstep < 0:
        return None
    xpair = _parse_pair(b, p, xstep)
    if xpair is None:
        return None
    type_byte = b[ytrans + len(_Y_TRANSITION)]
    y_start = ytrans + len(_Y_TRANSITION) + 1 + 3  # + type byte + "7b 40 01" filler
    ystep = b.find(_STEP_TAG, y_start, min(len(b), y_start + _TAG_SEARCH_SPAN))
    if ystep < 0:
        return None
    ypair = _parse_pair(b, y_start, ystep)
    if ypair is None:
        return None
    return (*xpair, *ypair, type_byte)


def extract_figures_opju(b: bytes) -> list[dict[str, Any]]:
    """Every decodable graph layer in a CPYUA project as a plot-state snapshot.

    Same shape as ``figures.extract_figures`` (the ``.opj`` reader): each dict
    has ``name``, ``x_from``, ``x_to``, ``x_log``, ``y_from``, ``y_to``,
    ``y_log``, ``source_hint``, ``n_curves``, ``annotations``. A multi-layer
    graph window (e.g. a double-Y or free-panel layout) yields one dict per
    layer rather than nesting them, since the shipped payload shape is flat.
    Composite windows that *reference* an already-encoded layer share its
    single anchor (see the module docstring).
    """
    figures: list[dict[str, Any]] = []
    anchors = _find_all(b, _ANCHOR)
    for idx, anchor in enumerate(anchors):
        p = anchor + len(_ANCHOR)
        window_end = anchors[idx + 1] if idx + 1 < len(anchors) else len(b)
        spec = _parse_specimen_record(b, p)
        if spec is not None:
            x_from, x_to, y_from, y_to, type_byte = spec
            if type_byte == _TYPE_LOG:
                y_log = True
            elif type_byte == _TYPE_LIN:
                y_log = False
            else:  # an unrecognized flag byte: no isolated evidence, fall back like .opj
                y_log = _log_heuristic(y_from, y_to)
        else:
            real = _parse_real_record(b, p, window_end)
            if real is None:
                continue  # undecodable record: skip, never guess
            x_from, x_to, y_from, y_to = real
            y_log = _log_heuristic(y_from, y_to)  # real form has no isolated flag
        window = b[anchor : min(window_end, anchor + _TEXT_WINDOW)]
        texts = _texts_in(window)
        titles = [t for t in texts if not _AUTO_TITLE.match(t) and "\\l(" not in t]
        legend_ns = [int(n) for t in texts for n in _LEGEND_RE.findall(t)]
        figures.append(
            {
                "name": "",  # per-layer window name not recoverable (see module docstring)
                "x_from": x_from,
                "x_to": x_to,
                "x_log": _log_heuristic(x_from, x_to),  # no isolated X flag; same heuristic as .opj
                "y_from": y_from,
                "y_to": y_to,
                "y_log": y_log,
                "source_hint": _source_hint(b, anchor),
                "n_curves": max(legend_ns) if legend_ns else 0,
                "annotations": titles[:12],
            }
        )
    return figures
