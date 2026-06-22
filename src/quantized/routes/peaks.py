"""Thin peak-finding route. Wraps ``calc.peaks.find_peaks_robust`` (golden vs
MATLAB findPeaksRobust): local-maxima + prominence/slope/width/SNR filtering.
Validate -> call -> serialize the (peaks, background) tuple.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from quantized.calc.peaks import find_peaks_robust
from quantized.routes._payload import jsonify, to_jsonable

router = APIRouter(prefix="/api/peaks", tags=["peaks"])


class FindPeaksRequest(BaseModel):
    x: list[float]
    y: list[float]
    snr_threshold: float = 5.0
    min_separation: float = 0.0
    max_peaks: int = 50
    max_window_deg: float = 2.0
    min_width_deg: float = 0.01
    max_width_deg: float = 10.0
    min_prominence: float = 0.02
    sensitivity: str = "medium"


@router.post("/find")
def find(req: FindPeaksRequest) -> dict[str, Any]:
    """Find peaks in (x, y); returns the peak list + the estimated background."""
    try:
        peaks, background = find_peaks_robust(
            req.x,
            req.y,
            snr_threshold=req.snr_threshold,
            min_separation=req.min_separation,
            max_peaks=req.max_peaks,
            max_window_deg=req.max_window_deg,
            min_width_deg=req.min_width_deg,
            max_width_deg=req.max_width_deg,
            min_prominence=req.min_prominence,
            sensitivity=req.sensitivity,
        )
    except (ValueError, IndexError, KeyError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"peaks": to_jsonable(peaks), "background": jsonify(background)}
