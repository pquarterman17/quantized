"""Render a :class:`~quantized.calc.report.ReportSheet` to office / markup files.

ORIGIN_GAP_PLAN #37 (docx/pptx) + #38 (LaTeX) + #39 (HTML). Every renderer
walks the SAME report schema (title -> sections -> typed blocks) with no
per-block special cases beyond the four block kinds — that is the #36
acceptance criterion made real.

LaTeX and HTML are pure-Python and always available. Word (.docx) and
PowerPoint (.pptx) live in ``io.report_office`` and need the MIT libraries
``python-docx`` / ``python-pptx``; those imports are guarded so the module
(and CI) work without them — a missing library raises a clear
``ReportExportError`` instead of an ImportError at module load.

Figure blocks (PRIMARY_SOFTWARE_AUDIT_PLAN P3.6): a block's ``spec`` is
rendered by the report ROUTE through the app's own figure exporter and handed
in as ``figures``; this module only places the result -- Word/PowerPoint embed
a 300-DPI PNG plus, for a vector request, the SVG (``io.report_office``);
HTML inlines the SVG (or the PNG); LaTeX emits an ``\includegraphics`` of the
figure's exported file, since a single .tex cannot carry images. Anything that
cannot be embedded is a named placeholder plus a warning (``io.report_figures``).

Pure ``io`` layer — no fastapi/pydantic imports (enforced by
test_repo_integrity). ``value ± error`` formatting rounds the value to the
precision implied by the uncertainty (2 significant figures on the error).
"""

from __future__ import annotations

import base64 as _base64
import html as _html
from collections.abc import Mapping
from typing import Any, Literal

from quantized.io.report_blocks import format_value_error, params_rows, table_rows
from quantized.io.report_figures import (
    FigureKey,
    FigurePlan,
    RenderedFigure,
    figure_alt_text,
    figure_file_stem,
    figure_warning,
    html_inline_svg,
    placeholder_text,
    plan_figure,
)
from quantized.io.report_office import OfficeLibraryMissing, to_docx, to_pptx

__all__ = [
    "FORMATS",
    "RenderedFigure",
    "ReportExportError",
    "figure_target",
    "format_value_error",
    "render_report",
    "to_html",
    "to_latex",
]

FORMATS = ("latex", "html", "docx", "pptx")


class ReportExportError(RuntimeError):
    """Raised for an unknown format or a missing optional export library."""


# ── LaTeX (booktabs) ──────────────────────────────────────────────────────
# LaTeX special chars + the science glyphs the emitters emit (so the output
# compiles under plain pdfLaTeX, no inputenc/unicode-engine required).
_LATEX_REPL = {
    "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_",
    "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}",
    "±": r"$\pm$", "×": r"$\times$", "·": r"$\cdot$", "²": r"$^2$", "³": r"$^3$",
    "χ": r"$\chi$", "η": r"$\eta$", "α": r"$\alpha$", "β": r"$\beta$",
    "γ": r"$\gamma$", "σ": r"$\sigma$", "λ": r"$\lambda$", "θ": r"$\theta$",
    "ω": r"$\omega$", "μ": r"$\mu$", "π": r"$\pi$", "τ": r"$\tau$",
    "Δ": r"$\Delta$", "Ω": r"$\Omega$", "Å": r"\AA{}", "°": r"$^\circ$",
    "√": r"$\surd$", "∞": r"$\infty$",
    # The reflectivity-fit report (calc.report_emit.from_refl_fit): its log
    # objective "Σ(Δlog₁₀R)²" and the "—" of an unreported error.
    "Σ": r"$\Sigma$", "₀": r"$_0$", "₁": r"$_1$", "—": "---", "–": "--",
}


def _latex_escape(text: str) -> str:
    return "".join(_LATEX_REPL.get(ch, ch) for ch in text)


def _latex_table(header: list[str], rows: list[list[str]], caption: str | None) -> list[str]:
    ncol = len(header)
    align = "l" + "r" * (ncol - 1) if ncol > 1 else "l"
    out = [r"\begin{table}[h]", r"  \centering"]
    if caption:
        out.append(rf"  \caption{{{_latex_escape(caption)}}}")
    out.append(rf"  \begin{{tabular}}{{{align}}}")
    out.append(r"    \toprule")
    out.append("    " + " & ".join(_latex_escape(h) for h in header) + r" \\")
    out.append(r"    \midrule")
    for row in rows:
        out.append("    " + " & ".join(_latex_escape(str(c)) for c in row) + r" \\")
    out.append(r"    \bottomrule")
    out.append(r"  \end{tabular}")
    out.append(r"\end{table}")
    return out


