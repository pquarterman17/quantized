"""Extract figure definitions from ``.opju`` (CPYUA) graph windows (items 14+33).

CPYUA stores a graph *layer*'s axis descriptor as a self-contained record, found
by scanning for the 4-byte marker ``03 00 00 1f`` (validated: it opens every
axis record in every graph tested — controlled specimens *and* real corpus
files, across both CPYUA builds seen, ``4.3380`` and ``4.3811``). Two record
forms exist, both decoded here:

**Specimen form** (default-dialog graphs, the item-14 shape): after the marker
come the X-axis ``(from, to)`` values, a step field, a fixed 8-byte marker
``81 04 06 00 00 01 c3 66`` whose *next byte* is a **combined axis-scale flag**
(``0x03`` X-lin+Y-lin / ``0x04`` X-log+Y-lin / ``0x0d`` Y-log, X unencoded —
pinned from four controlled specimens toggling X, Y, and both; see
``_axis_scales`` and ``tools/origin_trial/generate_specimens*``). Y-scale is
always exact; X-scale is exact only in the Y-linear case (``0x04``) and
otherwise falls back to the decade heuristic. Then a fixed 3-byte filler, then
Y ``(from, to)`` + step. Values are a
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
this form has **no isolated X-scale flag**: ``x_log`` falls back to the same
decade heuristic the ``.opj`` reader uses (correct for all 14 corpus
anchors), except when the specimen-form's combined scale byte (above)
happens to also be present nearby (``_scale_byte``) — see below. Spans
decode by exact-fill: X tries ``[from, to, step]`` then ``[to, step]`` (from
elided) after the flag skip; Y scans for its start (the separator payload
length varies) using tagged/RLE tokens only. A span whose fills disagree is
dropped, never guessed.

**Y-scale flag — solved 2026-07-04** (a 4-file by-construction oracle:
``rf_linlin``/``rf_logx``/``rf_logy``/``rf_loglog.opju``, the same
single-curve graph with identical custom ranges, differing only in
``layer.x.type``/``layer.y.type``): unlike X, Y in this form DOES carry an
isolated, exact lin/log flag — see ``opju_axis_real_form.py``'s
``_real_y_log_flag`` for the byte-level trail (the same two byte values,
``01 00``/``08 01``, as the independently-discovered ``.opj`` flag,
``figures.py``'s ``_y_scale_flag``, just at a different offset). Validated
exact against all 14 real-corpus anchors and >300 further layers scanned
across the wider ``.opj`` corpus during the cross-container validation (see
``docs/origin_project_format.md`` §6.2). ``y_log`` uses this flag when
present and only falls back to the decade heuristic otherwise.

Validated end-to-end against Origin's own ground-truth export: all 6 specimen
layers (``fig_lin``/``fig_log``/``fig_pairs``) decode exactly via the specimen
form (plus the X-scale diff pair ``fig_linx``/``fig_logx`` and both-log
``fig_xylog`` that pinned the combined flag), and **all 14 real-corpus anchors**
(RockingCurve 3, XAS 3, UnpolPlots 4,
"Fixed Lambdas SI" 4) decode with exact axis ranges and correct lin/log via
the real form (Y from the new exact flag, X from the decade heuristic).
Composite windows (e.g. RockingCurve ``Graph3``) reference already-encoded
layers, so anchors are fewer than GT layers; GT layers whose ranges
duplicate a matched anchor are covered by it. The real-corpus-form value
tokens, span decoding, and the Y-scale flag itself live in
``opju_axis_real_form.py`` (split out to stay under the 500-line
god-module ceiling).

This module fills ``source_hint`` from the ``<BKNAME>...</BKNAME>`` OriginStorage
XML tag when one appears near the graph (an unambiguous, low-false-positive
signal, unlike blind name-scanning) and ``n_curves`` from the legend text's
``\\l(n)`` indices, mirroring ``figures.py`` exactly. The per-layer graph
*window name* (Origin's "Graph1" etc.) is not recoverable with the current
understanding, so ``name`` is always ``""``.

**Curve-to-dataset binding (item 35, partial).** Unlike ``.opj``
(``figures.py``, where the DataPlot column selector is still permanently
undecoded), CPYUA's curve/DataPlot objects carry a small fixed-shape token
that decodes the Y-axis column exactly, gated against an independently
validated per-column designation check so nothing reported is a mis-typed
column (validated against a purpose-built specimen, exact 4/4; and the real
corpus, 12 designation-confirmed curves across 4 files — no direct Origin-GT
match was possible, see ``opju_curves.py``'s module docstring for the full
byte-level trail). Each decodable figure gets a best-effort ``"curves"``
list of ``{"book", "x", "y"}`` dicts (often empty, or missing curves a user
would expect — see ``opju_curves.py``'s "Known gap — per-figure
attribution", the reason item 35 stays open); ``x`` is a structural
inference (the Y column's own book's first column), not decoded from the
byte record.
"""

from __future__ import annotations

import re
from typing import Any

from quantized.io.origin_project.figures import _AUTO_TITLE, _LEGEND_RE, _log_heuristic, _texts_in
from quantized.io.origin_project.opju_axis_real_form import (
    _TAG_SEARCH_SPAN,
    _decode_compact,
    _decode_raw8,
    _parse_real_record,
)
from quantized.io.origin_project.opju_curves import (
    book_columns_from_bytes,
    book_metadata_from_bytes,
    extract_curves,
)

__all__ = ["extract_figures_opju"]

