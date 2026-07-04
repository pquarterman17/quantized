"""Extract figure definitions from ``.opju`` (CPYUA) graph windows (plan item 14).

CPYUA stores a graph *layer*'s axis descriptor as a self-contained record, found
by scanning for the 4-byte marker ``03 00 00 1f`` (validated: it opens every
axis record in every graph tested — controlled specimens *and* real corpus
files, across both CPYUA builds seen, ``4.3380`` and ``4.3811``). Right after
the marker come the X-axis ``(from, to)`` values, then a step field, then a
fixed 8-byte marker ``81 04 06 00 00 01 c3 66`` whose *next byte* is the only
byte that differed between a controlled linear/log10 diff pair (``0x03`` seen
for every linear axis, ``0x0d`` for the one log10 axis) — so it is used as the
Y-axis scale-type flag. A fixed 3-byte filler (``7b 40 01``) follows, then the
Y-axis ``(from, to)`` values, then Y's own step field.

Each individual value is emitted one of three ways (the exact 2-byte tag
prefix was not decoded — see below):

* a bare 8-byte float64 literal (LE), no tag — seen for "messy" values;
* a 2-byte tag + 8-byte float64 literal;
* a 2-byte tag + 1-3 *significant* bytes: the value's big-endian bytes,
  truncated to the top N and stored **reversed** (so the file holds
  ``reversed(struct.pack(">d", v)[:N])``), used whenever a value is exactly
  representable that way (whole numbers, most auto-scaled ranges);
* **elision**: an exactly-zero ``from`` is not stored at all — the record
  jumps straight to ``to``'s own tag+value.

The 2-byte tag's exact bit layout was not cracked (it looks like a
varint-encoded field id that also depends on which of the sibling
value's encodings surround it — see ``docs/origin_re/opju_container.md``
follow-up notes), so this module does not decode it. Instead every
admissible split of a value span is tried (bare/tagged raw8, tagged compact
1-3B, optionally-elided ``from``) and accepted **only** when exactly one
split parses both values as plausible finite numbers *and* consumes the span
exactly — an ambiguous or malformed span is dropped, never guessed.

Validated end-to-end against Origin's own ground-truth export
(``specimens/ground_truth/{fig_lin,fig_log,fig_pairs}``): all 6 controlled
graph layers decode with exact axis ranges and the correct linear/log10 flag.
**Known gap:** real corpus graphs (bound curves, non-default tick/grid
dialogs) do not share this exact record shape — the ``03 00 00 1f`` marker is
present, but the fixed ``81 04 06 00 00 01 c3 66`` transition marker is not
found (confirmed identical-byte-for-byte between the original corpus file and
a same-content file re-saved by a newer CPYUA build, so this is a
*content-complexity* difference, not a version difference). Those graphs are
silently skipped rather than mis-decoded; see
``docs/origin_re/opju_container.md`` for the byte-level record dump this
finding is based on.

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


def extract_figures_opju(b: bytes) -> list[dict[str, Any]]:
    """Every decodable graph layer in a CPYUA project as a plot-state snapshot.

    Same shape as ``figures.extract_figures`` (the ``.opj`` reader): each dict
    has ``name``, ``x_from``, ``x_to``, ``x_log``, ``y_from``, ``y_to``,
    ``y_log``, ``source_hint``, ``n_curves``, ``annotations``. A multi-layer
    graph window (e.g. a double-Y or free-panel layout) yields one dict per
    layer rather than nesting them, since the shipped payload shape is flat.
    """
    figures: list[dict[str, Any]] = []
    anchors = _find_all(b, _ANCHOR)
    for idx, anchor in enumerate(anchors):
        p = anchor + len(_ANCHOR)
        ytrans = b.find(_Y_TRANSITION, p, min(len(b), p + _TAG_SEARCH_SPAN))
        if ytrans < 0:
            continue  # real-corpus graphs with bound curves/custom dialogs: known gap
        xstep = b.rfind(_STEP_TAG, p, ytrans)
        if xstep < 0:
            continue
        xpair = _parse_pair(b, p, xstep)
        if xpair is None:
            continue
        type_byte = b[ytrans + len(_Y_TRANSITION)]
        y_start = ytrans + len(_Y_TRANSITION) + 1 + 3  # + type byte + "7b 40 01" filler
        ystep = b.find(_STEP_TAG, y_start, min(len(b), y_start + _TAG_SEARCH_SPAN))
        if ystep < 0:
            continue
        ypair = _parse_pair(b, y_start, ystep)
        if ypair is None:
            continue
        x_from, x_to = xpair
        y_from, y_to = ypair
        if type_byte == _TYPE_LOG:
            y_log = True
        elif type_byte == _TYPE_LIN:
            y_log = False
        else:  # an unrecognized flag byte: no isolated evidence, fall back like .opj
            y_log = _log_heuristic(y_from, y_to)
        window_end = anchors[idx + 1] if idx + 1 < len(anchors) else len(b)
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
