"""refl1d output ``.dat`` parser (profile / refl / slabs / steps).

Port of MATLAB parser.importRefl1dDat. ``#``-prefixed header with optional
``key: value`` metadata lines and one column-name line ("z (A) rho (1e-6/A2)
..."); first column -> time, the rest -> values.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct

__all__ = ["import_refl1d_dat", "is_refl1d_dat"]

_KV_RE = re.compile(r"^(\w[\w\s]*\w|\w+):\s*(.+)$")
_TOKEN_RE = re.compile(r"\S+(?:\s*\([^)]*\))?")
_UNIT_RE = re.compile(r"^(.+?)\s*\(([^)]+)\)$")


def is_refl1d_dat(path: Path) -> bool:
    """Sniff a ``.dat`` as refl1d output: a ``#``-comment column header naming a
    profile (``z``/``rho``) or reflectivity (``Q``/``R``) axis, and not a QD
    ``[Header]`` file. The column header may follow other ``#`` metadata lines
    (e.g. ``# intensity:`` / ``# background:`` in refl-fit exports), so scan every
    comment line rather than only the first non-empty one."""
    head = Path(path).read_text(encoding="latin-1", errors="replace")[:512]
    if "[header]" in head.lower():
        return False
    for line in head.splitlines():
        stripped = line.strip()
        if not stripped.startswith("#"):
            continue
        low = stripped.lower()
        if "rho" in low or "z (" in low or ("q" in low and "r" in low):
            return True
    return False


def import_refl1d_dat(filepath: str | Path) -> DataStruct:
    path = Path(filepath)
    lines = path.read_text(encoding="latin-1").splitlines()

    header_meta: dict[str, Any] = {}
    column_line = ""
    data_start = len(lines)
    for i, raw in enumerate(lines):
        stripped = raw.strip()
        if not stripped.startswith("#"):
            data_start = i
            break
        content = stripped[1:].strip()
        if not content:
            continue
        kv = _KV_RE.match(content)
        if kv:
            key, val = kv.group(1), kv.group(2)
            try:
                header_meta[key] = float(val)
            except ValueError:
                header_meta[key] = val
        else:
            column_line = content

    labels_all: list[str] = []
    units_all: list[str] = []
    for tok in _TOKEN_RE.findall(column_line):
        unit_match = _UNIT_RE.match(tok.strip())
        if unit_match:
            labels_all.append(unit_match.group(1).strip())
            units_all.append(unit_match.group(2).strip())
        else:
            labels_all.append(tok.strip())
            units_all.append("")

    rows: list[list[float]] = []
    for raw in lines[data_start:]:
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        try:
            rows.append([float(t) for t in stripped.split()])
        except ValueError:
            continue
    if not rows:
        raise ValueError(f"no numeric data in {path.name}")
    matrix = np.asarray(rows, dtype=float)
    n_cols = matrix.shape[1]

    if not labels_all:
        labels_all = [f"Col{j + 1}" for j in range(n_cols)]
        units_all = [""] * n_cols

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_refl1d_dat",
        "x_column_name": labels_all[0],
        "x_column_unit": units_all[0],
        **header_meta,
    }
    return DataStruct.create(
        matrix[:, 0],
        matrix[:, 1:],
        labels=labels_all[1:n_cols],
        units=units_all[1:n_cols],
        metadata=metadata,
    )
