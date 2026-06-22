"""Self-describing HDF5 exporter. Port of MATLAB ``+utilities/exportHDF5.m``.

Writes a unified ``DataStruct`` (plus optional corrected data, correction
parameters, and peak fits) to a hierarchical HDF5 file with a schema that is
consistent across data types (VSM, PPMS, XRD, generic CSV/Excel). All parsers
produce the same ``DataStruct`` layout, so one schema covers everything.

Schema overview (v1.0, identical to the MATLAB original)::

    /raw/           raw data (always written)
    /corrected/     corrected data (optional)
    /corrections/   xOff, yOff, bgSlope, bgInt (optional)
    /peaks/         peak-fit results (optional)
    /metadata/      common metadata attributes
    /metadata/parserSpecific/   instrument-specific attributes

String datasets (labels, units, peak status/model) are written as space-padded
ASCII ``uint8`` matrices with an ``encoding='ASCII_padded_space'`` attribute,
matching MATLAB so files round-trip across both implementations.

Pure layer: ``DataStruct`` in -> ``.h5`` file out. No fastapi/pydantic imports.
``h5py`` (BSD-3-Clause) is the only extra dependency; it is imported lazily so
the rest of ``io/`` works without it installed.

The tree-shaping logic lives in :mod:`quantized.io._hdf5_layout` (keeps both
modules under the 500-line ceiling and makes the layout independently testable).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io import _hdf5_layout as layout

__all__ = ["write_hdf5"]

_VALID_EXTENSIONS = (".h5", ".hdf5")
_TOOLBOX_NAME = "quantized"
_HDF5_SCHEMA = "1.0"


def write_hdf5(
    data: DataStruct,
    output_path: str | Path,
    *,
    corr_data: DataStruct | None = None,
    corrections: Mapping[str, float] | None = None,
    include_peaks: bool = False,
    peaks: Sequence[Mapping[str, Any]] | None = None,
    overwrite: bool = True,
) -> None:
    """Write ``data`` to a self-describing HDF5 file (port of ``exportHDF5``).

    Parameters
    ----------
    data:
        Unified ``DataStruct`` (from any parser). Written to ``/raw/``.
    output_path:
        Destination file; must end in ``.h5`` or ``.hdf5``. Its parent
        directory must already exist (mirrors the MATLAB ``isfolder`` check).
    corr_data:
        Corrected ``DataStruct`` (same layout as ``data``); writes
        ``/corrected/`` when given. ``None`` (or ``struct()`` upstream) skips it.
    corrections:
        Mapping with any of ``xOff``/``yOff``/``bgSlope``/``bgInt`` (also
        accepts the quantized snake_case ``x_off``/``y_off``/``bg_slope``/
        ``bg_int``). Writes ``/corrections/`` only when at least one finite,
        value is present (mirrors MATLAB ``hasCorrections``).
    include_peaks:
        Write ``/peaks/`` from ``peaks`` (default ``False``).
    peaks:
        Sequence of peak mappings (``center``/``fwhm``/``height``/``bg``/
        ``xRange``/``status``/``model``). Required when ``include_peaks=True``.
    overwrite:
        Delete an existing file first (default ``True``). When ``False`` and the
        file exists, raise ``FileExistsError`` (mirrors MATLAB ``Overwrite``).

    Raises
    ------
    ValueError
        Bad file extension.
    FileNotFoundError
        Output directory does not exist.
    FileExistsError
        File exists and ``overwrite=False``.
    ImportError
        ``h5py`` is not installed.
    """
    out = Path(output_path)
    _validate_path(out, overwrite=overwrite)

    h5py = _import_h5py()

    norm_corr = _normalize_corrections(corrections)
    has_corr_data = corr_data is not None
    peak_list = list(peaks) if peaks else []
    has_peaks = include_peaks and len(peak_list) > 0
    has_corrections = _has_corrections(norm_corr)
    corrections_applied = has_corrections and any(v != 0.0 for v in norm_corr.values())

    if out.exists():
        out.unlink()

    with h5py.File(out, "w") as hf:
        # Root sentinel dataset + root-level attributes.
        hf.create_dataset("file_schema_version", data=np.uint8(1).reshape(1, 1))
        hf.attrs["toolboxName"] = _TOOLBOX_NAME
        hf.attrs["hdf5Schema"] = _HDF5_SCHEMA
        hf.attrs["createdAt"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S")
        hf.attrs["hasCorrected"] = np.uint8(has_corr_data)
        hf.attrs["hasPeaks"] = np.uint8(has_peaks)
        hf.attrs["correctionsApplied"] = np.uint8(corrections_applied)

        layout.write_data_group(hf, "raw", data)

        if has_corr_data:
            assert corr_data is not None  # narrowed by has_corr_data
            layout.write_data_group(hf, "corrected", corr_data)

        if has_corrections:
            layout.write_corrections_group(hf, norm_corr)

        if has_peaks:
            layout.write_peaks_group(hf, peak_list)

        layout.write_metadata_group(hf, data.metadata)


# ── helpers ──────────────────────────────────────────────────────────────────


def _validate_path(out: Path, *, overwrite: bool) -> None:
    """Validate extension, parent directory, and overwrite policy."""
    if out.suffix.lower() not in _VALID_EXTENSIONS:
        raise ValueError(
            f"output_path must end in .h5 or .hdf5 (got: {out.suffix!r})"
        )
    parent = out.parent
    if str(parent) not in ("", ".") and not parent.is_dir():
        raise FileNotFoundError(f"Output directory does not exist: {parent}")
    if not overwrite and out.exists():
        raise FileExistsError(
            f"File already exists and overwrite=False: {out}"
        )


def _import_h5py() -> Any:
    """Lazily import ``h5py`` with an actionable error message."""
    try:
        import h5py  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - exercised only without h5py
        raise ImportError(
            "h5py is required for HDF5 export. Install it with: uv add h5py"
        ) from exc
    return h5py


# Map quantized snake_case correction names onto the MATLAB attribute names.
_CORRECTION_ALIASES: dict[str, str] = {
    "x_off": "xOff",
    "y_off": "yOff",
    "bg_slope": "bgSlope",
    "bg_int": "bgInt",
}


def _normalize_corrections(
    corrections: Mapping[str, float] | None,
) -> dict[str, float]:
    """Coerce a corrections mapping to the four MATLAB-named float keys."""
    if not corrections:
        return {}
    out: dict[str, float] = {}
    for key, val in corrections.items():
        name = _CORRECTION_ALIASES.get(key, key)
        if name in layout.CORRECTION_FIELDS:
            try:
                out[name] = float(val)
            except (TypeError, ValueError):
                continue
    return out


def _has_corrections(norm_corr: Mapping[str, float]) -> bool:
    """True when any normalized correction value is finite (mirrors MATLAB)."""
    return any(np.isfinite(v) for v in norm_corr.values())