def _latex_figure_file(block: Mapping[str, Any]) -> str:
    """The companion file a LaTeX figure expects: ``fig-<name>.pdf`` (vector,
    the app's default export) unless the block's spec/image is raster."""
    spec = block.get("spec")
    image = block.get("image")
    ext = "pdf"
    if isinstance(spec, Mapping) and spec.get("fmt") in ("png", "tiff"):
        ext = "png"
    elif not isinstance(spec, Mapping) and isinstance(image, Mapping):
        ext = {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg"}.get(
            str(image.get("mime")), "pdf")
    return f"{figure_file_stem(block)}.{ext}"


def _latex_figure(block: Mapping[str, Any]) -> list[str]:
    """A ``figure`` float that includes the figure's exported file when it sits
    beside the .tex, and compiles to a boxed note naming the file when not
    (the .tex is a single text file -- it cannot carry the image itself)."""
    fname = _latex_figure_file(block)
    spec = block.get("spec")
    width_in = spec.get("width_in") if isinstance(spec, Mapping) else None
    width = (f"{float(width_in):g}in" if isinstance(width_in, (int, float))
             and not isinstance(width_in, bool) and width_in > 0 else r"\linewidth")
    name = _latex_escape(str(block.get("name", "")))
    caption = _latex_escape(str(block.get("caption") or block.get("name", "")))
    return [
        r"\begin{figure}[h]",
        r"  \centering",
        rf"  \IfFileExists{{{fname}}}{{\includegraphics[width={width}]{{{fname}}}}}"
        rf"{{\fbox{{\parbox{{0.8\linewidth}}{{Figure {name}: export it as "
        rf"\texttt{{{_latex_escape(fname)}}} next to this file.}}}}}}",
        rf"  \caption{{{caption}}}",
        r"\end{figure}",
    ]


def to_latex(report: Mapping[str, Any], *, warnings: list[str] | None = None) -> str:
    """Booktabs LaTeX for the report's tables (params + stats), text as prose,
    and a ``figure`` float per figure block (see :func:`_latex_figure`; each
    one also appends a warning naming the file the .tex expects)."""
    has_figures = any(b.get("type") == "figure"
                      for sec in report.get("sections", []) for b in sec.get("blocks", []))
    lines = [rf"% Report: {_latex_escape(str(report.get('title', '')))}",
             r"% Requires \usepackage{booktabs}",
             *([r"% Requires \usepackage{graphicx} (figures)"] if has_figures else []), ""]
    for si, sec in enumerate(report.get("sections", [])):
        lines.append(rf"\subsection*{{{_latex_escape(str(sec.get('title', '')))}}}")
        for block in sec.get("blocks", []):
            btype = block.get("type")
            if btype == "text":
                lines.append(_latex_escape(block["text"]) + "\n")
            elif btype == "params":
                header, rows = params_rows(block)
                lines += _latex_table(header, rows, block.get("caption"))
            elif btype == "table":
                header, rows = table_rows(block)
                lines += _latex_table(header, rows, block.get("caption"))
            elif btype == "figure":
                lines += _latex_figure(block)
                if warnings is not None:
                    warnings.append(figure_warning(block, si, (
                        "the .tex export does not bundle image files -- export the figure "
                        f"as {_latex_figure_file(block)} beside the .tex")))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# ── HTML (self-contained) ─────────────────────────────────────────────────
_HTML_CSS = (
    "body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;"
    "padding:0 1rem;color:#1a1a1a}h1{font-size:1.5rem}h2{font-size:1.15rem;"
    "border-bottom:1px solid #ddd;padding-bottom:.2rem}table{border-collapse:"
    "collapse;margin:.6rem 0}th,td{border:1px solid #ccc;padding:.25rem .6rem;"
    "text-align:right}th:first-child,td:first-child{text-align:left}"
    "caption{caption-side:top;font-style:italic;text-align:left;color:#555}"
    "figure{color:#777;font-style:italic}"
)


def _html_table(header: list[str], rows: list[list[str]], caption: str | None) -> str:
    parts = ["<table>"]
    if caption:
        parts.append(f"<caption>{_html.escape(caption)}</caption>")
    parts.append("<thead><tr>" + "".join(f"<th>{_html.escape(h)}</th>" for h in header)
                 + "</tr></thead><tbody>")
    for row in rows:
        parts.append("<tr>" + "".join(f"<td>{_html.escape(str(c))}</td>" for c in row) + "</tr>")
    parts.append("</tbody></table>")
    return "".join(parts)


