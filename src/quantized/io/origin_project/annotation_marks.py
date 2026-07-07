"""Positioned free-text annotation marks for Origin figures (both containers).

Origin graphs carry floating text objects ("Field applied in-plane\\r\\nT =
1.3 K") whose text the figure decoders already recover into the flat
``annotations: list[str]`` field. This module adds the POSITION: each text
object stores its box's **top-left corner** as two little-endian float64
layer-fractions ``(frac_a, frac_b)``, converted to data coordinates with the
layer's own axis range::

    x1 = x_from + frac_a * (x_to - x_from)
    y1 = y_to   - frac_b * (y_to - y_from)      # y measured from the TOP

Validated against a live-COM oracle (``ground_truth/<stem>/annotations.json``,
the box corner Origin itself reports as ``x1``/``y1``): all 5 captured
instances (hc2convert.opj Graph1/2/3, Hc2 data.opju Graph1/2) reproduce to
~1e-9. The oracle graphs are all linear-scale; how Origin maps the fraction
on a LOG axis is unverified — the linear formula above is applied regardless
(it is the confirmed model; no log-axis oracle instance exists yet).

**Where the fractions live**

* ``.opj``: the text object's 133-byte header block (ASCII name at payload
  offset 70, see ``figures.py``) holds ``frac_a`` at payload offset **19**
  and ``frac_b`` at **27** — two consecutive LE doubles. Confirmed exact on
  every oracle instance and plausibility-scanned across ~2000 ``Text*``/
  ``Line*`` headers corpus-wide (all decode to sane layer fractions).
* ``.opju`` (CPYUA): a tagged field ``85 13 <frac_a:8> <frac_b:8> 80 00 …``
  ending exactly **32 bytes before** the object-name header that
  ``opju_figure_text._object_headers`` locates (i.e. tag at ``h-32``,
  ``frac_a`` at ``h-30``, ``frac_b`` at ``h-22``, and the constant ``80 00``
  field boundary right after ``frac_b`` at ``h-14``). Confirmed at that
  exact distance for every positioned ``Text*`` header in the 5-file real
  corpus, and exact against both oracle instances.

**Known negatives (omitted, never guessed):** RockingCurve.opju's composite
panel-label Texts use an ``86 13`` tag and UnpolPlots.opju one ``85 1f``
variant — same neighbourhood, different framing, no oracle coverage — so
those objects keep their text in ``annotations`` but ship no position. The
oracle's ``attach`` mode (all captured instances are 0 = layer-scale) is not
decoded; a non-zero attach presumably reinterprets the fractions.

Pure library: bytes in → dicts out. No fastapi/pydantic/routes imports.
"""

from __future__ import annotations

import math
import re
import struct
from typing import Any

from quantized.io.origin_project.origin_richtext import clean_richtext

__all__ = [
    "build_mark",
    "frac_to_data",
    "opj_object_box",
    "opj_text_fractions",
    "opju_text_fractions",
    "page_point_fractions",
]

# ── shared annotation-text cleanup (moved here from figures.py so this module
# stays a leaf both containers' figure decoders can import) ──────────────────

_AUTO_TITLE = re.compile(r"^%\(\?[XY]\)")

# Internal Origin storage/style markers that leak into raw text scans — see
# figures.py's module docstring ("Axis-title / legend-label routing").
_INTERNAL_ANN_RE = re.compile(
    r"SYSTEM|STYLEHOLDER|OriginStorage|AxesDlgSettings|UseSameOptions|SRCINFO", re.IGNORECASE
)
_SHEETREF_ANN_RE = re.compile(r"^Sheet\d+<?$")  # internal sheet source reference, not a title


