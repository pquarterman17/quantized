"""Batch publication-figure export as one ZIP download.

Each entry is an ordinary :class:`FigureRequest` rendered by the same
``render_figure_request`` function as ``POST /api/export/figure``.  The route
adds only archive orchestration: bounded batch size, safe unique filenames,
and all-or-nothing error handling.  It deliberately does not invent a second
plot renderer or send a burst of browser downloads that modern browsers may
block after the first file.
"""

from __future__ import annotations

import io
import threading
import zipfile
from functools import partial

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from quantized.routes._disconnect import run_watching_disconnect
from quantized.routes._errors import CALC_ERRORS_WITH_LOCK, raise_calc_error
from quantized.routes._export_common import _FIGURE_MIME, _attachment, _safe_name
from quantized.routes._offloop import OffloopJSONRoute
from quantized.routes.export_figures import FigureRequest, render_figure_request

router = APIRouter(prefix="/api/export", tags=["export"], route_class=OffloopJSONRoute)


class FigureBatchRequest(BaseModel):
    figures: list[FigureRequest] = Field(min_length=1, max_length=64)
    filename: str = "figures"


def _unique_entry_name(filename: str, fmt: str, used: set[str]) -> str:
    """Return a safe, case-insensitively unique archive member name."""
    safe = _safe_name(filename, f".{fmt}")
    stem, dot, extension = safe.rpartition(".")
    stem = stem if dot else safe
    extension = extension if dot else fmt
    candidate = safe
    suffix = 2
    while candidate.casefold() in used:
        candidate = f"{stem}_{suffix}.{extension}"
        suffix += 1
    used.add(candidate.casefold())
    return candidate


@router.post("/figure-batch")
async def export_figure_batch(req: FigureBatchRequest, request: Request) -> Response:
    """Render 1–64 ordinary figures and download them in one ZIP archive.

    The response is all-or-nothing: if any figure is invalid or rendering is
    unavailable, no partial archive is returned.  Duplicate or sanitization-
    colliding filenames are numbered rather than overwritten by ``ZipFile``.
    """
    return await run_watching_disconnect(request, partial(_export_figure_batch, req))


def _export_figure_batch(req: FigureBatchRequest, gone: threading.Event) -> Response:
    """Synchronous worker body; stop between renders after a disconnect."""
    for figure in req.figures:
        if figure.fmt not in _FIGURE_MIME:
            raise HTTPException(
                status_code=422,
                detail=f"fmt must be one of {sorted(_FIGURE_MIME)}",
            )

    archive = io.BytesIO()
    used: set[str] = set()
    try:
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
            for figure in req.figures:
                if gone.is_set():
                    raise HTTPException(status_code=499, detail="client_disconnected")
                name = _unique_entry_name(figure.filename, figure.fmt, used)
                data = render_figure_request(figure, fmt=figure.fmt, dpi=figure.dpi)
                output.writestr(name, data)
    except CALC_ERRORS_WITH_LOCK as exc:
        raise_calc_error(exc)

    return Response(
        content=archive.getvalue(),
        media_type="application/zip",
        headers=_attachment(_safe_name(req.filename, ".zip")),
    )
