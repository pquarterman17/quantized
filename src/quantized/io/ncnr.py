"""NCNR reductus reflectometry parser (.refl). Port of parser.importNCNRRefl.

Format: ``#``-prefixed JSON-ish header (name / polarization / wavelength /
columns / units) then whitespace-delimited numeric rows. time = Qz (column 0),
values = the remaining columns (Intensity, uncertainty, resolution). Rows with
any non-numeric token are dropped (matches MATLAB's any-NaN filter). A file with
one header block per spin state keeps each state as its own series
(:mod:`quantized.io._ncnr_blocks`). The ``.pnr``/``.datA-D`` parsers live in
:mod:`quantized.io.ncnr_polarized` and are re-exported here.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io._ncnr_blocks import RawBlock, combine_blocks, split_blocks
from quantized.io._row_width import conform_rows
from quantized.io.base import read_text

__all__ = ["import_ncnr_dat", "import_ncnr_pnr", "import_ncnr_refl", "is_ncnr_refl"]

_HEADER_RE = re.compile(r'#\s*"([^"]+)":\s*(.+)$')


def is_ncnr_refl(path: str | Path) -> bool:
    """Sniff a ``.refl`` as NCNR reductus output: its ``#``-comment header carries
    a JSON ``"columns": [...]`` line. A refl1d-exported ``.refl`` instead uses a
    plain ``Q (1/A) R dR`` column line, so it won't match — letting the registry
    route it to the refl1d parser. Scans the header line-by-line (the reductus
    ``"template_data"`` line alone can exceed several KB, so a fixed byte slice
    would miss the later ``"columns"`` key) and stops at the first data row."""
    with Path(path).open(encoding="utf-8-sig", errors="replace") as fh:
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



def _block_matrix(block: RawBlock, name: str) -> tuple[np.ndarray, dict[str, Any]]:
    """One block's numeric rows, conformed to its ``columns`` width."""
    rows: list[list[float]] = []
    for line in block.data_lines:
        text = line.strip()
        if not text:
            continue
        try:
            rows.append([float(t) for t in text.split()])
        except ValueError:
            continue  # any non-numeric token -> drop the row (MATLAB parity)
    if not rows:
        raise ValueError(f"no numeric data rows in {name}")
    n_cols = len(block.columns)
    # A cut-off last line used to crash np.asarray ("inhomogeneous shape"),
    # and values past the declared columns were dropped without a word.
    matrix, row_meta = conform_rows(rows, n_cols, truncate_wide=True)
    if matrix.shape[0] == 0:
        raise ValueError(
            f"{name}: every data row has fewer values than the "
            f"{n_cols}-column 'columns' header"
        )
    return matrix, row_meta


def _merge_row_meta(metas: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    dropped = sum(int(m.get("dropped_rows", 0)) for m in metas)
    notes = [n for m in metas for n in m.get("notes", [])]
    if dropped:
        out["dropped_rows"] = dropped
    if notes:
        out["notes"] = notes
    return out


def import_ncnr_refl(filepath: str | Path) -> DataStruct:
    """Import an NCNR reductus ``.refl`` file (PBR or CANDOR).

    A file with several header blocks (one per spin state of a polarized
    measurement) keeps each block as its own series -- see
    :mod:`quantized.io._ncnr_blocks`."""
    path = Path(filepath)
    blocks = split_blocks(read_text(path).splitlines())
    if not blocks:
        raise ValueError(f"no 'columns' header found in {path.name}")
    parts = [_block_matrix(b, path.name) for b in blocks]
    first = blocks[0]
    x_unit = first.units[0] if first.units and first.units[0] else "1/Ang"

    if len(blocks) == 1:
        matrix = parts[0][0]
        n_cols = len(first.columns)
        qz, values = matrix[:, 0], matrix[:, 1:n_cols]
        labels = first.columns[1:n_cols]
        out_units = [first.units[j] if j < len(first.units) else "" for j in range(1, n_cols)]
        polarization: str | list[str] = first.polarization
    else:
        qz, values, labels, out_units = combine_blocks(blocks, [p[0] for p in parts], x_unit)
        polarization = [b.polarization for b in blocks]

    wavelength = first.wavelength
    instrument_type = "PBR (monochromatic)" if len(wavelength) == 1 else "CANDOR (polychromatic)"
    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_ncnr_refl",
        "x_column_name": "Qz",
        "x_column_unit": x_unit,
        "name": first.name,
        "polarization": polarization,
        "instrument_type": instrument_type,
        "wavelengths": wavelength,
    }
    if len(blocks) > 1:
        metadata["entries"] = [b.entry for b in blocks]
        bounds = [int(b) for b in np.cumsum([0] + [p[0].shape[0] for p in parts])]
        metadata["block_rows"] = [[bounds[k], bounds[k + 1]] for k in range(len(blocks))]
    metadata.update(_refl_role_metadata(labels, out_units, x_unit))
    metadata.update(_merge_row_meta([p[1] for p in parts]))
    return DataStruct.create(qz, values, labels=labels, units=out_units, metadata=metadata)


# The polarized parsers live in their own module (line ceiling); re-exported
# here so `quantized.io.ncnr` stays the one import site for every NCNR format.
from quantized.io.ncnr_polarized import import_ncnr_dat, import_ncnr_pnr  # noqa: E402
