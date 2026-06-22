"""Tree-building helpers for the HDF5 exporter (:mod:`quantized.io.hdf5`).

Split out of ``hdf5.py`` to keep both modules under the 500-line ceiling and
to make the tree-shaping logic independently testable. Pure layer: ndarray /
``DataStruct`` / ``h5py`` group in -> datasets/attributes written. No
fastapi/pydantic imports.

Schema (mirrors MATLAB ``+utilities/exportHDF5.m`` v1.0)::

    /file_schema_version          uint8 [1,1] = 1   (root sentinel)
    /  (root attrs)               toolboxName, hdf5Schema, createdAt,
                                  hasCorrected, hasPeaks, correctionsApplied
    /raw/                         time, values, labels, units, nRows (+attrs)
    /corrected/                   (optional, same layout as /raw/)
    /corrections/                 xOff, yOff, bgSlope, bgInt (double scalars)
    /peaks/                       count, center, fwhm, height, bg,
                                  xRange_lo, xRange_hi, status, model
    /metadata/                    schema_version (+ common attrs)
    /metadata/parserSpecific/     schema_version (+ flattened struct attrs)

String datasets (labels, units, datetime time, peak status/model) are written
as space-padded ASCII ``uint8`` matrices, one string per row, exactly like the
MATLAB original; the companion ``encoding`` attribute documents the format.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

if TYPE_CHECKING:  # pragma: no cover - h5py only needed at write time
    import h5py

__all__ = [
    "CORRECTION_FIELDS",
    "META_COMMON_KEYS",
    "PEAK_NUMERIC_FIELDS",
    "encode_padded_ascii",
    "first_meta",
    "write_corrections_group",
    "write_data_group",
    "write_metadata_group",
    "write_peaks_group",
    "write_struct_attrs",
]

# MATLAB writes exactly these four correction scalars, in this order, always
# defaulting absent ones to 0.0 (see exportHDF5.m corrFieldNames).
CORRECTION_FIELDS: tuple[str, ...] = ("xOff", "yOff", "bgSlope", "bgInt")

# Common /metadata attributes, mapped MATLAB-attr-name -> candidate metadata
# keys (quantized snake_case first, then MATLAB camelCase, mirroring xrd_csv).
META_COMMON_KEYS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("parserName", ("parser_name", "parserName")),
    ("xColumnName", ("x_column_name", "xColumnName")),
    ("xColumnUnit", ("x_column_unit", "xColumnUnit")),
    ("source", ("source", "sourceFile")),
)

# Peak numeric fields written as parallel [P,1] double vectors (NaN fallback).
PEAK_NUMERIC_FIELDS: tuple[str, ...] = ("center", "fwhm", "height", "bg")


def first_meta(meta: Mapping[str, Any], keys: Sequence[str]) -> Any:
    """First present, non-empty value among ``keys`` (or ``None``).

    Mirrors the dual-provenance lookup in ``xrd_csv._meta_get`` (accepts both
    quantized snake_case and MATLAB camelCase keys, plus a nested
    ``parser_specific`` / ``parserSpecific`` mapping).
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
                if val is None or (isinstance(val, str) and val == ""):
                    continue
                return val
    return None


def encode_padded_ascii(strings: Sequence[str]) -> NDArray[np.uint8]:
    """Encode ``strings`` as an ``[M, maxLen]`` space-padded ASCII uint8 matrix.

    One string per row, right-padded with ASCII space (0x20). An empty input
    becomes a single empty row (``[1, 1]`` of spaces), matching MATLAB's
    ``writeCellStrDataset`` (which substitutes ``{''}`` for an empty cell and a
    minimum column count of 1). Non-ASCII codepoints are replaced (``?``) so
    each character maps to exactly one byte, matching MATLAB ``uint8(char)``
    behaviour for ASCII labels.
    """
    rows = [str(s) for s in strings]
    if not rows:
        rows = [""]
    encoded = [r.encode("ascii", errors="replace") for r in rows]
    max_len = max((len(b) for b in encoded), default=1)
    max_len = max(max_len, 1)
    mat = np.full((len(encoded), max_len), ord(" "), dtype=np.uint8)
    for i, b in enumerate(encoded):
        if b:
            mat[i, : len(b)] = np.frombuffer(b, dtype=np.uint8)
    return mat


