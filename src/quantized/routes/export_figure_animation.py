"""Animated figure export: step a figure through By levels or a dataset series.

Each frame is an ordinary :class:`FigureRequest` rendered to PNG by the same
``render_figure_request`` as ``POST /api/export/figure`` and the batch export,
so frames match the static export.  The route adds only orchestration: the
frame label (drawn as the figure title), fixed axes across frames, the limits
(frame count, pixel area, wall-clock) and the encoder (``calc.figure_animation``:
GIF / APNG / PNG-frame ZIP, no ffmpeg).

Synchronous with disconnect watching, exactly like ``figure-batch`` (and
unlike the job queue, whose results are JSON, not a binary download); the
wall-clock budget is checked between frames.  Provisional, owner to confirm:
limits and fixed axes ON by default.
"""

from __future__ import annotations

import io
import threading
import time
from functools import partial
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from starlette.responses import Response as StarletteResponse

from quantized.calc import figure_animation as anim
from quantized.heavy_import import heavy_imports
from quantized.routes._disconnect import run_watching_disconnect
from quantized.routes._errors import CALC_ERRORS_WITH_LOCK, raise_calc_error
from quantized.routes._export_common import _attachment, _safe_name
from quantized.routes._offloop import OffloopJSONRoute
from quantized.routes.export_figures import FigureRequest, _figure_hitmap, render_figure_request

router = APIRouter(prefix="/api/export", tags=["export"], route_class=OffloopJSONRoute)

_MIME = {"gif": "image/gif", "apng": "image/apng", "zip": "application/zip"}
_EXT = {"gif": ".gif", "apng": ".png", "zip": ".zip"}
_PROBE_DPI = 50  # axis limits do not depend on resolution


class AnimationFrame(BaseModel):
    figure: FigureRequest
    # Drawn as the figure title (after the figure's own title, if any).
    label: str = Field(default="", max_length=200)


class FigureAnimationRequest(BaseModel):
    frames: list[AnimationFrame] = Field(min_length=1, max_length=anim.MAX_FRAMES)
    format: Literal["gif", "apng", "zip"] = "gif"
    frame_ms: int = Field(default=500, ge=anim.FRAME_MS_RANGE[0], le=anim.FRAME_MS_RANGE[1])
    loop: bool = True
    # One shared X/Y range (the union over frames) so frames are comparable.
    fixed_axes: bool = True
    filename: str = "animation"


def _frame_request(frame: AnimationFrame) -> FigureRequest:
    """The frame's figure, titled with its label."""
    fig = frame.figure
    title = " ".join(part for part in (fig.title, frame.label) if part)
    return fig.model_copy(update={"title": title, "fmt": "png"})


def _axes_union(figures: list[FigureRequest], gone: threading.Event) -> dict[str, list[float]]:
    """Per-axis union of the autoscaled limits of every frame (a probe render each)."""
    xs: list[list[float]] = []
    ys: list[list[float]] = []
    for fig in figures:
        if gone.is_set():
            raise HTTPException(status_code=499, detail="client_disconnected")
        if fig.facets or fig.polar is not None or fig.plots2 is not None or fig.y2_keys:
            raise HTTPException(
                status_code=422,
                detail="fixed axes needs a plain single-axis XY figure (no facets, polar, "
                "map plots or secondary Y axis); turn off 'Fixed axes'",
            )
        probe = fig.model_copy(update={"dpi": _PROBE_DPI})
        out = _figure_hitmap(probe, Response(), gone)
        axes = out.get("axes")
        if axes is None:
            raise HTTPException(
                status_code=422,
                detail="fixed axes is unavailable for this figure; turn it off",
            )
        xs.append(axes["xlim"])
        ys.append(axes["ylim"])
    return {"x_lim": list(anim.union_limits(xs)), "y_lim": list(anim.union_limits(ys))}


def _with_limits(fig: FigureRequest, limits: dict[str, list[float]]) -> FigureRequest:
    overrides: dict[str, Any] = {**(fig.overrides or {}), **limits}
    return fig.model_copy(update={"overrides": overrides})


@router.post("/figure-animation")
async def export_figure_animation(
    req: FigureAnimationRequest, request: Request
) -> StarletteResponse:
    """Render 1-120 frames and download one animated GIF / APNG or a PNG ZIP.

    All-or-nothing: a frame that fails, a limit that is exceeded, or a timeout
    returns an error with the reason and no partial file.
    """
    return await run_watching_disconnect(request, partial(_export_animation, req))


def _png_size(data: bytes) -> tuple[int, int]:
    with heavy_imports("PIL", "PIL.Image"):
        from PIL import Image
    with Image.open(io.BytesIO(data)) as im:
        return im.size


def _export_animation(req: FigureAnimationRequest, gone: threading.Event) -> StarletteResponse:
    started = time.monotonic()
    try:
        anim.check_frame_count(len(req.frames))
        figures = [_frame_request(f) for f in req.frames]
        if req.fixed_axes:
            limits = _axes_union(figures, gone)
            figures = [_with_limits(f, limits) for f in figures]
        pngs: list[bytes] = []
        total_px = 0
        for index, fig in enumerate(figures):
            if gone.is_set():
                raise HTTPException(status_code=499, detail="client_disconnected")
            if time.monotonic() - started > anim.MAX_SECONDS:
                raise HTTPException(
                    status_code=408,
                    detail=f"rendering exceeded the {anim.MAX_SECONDS:.0f} s limit after "
                    f"{index} of {len(figures)} frames; use fewer frames or a lower DPI",
                )
            pngs.append(render_figure_request(fig, fmt="png", dpi=fig.dpi))
            # Every frame is measured (frames may differ in size or DPI; the GIF/APNG
            # encoder refuses mixed sizes, the ZIP does not): the first against the
            # projected total, each later one against the running total.
            width, height = _png_size(pngs[index])
            anim.check_frame_pixels(width, height, len(figures) if index == 0 else 1)
            total_px += width * height
            if total_px > anim.MAX_TOTAL_PIXELS:
                raise ValueError(
                    f"{index + 1} frames total {total_px / 1e6:.0f} megapixels; the limit is "
                    f"{anim.MAX_TOTAL_PIXELS / 1e6:.0f}. Use fewer frames or a lower DPI."
                )
        names = [
            f"frame_{i + 1:03d}" + (f"_{_safe_name(f.label, '')}" if f.label else "") + ".png"
            for i, f in enumerate(req.frames)
        ]
        data = anim.encode_animation(
            pngs, names, fmt=req.format, frame_ms=req.frame_ms, loop=req.loop
        )
    except CALC_ERRORS_WITH_LOCK as exc:
        raise_calc_error(exc)
    return StarletteResponse(
        content=data,
        media_type=_MIME[req.format],
        headers={
            **_attachment(_safe_name(req.filename, _EXT[req.format])),
            "X-Animation-Frames": str(len(pngs)),
        },
    )
