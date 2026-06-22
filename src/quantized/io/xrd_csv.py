"""XRD data CSV / Origin-ASCII exporter. Port of MATLAB ``+utilities/writeXRDcsv.m``.

This is the first *writer* in ``io/`` (readers parse files into a
``DataStruct``; this goes the other way: ``DataStruct`` -> CSV text/file).

Two output formats mirror the MATLAB original exactly:

* ``"standard"`` — comma-delimited; one header row; optional ``# ``-prefixed
  metadata block.
* ``"origin"`` — tab-delimited Origin ASCII; three header rows (long name,
  units, X/Y designation); optional ``#\\t``-prefixed metadata block.

Number formatting matches MATLAB ``fprintf``: x-axis values use ``%.6f``,
intensity values use ``%.6g``.

Pure layer: ``DataStruct`` in -> string/file out. No fastapi/pydantic imports.

The string-producing :func:`format_xrd_csv` is the testable core;
:func:`write_xrd_csv` is a thin disk wrapper around it.
"""

from __future__ import annotations

import warnings
from collections.abc import Mapping
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

__all__ = ["format_xrd_csv", "write_xrd_csv"]

_FORMATS = ("standard", "origin")
_INTENSITIES = ("both", "cps", "counts")


def write_xrd_csv(
    data: DataStruct,
    output_path: str | Path,
    *,
    fmt: str = "standard",
    intensity: str = "both",
    include_metadata: bool = True,
) -> None:
    """Write XRD ``data`` to ``output_path`` as CSV or Origin ASCII.

    Parameters
    ----------
    data:
        ``DataStruct`` from an XRD parser (first value column is intensity).
    output_path:
        Destination ``.csv`` file. Its parent directory must exist (mirrors
        the MATLAB ``isfolder`` check).
    fmt:
        ``"standard"`` (comma) or ``"origin"`` (tab, 3-row header). Case
        insensitive (mirrors MATLAB ``validatestring``).
    intensity:
        ``"both"`` | ``"cps"`` | ``"counts"`` — which intensity column(s) to
        emit. Case insensitive.
    include_metadata:
        Emit a comment-prefixed metadata header block.
    """
    out = Path(output_path)
    parent = out.parent
    # Mirror MATLAB: only validate the directory when one is specified.
    if str(parent) not in ("", ".") and not parent.is_dir():
        raise FileNotFoundError(f"Output directory does not exist: {parent}")

    text = format_xrd_csv(
        data, fmt=fmt, intensity=intensity, include_metadata=include_metadata
    )
    # newline="" so the explicit "\n" in the text is written verbatim (no
    # platform translation), matching MATLAB's byte-for-byte fprintf output.
    out.write_text(text, encoding="utf-8", newline="")


def format_xrd_csv(
    data: DataStruct,
    *,
    fmt: str = "standard",
    intensity: str = "both",
    include_metadata: bool = True,
) -> str:
    """Return the CSV / Origin-ASCII text for ``data`` (no disk I/O).

    See :func:`write_xrd_csv` for parameter meanings. Lines are joined with
    ``"\\n"`` and the text ends with a trailing newline, matching MATLAB.
    """
    fmt_norm = _validate_choice(fmt, _FORMATS, "Format")
    intensity_norm = _validate_choice(intensity, _INTENSITIES, "Intensity")

    int_vals, int_labels, int_units = _resolve_intensity_columns(data, intensity_norm)

    x_label = _x_axis_label(data)
    x_unit = _x_axis_unit(data)

    is_origin = fmt_norm == "origin"
    sep = "\t" if is_origin else ","
    prefix = "#\t" if is_origin else "# "

    lines: list[str] = []
    if include_metadata:
        lines.extend(_metadata_block(data, prefix))

    if is_origin:
        names = [x_label, *int_labels]
        units = [x_unit, *int_units]
        designations = ["X", *(["Y"] * len(int_labels))]
        lines.append(sep.join(names))
        lines.append(sep.join(units))
        lines.append(sep.join(designations))
    else:
        lines.append(sep.join([x_label, *int_labels]))

    time = np.asarray(data.time, dtype=float)
    for row in range(int_vals.shape[0]):
        cells = [f"{time[row]:.6f}"]
        cells.extend(f"{int_vals[row, col]:.6g}" for col in range(int_vals.shape[1]))
        lines.append(sep.join(cells))

    # Trailing newline after the final row (MATLAB writes "\n" after each row).
    return "\n".join(lines) + "\n"


# ── Helpers ────────────────────────────────────────────────────────────────


def _validate_choice(value: str, allowed: tuple[str, ...], label: str) -> str:
    """Case-insensitive choice validation (mirrors MATLAB ``validatestring``)."""
    norm = str(value).strip().lower()
    if norm not in allowed:
        opts = ", ".join(f'"{a}"' for a in allowed)
        raise ValueError(f"{label} must be one of [{opts}]; got {value!r}")
    return norm


def _meta_get(meta: Mapping[str, Any], *keys: str, default: Any = None) -> Any:
    """First present, non-empty metadata value among ``keys`` (or ``default``).

    Accepts both quantized's flat snake_case keys and the MATLAB-style camelCase
    keys (and a nested ``parser_specific`` / ``parserSpecific`` mapping), so the
    writer is robust to either DataStruct provenance.
    """
    sources: list[Mapping[str, Any]] = [meta]
    for nested_key in ("parser_specific", "parserSpecific"):
        nested = meta.get(nested_key)
        if isinstance(nested, Mapping):
            sources.append(nested)
    for src in sources:
        for key in keys:
            if key in src:
                val = src[key]
                if val is None:
                    continue
                if isinstance(val, str) and val == "":
                    continue
                return val
    return default


