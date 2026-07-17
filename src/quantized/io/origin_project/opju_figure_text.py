"""``.opju`` (CPYUA) graph text-object recovery — axis titles / legend / annotations.

Solved 2026-07-05 (previously a documented limitation: ``figures_opju`` dumped
every recovered string into one flat ``annotations`` list). CPYUA graph pages
carry the SAME named child objects the ``.opj`` container has (``YL``/``XB``/
``YR``/``XT`` axis titles, ``Legend``, ``Text``/``TextN`` floating
annotations, ``__FRAMESRCDATAINFOS`` internals …), just in a different
framing. Two byte-level structures, validated across every graph page of the
5-file real ``.opju`` corpus (323 name→text pairs, 0 orphan texts, and — the
strongest check — every shared graph's routed titles equal to the
``hc2convert.opj`` Save-As conversion's independently decoded titles):

**Object-name header** — a tagged field whose payload opens ``0x10``,
immediately followed by the name field::

    <tag 80-9f> 04 10 00 00 <xx> <ntag> <nlen> <name>     (axis-title shape)
    <tag 80-9f> 01 10 <ntag> <nlen> <name>                (Legend/Text shape)

``tag`` varies (``8a``/``84``/``92`` observed), ``<xx>`` varies (``02``/
``04``/``82``/``84`` — uninterpreted), ``ntag`` is ``0x80`` or ``0x83``, and
``name`` is plain ASCII (min 2 chars — a 1-char floor admitted junk
single-letter "names" in trailing storage sections).

**Text content** — a 1-byte ``0x80`` field then a length-prefixed string::

    <tag> 01 80 <tlen> <text … 00>

``tag`` is ``0x86`` or ``0xa8`` (both observed; a corpus scan accepting ANY
tag byte found zero additional matches that survive validation, so the
``0x80-0xbf`` tag range accepted here is not load-bearing — the validation
is: ``tlen`` exact, NUL terminator present, strict UTF-8, no control bytes
beyond CR/LF/TAB). Text is UTF-8 (e.g. Hc2's ``H\\-(c2⊥) (T)`` title and
``∥``/``⊥`` legend labels are raw multi-byte characters here, where the
ANSI ``.opj`` container stores ``\\(x22A5)`` escapes instead).

**Pairing** — objects are sequential: name header, a short style/format
field run (name→text distance 49-66 bytes across the whole corpus; bounded
at ``_MAX_NAME_TO_TEXT`` = 512 to allow longer style runs while still
failing closed), then the object's single text. Each text run therefore
pairs with the nearest preceding *unconsumed* header; a text with no such
header defaults to ``annotations`` (the same degrade ``.opj``'s
``_build_layer`` uses for text before its first resolvable header) — so a
regex-missed header can only ever yield a missing/annotation-demoted title,
never a WRONG one. Routing reuses ``figures.py``'s ``_object_bucket`` table
verbatim, and the title/legend/annotation cleanup runs through the exact
same pipeline (``_first_title``/``_parse_legend_labels``/
``_clean_annotations`` + ``clean_richtext``) so both containers' outputs
match character-for-character.

Undecoded/known negatives: an object holding MORE than one framed text run
would send its second run to ``annotations`` (never observed in the
corpus); a text longer than 255 bytes presumably uses a wider length
encoding never observed — such a run fails the NUL check and is dropped,
not truncated.

Pure library: bytes in → strings out. No fastapi/pydantic/routes imports.
"""

from __future__ import annotations

import re
from typing import Any, NamedTuple

from quantized.io.origin_project.annotation_marks import (
    _AUTO_TITLE,
    _clean_annotations,
    build_mark,
    frac_to_data,
    opju_text_fractions,
)
from quantized.io.origin_project.figure_text import (
    _first_title,
    _object_bucket,
    _parse_legend_labels,
    _parse_legend_title,
)
from quantized.io.origin_project.origin_richtext import clean_richtext

