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
from quantized.io.origin_project.notes import results_log
from quantized.io.origin_project.opj import read_opj, read_opj_books
from quantized.io.origin_project.opju import read_opju, read_opju_books

__all__ = ["OriginProjectError", "read_origin_books", "read_origin_project"]


def _with_log(ds: DataStruct, path: Path) -> DataStruct:
    """Attach the project's results log (fit provenance) to one DataStruct.

    The log is project-global, so it rides only the primary dataset (and the
    first book of a multi-book read) rather than being duplicated per book.
    """
    log = results_log(path.read_bytes())
    if not log:
        return ds
    return dataclasses.replace(ds, metadata={**ds.metadata, "origin_results_log": log})


def read_origin_project(path: Path) -> DataStruct:
    """Dispatch by extension to the clean-room ``.opj`` / ``.opju`` decoder.

    Origin projects are proprietary binary files; quantized decodes them itself
    (it will not bundle the GPL liborigin). Both containers recover worksheet
    data with real column names/units; the project's results log (analysis
    provenance) lands in ``metadata['origin_results_log']`` when present.
    """
    reader = read_opju if path.suffix.lower() == ".opju" else read_opj
    return _with_log(reader(path), path)


def read_origin_books(path: Path) -> list[DataStruct]:
    """Every workbook in an Origin project as its own DataStruct (plan item 3).

    ``read_origin_project`` keeps the registry's single-DataStruct contract
    (largest book); this is the pure API a multi-dataset import flow (plan
    item 16) builds on. The results log rides the first book only.
    """
    books = read_opju_books(path) if path.suffix.lower() == ".opju" else read_opj_books(path)
    if books:
        books[0] = _with_log(books[0], path)
    return books