def _write_padded_ascii(
    group: h5py.Group,
    name: str,
    strings: Sequence[str],
    *,
    count_attr: bool = True,
) -> None:
    """Create a padded-ASCII dataset + ``encoding`` (and optional ``count``)."""
    mat = encode_padded_ascii(strings)
    dset = group.create_dataset(name, data=mat)
    dset.attrs["encoding"] = "ASCII_padded_space"
    if count_attr:
        dset.attrs["count"] = np.int32(len(strings) if strings else 1)


def write_data_group(parent: h5py.Group, group_path: str, d: DataStruct) -> None:
    """Write ``time``, ``values``, ``labels``, ``units`` (+attrs) under a group.

    ``group_path`` is relative to ``parent`` (e.g. ``"raw"`` or ``"corrected"``).
    quantized's ``DataStruct.time`` is always numeric float64 (datetime axes are
    converted to epoch seconds on import), so ``timeIsDatetime`` is always 0
    here — the datetime branch in MATLAB has no quantized analogue.
    """
    grp = parent.require_group(group_path)
    n = int(d.time.shape[0])
    m = int(d.values.shape[1])

    grp.create_dataset("time", data=d.time.astype(np.float64).reshape(n, 1))
    grp["time"].attrs["timeIsDatetime"] = np.uint8(0)

    grp.create_dataset("values", data=d.values.astype(np.float64).reshape(n, m))

    _write_padded_ascii(grp, "labels", list(d.labels))
    _write_padded_ascii(grp, "units", list(d.units))

    # nRows sentinel dataset (carries group attrs in the MATLAB original).
    grp.create_dataset("nRows", data=np.int32(n).reshape(1, 1))
    grp.attrs["nChannels"] = np.int32(m)
    grp.attrs["timeIsDatetime"] = np.uint8(0)


def write_corrections_group(
    parent: h5py.Group, corrections: Mapping[str, float]
) -> None:
    """Write the four correction scalars as ``[1,1]`` double datasets."""
    grp = parent.require_group("corrections")
    for field in CORRECTION_FIELDS:
        val = float(corrections.get(field, 0.0))
        grp.create_dataset(field, data=np.float64(val).reshape(1, 1))


def write_peaks_group(parent: h5py.Group, peaks: Sequence[Mapping[str, Any]]) -> None:
    """Write parallel peak datasets into ``/peaks/`` (mirrors MATLAB)."""
    grp = parent.require_group("peaks")
    p = len(peaks)
    grp.create_dataset("count", data=np.uint32(p).reshape(1, 1))

    for field in PEAK_NUMERIC_FIELDS:
        vec = np.array([_safe_num(pk.get(field)) for pk in peaks], dtype=np.float64)
        grp.create_dataset(field, data=vec.reshape(p, 1))

    x_lo = np.full(p, np.nan)
    x_hi = np.full(p, np.nan)
    for i, pk in enumerate(peaks):
        xr = pk.get("xRange", pk.get("x_range"))
        if xr is not None and len(xr) == 2:
            x_lo[i] = float(xr[0])
            x_hi[i] = float(xr[1])
    grp.create_dataset("xRange_lo", data=x_lo.reshape(p, 1))
    grp.create_dataset("xRange_hi", data=x_hi.reshape(p, 1))

    status = [_safe_str(pk.get("status"), "unknown") for pk in peaks]
    model = [_safe_str(pk.get("model"), "") for pk in peaks]
    _write_padded_ascii(grp, "status", status)
    _write_padded_ascii(grp, "model", model)


