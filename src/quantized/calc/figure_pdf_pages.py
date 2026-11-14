"""One multi-page PDF from several figure renders (gap-audit-2 #10).

``render_pdf_pages`` runs each render callable with
``figure_render.pdf_page_sink`` set to a matplotlib ``PdfPages``, so every
figure a renderer would have saved as its own PDF becomes the next page of one
document instead -- each page keeps its own size, exactly as the single-file
export draws it. Pure: callables in, PDF bytes out.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from io import BytesIO

from matplotlib.backends.backend_pdf import PdfPages

from quantized.calc.figure_render import pdf_page_sink, render_scope

__all__ = ["render_pdf_pages"]


def render_pdf_pages(renders: Iterable[Callable[[], object]]) -> bytes:
    """Run each of ``renders`` (each renders ONE figure as ``"pdf"``) and
    return the pages as one PDF. Raises ``ValueError`` when no page was
    drawn; a render's own error propagates and no document is returned."""
    buf = BytesIO()
    pages = PdfPages(buf, metadata={"Creator": "quantized"})
    token = pdf_page_sink.set(pages)
    try:
        for render in renders:
            render()
    finally:
        pdf_page_sink.reset(token)
        count = pages.get_pagecount()  # type: ignore[no-untyped-call]
        # Fonts are embedded on close: under the render lock and BASE_RC
        # (pdf.fonttype 42), as every single-figure save is.
        with render_scope():
            pages.close()  # type: ignore[no-untyped-call]
    if count == 0:
        raise ValueError("no figure produced a page")
    return buf.getvalue()
