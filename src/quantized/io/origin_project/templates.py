"""Origin graph templates (``.otp``/``.otpu``) -> a quantized ``GraphTemplate``
(gap-ecosystem plan item 5, decode-plan #21). GRAPH templates only (owner
decision): a graph template's saved style (axis limits, legend, per-curve
color/line-vs-scatter/width/marker) maps onto the frontend's ``GraphTemplate``
shape (``frontend/src/lib/figuredoc.ts`` -- ``name``/``style``/``overrides``/
``seriesStyles``); workbook/analysis templates have no quantized counterpart
and are out of scope.

**Recon (2026-07-07).** Both template extensions are the SAME CPY container
family already documented in ``docs/origin_project_format.md`` sec 2 -- an
``.otp`` opens with the ``CPYA`` magic (verified: the corpus's
``SLD_DoubleY.otp`` is ``CPYA 4.3227``, an older sub-version of the same
family already handled), an ``.otpu`` with ``CPYUA`` (verified: all four
corpus ``.otpu`` files are ``CPYUA 4.3380``). Critically, the EXISTING figure
decoders already understand a template's bytes directly -- ``figures.
extract_figures``/``figures_opju.extract_figures_opju`` take raw file bytes,
not a parsed workbook, and a template's graph window(s) are laid out exactly
like a project's: axis ranges, log flags, titles, legend text/labels, frame
and page geometry all decoded verbatim, zero new code, against 4 of the 5
corpus templates (``SLD_DoubleY.otp``, ``PNR-SF.otpu``, ``SLDdouble.otpu``,
``UnpolFresnelNR.otpu``). The 5th, ``PNR.otpu``, carries exactly one axis
anchor (``03 00 00 1f``) whose record matches NONE of the three existing
``.opju`` axis-record forms (specimen / real / hybrid -- all return ``None``
at that offset): a genuinely new, undocumented 4th record shape. Per the
"conservative first decoder" scope, this is left undecoded and documented,
not chased -- ``read_origin_template`` degrades that one file to a
styles-only partial (see below) rather than guessing an axis record or
failing the whole file, since its curve-style tokens decode fine
independently.

**What does NOT decode via the existing path: curve style.** A template
carries no workbook columns, so ``opj_curves.extract_curves``/
``opju_figure_curves.extract_curves_by_id`` -- which bind a curve to
``(book, x, y)`` via a global column-id lookup built by scanning the
project's OWN column-storage blocks -- always come up with an empty id map
for a template file (there is no workbook to scan), so every curve is
silently dropped even though its raw style record is present on disk and
fully decodable. Confirmed by direct byte-level recon: every corpus template
carries real ``curve_style_color.style_fields``-decodable records (explicit
RGB colors, line/scatter, line width, symbol size) with NO book/column
resolution required -- the style lives entirely inside the curve's own
anchor record (``.otp``) / sparse id token (``.otpu``), the same record
``curve_style_color.py`` already decodes for real projects. This module reuses
ONLY the style half of those two decoders (:func:`_template_curve_styles_opj`
/ :func:`_template_curve_styles_opju`), never their book/column binding --
templates have no dataset to bind to, so book/x/y stay permanently absent by
design, not by gap.

**Mapping to ``GraphTemplate`` (honestly partial).** ``name`` is the file
stem; ``style`` stays the fixed string ``"default"`` (Origin templates carry
no quantized preset concept to recover). ``overrides`` comes from the
template's FIRST decoded graph layer only -- ``x_lim``/``y_lim`` (axis
range) and ``legend`` (``show`` + a nearest-quadrant ``loc``, mirroring
``frontend/src/lib/originFigures.ts``'s ``originLegendPos``); a template with
>1 layer (e.g. a double-Y style like ``SLD_DoubleY.otp``/``SLDdouble.otpu``)
has no way to carry its 2nd layer's own Y range in this shape (``GraphTemplate``
itself has no multi-layer/y2 concept -- see ``figuredoc.ts``), so that layer's
style is simply not represented; this is a target-SHAPE limitation, not a
decode failure. ``seriesStyles`` is built from EVERY decoded curve style
record found in the file, in on-disk order, mirroring
``originCurveSeriesStyle``'s color/line-vs-scatter/width/marker rule but
targeting the export-style shape (``frontend/src/lib/exportStyles.ts``'s
``ExportSeriesStyle`` -- ``color``/``width``/``line``/``marker``/
``marker_size``); since ``GraphTemplate.seriesStyles`` is ALREADY one flat
list with no per-layer grouping, collapsing a multi-layer template's curves
into one file-wide list matches the target shape's own limitation rather
than adding a new one. Undecodable per-curve properties (Origin's symbol
*shape* -- square/circle/triangle/... -- has no field in ``ExportSeriesStyle``,
only a boolean "draw a marker") and undecodable per-layer properties (grid
on/off, tick direction, font: no isolated on-disk field is known for any of
these -- see ``docs/origin_project_format.md`` sec 6.3's permanent-gaps list)
stay absent from the returned dict, never guessed.

Non-graph templates (a workbook/analysis template, or any file whose graph
layer(s) fail to decode at all) raise :class:`OriginProjectError` with what
was found, per the "an honest partial beats a guessed decoder" rule --
:func:`read_origin_template` never fabricates a template from nothing.
"""

