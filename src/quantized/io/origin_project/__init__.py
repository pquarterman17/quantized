"""Origin project readers (``.opj`` / ``.opju``) — clean-room, no GPL liborigin.

Package layout (split per plan item 15 to stay under the module ceiling as
decoders grow): ``container`` (CPY block primitives), ``opj`` (worksheet data +
names/units), ``opju`` (pending decoder), ``windows`` (windows-section
metadata). Format notes: ``docs/origin_project_format.md`` + ``docs/origin_re/``.
"""

from __future__ import annotations

from pathlib import Path

from quantized.datastruct import DataStruct
from quantized.io.origin_project.container import OriginProjectError
from quantized.io.origin_project.opj import read_opj
from quantized.io.origin_project.opju import read_opju

__all__ = ["OriginProjectError", "read_origin_project"]


def read_origin_project(path: Path) -> DataStruct:
    """Dispatch by extension to the clean-room ``.opj`` / ``.opju`` decoder.

    Origin projects are proprietary binary files; quantized decodes them itself
    (it will not bundle the GPL liborigin). ``.opj`` recovers worksheet data
    with real column names/units; ``.opju`` still raises
    :class:`OriginProjectError` with the export-via-Origin-Viewer fallback
    until the codec decoder lands (plan item 8).
    """
    return (read_opju if path.suffix.lower() == ".opju" else read_opj)(path)
