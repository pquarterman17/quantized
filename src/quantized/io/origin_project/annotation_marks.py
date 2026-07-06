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

__all__ = ["build_mark", "frac_to_data", "opj_text_fractions", "opju_text_fractions"]

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

# .opj: fraction doubles inside the 133-byte object header payload.
_OPJ_FRACA_OFFSET = 19
_OPJ_FRACB_OFFSET = 27

# .opju: the position field's tag pair and its fixed distance before the
# object-name header (see module docstring). The `80 00` right after frac_b
# is the next field's boundary — constant across every corpus instance, kept
# as a cheap structural check against false tag matches.
_OPJU_POS_TAG = b"\x85\x13"
_OPJU_POS_LOOKBACK = 32
_OPJU_POS_SENTINEL = b"\x80\x00"

# Corpus-wide the fractions stay within ~[-0.2, 4] (text can sit outside the
# layer frame); a misread double is astronomically large or non-finite.
_FRAC_BOUND = 50.0


def _plausible(v: float) -> bool:
    return math.isfinite(v) and abs(v) <= _FRAC_BOUND


def frac_to_data(
    frac_a: float,
    frac_b: float,
    x_from: float,
    x_to: float,
    y_from: float,
    y_to: float,
) -> tuple[float, float]:
    """The confirmed fraction→data model (module docstring): the box top-left
    corner in data coordinates. ``frac_b`` measures down from the axis TOP."""
    return (x_from + frac_a * (x_to - x_from), y_to - frac_b * (y_to - y_from))


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
    q = header_pos - _OPJU_POS_LOOKBACK
    if q < 0 or b[q : q + 2] != _OPJU_POS_TAG:
        return None
    if b[q + 18 : q + 20] != _OPJU_POS_SENTINEL:
        return None
    frac_a = float(struct.unpack_from("<d", b, q + 2)[0])
    frac_b = float(struct.unpack_from("<d", b, q + 10)[0])
    if not (_plausible(frac_a) and _plausible(frac_b)):
        return None
    return frac_a, frac_b


def build_mark(
    fracs: tuple[float, float] | None,
    lines: list[str],
    x_from: float,
    x_to: float,
    y_from: float,
    y_to: float,
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
    x, y = frac_to_data(fracs[0], fracs[1], x_from, x_to, y_from, y_to)
    return {"text": text, "x": x, "y": y}
