"""Reader for quantized's own XRD export (``io/xrd_csv.py``, the writer).

The export is a ``.csv`` — comma ``"standard"`` or tab ``"origin"`` (3 header
rows: names, units, X/Y designations) — so it used to re-import through the
generic delimited parser and lose what made it XRD: the technique tag (and so
the log-intensity default) and the counting time its cps/counts columns are
related by. :func:`is_xrd_export` claims a file by the writer's own first
line, ``# XRD Batch Export`` (``#\\tXRD Batch Export`` in Origin form); an
export written WITHOUT its metadata block carries no such proof and stays a
generic table, never a guess.

The metadata block is read back into the keys the writer reads, so a
re-export reproduces the original columns. ``source`` is this file;
``exported_from`` / ``exported_parser`` keep where the scan first came from.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.base import read_head, read_text
from quantized.io.delimited import _extract_units

__all__ = ["MARKER", "import_xrd_export", "is_xrd_export"]

MARKER = "XRD Batch Export"

# Intensity columns after the first are named by unit, so labels stay unique.
_UNIT_LABELS = {"counts": "Counts", "cps": "CPS"}
_NUM = r"([-+0-9.eE]+)"

# The writer's metadata lines -> the keys it reads them from.
_FIELDS: tuple[tuple[re.Pattern[str], tuple[str, ...]], ...] = tuple(
    (re.compile(pattern), keys)
    for pattern, keys in (
        (r"Source: (.*)", ("exported_from",)),
        (r"Parser: (.*)", ("exported_parser",)),
        (r"Sample: (.*)", ("sample_name",)),
        (
            rf"Anode: (\S+) \({_NUM} kV / {_NUM} mA\)",
            ("anode_material", "tension_kV", "current_mA"),
        ),
        (r"Anode: (\S+)", ("anode_material",)),
        (rf"Wavelength: Ka1 = {_NUM} A", ("wavelength_a",)),
        (rf"2-theta range: {_NUM} - {_NUM} deg", ("start_angle", "end_angle")),
        (rf"Step size: {_NUM} deg \((\d+) points\)", ("step_size", "num_points")),
        (rf"Counting time: {_NUM} s/point", ("counting_time",)),
    )
)
_TEXT_KEYS = frozenset({"exported_from", "exported_parser", "sample_name", "anode_material"})


def is_xrd_export(path: Path) -> bool:
    """True when the file's first line is the XRD export marker."""
    try:
        head = read_head(path, 256)
    except OSError:
        return False
    lines = head.lstrip("﻿").splitlines()  # also a classic-Mac "\r"-only file
    first = lines[0] if lines else ""
    return first.startswith("#") and first[1:].strip() == MARKER


def _value(key: str, text: str) -> str | int | float:
    if key in _TEXT_KEYS:
        return text
    return int(text) if key == "num_points" else float(text)


def _header_metadata(lines: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for line in lines:
        for pattern, keys in _FIELDS:
            match = pattern.fullmatch(line)
            if match is None:
                continue
            try:
                out.update({k: _value(k, v) for k, v in zip(keys, match.groups(), strict=True)})
            except ValueError:
                pass  # a hand-edited number: keep the rest of the block
            break
    return out


def _cell(text: str) -> str:
    """A header cell, with the writer's formula-guard quote removed."""
    text = text.strip()
    return text[1:] if text.startswith("'") else text


def import_xrd_export(filepath: str | Path) -> DataStruct:
    """Import a quantized XRD export (standard or Origin form)."""
    path = Path(filepath)
    lines = read_text(path).splitlines()
    comments: list[str] = []
    start = 0
    while start < len(lines) and lines[start].startswith("#"):
        comments.append(lines[start][1:].strip())
        start += 1
    body = [ln for ln in lines[start:] if ln.strip()]
    if not body:
        raise ValueError(f"XRD export has no header row: {path.name}")
    sep = "\t" if "\t" in body[0] else ","
    rows = list(csv.reader(body, delimiter=sep))
    names = [_cell(c) for c in rows[0]]
    is_origin = len(rows) > 2 and [c.strip() for c in rows[2]][:1] == ["X"]
    try:
        data = np.array([[float(c) for c in r] for r in rows[3 if is_origin else 1 :]], dtype=float)
    except ValueError as exc:
        raise ValueError(f"XRD export has a non-numeric data row: {path.name}") from exc
    if data.ndim != 2 or data.shape[0] == 0 or data.shape[1] != len(names) or len(names) < 2:
        raise ValueError(f"XRD export has no data rows matching its header: {path.name}")

    x_unit, x_name = _extract_units(names[0])
    labels: list[str] = []
    units: list[str] = []
    for k, name in enumerate(names[1:]):
        unit, label = _extract_units(name)
        labels.append(label if k == 0 else _UNIT_LABELS.get(unit.lower(), name))
        units.append(unit)

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_xrd_export",
        "x_column_name": x_name,
        "x_column_unit": x_unit,
        **_header_metadata(comments),
    }
    return DataStruct.create(data[:, 0], data[:, 1:], labels=labels, units=units, metadata=metadata)
