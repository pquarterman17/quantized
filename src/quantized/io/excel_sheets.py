"""Every data-bearing sheet of an ``.xlsx``/``.xlsm`` workbook.

``import_auto`` imports ONE sheet (sheet 0, MATLAB ``importExcel``'s default),
so a workbook holding several data sheets lost all but the first with no word
said. :func:`import_workbook_sheets` keeps sheet 0's import byte-identical
(the same registry call) and adds every OTHER sheet that parses: a SIMS sheet
through ``import_sims``, anything else through ``import_excel``. A sheet with
no numeric data (a report's "Summary" page) is skipped and NAMED in the first
dataset's ``metadata['notes']``, so nothing is dropped silently. When sheet 0
itself has no data, the first sheet that does becomes the primary.

Every dataset of a multi-sheet workbook carries ``metadata['sheet_name']`` —
the key a re-import uses to find the same sheet again.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Callable
from pathlib import Path

from quantized.datastruct import DataStruct
from quantized.io.excel import import_excel, sheet_titles
from quantized.io.sims import import_sims, is_sims_sheet
from quantized.io.technique import stamp_technique

__all__ = ["MAX_SHEETS", "import_workbook_sheets"]

# Each sheet is read under excel.MAX_CELLS; this bounds how many are read.
MAX_SHEETS = 64
# A sheet that fails to parse as data: no numeric rows, an empty grid.
_NOT_DATA = (ValueError, IndexError, KeyError)


def _other_sheet(path: Path, index: int) -> DataStruct:
    if is_sims_sheet(path, index):
        return stamp_technique(import_sims(path, sheet=index), import_sims)
    return stamp_technique(import_excel(path, sheet=index), import_excel)


def _with_meta(ds: DataStruct, **extra: object) -> DataStruct:
    return dataclasses.replace(ds, metadata={**ds.metadata, **extra})


def import_workbook_sheets(
    path: Path, first_sheet: Callable[[Path], DataStruct]
) -> list[DataStruct]:
    """Each data-bearing sheet of ``path`` as its own DataStruct, in workbook
    order. ``first_sheet`` is the registry's ordinary one-sheet import (sheet
    0); a one-sheet workbook returns exactly ``[first_sheet(path)]``.

    Raises sheet 0's own error when no sheet holds data."""
    titles = sheet_titles(path)
    if len(titles) <= 1:
        return [first_sheet(path)]
    found: list[DataStruct] = []
    skipped: list[str] = []
    first_error: Exception | None = None
    for index, title in enumerate(titles[:MAX_SHEETS]):
        try:
            ds = first_sheet(path) if index == 0 else _other_sheet(path, index)
        except _NOT_DATA as exc:
            first_error = first_error or exc
            skipped.append(title)
            continue
        found.append(_with_meta(ds, sheet_name=title))
    if not found:
        raise first_error or ValueError(f"no sheet of {path.name} holds data")
    notes = [str(n) for n in found[0].metadata.get("notes", [])]
    notes += [f"Sheet '{t}' has no numeric data; not imported." for t in skipped]
    if len(titles) > MAX_SHEETS:
        notes.append(f"Only the first {MAX_SHEETS} of {len(titles)} sheets were read.")
    if notes:
        found[0] = _with_meta(found[0], notes=notes)
    return found
