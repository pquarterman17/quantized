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
# Column-header signals, matched on word boundaries so a prose comment like
# "rhodium thermometer" or "quick readout" no longer false-positives (the bare
# substrings "rho"/"q"+"r" did — mis-routing PPMS files into this parser).
_RHO_RE = re.compile(r"\brho\b")
_Z_COL_RE = re.compile(r"\bz\s*\(")
_Q_COL_RE = re.compile(r"\bq\b")
_R_COL_RE = re.compile(r"\br\b")


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
        if (
            _RHO_RE.search(low)
            or _Z_COL_RE.search(low)
            or (_Q_COL_RE.search(low) and _R_COL_RE.search(low))
        ):
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
    # Pad/truncate ragged rows to the column count (header if known, else the
    # widest row), filling gaps with NaN — mirrors MATLAB textscan, which yields
    # NaN for missing fields rather than failing on a truncated/disk-cut file.
    target = len(labels_all) if labels_all else max(len(r) for r in rows)
    if any(len(r) != target for r in rows):
        rows = [(r + [float("nan")] * (target - len(r)))[:target] for r in rows]
    matrix = np.asarray(rows, dtype=float)
    n_cols = matrix.shape[1]
    if n_cols < 2:
        raise ValueError(
            f"refl1d .dat needs at least 2 columns (found {n_cols}) in {path.name}"
        )

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