def _counting_time(data: DataStruct) -> float:
    """Counting time (s/point) or NaN. Mirrors MATLAB's parserSpecific lookup."""
    val = _meta_get(data.metadata, "counting_time", "countingTime", default=None)
    if val is None:
        return float("nan")
    try:
        return float(val)
    except (TypeError, ValueError):
        return float("nan")


def _resolve_intensity_columns(
    data: DataStruct, intensity: str
) -> tuple[NDArray[np.float64], list[str], list[str]]:
    """Select / convert intensity columns. Port of ``resolveIntensityColumns``.

    Returns ``(values[N, k], labels[k], units[k])``.
    """
    original_unit = data.units[0] if data.units else ""
    original = np.asarray(data.values[:, 0], dtype=float)
    counting_time = _counting_time(data)
    has_ct = not np.isnan(counting_time)
    is_cps = "cps" in original_unit.lower()

    if intensity == "both":
        if not has_ct:
            # Can't convert; write only the original column.
            if is_cps:
                return original.reshape(-1, 1), ["Intensity (cps)"], ["cps"]
            return original.reshape(-1, 1), ["Intensity (counts)"], ["counts"]
        if is_cps:
            counts = original * counting_time
            stacked = np.column_stack([original, counts])
        else:
            cps = original / counting_time
            stacked = np.column_stack([cps, original])
        return (
            stacked,
            ["Intensity (cps)", "Intensity (counts)"],
            ["cps", "counts"],
        )

    if intensity == "cps":
        if is_cps:
            vals = original
        elif not has_ct:
            warnings.warn(
                "Cannot convert counts to cps (countingTime not available). "
                "Writing counts.",
                stacklevel=2,
            )
            vals = original
        else:
            vals = original / counting_time
        return vals.reshape(-1, 1), ["Intensity (cps)"], ["cps"]

    # intensity == "counts"
    is_counts = "counts" in original_unit.lower()
    if is_counts:
        vals = original
    elif not has_ct:
        warnings.warn(
            "Cannot convert cps to counts (countingTime not available). "
            "Writing cps.",
            stacklevel=2,
        )
        vals = original
    else:
        vals = original * counting_time
    return vals.reshape(-1, 1), ["Intensity (counts)"], ["counts"]


def _x_axis_label(data: DataStruct) -> str:
    """Build the x-axis column label. Port of ``getXAxisLabel``."""
    name = _meta_get(data.metadata, "x_column_name", "xColumnName", default=None)
    if name is None:
        return "X Axis"
    unit = _x_axis_unit(data)
    return f"{name} ({unit})" if unit else str(name)


def _x_axis_unit(data: DataStruct) -> str:
    """X-axis unit string ('' when unknown). Port of ``getXAxisUnit``."""
    unit = _meta_get(data.metadata, "x_column_unit", "xColumnUnit", default="")
    return "" if unit is None else str(unit)


def _metadata_block(data: DataStruct, prefix: str) -> list[str]:
    """Comment-prefixed metadata lines. Port of ``writeMetadataBlock``.

    Field presence/order matches the MATLAB original. The "Export date" line
    is non-deterministic (current time) by design — golden parity tests freeze
    with ``include_metadata=False``.
    """
    meta = data.metadata
    lines: list[str] = [f"{prefix}XRD Batch Export"]

    source = _meta_get(meta, "source", "sourceFile", default=None)
    if source is not None:
        lines.append(f"{prefix}Source: {source}")

    parser = _meta_get(meta, "parser_name", "parser", default=None)
    if parser is not None:
        lines.append(f"{prefix}Parser: {parser}")

    sample = _meta_get(
        meta, "sample_name", "sampleName", "sampleID", default=None
    )
    if sample is not None:
        lines.append(f"{prefix}Sample: {sample}")

    anode = _meta_get(meta, "anode_material", "anodeMaterial", default=None)
    if anode is not None:
        kv = _meta_get(meta, "tension_kV", "tension_kv", default=None)
        ma = _meta_get(meta, "current_mA", "current_ma", default=None)
        if kv is not None and ma is not None:
            lines.append(f"{prefix}Anode: {anode} ({kv:.1f} kV / {ma:.1f} mA)")
        else:
            lines.append(f"{prefix}Anode: {anode}")

    ka1 = _meta_get(meta, "k_alpha1", "kAlpha1", default=None)
    if ka1 is not None:
        lines.append(f"{prefix}Wavelength: Ka1 = {float(ka1):.5g} A")

    start = _meta_get(meta, "start_angle", "startAngle", default=None)
    end = _meta_get(meta, "end_angle", "endAngle", default=None)
    if start is not None and end is not None:
        lines.append(
            f"{prefix}2-theta range: {float(start):.4f} - {float(end):.4f} deg"
        )

    step = _meta_get(meta, "step_size", "stepSize", default=None)
    npts = _meta_get(meta, "n_points", "nPoints", "num_points", default=None)
    if step is not None and npts is not None:
        lines.append(f"{prefix}Step size: {float(step):.6f} deg ({int(npts)} points)")

    ct = _counting_time(data)
    if not np.isnan(ct):
        lines.append(f"{prefix}Counting time: {ct:.3f} s/point")

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines.append(f"{prefix}Export date: {now}")
    lines.append(prefix)
    return lines
