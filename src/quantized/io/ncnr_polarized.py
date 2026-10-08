"""NCNR polarized reflectometry parsers: ``.pnr`` and refl1d-fit cross sections.

Split out of :mod:`quantized.io.ncnr` (which re-exports both) to keep each
module under the line ceiling. Ports of MATLAB ``parser.importNCNRPNR`` and
``parser.importNCNRDat``. Plotting roles come from
:mod:`quantized.io._refl_columns`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io._delimited_layout import _to_float
from quantized.io._fortran_float import parse_float
from quantized.io._refl_columns import (
    angstrom_unit,
    pnr_role_metadata,
    refl_fit_role_metadata,
)
from quantized.io._row_width import conform_rows, modal_width
from quantized.io.base import read_text

__all__ = ["import_ncnr_dat", "import_ncnr_pnr"]


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
    lines = read_text(path).splitlines()
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
            rows.append([parse_float(t) for t in tokens[:n_cols]])
        except ValueError:
            continue
    if not rows:
        raise ValueError(f"no numeric data in {path.name}")
    matrix = np.asarray(rows, dtype=float)

    labels = [_clean_polarization(c) for c in col_names[1:]]
    header_units = [units[j] if j < len(units) else "" for j in range(n_cols)]
    out_units = [angstrom_unit(u) for u in header_units[1:]]

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
        "x_column_unit": angstrom_unit(units[0] if units else "1/Ang"),
        "header_units": header_units,  # the file's ASCII; the units spell Å
        "variant": variant,
        "probe": "neutron",  # spin states: polarized neutrons only
    }
    # Plot hints: R and theory per spin state, dR/dSA as error bars, dQ as the
    # x resolution. dQ, the dR columns and the signed spin asymmetry used to
    # open as curves on the log-R axis.
    metadata.update(pnr_role_metadata(labels, out_units, metadata["x_column_unit"]))
    return DataStruct.create(
        matrix[:, 0], matrix[:, 1:], labels=labels, units=out_units, metadata=metadata
    )


# ── refl1d-fit cross sections (.datA/.datB/.datC/.datD) ──────────────────────
_NCNR_POL_BY_EXT = {".datA": "++", ".datB": "+-", ".datC": "-+", ".datD": "--"}
_NCNR_DAT_LABELS = ["dQ", "R", "dR", "theory", "fresnel"]
_NCNR_DAT_UNITS = ["1/A", "", "", "", ""]


def import_ncnr_dat(filepath: str | Path) -> DataStruct:
    """Import an NCNR refl1d-fit cross section (.datA/.datB/.datC/.datD)."""
    path = Path(filepath)
    pol = next(
        (v for k, v in _NCNR_POL_BY_EXT.items() if k.lower() == path.suffix.lower()), None
    )
    if pol is None:
        raise ValueError(f"{path.name}: expected extension .datA/.datB/.datC/.datD")
    lines = read_text(path).splitlines()

    intensity = float("nan")
    background = float("nan")
    data_start = 0
    # Scan the whole comment header (not just the first 5 lines) so intensity /
    # background metadata is captured wherever it sits; the loop still breaks at
    # the column header or first data row.
    for i, line in enumerate(lines):
        if line.startswith("# intensity:"):
            intensity = _to_float(line.split(":", 1)[1])
        elif line.startswith("# background:"):
            background = _to_float(line.split(":", 1)[1])
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
            rows.append([parse_float(t) for t in stripped.split()])
        except ValueError:
            continue
    if not rows:
        raise ValueError(f"no numeric data in {path.name}")
    # The modal width, not row 0's: a truncated first row used to set the
    # width and so discard every full row after it.
    matrix, row_meta = conform_rows(rows, modal_width(rows), truncate_wide=False)

    n_val = matrix.shape[1] - 1
    labels: list[str] = []
    units: list[str] = []
    for j in range(n_val):
        labels.append(_NCNR_DAT_LABELS[j] if j < len(_NCNR_DAT_LABELS) else f"col{j + 1}")
        units.append(_NCNR_DAT_UNITS[j] if j < len(_NCNR_DAT_UNITS) else "")
    header_units = ["1/Ang", *units]  # the "Q (1/A)" header's ASCII spelling
    units = [angstrom_unit(u) for u in units]

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_ncnr_dat",
        "x_column_name": "Q",
        "x_column_unit": angstrom_unit("1/Ang"),
        "header_units": header_units,
        "polarization": pol,
        "probe": "neutron",  # spin cross sections: polarized neutrons only
        **row_meta,
    }
    if not np.isnan(intensity):
        metadata["intensity"] = intensity
    if not np.isnan(background):
        metadata["background"] = background
    # Plot hints (honoured by the frontend defaults): show the measured
    # reflectivity R and the fit line 'theory', with dR as R's error bars and
    # dQ as the x resolution; 'fresnel' stays off the plot (still toggleable).
    metadata.update(refl_fit_role_metadata(labels))
    return DataStruct.create(
        matrix[:, 0], matrix[:, 1:], labels=labels, units=units, metadata=metadata
    )
