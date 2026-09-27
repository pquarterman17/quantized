"""Render a report's figure-block specs through the app's own figure exporter.

PRIMARY_SOFTWARE_AUDIT_PLAN P3.6. A report figure block may carry ``spec`` --
the exact body of ``POST /api/export/figure`` (a ``FigureRequest``). The report
export route calls :func:`render_report_figures` before handing the report to
the pure ``io.report_export`` renderers, so the figure embedded in a Word /
PowerPoint / HTML report is produced by ``routes.export_figures.
render_figure_request`` -- the one body ``/api/export/figure`` itself runs
(interactive/export agreement: a report figure can never drift from the
figure export for the same spec).

What is rendered, per target (``io.report_export.figure_target``):

* ``office`` (.docx/.pptx): always a 300-DPI PNG (``OFFICE_DPI``, what the
  document displays everywhere); plus an SVG when the spec asks for a vector
  (``fmt`` ``svg``/``pdf``), embedded beside the PNG by ``io.report_office``.
* ``html``: the SVG for a vector spec (inlined), else the 300-DPI PNG; a
  failed SVG falls back to the PNG and says so.
* LaTeX: nothing -- a single .tex references its figures' exported files.

A spec that fails validation or rendering NEVER fails the export: it becomes
a :class:`RenderedFigure` carrying the specific reason, which the renderer
prints as a named placeholder and the route reports as a warning.

Resource limits (PRIMARY_SOFTWARE_AUDIT_PLAN P3.6 review, finding 5): a report
is arbitrary caller input, so this module caps the work ONE export can demand
before any of it runs --

* at most :data:`MAX_FIGURES_PER_REPORT` figures are actually rendered; every
  one past that becomes a placeholder saying so (never a 500/timeout).
* ``width_in``/``height_in`` are clamped to ``io.report_figures.
  FIGURE_WIDTH_IN_RANGE`` before either render is attempted.
* the raster's pixel count at the clamped size and :data:`~quantized.io.
  report_figures.OFFICE_DPI` is rejected outright (no render attempted, for
  EITHER the PNG or the SVG half of one spec) above
  :data:`MAX_FIGURE_PIXELS`.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import ValidationError

from quantized.io.report_figures import FIGURE_WIDTH_IN_RANGE, OFFICE_DPI, FigureKey, RenderedFigure
from quantized.routes._errors import CALC_ERRORS_WITH_LOCK
from quantized.routes.export_figures import FigureRequest, render_figure_request

__all__ = ["MAX_FIGURE_PIXELS", "MAX_FIGURES_PER_REPORT", "render_report_figures", "render_spec"]

_VECTOR_FMTS = ("svg", "pdf")

#: Hard cap on figures actually rendered per report export -- a report is
#: caller-controlled input, and rendering is real matplotlib CPU/memory work
#: per figure (P3.6-R5).
MAX_FIGURES_PER_REPORT = 50

#: Hard cap on one figure's raster pixel count (width_px * height_px at
#: OFFICE_DPI) -- rejected before either render is attempted, not after
#: allocating it (P3.6-R5). 40 Mpx is comfortably above the largest sane
#: print figure (FIGURE_WIDTH_IN_RANGE's own 20x20 in cap is 36 Mpx at 300
#: DPI) while still bounding a hostile/absurd request.
MAX_FIGURE_PIXELS = 40_000_000


def _spec_error(exc: ValidationError) -> str:
    parts = []
    for err in exc.errors()[:3]:
        loc = ".".join(str(p) for p in err["loc"]) or "spec"
        parts.append(f"{loc}: {err['msg']}")
    more = len(exc.errors()) - len(parts)
    return "invalid figure spec -- " + "; ".join(parts) + (f" (+{more} more)" if more else "")


def _clamped_size(req: FigureRequest) -> FigureRequest:
    """``req`` with ``width_in``/``height_in`` clamped to
    :data:`FIGURE_WIDTH_IN_RANGE` (P3.6-R5/R8) -- unchanged if both are
    already ``None`` or already in range."""
    lo, hi = FIGURE_WIDTH_IN_RANGE
    update: dict[str, float] = {}
    if req.width_in is not None:
        clamped = max(lo, min(hi, req.width_in))
        if clamped != req.width_in:
            update["width_in"] = clamped
    if req.height_in is not None:
        clamped = max(lo, min(hi, req.height_in))
        if clamped != req.height_in:
            update["height_in"] = clamped
    return req.model_copy(update=update) if update else req


def _pixel_budget_reason(req: FigureRequest) -> str | None:
    """``None`` if ``req``'s AS-REQUESTED size renders within
    :data:`MAX_FIGURE_PIXELS` at :data:`OFFICE_DPI`, else the reason it was
    rejected outright -- checked on the raw request, BEFORE ``_clamped_size``
    and before either render is attempted (P3.6-R5). Checking the raw value
    matters: an absurd request (e.g. 1000x1000in) must be REJECTED with a
    clear reason, not silently reinterpreted as the clamp's 20x20in (which
    would itself always be within budget -- 36 Mpx at 300 DPI -- making this
    check unreachable dead code if it ran after the clamp)."""
    if req.width_in is None or req.height_in is None:
        return None  # a preset's own size -- always within the sane range
    px = req.width_in * OFFICE_DPI * req.height_in * OFFICE_DPI
    if px > MAX_FIGURE_PIXELS:
        return (f"the requested figure size ({req.width_in:.2f}x{req.height_in:.2f}in at "
                f"{OFFICE_DPI} DPI) exceeds the {MAX_FIGURE_PIXELS // 1_000_000} "
                "Mpx render budget")
    return None


def _try_render(req: FigureRequest, fmt: str, dpi: int) -> tuple[bytes | None, str | None]:
    try:
        return render_figure_request(req, fmt=fmt, dpi=dpi), None
    # CALC_ERRORS_WITH_LOCK, not bare Exception (P3.6-R10 review): the /figure
    # route maps this SAME tuple to 422/503 for a bad-but-well-typed spec (bad
    # channel pick, a malformed dataset, a stuck render lock) -- that is
    # exactly the "degrade to this figure's placeholder" case here too. An
    # exception OUTSIDE that tuple is a programming bug in our own code, not
    # a bad report, and must propagate (and fail a test) rather than vanish
    # into a silent placeholder.
    except CALC_ERRORS_WITH_LOCK as exc:
        return None, f"{type(exc).__name__}: {exc}"


def render_spec(spec: Mapping[str, Any], target: Literal["office", "html"]) -> RenderedFigure:
    """Render one figure spec for ``target`` (see the module doc)."""
    try:
        req = FigureRequest.model_validate(dict(spec))
    except ValidationError as exc:
        return RenderedFigure(error=_spec_error(exc))
    vector = req.fmt in _VECTOR_FMTS
    budget_reason = _pixel_budget_reason(req)
    if budget_reason is not None:
        return RenderedFigure(vector_requested=vector, error=budget_reason)
    req = _clamped_size(req)
    svg: bytes | None = None
    svg_err: str | None = None
    if vector:
        svg, svg_err = _try_render(req, "svg", req.dpi)  # dpi is inert for SVG
    png: bytes | None = None
    png_err: str | None = None
    if target == "office" or svg is None:
        png, png_err = _try_render(req, "png", OFFICE_DPI)
    if png is None and svg is None:
        return RenderedFigure(vector_requested=vector,
                              error=f"render failed ({png_err or svg_err})")
    return RenderedFigure(png=png, svg=svg, dpi=OFFICE_DPI, vector_requested=vector,
                          svg_error=svg_err, png_error=png_err)


def render_report_figures(
    report: Mapping[str, Any], target: Literal["office", "html"] | None
) -> dict[FigureKey, RenderedFigure]:
    """Render every figure block's ``spec`` in ``report`` for ``target``,
    keyed ``(section index, block index)``; empty for ``None`` (LaTeX) or a
    report without specs -- so a report with no figures renders no figure.

    Stops actually rendering after :data:`MAX_FIGURES_PER_REPORT` (P3.6-R5):
    every figure past the cap becomes a placeholder saying so, exactly like
    any other render failure -- never a 500/timeout from a report that simply
    asks for too many.
    """
    out: dict[FigureKey, RenderedFigure] = {}
    if target is None:
        return out
    rendered = 0
    for si, sec in enumerate(report.get("sections", [])):
        for bi, block in enumerate(sec.get("blocks", [])):
            spec = block.get("spec")
            if block.get("type") != "figure" or not isinstance(spec, Mapping):
                continue
            if rendered >= MAX_FIGURES_PER_REPORT:
                out[(si, bi)] = RenderedFigure(
                    error=f"the report exceeds the {MAX_FIGURES_PER_REPORT}-figure "
                    "render budget per export"
                )
                continue
            rendered += 1
            out[(si, bi)] = render_spec(spec, target)
    return out