from __future__ import annotations

import math
import re
import struct
from pathlib import Path
from typing import Any

from quantized.io.origin_project.container import OriginProjectError, walk_blocks
from quantized.io.origin_project.curve_style_color import (
    apply_increment_colors,
    opju_style_record,
    style_fields,
)
from quantized.io.origin_project.figures import extract_figures
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opj_curves import _CURVE_PREFIX, _DATAPLOT_MAGIC
from quantized.io.origin_project.opju_codec import curve_plot_style
from quantized.io.origin_project.opju_figure_curves import _CURVE_TOKEN

__all__ = ["read_origin_template"]

_HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
_StyleFields = dict[str, str | float]


def _template_curve_styles_opj(b: bytes) -> list[_StyleFields]:
    """Every decodable curve-anchor style record in a CPYA template, file-wide,
    in on-disk order -- the style half of ``opj_curves.extract_curves`` (item
    11's ``01 00 00 00 <id>`` anchor immediately followed by the DataPlot
    magic), deliberately WITHOUT its ``id_map``/``x_columns`` book/column
    binding (a template has no workbook to build either from -- see module
    docstring)."""
    blocks = [(size, payload) for size, payload in walk_blocks(b) if size]
    out: list[_StyleFields] = []
    records: list[bytes | None] = []
    for j in range(len(blocks) - 1):
        _, payload = blocks[j]
        if len(payload) < 6 or payload[:4] != _CURVE_PREFIX:
            continue
        _, next_payload = blocks[j + 1]
        if next_payload[:8] != _DATAPLOT_MAGIC:
            continue
        out.append(style_fields(payload))
        records.append(payload)
    apply_increment_colors(out, records)
    return out


def _template_curve_styles_opju(b: bytes) -> list[_StyleFields]:
    """Same, for CPYUA templates: every unified id-token's sparse style record
    (``opju_figure_curves``'s ``_CURVE_TOKEN``), reconstructed via
    ``curve_style_color.opju_style_record`` and read with ``style_fields`` --
    independent of ``opju_figure_curves.column_id_table`` (empty for a
    template: no workbook column ever assigns the token's id)."""
    out: list[_StyleFields] = []
    records: list[bytes | None] = []
    for m in _CURVE_TOKEN.finditer(b):
        record = opju_style_record(b, m.start() + 3)
        curve: _StyleFields = dict(style_fields(record)) if record is not None else {}
        style = curve_plot_style(b, m.start())
        if style:
            curve["style"] = style
        out.append(curve)
        records.append(record)
    apply_increment_colors(out, records)
    return out


