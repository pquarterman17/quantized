"""ORSO ``.ort`` reduced reflectometry (standards 0.1 and 1.0).

An ``.ort`` file is a YAML header inside ``#`` comments, then whitespace-
delimited columns. The first line names the format::

    # # ORSO reflectivity data file | 1.0 standard | YAML encoding | https://www.reflectometry.org/

and a file without it is refused, whatever its extension (the corpus's
negative fixture is bare numbers named ``.ort``). The header's ``columns`` list
declares each column: ``{name: Qz, unit: 1/angstrom}`` (``1/nm`` is allowed
too), ``{name: R}``, then error columns ``{error_of: R}`` (``sR``, the y error)
and ``{error_of: Qz, error_type: resolution}`` (``sQz``, the x error). An error
column inherits its target's unit, and its name is ``s<target>`` unless given.

Several data sets (spin states, temperatures) follow one another, each opened
by a ``# data_set: <id>`` line after the first and carrying only the header
keys that differ from the first data set (merged as orsopy does). As in
:mod:`quantized.io._ncnr_blocks`, rows stay in file order, each data set gets
its own channels (``"R pp"``, ``"sR pp"``), NaN outside its rows, and a Q
resolution that every data set carries becomes one shared ``sQz`` channel.

The header is read with :mod:`quantized.io._orso_yaml` (stdlib only; PyYAML is
not a direct dependency). Pure ``io`` layer.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io._orso_yaml import load_header, merge
from quantized.io._row_width import conform_rows
from quantized.io.base import read_text

__all__ = ["import_orso"]

_MAGIC_RE = re.compile(
    r"^#\s*#\s*ORSO reflectivity data file\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s+standard", re.I
)
# Display units for the two Q units the standard allows; anything else as written.
_UNITS = {"1/angstrom": "Å⁻¹", "1/nm": "nm⁻¹", "angstrom": "Å"}


@dataclass
class _Block:
    header_lines: list[str] = field(default_factory=list)
    data_lines: list[str] = field(default_factory=list)
    header: dict[str, Any] = field(default_factory=dict)


def _version(first_line: str) -> str | None:
    match = _MAGIC_RE.match(first_line.strip())
    return match.group(1) if match else None


def _split_blocks(lines: Sequence[str]) -> list[_Block]:
    """One block per data set: a ``# data_set`` line after the first opens a
    new one (orsopy's reader rule)."""
    blocks = [_Block()]
    seen_data_set = False
    for line in lines:
        if not line.startswith("#"):
            if line.strip():
                blocks[-1].data_lines.append(line)
            continue
        if line.startswith("# data_set") or line.startswith("#data_set"):
            if seen_data_set:
                blocks.append(_Block())
            seen_data_set = True
        blocks[-1].header_lines.append(line[1:])
    return blocks


def _get(tree: Any, *keys: str) -> Any:
    for key in keys:
        if not isinstance(tree, dict):
            return None
        tree = tree.get(key)
    return tree


def _text(value: Any) -> str:
    if value is None or isinstance(value, (dict, list)):
        return ""
    return str(value).strip()


def _unit(value: Any) -> str:
    text = _text(value)
    return _UNITS.get(text, text)


def _column_specs(columns: Any, name: str) -> list[dict[str, Any]]:
    """The validated ``columns`` list: dicts, first one ``Qz``."""
    if not isinstance(columns, list) or not columns:
        raise ValueError(f"{name}: ORSO header has no 'columns' list")
    specs = [c if isinstance(c, dict) else {"name": _text(c)} for c in columns]
    if _text(specs[0].get("name")) != "Qz":
        raise ValueError(
            f"{name}: the first ORSO column must be Qz (found {specs[0].get('name')!r})"
        )
    if len(specs) < 2:
        raise ValueError(f"{name}: ORSO 'columns' declares no value column after Qz")
    return specs


def _labels_units(specs: Sequence[dict[str, Any]]) -> tuple[list[str], list[str]]:
    labels: list[str] = []
    for j, spec in enumerate(specs):
        target = _text(spec.get("error_of"))
        labels.append(_text(spec.get("name")) or (f"s{target}" if target else f"Col{j + 1}"))
    by_name = {lab: j for j, lab in enumerate(labels)}
    units: list[str] = []
    for spec in specs:
        target = _text(spec.get("error_of"))
        source = specs[by_name[target]] if target in by_name else spec
        units.append(_unit(source.get("unit")))
    return labels, units


def _matrix(block: _Block, width: int, name: str) -> tuple[np.ndarray, dict[str, Any]]:
    rows: list[list[float]] = []
    for line in block.data_lines:
        try:
            rows.append([float(t) for t in line.split()])
        except ValueError:
            continue  # a non-numeric row is not data
    if not rows:
        raise ValueError(f"{name}: no numeric data rows in ORSO data set {_set_id(block)!r}")
    matrix, meta = conform_rows(rows, width, truncate_wide=True)
    if matrix.shape[0] == 0:
        raise ValueError(
            f"{name}: every row of ORSO data set {_set_id(block)!r} has fewer values "
            f"than its {width} declared columns"
        )
    return matrix, meta


def _set_id(block: _Block) -> str:
    return _text(block.header.get("data_set"))


def _polarization(header: dict[str, Any]) -> str:
    return _text(_get(header, "data_source", "measurement", "instrument_settings", "polarization"))


def _suffixes(blocks: Sequence[_Block]) -> list[str]:
    """Per-block series suffix: the polarization, else the data_set id, else
    the ordinal -- the first that tells every block apart."""
    for tags in (
        [_polarization(b.header) for b in blocks],
        [_set_id(b) for b in blocks],
    ):
        if all(tags) and len(set(tags)) == len(tags):
            return tags
    return [f"#{k + 1}" for k in range(len(blocks))]


@dataclass
class _Channel:
    label: str
    name: str  # the column's own name, without the data-set suffix
    unit: str
    block: int  # -1 for a channel shared by every block
    column: int  # source column (per block; ignored when shared)
    error_of: str = ""  # the target column's base label, for an error column


def _plan_channels(
    blocks: Sequence[_Block], layouts: Sequence[tuple[list[str], list[str], list[dict[str, Any]]]]
) -> list[_Channel]:
    """The output channels in file order. With several blocks, each block's
    value/error columns are suffixed, and a ``Qz`` error column every block
    declares becomes one shared channel at the end."""
    def x_error(specs: Sequence[dict[str, Any]]) -> int | None:
        return next((j for j, s in enumerate(specs) if _text(s.get("error_of")) == "Qz"), None)

    x_errors = [x_error(specs) for _, _, specs in layouts]
    multi = len(blocks) > 1
    shared = multi and all(j is not None for j in x_errors)
    suffixes = _suffixes(blocks) if multi else [""]
    channels: list[_Channel] = []
    for k, (labels, units, specs) in enumerate(layouts):
        for j in range(1, len(labels)):
            if shared and j == x_errors[k]:
                continue
            label = f"{labels[j]} {suffixes[k]}" if multi else labels[j]
            error_of = _text(specs[j].get("error_of"))
            channels.append(_Channel(label, labels[j], units[j], k, j, error_of))
    if shared:
        first = x_errors[0]
        assert first is not None
        labels, units, _ = layouts[0]
        channels.append(_Channel(labels[first], labels[first], units[first], -1, first, "Qz"))
    return channels


def _role_metadata(channels: Sequence[_Channel]) -> dict[str, Any]:
    """Plotting roles straight from the ``error_of`` declarations."""
    index = {(c.block, c.name): i for i, c in enumerate(channels)}
    roles: list[dict[str, Any]] = []
    error_channels: dict[int, int] = {}
    for i, ch in enumerate(channels):
        if not ch.error_of:
            continue
        if ch.error_of == "Qz":
            roles.append({"channel": i, "target": -1, "axis": "x", "side": "both"})
            continue
        target = index.get((ch.block, ch.error_of))
        if target is None:
            continue
        roles.append({"channel": i, "target": target, "axis": "y", "side": "both"})
        error_channels[target] = i
    curves = sorted(error_channels)
    if not curves:  # no declared uncertainty: plot every R column, else every value
        values = [i for i, c in enumerate(channels) if not c.error_of]
        named_r = [i for i in values if channels[i].name == "R"]
        curves = named_r or values
    meta: dict[str, Any] = {"default_value_channels": curves}
    if error_channels:
        meta["error_channels"] = error_channels
    if roles:
        meta["error_roles"] = roles
    return meta


def _header_metadata(header: dict[str, Any]) -> dict[str, Any]:
    """Flat, Inspector-friendly keys from the first data set's header."""
    source = _get(header, "data_source")
    meta: dict[str, Any] = {}
    flat = {
        "sample_name": ("sample", "name"),
        "title": ("experiment", "title"),
        "instrument": ("experiment", "instrument"),
        "facility": ("experiment", "facility"),
        "probe": ("experiment", "probe"),
        "start_date": ("experiment", "start_date"),
        "proposal_id": ("experiment", "proposalID"),
        "scheme": ("measurement", "scheme"),
    }
    for key, path in flat.items():
        text = _text(_get(source, *path))
        if text:
            meta[key] = text
    if "sample_name" in meta:
        meta["name"] = meta["sample_name"]
    files = _get(source, "measurement", "data_files")
    if isinstance(files, list):
        meta["data_files"] = [
            {"file": _text(f.get("file")), "timestamp": _text(f.get("timestamp"))}
            for f in files
            if isinstance(f, dict)
        ]
    software = _get(header, "reduction", "software")
    sw_text = (
        " ".join(t for t in (_text(software.get("name")), _text(software.get("version"))) if t)
        if isinstance(software, dict)
        else _text(software)
    )
    if sw_text:
        meta["reduction_software"] = sw_text
    stamp = _text(_get(header, "reduction", "timestamp"))
    if stamp:
        meta["reduction_timestamp"] = stamp
    return meta


def _merge_row_meta(metas: Sequence[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    dropped = sum(int(m.get("dropped_rows", 0)) for m in metas)
    notes = [n for m in metas for n in m.get("notes", [])]
    if dropped:
        out["dropped_rows"] = dropped
    if notes:
        out["notes"] = notes
    return out


def import_orso(filepath: str | Path) -> DataStruct:
    """Import an ORSO ``.ort`` file (see module docstring)."""
    path = Path(filepath)
    lines = read_text(path).lstrip("﻿").splitlines()
    first = next((ln for ln in lines if ln.strip()), "")
    version = _version(first)
    if version is None:
        raise ValueError(
            f"{path.name} is not an ORSO file: its first line is not "
            "'# # ORSO reflectivity data file | <version> standard | ...'"
        )
    blocks = _split_blocks(lines)
    first_header = load_header(blocks[0].header_lines)
    blocks[0].header = first_header
    for block in blocks[1:]:
        block.header = merge(first_header, load_header(block.header_lines))

    layouts: list[tuple[list[str], list[str], list[dict[str, Any]]]] = []
    parts: list[tuple[np.ndarray, dict[str, Any]]] = []
    for block in blocks:
        specs = _column_specs(block.header.get("columns"), path.name)
        labels, units = _labels_units(specs)
        layouts.append((labels, units, specs))
        parts.append(_matrix(block, len(specs), path.name))

    channels = _plan_channels(blocks, layouts)
    starts = [0]
    for matrix, _ in parts:
        starts.append(starts[-1] + matrix.shape[0])
    values = np.full((starts[-1], len(channels)), np.nan)
    for i, ch in enumerate(channels):
        for k, (matrix, _) in enumerate(parts):
            if ch.block == k:
                values[starts[k] : starts[k + 1], i] = matrix[:, ch.column]
            elif ch.block == -1:  # the shared sQz: each block's own column
                values[starts[k] : starts[k + 1], i] = matrix[:, _x_error_column(layouts[k][2])]
    qz = np.concatenate([m[:, 0] for m, _ in parts])

    pols = [_polarization(b.header) for b in blocks]
    x_unit = layouts[0][1][0]
    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_orso",
        "x_column_name": "Qz",
        "x_column_unit": x_unit,
        "orso_version": version,
        **_header_metadata(first_header),
        "orso_columns": layouts[0][2],
        "orso_header": {k: v for k, v in first_header.items() if k != "columns"},
    }
    set_ids = [_set_id(b) for b in blocks]
    if any(set_ids):
        metadata["data_sets"] = set_ids
    if any(pols):
        metadata["polarization"] = pols if len(blocks) > 1 else pols[0]
    if len(blocks) > 1:
        metadata["block_rows"] = [[starts[k], starts[k + 1]] for k in range(len(blocks))]
    metadata.update(_role_metadata(channels))
    metadata.update(_merge_row_meta([meta for _, meta in parts]))
    return DataStruct.create(
        qz,
        values,
        labels=[c.label for c in channels],
        units=[c.unit for c in channels],
        metadata=metadata,
    )


def _x_error_column(specs: Sequence[dict[str, Any]]) -> int:
    return next(j for j, s in enumerate(specs) if _text(s.get("error_of")) == "Qz")
