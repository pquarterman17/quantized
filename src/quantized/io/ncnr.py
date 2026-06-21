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

__all__ = ["import_ncnr_refl"]

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