def _clean_annotations(titles: list[str]) -> list[str]:
    """Drop internal Origin storage/style markers and bare sheet references
    from recovered floating-text lines. Shared by BOTH containers' figure
    decoders (``figures.py`` re-exports it; ``figures_opju.py`` additionally
    truncates at its embedded PNG thumbnail first) and by ``build_mark``
    below, so the flat ``annotations`` list and the positioned marks can
    never disagree on what counts as user text."""
    out: list[str] = []
    for t in titles:
        s = t.strip()
        if not s or _INTERNAL_ANN_RE.search(s) or _SHEETREF_ANN_RE.match(s):
            continue
        out.append(s)
    return out


# ── position decode ──────────────────────────────────────────────────────────

# .opj object BOX: four u16 LE at header payload offsets 3-10 = the object's
# bounding box (x1, y1, x2, y2) in PAGE units, post-rotation (solved
# 2026-07-06 against the 111-instance annotations.json oracle: XRD's rotated
# peak labels store their pre-rotation anchor in the FRACTION pair, so a
# fraction-only model is off by a font-proportional vector — the page box is
# exact for every object kind). Mapped to data coordinates through the layer
# FRAME quad (figures.py, layer-block offsets 113-119, same page units).
_OPJ_BOX_OFFSET = 3

# .opj: fraction doubles inside the 133-byte object header payload — the
# object's pre-rotation ANCHOR. Kept as the fallback when the box/frame quad
# is missing or implausible (older 4.3227 layer blocks); exact for
# horizontal text, offset for rotated labels.
_OPJ_FRACA_OFFSET = 19
_OPJ_FRACB_OFFSET = 27

# .opju: the position field's tag pair and its fixed distance before the
# object-name header (see module docstring). The `80 00` right after frac_b
# is the next field's boundary — constant across every corpus instance, kept
# as a cheap structural check against false tag matches. Three tag flavours
# carry the same <fracA:8><fracB:8> payload, each at its own fixed distance:
# `85 13` at header-32 (Text* objects, the original 2026-07-05 decode),
# `86 13` at header-32 (panel-label Text objects — verified 2026-07-06 when
# the expanded annotations COM oracle finally covered RockingCurve's
# instances under the identical fraction model; previously a known-negative),
# and `85 1f` at header-33 (Legend objects and some panel Texts — resolved
# 2026-07-06 via the legend-position oracle).
_OPJU_POS_TAG_LOOKBACK = {b"\x85\x13": 32, b"\x86\x13": 32, b"\x85\x1f": 33}
_OPJU_POS_SENTINEL = b"\x80\x00"

# Corpus-wide the fractions stay within ~[-0.2, 4] (text can sit outside the
# layer frame); a misread double is astronomically large or non-finite.
_FRAC_BOUND = 50.0


def _plausible(v: float) -> bool:
    return math.isfinite(v) and abs(v) <= _FRAC_BOUND


def _interp(frac: float, lo: float, hi: float, log: bool) -> float:
    """Axis-fraction -> data value, linear or log10-space.

    The log mapping was CONFIRMED 2026-07-06 against the legend-position COM
    oracle on two log-Y graphs (XRD Graph2: linear read 9.73e4 vs oracle
    7.291e4; log10 read 7.291e4 exact — same for Si-YIG-Py): on a log axis
    Origin stores the fraction of the DECADE span. Non-positive bounds can't
    be a real log axis — degrade to linear rather than crash."""
    if log and lo > 0 and hi > 0:
        return float(10 ** (math.log10(lo) + frac * (math.log10(hi) - math.log10(lo))))
    return lo + frac * (hi - lo)


def frac_to_data(
    frac_a: float,
    frac_b: float,
    x_from: float,
    x_to: float,
    y_from: float,
    y_to: float,
    x_log: bool = False,
    y_log: bool = False,
) -> tuple[float, float]:
    """The confirmed fraction→data model (module docstring): the box top-left
    corner in data coordinates. ``frac_b`` measures down from the axis TOP;
    log axes interpolate in log10 space (see ``_interp``)."""
    return (
        _interp(frac_a, x_from, x_to, x_log),
        _interp(frac_b, y_to, y_from, y_log),  # from the TOP: hi -> lo
    )


