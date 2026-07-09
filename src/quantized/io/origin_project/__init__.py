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

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.origin_project.container import OriginProjectError
from quantized.io.origin_project.notes import notes_windows, parse_results_log, results_log
from quantized.io.origin_project.opj import (
    build_opj_books,
    build_opj_primary,
    parse_opj,
    read_opj,
    read_opj_books,
)
from quantized.io.origin_project.opju import (
    build_opju_books,
    build_opju_primary,
    parse_opju,
    read_opju,
    read_opju_books,
)
from quantized.io.origin_project.tree import opj_folder_paths, opj_project_dates
from quantized.io.origin_project.tree_opju import opju_folder_paths

__all__ = [
    "OriginProjectError",
    "drop_empty_library_books",
    "drop_nonactionable_figures",
    "read_origin_books",
    "read_origin_project",
    "read_origin_project_all",
]


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
    # .opj project created/modified timestamps (tree.py::opj_project_dates,
    # §13.2 #5); None on the 4.3227 variant / CPYUA bytes — key then absent.
    dates = opj_project_dates(raw)
    if dates:
        extra["origin_project_dates"] = dates
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


def read_origin_project_all(
    path: Path, *, raw: bytes | None = None
) -> tuple[DataStruct, list[DataStruct]]:
    """Parse an Origin project ONCE and return both ``read_origin_project``'s
    primary DataStruct (with provenance) and ``read_origin_books``'s full
    per-book list (with folder paths + book[0] provenance) — the combined
    result of calling both entry points, without the redundant second
    ``parse_opj``/``parse_opju`` (and repeated file reads) each independently
    performs today.

    Used by the ``/api/parsers`` import route: profiling a 122-book /
    8.5M-cell project (``PNR.opj``, 121.56 MB) showed the duplicated
    project-wide parse dominating the ~4s round-trip (2026-07-09) — calling
    ``import_auto`` (-> ``read_origin_project`` -> a full parse) and then
    ``read_origin_books`` (-> another full parse) back to back reads the file
    from disk repeatedly and decodes every column twice.

    Primary-book construction (``build_opj*_primary``) and all-books
    construction (``build_opj*_books``) stay independent calls sharing only
    the parsed intermediate — mirroring ``read_opj``/``read_opj_books``'s
    separation — so a decode issue confined to one non-primary book still
    degrades the book list to ``[]`` without taking down the primary import,
    exactly as ``routes.parsers._import_with_books`` behaved before (its
    ``except OriginProjectError`` around ``read_origin_books`` only ever
    guarded against that isolated-book-build failure, since a shared-parse
    failure would already have surfaced on the first, unguarded call).
    """
    is_opju = path.suffix.lower() == ".opju"
    raw = path.read_bytes() if raw is None else raw

    books: list[DataStruct]
    if is_opju:
        opju_parsed = parse_opju(path, raw=raw)
        primary = _with_provenance(build_opju_primary(opju_parsed), path, raw=raw)
        try:
            books = build_opju_books(opju_parsed)
        except OriginProjectError:
            books = []
    else:
        opj_parsed = parse_opj(path, raw=raw)
        primary = _with_provenance(build_opj_primary(opj_parsed), path, raw=raw)
        try:
            books = build_opj_books(opj_parsed)
        except OriginProjectError:
            books = []

    if books:
        books[0] = _with_provenance(books[0], path, raw=raw)
        folder_paths = opju_folder_paths(raw) if is_opju else opj_folder_paths(raw)
        books = [_with_folder_path(b, folder_paths) for b in books]
    return primary, books


def drop_empty_library_books(books: list[DataStruct]) -> list[DataStruct]:
    """Presentation gate for the multi-book Library listing: hide books with no
    plottable numeric data and no text content.

    Origin fit/report sheets (plan item 4) surface as pseudo-books whose numeric
    ``.values`` are empty -- their content is unresolved ``cell://`` reference
    stubs in ``metadata['origin_report_sheets']``, not real data -- so listing
    them as top-level Library entries floods it with empty rows (the Hc2 project
    alone produced 48 ``Book2@N`` fit-report shells). Mirrors
    ``drop_nonactionable_figures``: a gate applied at the import boundary, not in
    the decoder, so ``read_origin_books`` stays a complete reader (the report
    metadata still rides the returned DataStruct for a future fit-report surface).
    Text-only books (real content in ``origin_text_columns``) are kept. Never
    returns empty: a degenerate all-empty project passes through unchanged so the
    Library still shows something.
    """
    kept = [
        b
        for b in books
        if (b.values.size and int(np.count_nonzero(np.isfinite(b.values))) > 0)
        or b.metadata.get("origin_text_columns")
    ]
    return kept or books


def drop_nonactionable_figures(figs: list[dict[str, object]]) -> list[dict[str, object]]:
    """Keep only figures a user can act on: those with bound curves OR a resolvable
    source hint.

    The layer-anchor scan also locates internal storage/thumbnail blocks that carry
    a decodable axis record but no bound curves and no source reference -- the
    decoder can find them, but they are not user graphs and cannot be restored onto
    any imported dataset. Surfacing them just floods the Library's Figures section
    with dead "SYSTEM" rows (the Hc2 project produced 32 of them). This is a
    presentation gate, applied at the import boundary, not in the decoder -- so the
    decoder stays a complete axis-record reader for the synthetic tests. Verified
    against the corpus: keeps all 14 real figures (each has curves), drops all 32
    non-actionable Hc2 anchors. (Moved here from ``figures_opju`` 2026-07-06 --
    it pairs with ``drop_empty_library_books``, the sibling gate above.)
    """
    return [f for f in figs if f.get("curves") or str(f.get("source_hint") or "").strip()]