def _html_figure(block: Mapping[str, Any], plan: FigurePlan) -> str:
    cap = str(block.get("caption") or block.get("name", ""))
    alt = _html.escape(figure_alt_text(block))
    if plan.kind == "image" and plan.image is not None:  # pre-P3.6 markup kept
        img = plan.image
        src = f"data:{img['mime']};base64,{img['data']}"
        return (f'<figure><img src="{src}" alt="{_html.escape(cap)}"'
                f' style="max-width:100%"><figcaption>'
                f"{_html.escape(cap)}</figcaption></figure>")
    if plan.kind == "render":
        art = html_inline_svg(plan.svg, alt) if plan.svg is not None else None
        if art is None and plan.png is not None:
            b64 = _base64.b64encode(plan.png).decode("ascii")
            art = f'<img src="data:image/png;base64,{b64}" alt="{alt}" style="max-width:100%">'
        if art is not None:
            text = f"{cap} ({plan.note})" if plan.note else cap
            return f"<figure>{art}<figcaption>{_html.escape(text)}</figcaption></figure>"
        plan = FigurePlan("placeholder", reason="the rendered SVG holds no <svg> element")
    return f"<figure>{_html.escape(placeholder_text(block, plan.reason or ''))}</figure>"


def to_html(
    report: Mapping[str, Any],
    *,
    figures: Mapping[FigureKey, RenderedFigure] | None = None,
    warnings: list[str] | None = None,
) -> str:
    """A self-contained HTML page for the report (#39). A server-rendered
    figure is inlined as ``<svg>`` when its spec asked for a vector, else as a
    PNG data-URI ``<img>``; an attached image is used as-is."""
    title = _html.escape(str(report.get("title", "Report")))
    body = [f"<h1>{title}</h1>"]
    refs = report.get("source_refs", [])
    if refs:
        names = ", ".join(_html.escape(str(r.get("name") or r.get("id"))) for r in refs)
        body.append(f"<p><small>Sources: {names}</small></p>")
    for si, sec in enumerate(report.get("sections", [])):
        body.append(f"<h2>{_html.escape(str(sec.get('title', '')))}</h2>")
        for bi, block in enumerate(sec.get("blocks", [])):
            btype = block.get("type")
            if btype == "text":
                body.append(f"<p>{_html.escape(block['text'])}</p>")
            elif btype == "params":
                header, rows = params_rows(block)
                body.append(_html_table(header, rows, block.get("caption")))
            elif btype == "table":
                header, rows = table_rows(block)
                body.append(_html_table(header, rows, block.get("caption")))
            elif btype == "figure":
                plan = plan_figure(block, (figures or {}).get((si, bi)), "html")
                if warnings is not None and plan.kind == "placeholder":
                    warnings.append(figure_warning(block, si, f"not embedded: {plan.reason}"))
                elif warnings is not None and plan.note:
                    warnings.append(figure_warning(block, si, plan.note))
                body.append(_html_figure(block, plan))
    return (f"<!doctype html><html><head><meta charset='utf-8'><title>{title}</title>"
            f"<style>{_HTML_CSS}</style></head><body>{''.join(body)}</body></html>")


# ── dispatch ──────────────────────────────────────────────────────────────
def render_report(
    report: Mapping[str, Any],
    fmt: str,
    *,
    figures: Mapping[FigureKey, RenderedFigure] | None = None,
    warnings: list[str] | None = None,
) -> tuple[bytes, str, bool]:
    """Render ``report`` to ``fmt``; return ``(data, mime, is_text)``.

    ``is_text`` is True for latex/html (utf-8 text), False for docx/pptx
    (binary — the route base64-encodes these). Unknown or unavailable formats
    raise :class:`ReportExportError`.

    ``figures`` maps ``(section index, block index)`` to the server-side render
    of that figure block's ``spec`` (built by ``routes.report_figures`` -- this
    pure layer never renders); ``warnings``, when given, collects one message
    per figure that could not be embedded (or embedded with a caveat). A
    figure problem never raises -- it becomes a named placeholder.
    """
    if fmt == "latex":
        return to_latex(report, warnings=warnings).encode("utf-8"), "text/x-tex", True
    if fmt == "html":
        html = to_html(report, figures=figures, warnings=warnings)
        return html.encode("utf-8"), "text/html", True
    try:
        if fmt == "docx":
            return (to_docx(report, figures=figures, warnings=warnings),
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    False)
        if fmt == "pptx":
            return (to_pptx(report, figures=figures, warnings=warnings),
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    False)
    except OfficeLibraryMissing as exc:
        raise ReportExportError(str(exc)) from exc
    raise ReportExportError(f"unknown report format {fmt!r}; expected one of {FORMATS}")


def figure_target(fmt: str) -> Literal["office", "html"] | None:
    """Which render ``fmt`` needs from a figure spec (``None``: no render --
    the .tex references its figures' files instead of embedding them)."""
    if fmt in ("docx", "pptx"):
        return "office"
    return "html" if fmt == "html" else None
