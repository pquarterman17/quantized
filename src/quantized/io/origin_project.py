"""Read Origin project files (``.opj`` / ``.opju``) — clean-room, no GPL liborigin.

Origin's project formats are proprietary binary. The older ``.opj`` (Origin 2017
and earlier) has a reverse-engineerable structure; the newer ``.opju`` (2018+) has
no open reference and must be decoded from sample files. This repo is Apache-2.0
with an enforced no-GPL rule (see ``architecture-guards`` #3), so it will **never**
bundle the GPL ``liborigin`` — we roll our own reader instead.

Priority is recovering the user's work: worksheet DATA first (columns → DataStruct
so it can be re-plotted natively), then as much of the figure definition (layers,
axes, curves, styling) as the format exposes. Exact-pixel reproduction of an
Origin graph is a stretch goal; not losing the underlying data is the guarantee.

Status: recognition + guidance shipped; the binary decoders (``_read_opj`` /
``_read_opju``) are built incrementally against local sample files (kept under
``tests/realdata/origin/``, gitignored — real projects may hold private data).
Until a format is decoded, importing it raises :class:`OriginProjectError` with
the working fallback (free Origin Viewer → CSV/ASCII → import here).
"""

from __future__ import annotations

from pathlib import Path

from quantized.datastruct import DataStruct

__all__ = ["OriginProjectError", "read_origin_project"]

_VIEWER = "the free Origin Viewer (https://www.originlab.com/viewer/)"


class OriginProjectError(ValueError):
    """An Origin project can't (yet) be read directly; the message explains why
    and how to recover the data (subclasses ValueError so the import route maps
    it to a 422 with the message intact)."""


def _fallback(path: Path, detail: str) -> OriginProjectError:
    return OriginProjectError(
        f"{detail} For now, open '{path.name}' in {_VIEWER} and export the "
        f"worksheet(s) to CSV or ASCII, then import that file here."
    )


def _read_opj(path: Path) -> DataStruct:
    # TODO(clean-room): decode the .opj binary (container + data streams) into a
    # DataStruct, worksheet data first. Built against local samples in
    # tests/realdata/origin/. See read_origin_project's module docstring.
    raise _fallback(
        path,
        f"'{path.name}' is an Origin .opj project; the clean-room reader is not wired up yet.",
    )


def _read_opju(path: Path) -> DataStruct:
    # TODO(clean-room): .opju (2018+) has no open reference — reverse-engineer the
    # container from sample files before decoding worksheet data / figures.
    raise _fallback(
        path,
        f"'{path.name}' is an Origin .opju (2018+) project; "
        f"no open-source reader exists for it yet.",
    )


def read_origin_project(path: Path) -> DataStruct:
    """Dispatch by extension to the clean-room ``.opj`` / ``.opju`` decoder.

    Origin projects are proprietary binary files; quantized decodes them itself
    (it will not bundle the GPL liborigin). While a decoder is still being built
    for a given format, this raises :class:`OriginProjectError` pointing at the
    export-via-Origin-Viewer fallback.
    """
    return (_read_opju if path.suffix.lower() == ".opju" else _read_opj)(path)
