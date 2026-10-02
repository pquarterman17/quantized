"""Header blocks of an NCNR reductus ``.refl`` (helper for :mod:`quantized.io.ncnr`).

A reductus export holds one ``#``-header block per dataset. A polarized
measurement exported as one file carries one block per cross section
(``"polarization": "++"`` then ``"--"``, or all four spin states), each with its
own Q grid. They used to be read as one series: every block after the first was
appended to it, so the plot drew ``--`` as a continuation of ``++`` (a line back
from high Q to low Q) under the first block's name.

:func:`combine_blocks` keeps them apart. Rows stay in file order, so x is the
concatenation of every block's Qz. Each block gets its own measured and
uncertainty channels, NaN outside the block's rows, named
``"<column> <state>"`` (``"uncertainty ++"``). A resolution column that every
block carries in the x axis's unit is shared: each row holds its own block's
dQ, so one x-error binding serves every series.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np

__all__ = ["RawBlock", "combine_blocks", "parse_header", "split_blocks"]

_HEADER_RE = re.compile(r'#\s*"([^"]+)":\s*(.+)$')


def _loads(text: str) -> Any:
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None


def _text(parsed: Any, raw: str) -> str:
    return parsed if isinstance(parsed, str) else raw.strip('"')


def _unit(value: Any) -> str:
    """A header unit as text: JSON ``null`` is blank, not the string "None"."""
    return "" if value is None else str(value)


@dataclass
class RawBlock:
    """One header block's keys plus the text lines that follow it."""

    name: str = ""
    entry: str = ""
    polarization: str = ""
    wavelength: list[float] = field(default_factory=list)
    columns: list[str] = field(default_factory=list)
    units: list[str] = field(default_factory=list)
    data_lines: list[str] = field(default_factory=list)


def parse_header(lines: Sequence[str]) -> RawBlock:
    """Read the reductus keys from one block's ``#`` lines."""
    block = RawBlock()
    for line in lines:
        match = _HEADER_RE.match(line)
        if match is None:
            continue
        key, valstr = match.group(1), match.group(2).strip()
        parsed = _loads(valstr)
        if key == "name":
            block.name = _text(parsed, valstr)
        elif key == "entry":
            block.entry = _text(parsed, valstr)
        elif key == "polarization":
            block.polarization = _text(parsed, valstr)
        elif key == "wavelength":
            if isinstance(parsed, list):
                block.wavelength = [float(x) for x in parsed]
            elif isinstance(parsed, (int, float)):
                block.wavelength = [float(parsed)]
        elif key == "columns" and isinstance(parsed, list):
            block.columns = [str(x) for x in parsed]
        elif key == "units" and isinstance(parsed, list):
            block.units = [_unit(x) for x in parsed]
    return block


def split_blocks(lines: Sequence[str]) -> list[RawBlock]:
    """Split the file at every ``#`` line that follows data, one block each.

    A run of ``#`` lines with no ``"columns"`` key does not start a block: it
    is a stray comment, and the rows after it stay with the block before it
    (where they always went). Blocks before the first ``"columns"`` header are
    dropped, as the single-block reader always ignored them."""
    blocks: list[RawBlock] = []
    header: list[str] = []
    data: list[str] = []
    for line in lines:
        if line.startswith("#"):
            if data:
                _push(blocks, header, data)
                header, data = [], []
            header.append(line)
        else:
            data.append(line)
    if header or data:
        _push(blocks, header, data)
    return [b for b in blocks if b.columns]


def _push(blocks: list[RawBlock], header: list[str], data: list[str]) -> None:
    block = parse_header(header)
    if not block.columns and blocks:
        blocks[-1].data_lines.extend(data)
        return
    block.data_lines = data
    blocks.append(block)


def _suffixes(blocks: Sequence[RawBlock]) -> list[str]:
    """Per-block series suffix: the spin state, else the entry, else the name,
    else the block's ordinal -- the first of these that tells every block apart."""
    for key in ("polarization", "entry", "name"):
        tags = [str(getattr(b, key)).strip() for b in blocks]
        if all(tags) and len(set(tags)) == len(tags):
            return tags
    return [f"#{k + 1}" for k in range(len(blocks))]


def _shared_resolution(blocks: Sequence[RawBlock], x_unit: str) -> str | None:
    """The resolution column every block carries in the x unit, if any."""
    first = blocks[0]
    for j in range(1, len(first.columns)):
        label = first.columns[j]
        if "".join(c for c in label.lower() if c.isalnum()) not in ("resolution", "dq"):
            continue
        if not x_unit or any(
            label not in b.columns[1:] or _unit_at(b, b.columns.index(label)) != x_unit
            for b in blocks
        ):
            return None
        return label
    return None


def _unit_at(block: RawBlock, j: int) -> str:
    return block.units[j] if j < len(block.units) else ""


def combine_blocks(
    blocks: Sequence[RawBlock], matrices: Sequence[np.ndarray], x_unit: str
) -> tuple[np.ndarray, np.ndarray, list[str], list[str]]:
    """One (time, values, labels, units) for several blocks; see module doc.

    ``matrices[k]`` is block ``k``'s conformed numeric rows (column 0 = Qz)."""
    suffixes = _suffixes(blocks)
    shared = _shared_resolution(blocks, x_unit)
    labels: list[str] = []
    units: list[str] = []
    sources: list[tuple[int, int]] = []  # (block, column) per output channel
    for k, block in enumerate(blocks):
        n_cols = matrices[k].shape[1]
        for j in range(1, n_cols):
            if block.columns[j] == shared:
                continue
            labels.append(f"{block.columns[j]} {suffixes[k]}")
            units.append(_unit_at(block, j))
            sources.append((k, j))
    starts = np.cumsum([0] + [m.shape[0] for m in matrices])
    n_rows = int(starts[-1])
    values = np.full((n_rows, len(labels) + (shared is not None)), np.nan)
    for ch, (k, j) in enumerate(sources):
        values[starts[k] : starts[k + 1], ch] = matrices[k][:, j]
    if shared is not None:
        for k, block in enumerate(blocks):
            values[starts[k] : starts[k + 1], -1] = matrices[k][:, block.columns.index(shared)]
        labels.append(shared)
        units.append(x_unit)
    time = np.concatenate([m[:, 0] for m in matrices])
    return time, values, labels, units