__all__ = ["FigureText", "routed_figure_text"]

# Object-name header: <tag> <plen 01|04> <payload[0]=0x10 ...> (module docstring).
_HDR_RE = re.compile(rb"[\x80-\x9f]([\x01\x04])\x10", re.DOTALL)
_NAME_TAGS = (0x80, 0x83)
_NAME_RE = re.compile(rb"[A-Za-z_][A-Za-z0-9_]{1,23}\Z")  # >= 2 chars (docstring)

# Text content field: <tag> 01 80 <tlen> <text ... 00> (module docstring).
_TEXT_RE = re.compile(rb"[\x80-\xbf]\x01\x80", re.DOTALL)

# Upper bound on the style/format run between an object's name header and its
# own text (measured max 66 bytes corpus-wide; generous margin, still local).
_MAX_NAME_TO_TEXT = 512


class FigureText(NamedTuple):
    """One graph layer's routed text, shaped exactly like the ``.opj`` fields."""

    x_title: str
    y_title: str
    y2_title: str
    legend_labels: list[str]
    # Legend TITLE — the Legend object's own non-swatch header line(s), ""
    # when none (see figure_text._parse_legend_title). Never a nearby floating
    # Text object, which stays an annotation_marks entry.
    legend_title: str
    annotations: list[str]
    # Positioned floating text ({"text", "x", "y"} in data coords, one per
    # Text object, multi-line preserved) — see annotation_marks.py. Empty
    # when the caller supplied no axis range or no position field decoded.
    annotation_marks: list[dict[str, Any]]
    # The Legend object's box top-left in data coords ({"x", "y"}) — the
    # SAME position field every text object carries (§13.2 #3, 2026-07-06),
    # read from the Legend name header. None when no legend, no axes, or
    # the position field didn't decode (omitted, never guessed).
    legend_pos: dict[str, float] | None


def _object_headers(b: bytes, start: int, end: int) -> list[tuple[int, str]]:
    """Every object-name header in ``b[start:end)`` as ``(position, name)``."""
    out: list[tuple[int, str]] = []
    for m in _HDR_RE.finditer(b, start, end):
        plen = m.group(1)[0]
        if plen == 4 and b[m.start() + 3 : m.start() + 5] != b"\x00\x00":
            continue  # axis-title shape's payload is always 10 00 00 <xx>
        p = m.start() + 2 + plen  # the name field, right after the payload
        if p + 2 > end or b[p] not in _NAME_TAGS:
            continue
        nlen = b[p + 1]
        name = b[p + 2 : p + 2 + nlen]
        if len(name) != nlen or not _NAME_RE.match(name):
            continue
        out.append((m.start(), name.decode("ascii")))
    return out


def _text_runs(b: bytes, start: int, end: int) -> list[tuple[int, str]]:
    """Every framed text run in ``b[start:end)`` as ``(position, text)``.

    Validation is what carries the safety here (see module docstring): the
    length byte must fit, the run must be NUL-terminated, decode as strict
    UTF-8, and contain no control characters beyond CR/LF/TAB — anything
    else is dropped, never repaired.
    """
    out: list[tuple[int, str]] = []
    for m in _TEXT_RE.finditer(b, start, end):
        p = m.end()
        if p >= end:
            continue
        tlen = b[p]
        raw = b[p + 1 : p + 1 + tlen]
        if len(raw) != tlen or tlen < 2 or raw[-1] != 0:
            continue
        try:
            body = raw[:-1].decode("utf-8")
        except UnicodeDecodeError:
            continue
        if any(ord(c) < 0x20 and c not in "\r\n\t" for c in body):
            continue
        out.append((m.start(), body))
    return out