def write_metadata_group(parent: h5py.Group, meta: Mapping[str, Any]) -> None:
    """Write common ``/metadata`` attrs and the ``parserSpecific`` sub-group."""
    grp = parent.require_group("metadata")
    grp.create_dataset("schema_version", data=np.uint8(1).reshape(1, 1))

    for attr_name, keys in META_COMMON_KEYS:
        val = first_meta(meta, keys)
        grp.attrs[attr_name] = "" if val is None else str(val)

    # quantized time axis is always numeric.
    grp.attrs["timeIsDatetime"] = np.uint8(0)

    import_date = first_meta(meta, ("import_date", "importDate"))
    if import_date is not None:
        grp.attrs["importDate"] = str(import_date)

    parser_specific = _parser_specific(meta)
    if parser_specific is not None:
        ps = grp.require_group("parserSpecific")
        ps.create_dataset("schema_version", data=np.uint8(1).reshape(1, 1))
        write_struct_attrs(ps, parser_specific, "")


def write_struct_attrs(
    group: h5py.Group, mapping: Mapping[str, Any], prefix: str
) -> None:
    """Flatten ``mapping`` into HDF5 attributes (port of ``writeStructAttrs``).

    Scalars -> numeric attr; NaN -> ``"NaN"``; short numeric vectors -> array
    attr; str/bool/None handled; one level of nested-dict flattening with an
    ``<field>_`` prefix; lists of strings joined with ``|`` (+ ``__delim``);
    anything else records ``<name>__type``.
    """
    for field, val in mapping.items():
        attr_name = f"{prefix}{field}"
        if isinstance(val, bool):
            group.attrs[attr_name] = np.uint8(val)
        elif isinstance(val, (int, float, np.integer, np.floating)):
            fval = float(val)
            group.attrs[attr_name] = "NaN" if np.isnan(fval) else fval
        elif isinstance(val, str):
            group.attrs[attr_name] = val
        elif val is None:
            group.attrs[f"{attr_name}__type"] = "NoneType"
        elif isinstance(val, Mapping) and not prefix:
            write_struct_attrs(group, val, f"{field}_")
        elif _is_str_list(val):
            items = [str(x) for x in val]
            if 0 < len(items) <= 128:
                group.attrs[attr_name] = "|".join(items)
                group.attrs[f"{attr_name}__delim"] = "|"
            else:
                group.attrs[f"{attr_name}__type"] = "cell"
        elif _is_num_vector(val):
            arr = np.asarray(val, dtype=np.float64).ravel()
            if 1 < arr.size <= 64:
                group.attrs[attr_name] = arr
            else:
                group.attrs[f"{attr_name}__type"] = "double"
        else:
            group.attrs[f"{attr_name}__type"] = type(val).__name__


# ── small value helpers ─────────────────────────────────────────────────────


def _parser_specific(meta: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """Return the parserSpecific mapping.

    quantized parsers keep instrument-specific fields flat in ``metadata``
    (alongside the common keys) rather than nested. To mirror the MATLAB
    ``/metadata/parserSpecific`` group we take an explicit nested mapping when
    present, else the leftover flat keys (everything not a recognised common
    key).
    """
    for key in ("parser_specific", "parserSpecific"):
        nested = meta.get(key)
        if isinstance(nested, Mapping):
            return nested
    common = {k for _, keys in META_COMMON_KEYS for k in keys}
    common |= {"import_date", "importDate", "parser_specific", "parserSpecific"}
    leftover = {k: v for k, v in meta.items() if k not in common}
    return leftover or None


def _safe_num(val: Any) -> float:
    if val is None:
        return float("nan")
    try:
        if hasattr(val, "__len__") and not isinstance(val, str):
            return float(val[0]) if len(val) else float("nan")
        return float(val)
    except (TypeError, ValueError):
        return float("nan")


def _safe_str(val: Any, default: str) -> str:
    if val is None or (isinstance(val, str) and val == ""):
        return default
    return str(val)


def _is_str_list(val: Any) -> bool:
    return (
        isinstance(val, (list, tuple))
        and len(val) > 0
        and all(isinstance(x, str) for x in val)
    )


def _is_num_vector(val: Any) -> bool:
    if not isinstance(val, (list, tuple, np.ndarray)):
        return False
    try:
        arr = np.asarray(val, dtype=np.float64)
    except (TypeError, ValueError):
        return False
    return arr.ndim == 1 and arr.size > 0
