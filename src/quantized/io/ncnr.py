"""NCNR reductus reflectometry parser (.refl). Port of parser.importNCNRRefl.

Format: ``#``-prefixed JSON-ish header (name / polarization / wavelength /
columns / units) then whitespace-delimited numeric rows. time = Qz (column 0),
values = the remaining columns (Intensity, uncertainty, resolution). Rows with
any non-numeric token are dropped (matches MATLAB's any-NaN filter).
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io._delimited_layout import _to_float

__all__ = ["import_ncnr_dat", "import_ncnr_pnr", "import_ncnr_refl", "is_ncnr_refl"]

_HEADER_RE = re.compile(r'#\s*"([^"]+)":\s*(.+)$')


def _loads(text: str) -> Any:
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None


def is_ncnr_refl(path: str | Path) -> bool:
    """Sniff a ``.refl`` as NCNR reductus output: its ``#``-comment header carries
    a JSON ``"columns": [...]`` line. A refl1d-exported ``.refl`` instead uses a
    plain ``Q (1/A) R dR`` column line, so it won't match — letting the registry
    route it to the refl1d parser. Scans the header line-by-line (the reductus
    ``"template_data"`` line alone can exceed several KB, so a fixed byte slice
    would miss the later ``"columns"`` key) and stops at the first data row."""
    with Path(path).open(encoding="latin-1", errors="replace") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            if not line.startswith("#"):
                break  # header ended without a "columns" key
            match = _HEADER_RE.match(line)
            if match is not None and match.group(1) == "columns":
                return True
    return False


# ── Reductus uncertainty-role semantics (BUGS_AND_ISSUES BUG-001) ────────────
# A reductus `.refl` carries its measured intensity, that intensity's
# uncertainty, and the Q resolution as three ordinary numeric columns. Nothing
# in the file marks the latter two as uncertainties, so before this they were
# imported as independent Y series and drawn as their own curves: a
# plausible-looking figure in which two of the three "measurements" are error
# estimates. The generic label guesser does not rescue it either --
# `classifyErrorLabelInLabels(["Intensity","uncertainty","resolution"])`
# returns no binding for any column (measured 2026-09-09), so the roles have to
# come from the parser, which is the only layer that knows the format.
#
# Recognition is deliberately EVIDENCE-GATED on name AND unit, never on name
# alone: the uncertainty of an intensity carries the intensity's unit, and a Q
# resolution carries the Q axis's unit. A file whose names match but whose
# units disagree is a variant this function does not understand, so it emits
# nothing and the import behaves exactly as it did before. Same for anything
# other than the canonical measured/uncertainty/resolution triple -- an extra
# value column, a missing one, or a second uncertainty candidate all fall back
# to "no declared roles" rather than guessing.
_UNCERTAINTY_TOKENS = frozenset({"uncertainty", "error", "sigma", "dr", "di"})
_RESOLUTION_TOKENS = frozenset({"resolution", "dq"})


def _norm_label(label: str) -> str:
    return "".join(ch for ch in label.lower() if ch.isalnum())


def _refl_role_metadata(
    labels: Sequence[str], value_units: Sequence[str], x_unit: str
) -> dict[str, Any]:
    """Declared plotting roles for the canonical reductus triple, or ``{}``.

    ``labels``/``value_units`` describe the VALUE channels only (x excluded),
    so the indices returned are channel indices, matching what
    ``Dataset.errorRoles`` and ``default_value_channels`` both use. A binding
    that targets the x axis uses ``target: -1`` -- the x axis is not a channel.
    """
    if len(labels) != 3 or len(value_units) != 3:
        return {}
    measured, unc, res = 0, 1, 2
    if _norm_label(labels[unc]) not in _UNCERTAINTY_TOKENS:
        return {}
    if _norm_label(labels[res]) not in _RESOLUTION_TOKENS:
        return {}
    # The measured column must not itself look like an uncertainty, or a
    # reordered/short variant could bind an error to another error.
    if _norm_label(labels[measured]) in _UNCERTAINTY_TOKENS | _RESOLUTION_TOKENS:
        return {}
    # Unit agreement is the actual evidence that these are the roles claimed.
    if not value_units[unc] or value_units[unc] != value_units[measured]:
        return {}
    if not value_units[res] or value_units[res] != x_unit:
        return {}
    return {
        # Only the measurement is a curve; the two uncertainties stay in the
        # worksheet and stay toggleable, but are not series of their own.
        "default_value_channels": [measured],
        # The rich contract (`lib/errorRoles.ts`'s ErrorBinding): symmetric Y
        # error on the measurement, symmetric X error on the Q axis.
        "error_roles": [
            {"channel": unc, "target": measured, "axis": "y", "side": "both"},
            {"channel": res, "target": -1, "axis": "x", "side": "both"},
        ],
        # The legacy Y-only projection (`lib/errorbars.defaultErrKeys`), kept
        # so vertical whiskers appear on every surface that still reads it --
        # including the multi-panel stage, which does not render X error.
        "error_channels": {measured: unc},
    }


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
    metadata.update(_refl_role_metadata(labels, out_units, metadata["x_column_unit"]))
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
    # Plot hints (honoured by the frontend defaults): show the measured
    # reflectivity R and the fit line 'theory' by default, with dR as R's error
    # bars; the resolution 'dQ' and normalisation 'fresnel' columns stay off the
    # plot by default (still toggleable in the Channels card). Keyed by value-
    # column index (0-based, x/Q excluded).
    label_idx = {lab: j for j, lab in enumerate(labels)}
    default_channels = [label_idx[name] for name in ("R", "theory") if name in label_idx]
    if default_channels:
        metadata["default_value_channels"] = default_channels
    if "R" in label_idx and "dR" in label_idx:
        metadata["error_channels"] = {label_idx["R"]: label_idx["dR"]}
    return DataStruct.create(
        matrix[:, 0], matrix[:, 1:], labels=labels, units=units, metadata=metadata
    )