def _series_style(fields: _StyleFields) -> dict[str, Any] | None:
    """One decoded curve's style fields -> an ``ExportSeriesStyle``-shaped
    dict (``frontend/src/lib/exportStyles.ts``), mirroring
    ``frontend/src/lib/originFigures.ts``'s ``originCurveSeriesStyle`` (the
    already-shipped rule for applying a decoded Origin curve's style to a
    plot) but targeting the *export* style shape a saved template carries:
    "scatter" -> markers, no connecting line (``width: 0``); "line" -> a
    solid line at the default 1.5pt width; "line_symbol" -> both; a decoded
    ``lineWidth`` overrides that default (never on a scatter curve -- Origin stores a latent line
    width even on symbol-only plots); a decoded ``symbolSize`` sets
    ``marker_size`` only once a marker is already on. No ``markerShape`` key
    exists in ``ExportSeriesStyle``, so a decoded ``symbol`` only turns
    ``marker`` on -- its glyph (square/circle/triangle/...) is not
    representable in this target shape (documented gap, not a decode miss).
    Returns ``None`` when nothing decoded, so the caller's list holds an
    honest ``null`` slot rather than an empty object."""
    out: dict[str, Any] = {}
    style = fields.get("style")
    if style == "scatter":
        out["marker"] = True
        out["width"] = 0
    elif style in ("line", "line_symbol"):
        out["width"] = 1.5
        if style == "line_symbol":
            out["marker"] = True
    connect = fields.get("connect")
    if connect in ("straight", "segment2") and style != "scatter":
        out["connect"] = connect
    color = fields.get("color")
    if isinstance(color, str) and _HEX_RE.match(color):
        out["color"] = color
    if fields.get("symbol"):
        out["marker"] = True
    width = fields.get("lineWidth")
    if isinstance(width, int | float) and width > 0 and style != "scatter":
        out["width"] = width
    size = fields.get("symbolSize")
    if isinstance(size, int | float) and size > 0 and out.get("marker"):
        out["marker_size"] = size
    return out or None


def _finite_range(lo: Any, hi: Any) -> bool:
    return (
        isinstance(lo, int | float)
        and isinstance(hi, int | float)
        and math.isfinite(lo)
        and math.isfinite(hi)
        and lo != hi
    )


def _axis_fraction(v: float, lo: float, hi: float, log: bool) -> float | None:
    """Fraction of ``v`` along ``[lo, hi]``, log10-aware on a log axis --
    mirrors ``frontend/src/lib/originFigures.ts``'s ``axisFraction`` (the
    same model the backend used to decode the legend box position in the
    first place, see ``annotation_marks.py``)."""
    if log and lo > 0 and hi > 0 and v > 0:
        a, b = math.log10(lo), math.log10(hi)
        return (math.log10(v) - a) / (b - a) if b != a else None
    return (v - lo) / (hi - lo) if hi != lo else None


def _template_legend(fig: dict[str, Any]) -> dict[str, Any] | None:
    """``{"show": True, "loc": "<vert> <side>"}`` when the layer carries any
    non-empty legend text or a decoded legend-box position, else ``None``.
    ``loc`` maps the decoded position (data coords) to the nearest quadrant
    -- the same corner logic as ``originFigures.ts``'s ``originLegendPos``,
    landing on one of ``frontend/src/lib/figureOverrides.ts``'s
    ``LEGEND_LOCS`` strings (``"upper right"``/``"upper left"``/
    ``"lower left"``/``"lower right"``) rather than a guessed pixel anchor."""
    labels = [t for t in (fig.get("legend_labels") or []) if t]
    pos = fig.get("legend_pos")
    if not labels and pos is None:
        return None
    out: dict[str, Any] = {"show": True}
    if pos is not None:
        fx = _axis_fraction(pos["x"], fig["x_from"], fig["x_to"], fig["x_log"])
        fy = _axis_fraction(pos["y"], fig["y_from"], fig["y_to"], fig["y_log"])
        if fx is not None and fy is not None and math.isfinite(fx) and math.isfinite(fy):
            vert = "upper" if fy >= 0.5 else "lower"
            side = "right" if fx >= 0.5 else "left"
            out["loc"] = f"{vert} {side}"
    return out