def routed_figure_text(
    b: bytes,
    start: int,
    end: int,
    axes: tuple[float, float, float, float] | None = None,
    x_log: bool = False,
    y_log: bool = False,
) -> FigureText | None:
    """Route one figure window's text objects into the ``.opj``-shaped buckets.

    Returns ``None`` when the window holds no framed text run at all (legacy/
    synthetic streams without CPYUA text objects) so the caller can degrade
    to its historical flat-scrape ``annotations``. Otherwise: each text run
    pairs with the nearest preceding unconsumed name header within
    ``_MAX_NAME_TO_TEXT`` bytes and routes via ``figures._object_bucket``
    (``YL``→``y_title``, ``XB``→``x_title``, ``YR``→``y2_title``,
    ``Legend``→legend, ``Text*``/``Line*``→annotations, anything else →
    dropped); an unpaired text defaults to ``annotations``. Multi-line runs
    (CPYUA stores a whole legend/textbox as ONE ``\\r\\n``-joined string,
    where ``.opj``'s byte scan naturally splits at the control bytes) are
    split into lines first, so both containers feed identical strings into
    the shared cleanup pipeline.

    ``axes`` is the layer's ``(x_from, x_to, y_from, y_to)``; when given,
    every annotation-bucket text whose own name header carries the
    fixed-distance position field (``annotation_marks.opju_text_fractions``)
    also emits a positioned ``annotation_marks`` entry — the whole
    multi-line object as ONE mark. Objects without the field (or an
    unpaired text, which has no header to read from) stay text-only.
    """
    texts = _text_runs(b, start, end)
    if not texts:
        return None
    headers = _object_headers(b, start, end)
    buckets: dict[str, list[str]] = {
        "x_title": [],
        "y_title": [],
        "y2_title": [],
        "legend": [],
        "annotations": [],
    }
    marks: list[dict[str, Any]] = []
    legend_pos: dict[str, float] | None = None
    events = sorted(
        [(pos, 0, name) for pos, name in headers] + [(pos, 1, text) for pos, text in texts]
    )
    pending: tuple[int, str] | None = None
    for pos, kind, value in events:
        if kind == 0:  # a name header: becomes the pending object (one text each)
            pending = (pos, value)
            continue
        header_pos: int | None = None
        if pending is not None and pos - pending[0] <= _MAX_NAME_TO_TEXT:
            bucket = _object_bucket(pending[1])
            header_pos = pending[0]
        else:
            bucket = "annotations"  # unpaired text: same default bucket .opj uses
        pending = None
        if bucket not in buckets:
            continue
        lines = [line for line in re.split(r"\r\n|[\r\n]", value) if line.strip()]
        buckets[bucket].extend(lines)
        if bucket == "annotations" and header_pos is not None and axes is not None:
            mark = build_mark(
                opju_text_fractions(b, header_pos), lines, *axes, x_log, y_log
            )
            if mark is not None:
                marks.append(mark)
        if bucket == "legend" and header_pos is not None and axes is not None:
            fracs = opju_text_fractions(b, header_pos)
            if fracs is not None and legend_pos is None:
                lx, ly = frac_to_data(fracs[0], fracs[1], *axes, x_log, y_log)
                legend_pos = {"x": lx, "y": ly}

    def _title(lines: list[str]) -> str:
        # .opj's _texts_in drops the %(?X)/%(?Y) auto-templates via its letter
        # filter; the framed extraction sees them verbatim, so filter here.
        return _first_title([t for t in lines if not _AUTO_TITLE.match(t)])

    notes = [t for t in buckets["annotations"] if not _AUTO_TITLE.match(t) and "\\l(" not in t]
    return FigureText(
        x_title=_title(buckets["x_title"]),
        y_title=_title(buckets["y_title"]),
        y2_title=_title(buckets["y2_title"]),
        legend_labels=_parse_legend_labels(buckets["legend"]),
        legend_title=_parse_legend_title(buckets["legend"]),
        annotations=[clean_richtext(a) for a in _clean_annotations(notes)[:12]],
        annotation_marks=marks,
        legend_pos=legend_pos,
    )
