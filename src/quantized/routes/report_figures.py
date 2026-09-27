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
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import ValidationError

from quantized.io.report_figures import OFFICE_DPI, FigureKey, RenderedFigure
from quantized.routes.export_figures import FigureRequest, render_figure_request

__all__ = ["render_report_figures", "render_spec"]

_VECTOR_FMTS = ("svg", "pdf")


def _spec_error(exc: ValidationError) -> str:
    parts = []
    for err in exc.errors()[:3]:
        loc = ".".join(str(p) for p in err["loc"]) or "spec"
        parts.append(f"{loc}: {err['msg']}")
    more = len(exc.errors()) - len(parts)
    return "invalid figure spec -- " + "; ".join(parts) + (f" (+{more} more)" if more else "")


def _try_render(req: FigureRequest, fmt: str, dpi: int) -> tuple[bytes | None, str | None]:
    try:
        return render_figure_request(req, fmt=fmt, dpi=dpi), None
    # Broad on purpose: the /figure route maps CALC_ERRORS_WITH_LOCK to
    # 422/503, but here ANY failure of one figure (bad channel pick, a stuck
    # render lock, a renderer bug) must degrade to that figure's placeholder,
    # never sink the whole report export.
    except Exception as exc:
        return None, f"{type(exc).__name__}: {exc}"


def render_spec(spec: Mapping[str, Any], target: Literal["office", "html"]) -> RenderedFigure:
    """Render one figure spec for ``target`` (see the module doc)."""
    try:
        req = FigureRequest.model_validate(dict(spec))
    except ValidationError as exc:
        return RenderedFigure(error=_spec_error(exc))
    vector = req.fmt in _VECTOR_FMTS
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
                          svg_error=svg_err)


def render_report_figures(
    report: Mapping[str, Any], target: Literal["office", "html"] | None
) -> dict[FigureKey, RenderedFigure]:
    """Render every figure block's ``spec`` in ``report`` for ``target``,
    keyed ``(section index, block index)``; empty for ``None`` (LaTeX) or a
    report without specs -- so a report with no figures renders no figure."""
    out: dict[FigureKey, RenderedFigure] = {}
    if target is None:
        return out
    for si, sec in enumerate(report.get("sections", [])):
        for bi, block in enumerate(sec.get("blocks", [])):
            spec = block.get("spec")
            if block.get("type") == "figure" and isinstance(spec, Mapping):
                out[(si, bi)] = render_spec(spec, target)
    return out
