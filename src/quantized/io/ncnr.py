"""NCNR reductus reflectometry parser (.refl). Port of parser.importNCNRRefl.

Format: ``#``-prefixed JSON-ish header (name / polarization / wavelength /
columns / units) then whitespace-delimited numeric rows. time = Qz (column 0),
values = the remaining columns (Intensity, uncertainty, resolution). Rows with
any non-numeric token are dropped (matches MATLAB's any-NaN filter).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct

__all__ = ["import_ncnr_dat", "import_ncnr_pnr", "import_ncnr_refl"]

_HEADER_RE = re.compile(r'#\s*"([^"]+)":\s*(.+)$')


def _loads(text: str) -> Any:
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None


def import_ncnr_refl(filepath: str | Path) -> DataStruct:
    """Import an NCNR reductus ``.refl`` file (PBR or CANDOR)."""
    path = Path(filepath)
    lines = path.read_text(encoding="latin-1").splitlines()

    name = ""
    polarization = ""
    wavelength: list[float] = []
    columns: list[str] = []
    units: list[str] = []
    data_start = len(lines)

    for i, line in enumerate(lines):
        if not line.startswith("#"):
            data_start = i
            break
        match = _HEADER_RE.match(line)
        if match is None:
            continue
        key, valstr = match.group(1), match.group(2).strip()
        if key == "name":
            parsed = _loads(valstr)
            name = parsed if isinstance(parsed, str) else valstr.strip('"')
        elif key == "polarization":
            parsed = _loads(valstr)
            polarization = parsed if isinstance(parsed, str) else valstr.strip('"')
        elif key == "wavelength":
            parsed = _loads(valstr)
            if isinstance(parsed, list):
                wavelength = [float(x) for x in parsed]
            elif isinstance(parsed, (int, float)):
                wavelength = [float(parsed)]
        elif key == "columns":
            parsed = _loads(valstr)
            if isinstance(parsed, list):
                columns = [str(x) for x in parsed]
        elif key == "units":
            parsed = _loads(valstr)
            if isinstance(parsed, list):
                units = [str(x) for x in parsed]

    if not columns:
        raise ValueError(f"no 'columns' header found in {path.name}")

    rows: list[list[float]] = []
    for line in lines[data_start:]:
        text = line.strip()
        if not text:
            continue
        try:
            rows.append([float(t) for t in text.split()])
        except ValueError:
            continue  # any non-numeric token -> drop the row (MATLAB parity)
    if not rows:
        raise ValueError(f"no numeric data rows in {path.name}")
    matrix = np.asarray(rows, dtype=float)

    n_cols = len(columns)
    qz = matrix[:, 0]
    values = matrix[:, 1:n_cols]
    labels = columns[1:n_cols]
    out_units = [units[j] if j < len(units) else "" for j in range(1, n_cols)]

    instrument_type = "PBR (monochromatic)" if len(wavelength) == 1 else "CANDOR (polychromatic)"
    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_ncnr_refl",
        "x_column_name": "Qz",
        "x_column_unit": units[0] if units else "1/Ang",
        "name": name,
        "polarization": polarization,
        "instrument_type": instrument_type,
        "wavelengths": wavelength,
    }
    return DataStruct.create(qz, values, labels=labels, units=out_units, metadata=metadata)


# ── Polarized .pnr (tab-delimited, 2 header rows) ────────────────────────────
_POL_REPLACEMENTS = (
    ("++", "pp"), ("+-", "pm"), ("-+", "mp"), ("--", "mm"), ("+/-", "pm"), ("-/+", "mp"),
)


def _clean_polarization(label: str) -> str:
    for old, new in _POL_REPLACEMENTS:
        label = label.replace(old, new)
    return label


def import_ncnr_pnr(filepath: str | Path) -> DataStruct:
    """Import an NCNR polarized neutron reflectometry ``.pnr`` (tab-delimited)."""
    path = Path(filepath)
    lines = path.read_text(encoding="latin-1").splitlines()
    if len(lines) < 3:
        raise ValueError(f"{path.name}: too few lines for a .pnr file")
    col_names = lines[0].strip().split("\t")
    units = lines[1].strip().split("\t")
    n_cols = len(col_names)

    rows: list[list[float]] = []
    for raw in lines[2:]:
        stripped = raw.strip()
        if not stripped:
            continue
        tokens = stripped.split("\t")
        if len(tokens) < n_cols:
            continue
        try:
            rows.append([float(t) for t in tokens[:n_cols]])
        except ValueError:
            continue
    if not rows:
        raise ValueError(f"no numeric data in {path.name}")
    matrix = np.asarray(rows, dtype=float)

    labels = [_clean_polarization(c) for c in col_names[1:]]
    out_units = [units[j] if j < len(units) else "" for j in range(1, n_cols)]

    lowered = " ".join(col_names).lower()
    is_nsf = "r++" in lowered or "r--" in lowered
    is_sf = "r+-" in lowered or "r-+" in lowered or "r+/-" in lowered
    if is_nsf and is_sf:
        variant = "combined"
    elif is_nsf:
        variant = "NSF"
    elif is_sf:
        variant = "SF"
    else:
        variant = "unknown"

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_ncnr_pnr",
        "x_column_name": "Q",
        "x_column_unit": units[0] if units else "1/Ang",
        "variant": variant,
    }
    return DataStruct.create(
        matrix[:, 0], matrix[:, 1:], labels=labels, units=out_units, metadata=metadata
    )


# ── refl1d-fit cross sections (.datA/.datB/.datC/.datD) ──────────────────────
_NCNR_POL_BY_EXT = {".datA": "++", ".datB": "+-", ".datC": "-+", ".datD": "--"}
_NCNR_DAT_LABELS = ["dQ", "R", "dR", "theory", "fresnel"]
_NCNR_DAT_UNITS = ["1/A", "", "", "", ""]


def _safe_float(text: str) -> float:
    try:
        return float(text.strip())
    except ValueError:
        return float("nan")


def import_ncnr_dat(filepath: str | Path) -> DataStruct:
    """Import an NCNR refl1d-fit cross section (.datA/.datB/.datC/.datD)."""
    path = Path(filepath)
    pol = next(
        (v for k, v in _NCNR_POL_BY_EXT.items() if k.lower() == path.suffix.lower()), None
    )
    if pol is None:
        raise ValueError(f"{path.name}: expected extension .datA/.datB/.datC/.datD")
    lines = path.read_text(encoding="latin-1").splitlines()

    intensity = float("nan")
    background = float("nan")
    data_start = 0
    for i, line in enumerate(lines[:5]):
        if line.startswith("# intensity:"):
            intensity = _safe_float(line.split(":", 1)[1])
        elif line.startswith("# background:"):
            background = _safe_float(line.split(":", 1)[1])
        elif line.startswith("#") and "Q (1/A)" in line:
            data_start = i + 1
            break
        elif not line.startswith("#"):
            data_start = i
            break

    rows: list[list[float]] = []
    for line in lines[data_start:]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        try:
            rows.append([float(t) for t in stripped.split()])
        except ValueError:
            continue
    if not rows:
        raise ValueError(f"no numeric data in {path.name}")
    width = len(rows[0])
    matrix = np.asarray([r for r in rows if len(r) == width], dtype=float)

    n_val = matrix.shape[1] - 1
    labels: list[str] = []
    units: list[str] = []
    for j in range(n_val):
        labels.append(_NCNR_DAT_LABELS[j] if j < len(_NCNR_DAT_LABELS) else f"col{j + 1}")
        units.append(_NCNR_DAT_UNITS[j] if j < len(_NCNR_DAT_UNITS) else "")

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_ncnr_dat",
        "x_column_name": "Q",
        "x_column_unit": "1/Ang",
        "polarization": pol,
    }
    if not np.isnan(intensity):
        metadata["intensity"] = intensity
    if not np.isnan(background):
        metadata["background"] = background
    return DataStruct.create(
        matrix[:, 0], matrix[:, 1:], labels=labels, units=units, metadata=metadata
    )
