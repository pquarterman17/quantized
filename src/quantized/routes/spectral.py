"""Thin FFT spectral route. Wraps ``calc.spectral.fft_spectral`` for the ROI
gadget family's FFT mode (gap #34): a single-record magnitude/PSD/phase
spectrum of one region's rows. The "complex" output type never crosses the
wire (numpy complex isn't JSON-serializable — see CLAUDE.md's jsonencode
notes); only magnitude/psd/phase are exposed here. Validate -> call ->
serialize; no business logic here.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.spectral import fft_spectral
from quantized.routes._payload import to_jsonable

router = APIRouter(prefix="/api/spectral", tags=["spectral"])

# "complex" is deliberately excluded (see module docstring).
_OUTPUT_TYPES = ("psd", "magnitude", "phase")


class FftRequest(BaseModel):
    x: list[float]
    y: list[float]
    window: str = "hanning"
    output_type: str = "magnitude"
    sided: str = "one"
    detrend: str = "mean"


@router.post("/fft")
def fft(req: FftRequest) -> dict[str, Any]:
    """Single-record FFT spectrum (magnitude/psd/phase) of (x, y)."""
    if req.output_type not in _OUTPUT_TYPES:
        raise HTTPException(status_code=422, detail=f"unsupported output_type: {req.output_type}")
    try:
        result = fft_spectral(
            np.asarray(req.x, dtype=float),
            np.asarray(req.y, dtype=float),
            window=req.window,
            output_type=req.output_type,
            sided=req.sided,
            detrend=req.detrend,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # Drop the window-function array: same length as the input, internal detail
    # the caller never plots (keeps the response small).
    out = {k: v for k, v in result.items() if k != "window"}
    return to_jsonable(out)  # type: ignore[no-any-return]
