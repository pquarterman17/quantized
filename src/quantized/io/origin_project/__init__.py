"""Origin project readers (``.opj`` / ``.opju``) — clean-room, no GPL liborigin.

Package layout (split per plan item 15 to stay under the module ceiling as
decoders grow): ``container`` (CPY block primitives), ``opj`` (worksheet data +
names/units), ``opju`` (FPC column codec, see ``opju_codec``), ``windows``
(windows-section metadata). Format notes: ``docs/origin_project_format.md`` +
``docs/origin_re/``.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

from quantized.datastruct import DataStruct
from quantized.io.origin_project.container import OriginProjectError
from quantized.io.origin_project.notes import notes_windows, parse_results_log, results_log
from quantized.io.origin_project.opj import read_opj, read_opj_books
from quantized.io.origin_project.opju import read_opju, read_opju_books
from quantized.io.origin_project.tree import opj_folder_paths, opju_folder_paths

__all__ = ["OriginProjectError", "read_origin_books", "read_origin_project"]


def _with_provenance(ds: DataStruct, path: Path, *, raw: bytes | None = None) -> DataStruct:
    """Attach project-global provenance (results log + notes) to one DataStruct.

    Both are project-global, so they ride only the primary dataset (and the
    first book of a multi-book read) rather than being duplicated per book.
    The file is read once and both scans run over the same bytes (``raw``
    lets a caller that already has the bytes, e.g. :func:`read_origin_books`,
    skip a second read of the file).
    """
    raw = path.read_bytes() if raw is None else raw
    extra: dict[str, object] = {}
    log = results_log(raw)
    if log:
        extra["origin_results_log"] = log
        records = parse_results_log(log)
        if records:
            extra["origin_results_log_records"] = records
    notes = notes_windows(raw)
    if notes:
        extra["origin_notes"] = notes
    if not extra:
        return ds
    return dataclasses.replace(ds, metadata={**ds.metadata, **extra})


def read_origin_project(path: Path) -> DataStruct:
    """Dispatch by extension to the clean-room ``.opj`` / ``.opju`` decoder.

    Origin projects are proprietary binary files; quantized decodes them itself
    (it will not bundle the GPL liborigin). Both containers recover worksheet
    data with real column names/units; the project's results log (analysis
    provenance) lands in ``metadata['origin_results_log']`` (raw text) and
    ``metadata['origin_results_log_records']`` (parsed per-operation records,
    when at least one parses) and any notes-window text in
    ``metadata['origin_notes']`` when present.
    """
    reader = read_opju if path.suffix.lower() == ".opju" else read_opj
    return _with_provenance(reader(path), path)


def _with_folder_path(ds: DataStruct, folder_paths: dict[str, list[str]]) -> DataStruct:
    """Attach ``metadata['origin_folder_path']`` (the Project Explorer folder
    a book lives in, root-exclusive; ``[]`` when unknown or at the root) --
    see ``tree.py``. A ``Book4@2``-style sheet pseudo-book (plan item 5)
    resolves through its base book's name, since sheets aren't separate
    Project Explorer windows."""
    book = str(ds.metadata.get("origin_book", ""))
    base_book, _, _sheet = book.partition("@")
    folder_path = folder_paths.get(base_book, [])
    return dataclasses.replace(ds, metadata={**ds.metadata, "origin_folder_path": folder_path})


def read_origin_books(path: Path) -> list[DataStruct]:
    """Every workbook in an Origin project as its own DataStruct (plan item 3).

    ``read_origin_project`` keeps the registry's single-DataStruct contract
    (largest book); this is the pure API a multi-dataset import flow (plan
    item 16) builds on. The results log rides the first book only; every
    book gets an ``origin_folder_path`` (plan item: Project Explorer folder
    tree -- see ``tree.py``; decoded for ``.opj`` and both CPYUA ``.opju``
    sub-versions (4.3811 + 4.3380), degrading to ``[]`` only on an unknown
    container or a framing/consistency mismatch).
    """
    is_opju = path.suffix.lower() == ".opju"
    books = read_opju_books(path) if is_opju else read_opj_books(path)
    if not books:
        return books
    raw = path.read_bytes()
    books[0] = _with_provenance(books[0], path, raw=raw)
    folder_paths = opju_folder_paths(raw) if is_opju else opj_folder_paths(raw)
    return [_with_folder_path(b, folder_paths) for b in books]
