"""Shared figure-text helpers: raw-run scanning, object-name routing, titles,
legend-label parsing. Split out of ``figures.py`` (2026-07-06, the 500-line
guard) because BOTH containers' figure decoders (``figures.py``,
``figures_opju.py``) and the CPYUA framed-text router
(``opju_figure_text.py``) consume the exact same pipeline — one home keeps
the two containers' text semantics identical by construction.

Pure leaf: imports only ``origin_richtext``. See ``figures.py``'s module
docstring for the byte-level trail these helpers were validated against.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from quantized.io.origin_project.origin_richtext import clean_richtext

__all__ = [
    "_LEGEND_RE",
    "_RICHTEXT_MARK",
    "_TITLE_OBJECT_BUCKETS",
    "_first_title",
    "_object_bucket",
    "_object_text",
    "_parse_legend_labels",
    "_parse_legend_layers",
    "_texts_in",
    "distribute_legend_layers",
]

# A legend entry's swatch marker — counts curves (``n_curves``) and detects
# legend text in raw scans.
_LEGEND_RE = re.compile(r"\\l\((\d+)\)")

_WORDY = re.compile(r"[A-Za-z0-9 ()\[\].,%/+°:=-]")

# A well-formed Origin rich-text escape (see ``origin_richtext``): a legend
# swatch ``\l(n)``, a formatting run ``\g( \b( \i( \u( \+( \-(``, a font/colour
# run ``\f:Name(`` / ``\c<n>(``, or a character-code atom ``\(40)`` / ``\(x2225)``.
# Binary noise essentially never forms these 3+-byte structured sequences, so a
# string containing one is user text by construction — the wordiness heuristic
# below must not veto it (it mis-scored short titles like ``2\g(q)`` = "2θ",
# whose escape syntax IS most of the string).
_RICHTEXT_MARK = re.compile(r"\\(?:[gbiul+\-]\(|\((?:\d|[xX][0-9a-fA-F])|f:|c\d+\()")


def _texts_in(payload: bytes) -> list[str]:
    """Human-looking text runs of a text-object body (annotations, titles, legend).

    Binary blocks are full of short printable accidents and internal tokens —
    keep only strings that read like labels: mostly word-ish characters, at
    least two letters, not internal ``_``/``@${`` machinery. A string carrying
    a well-formed rich-text escape (``_RICHTEXT_MARK``) is kept verbatim
    without the wordiness test — escape syntax is proof of user text, and the
    escapes themselves (backslashes, single Symbol-font letters) are exactly
    what the heuristic mis-scores.
    """
    out = []
    for m in re.finditer(rb"[\x20-\x7e\\]{3,}", payload):
        s = m.group().decode("latin1").strip()
        if not s or s.startswith(("@${", "_", "*")):
            continue
        if _RICHTEXT_MARK.search(s):  # incl. legend \l(n): keep verbatim
            out.append(s)
            continue
        letters = sum(c.isalpha() for c in s)
        if letters < 2 or len(_WORDY.findall(s)) / len(s) < 0.85:
            continue
        if re.fullmatch(r"(Text|Line|Legend|Graph|Layer)\d*", s):
            continue  # object names, not user text
        if len(s) >= 4 or " " in s or "(" in s:
            out.append(s)
    return out


_TITLE_OBJECT_BUCKETS = {"YL": "y_title", "XB": "x_title", "YR": "y2_title", "Legend": "legend"}


def _object_bucket(name: str | None) -> str:
    """Which recovered-text bucket a graph-child object's own name routes to
    (see ``figures.py``): ``YL``/``XB``/``YR`` are the Y/X/secondary-Y axis
    titles, ``Legend`` is the per-curve legend text, ``Text*``/``Line*`` are
    genuine floating annotations. The legend object's name is matched
    case-insensitively: composite (multi-layer) graph windows name it
    lowercase ``legend`` (20 corpus instances across PNR/Moke/
    MnN_Diffusion_PNR/SLD_DoubleY.otp, 2026-07-11 sweep — always the dotted
    ``\\l(layer.plot)`` legend of a double-Y/merge window), which the old
    exact match silently routed to "ignore", dropping the whole legend.
    Everything else — ``XT`` (the rarely-used top-X axis), internal
    storage/config objects (``__LayerInfoStorage``, ``__BCO2``,
    ``__FRAMESRCDATAINFOS``, ``3D``), composite-layout axis-break
    sub-objects (``OB``/``OL``/``OR``/``X1``/``X2``), reference lines
    (``RLX*``/``RLY*``), or an unresolved name — is deliberately routed to
    ``"ignore"``: dropped, never guessed into the wrong bucket. (Region
    shapes, ``Rect*``, are no longer a text concern at all — their typed
    headers (0x31) are decoded by ``opj_shapes`` before name routing runs.)
    """
    if name is None:
        return "ignore"
    if name in _TITLE_OBJECT_BUCKETS:
        return _TITLE_OBJECT_BUCKETS[name]
    if name.lower() == "legend":
        return "legend"
    if name.startswith("Text") or name.startswith("Line"):
        return "annotations"
    return "ignore"


def _first_title(texts: Sequence[str]) -> str:
    """The first non-empty recovered string for a single-valued title bucket
    (``x_title``/``y_title``/``y2_title``) — these objects hold exactly one
    string in every corpus instance seen; ``""`` when the bucket never
    resolved (an untouched auto-title template like ``%(?Y)`` is already
    filtered out upstream by ``_texts_in``'s letter-count check). The chosen
    string is decoded from Origin rich-text (``\\g(q)`` → θ, ``\\(40)`` → the
    char, super/subscripts, styling stripped) so it displays as a plain title."""
    for t in texts:
        if t.strip():
            return clean_richtext(t)
    return ""


_LEGEND_LINE_RE = re.compile(r"\\l\((\d+)\)\s*(.*)")
# A single legend LINE can hold several entries back-to-back with no newline
# between them (Origin only needs the \l(n) swatch marker, not a line break —
# seen live in Hc2 data.opju Graph3: ``\l(4) Nb\l(5) Nb/Al\l(6) Nb/Au``), so
# split each line into per-entry segments at every \l(n) boundary first.
# The boundary also matches the composite (multi-layer) dotted form
# ``\l(layer.plot)`` so `_parse_legend_layers` sees clean segments; the
# plain `_LEGEND_LINE_RE` above still ignores dotted entries by design.
_LEGEND_SEG_RE = re.compile(r"(?=\\l\(\d+(?:\.\d+)?\))")
# Composite (multi-layer) legend entry: ``\l(layer.plot) <label>`` — the
# `layer.plot` indexing Origin uses whenever ONE legend object captions a
# multi-layer window's curves (double-Y overlays, merge windows). See
# `_parse_legend_layers`.
_LEGEND_DOTTED_RE = re.compile(r"\\l\((\d+)\.(\d+)\)\s*(.*)")


def _parse_legend_labels(texts: Sequence[str]) -> list[str]:
    """Per-curve legend captions from the Legend object's own
    ``\\l(n) <label>`` entries. ``label`` is kept verbatim — whether
    hand-edited literal text (e.g. hc2convert's ``"Nb"``/``"Nb/Al"``/
    ``"Nb/Au"``, XRD's ``"325"``/``"525"``) or the untouched auto template
    (``"%(2)"``) — never resolved further. Returns a dense 1-based list sized
    to the highest ``n`` seen, with ``""`` for any gap; ``[]`` when no
    ``\\l(n)`` entry was found. Never fabricated: a missing slot stays blank
    rather than guessed.
    """
    labels: dict[int, str] = {}
    for t in texts:
        for seg in _LEGEND_SEG_RE.split(t):
            m = _LEGEND_LINE_RE.match(seg)
            if m:
                labels[int(m.group(1))] = clean_richtext(m.group(2).strip())
    if not labels:
        return []
    return [labels.get(i, "") for i in range(1, max(labels) + 1)]


def _parse_legend_layers(texts: Sequence[str]) -> dict[int, list[str]]:
    """Per-LAYER legend captions from a composite legend's dotted
    ``\\l(layer.plot) <label>`` entries (item 41 — the multi-layer legend
    object of a double-Y/merge window, e.g. PNR.opj Graph1's
    ``\\l(1.1) %(1.1)  \\l(2.1) %(2.1) …``). Returns ``{layer: dense
    1-based label list}``; plain ``\\l(n)`` entries land in layer 1 (a
    single-layer legend's implied layer). An auto template referencing the
    SAME dotted slot (``%(layer.plot)``) is re-indexed to the target
    layer's own curve ordinal (``%(plot)``) so the per-figure ``%(n)``
    resolver applies unchanged; a template referencing a DIFFERENT layer is
    left verbatim — a raw code is better than a wrong guess. Missing slots
    stay ``""``, never fabricated."""
    per: dict[int, dict[int, str]] = {}
    for t in texts:
        for seg in _LEGEND_SEG_RE.split(t):
            m = _LEGEND_DOTTED_RE.match(seg)
            if m:
                lyr, plot = int(m.group(1)), int(m.group(2))
                label = m.group(3).strip()
                label = re.sub(rf"%\({lyr}\.(\d+)\)", r"%(\1)", label)
                per.setdefault(lyr, {})[plot] = clean_richtext(label)
                continue
            m2 = _LEGEND_LINE_RE.match(seg)
            if m2:
                per.setdefault(1, {})[int(m2.group(1))] = clean_richtext(m2.group(2).strip())
    return {lyr: [d.get(i, "") for i in range(1, max(d) + 1)] for lyr, d in per.items() if d}


def distribute_legend_layers(figures: list[dict[str, Any]]) -> None:
    """Window-level composite-legend pass (item 41): one graph window's
    figure dicts (one per layer, each carrying its private ``_legend_raw``
    lines) share ONE legend object, but its dotted ``\\l(layer.plot)``
    entries caption OTHER layers' curves — the per-layer span parse alone
    leaves every layer's ``legend_labels`` empty. Pops ``_legend_raw`` from
    every dict (the private key never ships), and — only when a dotted
    entry exists anywhere in the window — fills each layer's EMPTY
    ``legend_labels`` from the layered parse. A layer whose own plain
    ``\\l(n)`` legend already parsed is never overwritten."""
    raw: list[str] = []
    for f in figures:
        raw.extend(f.pop("_legend_raw", []))
    if not any(_LEGEND_DOTTED_RE.match(seg) for t in raw for seg in _LEGEND_SEG_RE.split(t)):
        return
    layered = _parse_legend_layers(raw)
    for f in figures:
        if not f.get("legend_labels"):
            entries = layered.get(int(f.get("layer", 1)))
            if entries:
                f["legend_labels"] = entries


def _object_text(payload: bytes) -> str | None:
    """The exact text of an annotation object's CONTENT block: the entire
    block is ``<text>\x00`` (observed structurally: a Text object = 133-byte
    header, a 103-byte format block, then a content block holding ONLY the
    NUL-terminated string — e.g. ``b"X\x00"`` for a one-char peak marker).
    Returns ``None`` unless the block is exactly that shape (non-empty,
    single trailing NUL, no interior NULs/controls beyond CR/LF/TAB) — so
    format/geometry blocks can never read as text. Solved 2026-07-06: the
    heuristic ``_texts_in`` scan needs >=3 printable chars and wordiness,
    silently dropping Origin's ultra-short peak labels ('X', '*', 'Si');
    ownership by a named Text header is the trust signal that replaces
    those noise filters."""
    # 4096-byte cap: a floating-text annotation can hold a paragraph (the old
    # 512 silently dropped long notes); still bounded so a large format/geometry
    # block can't be mistaken for text (2026-07-06 genericity audit).
    if not 2 <= len(payload) <= 4096 or payload[-1] != 0:
        return None
    body = payload[:-1]
    if not body or any(b < 0x20 and b not in (0x09, 0x0A, 0x0D) for b in body) or 0 in body:
        return None
    # UTF-8-first (the .opju container's text encoding — degree/Greek/micro);
    # latin-1 fallback for the rare cell that is latin-1 but not valid UTF-8.
    try:
        text = body.decode("utf-8").replace("\r\n", "\n").strip()
    except UnicodeDecodeError:
        text = body.decode("latin1").replace("\r\n", "\n").strip()
    return text or None
