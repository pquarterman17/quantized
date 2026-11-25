"""IIR branch of the spectral workbench "filter" operation.

``spectral_workbench`` has already selected finite rows and enforced a uniform
X grid (irregular spacing is refused unless the caller opted into resampling),
so the sampling rate here is exactly ``1 / spacing``; nothing is assumed.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.iir_filter import apply_iir, design_iir, frequency_response

__all__ = ["iir_filter_columns"]

_KEYS = {"family", "btype", "order", "cutoff", "rp", "rs", "bessel_norm", "zero_phase"}


def iir_filter_columns(
    x: NDArray[np.float64],
    values: NDArray[np.float64],
    spec: dict[str, Any],
    *,
    include_diagnostics: bool,
) -> tuple[NDArray[np.float64], dict[str, Any], dict[str, list[float]] | None]:
    """Filter every column of ``values``; returns (columns, parameters, response)."""
    unknown = set(spec) - _KEYS
    if unknown:
        raise ValueError(f"unknown IIR option(s): {', '.join(sorted(unknown))}")
    spacing = float(np.median(np.diff(x)))
    if not np.isfinite(spacing) or spacing <= 0:
        raise ValueError("IIR filtering needs an ascending X axis with positive spacing")
    fs = 1.0 / spacing
    zero_phase = spec.get("zero_phase", False)
    if not isinstance(zero_phase, bool):
        raise ValueError("zero_phase must be true or false")
    bessel_norm = spec.get("bessel_norm", "phase")
    sos = design_iir(
        family=str(spec.get("family")),
        btype=str(spec.get("btype")),
        order=spec.get("order"),  # type: ignore[arg-type]  # validated in design_iir
        cutoff=[float(c) for c in spec.get("cutoff") or []],
        fs=fs,
        rp=spec.get("rp"),
        rs=spec.get("rs"),
        bessel_norm=bessel_norm,
    )
    out = np.column_stack(
        [apply_iir(sos, values[:, c], zero_phase=zero_phase) for c in range(values.shape[1])]
    )
    params: dict[str, Any] = {
        "engine": "iir",
        "family": spec["family"],
        "btype": spec["btype"],
        "order": spec["order"],
        "cutoff": [float(c) for c in spec["cutoff"]],
        "rp": spec.get("rp"),
        "rs": spec.get("rs"),
        "besselNorm": bessel_norm if spec["family"] == "bessel" else None,
        "zeroPhase": zero_phase,
        "samplingRate": fs,
        "sections": int(sos.shape[0]),
    }
    response = frequency_response(sos, fs) if include_diagnostics else None
    if response is not None and zero_phase:
        # sosfiltfilt applies |H|^2 and cancels the phase: show what was applied.
        response["magnitudeDb"] = [2.0 * v for v in response["magnitudeDb"]]
        response["phaseDeg"] = [0.0 for _ in response["phaseDeg"]]
    return out, params, response