_ANCHOR = bytes.fromhex("0300001f")
_Y_TRANSITION = bytes([0x81, 0x04, 0x06, 0x00, 0x00, 0x01, 0xC3, 0x66])
_STEP_TAG = bytes([0x83, 0x02])
# The byte after _Y_TRANSITION is a *combined* axis-scale field, pinned from
# four single/dual-variable specimens (fig_lin/log toggled Y, fig_linx/logx
# toggled X, fig_xylog toggled both — see tools/origin_trial/generate_specimens*):
#   0x03 -> X-lin, Y-lin      0x04 -> X-log, Y-lin
#   0x0d -> Y-log  (0x0d whether X is lin OR log: the field does NOT encode X
#                   once Y is log, so X falls back to the decade heuristic there)
# Y-scale is therefore always exact (0x0d == log, else lin); X-scale is exact
# only in the Y-linear case (0x04), heuristic otherwise.
_TYPE_LOG = 0x0D  # Y log (X unencoded)
_TYPE_LIN = 0x03  # both linear
_TYPE_XLOG = 0x04  # X log, Y linear
_BKNAME_RE = re.compile(rb"<BKNAME>([^<]+)</BKNAME>")
_TEXT_WINDOW = 20_000  # bytes scanned per layer for legend/annotation/source-hint text

# ── specimen-form value spans (item 14) ───────────────────────────────────────


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


def _scale_byte(b: bytes, p: int, end: int) -> int | None:
    """The combined axis-scale byte after ``_Y_TRANSITION`` near anchor ``p``.

    Returns ``None`` when the marker is absent (every real-corpus figure
    anchor, whose scale is heuristic-only) so those layers stay untouched.
    """
    yt = b.find(_Y_TRANSITION, p, min(end, p + _TAG_SEARCH_SPAN))
    if yt < 0 or yt + len(_Y_TRANSITION) >= len(b):
        return None
    return b[yt + len(_Y_TRANSITION)]


def _axis_scales(
    type_byte: int, x_from: float, x_to: float, y_from: float, y_to: float
) -> tuple[bool, bool]:
    """``(x_log, y_log)`` from the combined scale byte (see ``_TYPE_*`` notes).

    Y-scale is exact for every observed byte; X-scale is exact only when the
    byte isolates it (``0x04``) and otherwise honestly falls back to the
    decade heuristic — the byte carries no X information once Y is log.
    """
    if type_byte == _TYPE_LIN:  # 0x03: both linear
        return False, False
    if type_byte == _TYPE_XLOG:  # 0x04: X log, Y linear
        return True, False
    if type_byte == _TYPE_LOG:  # 0x0d: Y log; X not encoded -> heuristic
        return _log_heuristic(x_from, x_to), True
    # unrecognized flag: no isolated evidence, heuristic for both (like .opj)
    return _log_heuristic(x_from, x_to), _log_heuristic(y_from, y_to)


def extract_figures_opju(b: bytes) -> list[dict[str, Any]]:
    """Every decodable graph layer in a CPYUA project as a plot-state snapshot.

    Same shape as ``figures.extract_figures`` (the ``.opj`` reader) plus one
    addition: each dict has ``name``, ``x_from``, ``x_to``, ``x_log``,
    ``y_from``, ``y_to``, ``y_log``, ``source_hint``, ``n_curves``,
    ``annotations``, and ``curves`` (item 35 — a best-effort list of
    ``{"book", "x", "y"}`` column bindings, possibly empty; see
    ``opju_curves.py``). A multi-layer graph window (e.g. a double-Y or
    free-panel layout) yields one dict per layer rather than nesting them,
    since the shipped payload shape is flat. Composite windows that
    *reference* an already-encoded layer share its single anchor (see the
    module docstring).
    """
    figures: list[dict[str, Any]] = []
    book_columns = book_columns_from_bytes(b)
    books_meta = book_metadata_from_bytes(b, book_columns)
    anchors = _find_all(b, _ANCHOR)
    for idx, anchor in enumerate(anchors):
        p = anchor + len(_ANCHOR)
        window_end = anchors[idx + 1] if idx + 1 < len(anchors) else len(b)
        spec = _parse_specimen_record(b, p)
        type_byte: int | None
        real_y_log: bool | None = None
        if spec is not None:
            x_from, x_to, y_from, y_to, type_byte = spec
        else:
            real = _parse_real_record(b, p, window_end)
            if real is None:
                continue  # undecodable record: skip, never guess
            x_from, x_to, y_from, y_to, real_y_log = real
            # the full specimen record may not parse (e.g. an X-log record's
            # varying filler) yet still carry the scale marker — read it directly
            type_byte = _scale_byte(b, p, window_end)
        if type_byte is None:  # real-corpus form: no marker, heuristic for X
            x_log = _log_heuristic(x_from, x_to)
            y_log = _log_heuristic(y_from, y_to)
        else:
            x_log, y_log = _axis_scales(type_byte, x_from, x_to, y_from, y_to)
        if real_y_log is not None:
            # the real-form Y-scale flag (_real_y_log_flag) is exact and
            # always wins: type_byte's 0x03/0x04 pair only ever isolates X in
            # this form (see the module docstring), so it must never override
            # a real Y reading with a stale/heuristic one.
            y_log = real_y_log
        window = b[anchor : min(window_end, anchor + _TEXT_WINDOW)]
        texts = _texts_in(window)
        titles = [t for t in texts if not _AUTO_TITLE.match(t) and "\\l(" not in t]
        legend_ns = [int(n) for t in texts for n in _LEGEND_RE.findall(t)]
        figures.append(
            {
                "name": "",  # per-layer window name not recoverable (see module docstring)
                "x_from": x_from,
                "x_to": x_to,
                "x_log": x_log,
                "y_from": y_from,
                "y_to": y_to,
                "y_log": y_log,
                "source_hint": _source_hint(b, anchor),
                "n_curves": max(legend_ns) if legend_ns else 0,
                "annotations": titles[:12],
                "curves": extract_curves(b, anchor, window_end, book_columns, books_meta),
            }
        )
    return figures
