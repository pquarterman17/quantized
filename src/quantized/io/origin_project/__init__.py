"""Origin project readers (``.opj`` / ``.opju``) — clean-room, no GPL liborigin.

Package layout (split per plan item 15 to stay under the module ceiling as
decoders grow): ``container`` (CPY block primitives), ``opj`` (worksheet data +
names/units), ``opju`` (FPC column codec, see ``opju_codec``), ``windows``
(windows-section metadata). Format notes: ``docs/origin_project_format.md`` +
``docs/origin_re/``.
"""

from __future__ import annotations

from pathlib import Path

from quantized.datastruct import DataStruct
from quantized.io.origin_project.container import OriginProjectError
from quantized.io.origin_project.opj import read_opj, read_opj_books
from quantized.io.origin_project.opju import read_opju, read_opju_books

__all__ = ["OriginProjectError", "read_origin_books", "read_origin_project"]


def read_origin_project(path: Path) -> DataStruct:
    """Dispatch by extension to the clean-room ``.opj`` / ``.opju`` decoder.

    Origin projects are proprietary binary files; quantized decodes them itself
    (it will not bundle the GPL liborigin). ``.opj`` recovers worksheet data
    with real column names/units; ``.opju`` recovers worksheet data via the FPC
    column codec (``opju_codec``) with Origin short designations for labels.
    """
    return (read_opju if path.suffix.lower() == ".opju" else read_opj)(path)


def read_origin_books(path: Path) -> list[DataStruct]:
    """Every workbook in an Origin project as its own DataStruct (plan item 3).

    ``read_origin_project`` keeps the registry's single-DataStruct contract
    (largest book); this is the pure API a multi-dataset import flow (plan
    item 16) builds on.
    """
    if path.suffix.lower() == ".opju":
        return read_opju_books(path)
    return read_opj_books(path)