def opj_object_box(payload: bytes) -> tuple[int, int, int, int] | None:
    """The object's page-unit bounding box ``(x1, y1, x2, y2)`` from a
    ``.opj`` 133-byte object header, or ``None`` when the quad is not a
    plausible box (degenerate/reversed — dropped, never guessed)."""
    if len(payload) < _OPJ_BOX_OFFSET + 8:
        return None
    x1, y1, x2, y2 = struct.unpack_from("<4H", payload, _OPJ_BOX_OFFSET)
    if not (x1 < x2 and y1 < y2 and x2 - x1 < 60_000 and y2 - y1 < 60_000):
        return None
    return int(x1), int(y1), int(x2), int(y2)


def page_point_fractions(
    x: float, y: float, frame: tuple[int, int, int, int]
) -> tuple[float, float] | None:
    """A page-unit point as layer-frame fractions (x from left, y from the
    frame TOP — the same convention :func:`frac_to_data` takes), or ``None``
    on a degenerate frame."""
    fx1, fy1, fx2, fy2 = frame
    if fx2 <= fx1 or fy2 <= fy1:
        return None
    return (x - fx1) / (fx2 - fx1), (y - fy1) / (fy2 - fy1)


def opj_text_fractions(payload: bytes) -> tuple[float, float] | None:
    """``(frac_a, frac_b)`` from a ``.opj`` text object's 133-byte header
    payload, or ``None`` when the doubles are missing/implausible (the text
    then still ships in ``annotations``, just without a position)."""
    if len(payload) < _OPJ_FRACB_OFFSET + 8:
        return None
    frac_a = float(struct.unpack_from("<d", payload, _OPJ_FRACA_OFFSET)[0])
    frac_b = float(struct.unpack_from("<d", payload, _OPJ_FRACB_OFFSET)[0])
    if not (_plausible(frac_a) and _plausible(frac_b)):
        return None
    return frac_a, frac_b


def opju_text_fractions(b: bytes, header_pos: int) -> tuple[float, float] | None:
    """``(frac_a, frac_b)`` for the ``.opju`` text object whose name header
    starts at ``header_pos``, or ``None`` when the fixed-distance ``85 13``
    field isn't there (the known ``86 13``/``85 1f`` variants, or no position
    at all — omitted, never guessed; see the module docstring)."""
    for tag, lookback in _OPJU_POS_TAG_LOOKBACK.items():
        q = header_pos - lookback
        if q < 0 or b[q : q + 2] != tag:
            continue
        if b[q + 18 : q + 20] != _OPJU_POS_SENTINEL:
            continue
        frac_a = float(struct.unpack_from("<d", b, q + 2)[0])
        frac_b = float(struct.unpack_from("<d", b, q + 10)[0])
        if _plausible(frac_a) and _plausible(frac_b):
            return frac_a, frac_b
    return None


def build_mark(
    fracs: tuple[float, float] | None,
    lines: list[str],
    x_from: float,
    x_to: float,
    y_from: float,
    y_to: float,
    x_log: bool = False,
    y_log: bool = False,
) -> dict[str, Any] | None:
    """One positioned annotation mark ``{"text", "x", "y"}`` — or ``None``
    when the position never decoded or no user text survives cleanup.

    ``lines`` are the object's raw recovered text runs, one per line; they go
    through the exact same cleanup pipeline as the flat ``annotations`` field
    (auto-title/legend filtering, internal-noise drop, rich-text decode) and
    re-join with ``"\\n"`` — one mark per text OBJECT, multi-line preserved.
    """
    if fracs is None:
        return None
    kept = [t for t in lines if not _AUTO_TITLE.match(t) and "\\l(" not in t]
    cleaned = [clean_richtext(t) for t in _clean_annotations(kept)]
    text = "\n".join(s for s in cleaned if s.strip())
    if not text:
        return None
    x, y = frac_to_data(fracs[0], fracs[1], x_from, x_to, y_from, y_to, x_log, y_log)
    return {"text": text, "x": x, "y": y}
