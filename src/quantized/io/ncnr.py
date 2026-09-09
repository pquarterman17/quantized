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
# nothing for that column and the import behaves exactly as it did before.
#
# Real reductus variants do not all carry the same three columns: some
# instruments omit the resolution column, some omit uncertainty, and some
# append further value columns (a monitor count, a second detector, ...)
# after the canonical triple. Recognition is therefore PER-COLUMN, not an
# all-or-nothing match on a fixed 3-column shape: each candidate uncertainty
# or resolution column is bound (or left alone) purely on its OWN evidence,
# so a deviation elsewhere in the file never suppresses a binding that IS
# unambiguous -- see `_measured_channel_for_uncertainty` and
# `_resolves_to_x_axis`. A channel's index is whatever it actually is; it is
# never reassigned or shifted to fit an assumed measured/uncertainty/
# resolution position.
_UNCERTAINTY_TOKENS = frozenset({"uncertainty", "error", "sigma", "dr", "di"})
_RESOLUTION_TOKENS = frozenset({"resolution", "dq"})


def _norm_label(label: str) -> str:
    return "".join(ch for ch in label.lower() if ch.isalnum())


def _identified_role(labels: Sequence[str], i: int) -> str | None:
    """Which role channel ``i``'s OWN label spells ("uncertainty"/"resolution"),
    or ``None``. A channel is only ever a role CANDIDATE by its own spelling --
    never inferred from a neighbour's label."""
    norm = _norm_label(labels[i])
    if norm in _UNCERTAINTY_TOKENS:
        return "uncertainty"
    if norm in _RESOLUTION_TOKENS:
        return "resolution"
    return None


def _measured_channel_for_uncertainty(
    labels: Sequence[str], value_units: Sequence[str], i: int
) -> int | None:
    """The channel an uncertainty candidate at index ``i`` describes, or
    ``None`` if the pairing is not unambiguous.

    Reductus places an uncertainty column immediately AFTER the value it
    describes -- the same "nearest preceding value column" convention Origin's
    own Y-error designation and the generic label guesser
    (`lib/errorRoles.ts::inferErrorBindingsFromLabels`) already rely on.
    Binding to that one specific neighbour -- never scanning further back,
    and never binding when the neighbour is itself an uncertainty/resolution
    column -- is what keeps this safe under an omitted or reordered column: an
    ambiguous or absent predecessor means no binding, not a guess at a more
    distant one.

    Units must AGREE, and two blank units agree. That is deliberately unlike
    `_resolves_to_x_axis` below, which rejects a blank unit outright, and the
    asymmetry is the point: this pairing already has two independent pieces of
    evidence -- the channel's own name spells "uncertainty", and it sits
    immediately after a column that is NOT itself an error column -- so the
    unit is corroboration. The x-axis pairing has neither (its target is an
    axis, not a neighbour), so there the unit is the only evidence and has to
    be real.

    Requiring a NON-blank unit here was a bug, found in review: reflectivity
    is dimensionless, so a perfectly ordinary reductus `R`/`dR` file carries
    blank units and got no binding at all -- which is precisely the BUG-001
    symptom (`dR` drawn as its own curve) that this metadata exists to fix.
    """
    if i == 0:
        return None
    j = i - 1
    if _identified_role(labels, j) is not None:
        return None  # the immediate neighbour is itself an error column
    if value_units[i] != value_units[j]:
        return None  # disagreeing units mean this is not that value's uncertainty
    return j


def _resolves_to_x_axis(value_units: Sequence[str], x_unit: str, i: int) -> bool:
    """Does a resolution candidate at index ``i`` carry the x axis's own unit?
    A blank unit is not evidence of anything (an empty string trivially equals
    another empty string, which must not read as agreement)."""
    unit = value_units[i]
    return bool(unit) and unit == x_unit


def _refl_role_metadata(
    labels: Sequence[str], value_units: Sequence[str], x_unit: str
) -> dict[str, Any]:
    """Declared plotting roles for a reductus-style layout, or ``{}``.

    ``labels``/``value_units`` describe the VALUE channels only (x excluded),
    so the indices returned are channel indices, matching what
    ``Dataset.errorRoles`` and ``default_value_channels`` both use. A binding
    that targets the x axis uses ``target: -1`` -- the x axis is not a channel.

    Every value channel that is not identified as an uncertainty/resolution
    binding stays in ``default_value_channels`` -- an unrecognised extra
    column is plotted like any other data, not hidden and not guessed at.
    Returns ``{}`` (no declared roles at all) only when NOTHING in the layout
    is identifiable; a layout with even one unambiguous binding returns that
    binding, never an all-or-nothing rejection of the whole file.
    """
    if not labels or len(labels) != len(value_units):
        return {}

    error_roles: list[dict[str, Any]] = []
    error_channels: dict[int, int] = {}
    bound: set[int] = set()  # channels already claimed as an uncertainty/resolution role

    for i, _label in enumerate(labels):
        role = _identified_role(labels, i)
        if role == "uncertainty":
            target = _measured_channel_for_uncertainty(labels, value_units, i)
            if target is None:
                continue
            error_roles.append({"channel": i, "target": target, "axis": "y", "side": "both"})
            error_channels[target] = i
            bound.add(i)
        elif role == "resolution":
            if not _resolves_to_x_axis(value_units, x_unit, i):
                continue
            error_roles.append({"channel": i, "target": -1, "axis": "x", "side": "both"})
            bound.add(i)

    if not error_roles:
        return {}

    # Only the MEASUREMENTS are curves. When any uncertainty bound to a value,
    # those values are what the file is a measurement OF, and they alone are
    # plotted -- BUG-001's acceptance criterion is that a recognised file opens
    # with "only its measured reflectivity/intensity curve selected".
    #
    # This deliberately does NOT plot a leftover column we declined to reason
    # about (a monitor, a Lambda, a "resolution" whose unit disagreed). Found in
    # review: a non-empty hint short-circuits `defaultDenseChannels`' NaN-density
    # heuristic (`lib/plotdata.ts`), so listing such a column here PINS it as a
    # curve where the heuristic used to hide it -- turning an honest "I don't
    # know what this is" into a confident plotting decision. It stays in the
    # worksheet and stays toggleable; it just is not a default curve.
    #
    # With no Y binding at all (a resolution-only match) there is no
    # "measurement" to name, so every unbound channel is offered instead --
    # that case has no better signal to go on.
    measured = sorted({int(b["target"]) for b in error_roles if b["target"] >= 0})
    default_value_channels = measured or [i for i in range(len(labels)) if i not in bound]
    if not default_value_channels:
        # Every channel bound as an error role and nothing left to plot --
        # should not happen for a real file, but fail closed rather than emit
        # a default that would blank the plot outright.
        return {}

    meta: dict[str, Any] = {
        "default_value_channels": default_value_channels,
        # The rich contract (`lib/errorRoles.ts`'s ErrorBinding).
        "error_roles": error_roles,
    }
    if error_channels:
        # The legacy Y-only projection (`lib/errorbars.defaultErrKeys`), kept
        # so vertical whiskers appear on every surface that still reads it --
        # including the multi-panel stage, which does not render X error.
        # Omitted (not an empty dict) when there is no Y binding at all, e.g.
        # a resolution-only match, matching `import_ncnr_dat`'s own convention
        # of only adding this key when it has something to say.
        meta["error_channels"] = error_channels
    return meta


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