def _template_overrides(fig: dict[str, Any]) -> dict[str, Any] | None:
    """``FigureOverrides``-shaped dict (``frontend/src/lib/figureOverrides.ts``)
    from one figure-layer dict: ``x_lim``/``y_lim`` (only when both bounds are
    finite and distinct) and ``legend``. Every other ``FigureOverrides`` key
    (``grid``, ``ticks``, ``spines``, ``margins``, ``font_size``/``font_name``,
    ``annotations``) has no isolated on-disk field this codebase decodes (see
    ``docs/origin_project_format.md`` sec 6.3's permanent-gaps list) and stays
    absent -- never defaulted."""
    out: dict[str, Any] = {}
    if _finite_range(fig.get("x_from"), fig.get("x_to")):
        out["x_lim"] = [fig["x_from"], fig["x_to"]]
    if _finite_range(fig.get("y_from"), fig.get("y_to")):
        out["y_lim"] = [fig["y_from"], fig["y_to"]]
    legend = _template_legend(fig)
    if legend:
        out["legend"] = legend
    return out or None


_DECODE_ERRORS = (IndexError, ValueError, KeyError, struct.error)


def read_origin_template(path: Path) -> dict[str, Any]:
    """Decode an Origin GRAPH template (``.otp``/``.otpu``) into a
    ``GraphTemplate``-shaped dict (``frontend/src/lib/figuredoc.ts``):
    ``name`` (the file stem), ``style`` (always ``"default"``), ``overrides``
    (axis limits + legend from the first decoded layer, or ``None``), and
    ``seriesStyles`` (one entry per decoded curve, file-wide, in on-disk
    order, or ``None`` when no curve style decoded). See the module docstring
    for the full recon + mapping rationale.

    Raises :class:`OriginProjectError` (mapped to a 422 by the import route)
    when ``path`` isn't a recognized template container, or when its magic
    header doesn't match the extension's expected CPY family, or when NO
    graph layer decodes at all (e.g. a workbook/analysis template -- out of
    scope for this graph-style mapping) -- an honest failure, never a
    fabricated template.
    """
    suffix = path.suffix.lower()
    if suffix not in (".otp", ".otpu"):
        raise OriginProjectError(
            f"'{path.name}' is not an Origin graph template (expected .otp or .otpu)."
        )
    b = path.read_bytes()
    # Magic-header checks stay OUTSIDE the decode try/except below: they raise
    # OriginProjectError directly, which is itself a ValueError -- inside the
    # try it would be caught by `_DECODE_ERRORS` and double-wrapped.
    if suffix == ".otp":
        if not b.startswith(b"CPYA"):
            raise OriginProjectError(
                f"'{path.name}' does not look like a CPYA .otp template (bad header)."
            )
    elif not b.startswith(b"CPYUA"):
        raise OriginProjectError(
            f"'{path.name}' does not look like a CPYUA .otpu template (bad header)."
        )
    try:
        if suffix == ".otp":
            figures = extract_figures(b)
            curve_styles = _template_curve_styles_opj(b)
        else:
            figures = extract_figures_opju(b)
            curve_styles = _template_curve_styles_opju(b)
    except _DECODE_ERRORS as exc:
        raise OriginProjectError(
            f"'{path.name}' could not be decoded as an Origin graph template: {exc}"
        ) from exc
    if not figures and not curve_styles:
        raise OriginProjectError(
            f"no graph layer or curve style could be decoded from '{path.name}' -- it "
            "may be a workbook/analysis template (out of scope for graph-style import) "
            "or an unrecognized template form."
        )
    # A layer can fail to decode (an axis-record shape this codebase doesn't
    # recognize yet -- see module docstring's PNR.otpu note) while curve style
    # STILL decodes (it lives in an independent record); overrides then stays
    # None rather than the whole template failing -- an honest partial, not a
    # guess (per-curve style is real either way; only axis/legend is missing).
    series_styles = [_series_style(f) for f in curve_styles] or None
    return {
        "name": path.stem,
        "style": "default",
        "overrides": _template_overrides(figures[0]) if figures else None,
        "seriesStyles": series_styles,
    }
