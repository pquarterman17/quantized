"""Convert an Origin project (``.opj`` / ``.opju``) to CSV, XLSX or ``.dwk`` files.

The engine behind ``qz convert`` (``quantized.cli_convert``) and
``quantized.api.convert_origin_project``: no Origin, no server. The project is
read the way the app's import route reads it (``read_origin_project_all``,
``drop_empty_library_books``, the figures + fidelity manifest of
``io/origin_project/import_manifest.py``, with its file-length check), and
every book and sheet is considered, not only the primary book ``qz.load``
gives.

**Fail closed.** (``io/origin_convert_checks.py`` says what counts.)

* A book that lost data -- a column not decoded, an X not recovered, cells
  blanked, a sheet not identified, matrix coordinates or a complex column's
  imaginary part not recovered, read by the legacy content scan -- is
  reported and NOT written. Project-level losses are attributed to their
  book wherever the reader's record names it.
* A loss no recovered book owns (a dataset or matrix the reader could not
  place, a truncated file, a book list that could not be built) means the
  project's output cannot be vouched for: NOTHING is written for it and it is
  ``failed``.
* ``allow_partial=True`` writes all of it anyway; every problem stays in the
  report and the project is ``partial`` (exit 1 in the CLI).

A book with no data (an Origin report-sheet shell) is ``empty``; a text-only
sheet (notes, sample lists) is written as its text columns.

**Outputs** (deterministic; ``<prefix>`` defaults to the project's file name,
e.g. ``run1.opj``, every part made filename-safe):

* ``csv``  -- one file per sheet: ``<prefix>__<Book>.csv``, and
  ``<prefix>__<Book>__sheet<k>.csv`` for sheet ``k >= 2`` of a book;
* ``xlsx`` -- one workbook per Origin book, ``<prefix>__<Book>.xlsx``, a tab
  per sheet (``Sheet1``, ``Sheet2``, ...);
* ``dwk``  -- one Quantized workspace per project, ``<prefix>.dwk``, the
  same Library an import of the project in the app gives (``io/workspace_dwk``).

Tables carry the Long Name and Units rows, and an Origin book's designations,
comments and date formats on a column-roles line, all of which the importers
read back (``io/datastruct_table.py``, ``io/_column_marker.py``). Pure ``io``.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io._column_marker import column_marker
from quantized.io.datastruct_table import write_table
from quantized.io.origin_convert_checks import attribute_losses, book_notes, book_problems
from quantized.io.origin_project import drop_empty_library_books, read_origin_project_all
from quantized.io.origin_project.fidelity import with_data_diagnostics
from quantized.io.origin_project.import_manifest import origin_figures_and_fidelity
from quantized.io.workspace_dwk import OriginWorkspace, workspace_json

__all__ = ["CONVERT_FORMATS", "convert_origin_project", "safe_name"]

CONVERT_FORMATS: tuple[str, ...] = ("csv", "xlsx", "dwk")
ORIGIN_SUFFIXES = (".opj", ".opju")

_UNSAFE = re.compile(r"[^\w.\- ]+")


def safe_name(text: str) -> str:
    """``text`` as one filename component: anything but word characters,
    ``.``, ``-`` and spaces becomes ``_``; never empty."""
    cleaned = _UNSAFE.sub("_", text).strip(" .")
    return cleaned or "_"


def _has_data(ds: DataStruct) -> bool:
    """The Library's own test (``drop_empty_library_books``: numbers, or
    text), plus a worksheet's X column alone -- it is data of its own, while
    a matrix's X/Y are generated coordinates."""
    matrix = bool(ds.metadata.get("origin_matrix"))
    cells = ds.values[:, 2:] if matrix else ds.values
    numbers = bool(cells.size) and int(np.count_nonzero(np.isfinite(cells))) > 0
    x_only = not matrix and bool(np.isfinite(ds.time).any())
    return numbers or x_only or bool(ds.metadata.get("origin_text_columns"))


def _roles_carried(ds: DataStruct) -> bool:
    """Do the book's designations / comments / date formats reach a table
    file? (They ride ``io/_column_marker.py``'s line when they line up.)"""
    meta = ds.metadata
    has = any(
        meta.get(k) for k in ("column_designations", "column_comments", "origin_column_formats")
    )
    return not has or bool(meta.get("origin_matrix")) or column_marker(ds) is not None


def _book_key(ds: DataStruct, index: int) -> tuple[str, int]:
    """``("Book4", 2)`` for ``origin_book`` ``"Book4@2"``; sheet 1 without ``@``."""
    key = str(ds.metadata.get("origin_book") or f"Book{index + 1}")
    base, _, sheet = key.partition("@")
    return base, int(sheet) if sheet.isdigit() else 1


def _unique(name: str, taken: set[str]) -> str:
    out, k = name, 2
    while out.lower() in taken:
        out, k = f"{name}~{k}", k + 1
    taken.add(out.lower())
    return out


def _project_checks(
    raw: bytes, suffix: str, books: list[DataStruct], primary: DataStruct
) -> tuple[list[dict[str, Any]], Mapping[str, Any], list[DataStruct], list[str], list[str]]:
    """``(figures, fidelity manifest, listed books, unowned losses, notes)``:
    the import route's manifest, and what in it no book owns."""
    listed = drop_empty_library_books(books) if books else [primary]
    figures, manifest = origin_figures_and_fidelity(raw, suffix, listed, primary=primary)
    fidelity = with_data_diagnostics(manifest, primary.metadata.get("origin_data_diagnostics"))
    unowned: list[str] = []
    notes: list[str] = []
    integrity = fidelity.get("container_integrity")
    if isinstance(integrity, Mapping):
        if integrity.get("complete") is False:
            unowned.append(f"file_truncated: {integrity.get('detail')}")
        elif integrity.get("complete") is None:
            notes.append(f"file length not verified: {integrity.get('detail')}")
    if not books:
        unowned.append("the project's book list could not be built; only its primary book was read")
    return figures, fidelity, listed, unowned, notes


def convert_origin_project(
    path: Path,
    out_dir: Path,
    fmt: str,
    *,
    prefix: str | None = None,
    allow_partial: bool = False,
    imported_at: str | None = None,
) -> dict[str, Any]:
    """Convert one project; return its report entry (never raises for a bad
    project file -- the failure is the entry's ``status``/``error``).

    Report: ``{"source", "status": "ok"|"partial"|"failed", "error",
    "outputs": [...], "omissions": [...], "notes": [...], "books": [{"book",
    "sheet", "long_name", "folder_path", "rows", "columns", "status":
    "written"|"partial"|"skipped"|"empty", "output", "problems", "notes"}]}``.
    ``omissions`` are the losses no book owns. ``imported_at`` stamps a
    ``.dwk``'s datasets (the CLI passes the current time).
    """
    if fmt not in CONVERT_FORMATS:
        raise ValueError(f"unknown format {fmt!r}; choose one of {', '.join(CONVERT_FORMATS)}")
    report: dict[str, Any] = {
        "source": str(path),
        "status": "failed",
        "error": None,
        "outputs": [],
        "omissions": [],
        "notes": [],
        "books": [],
    }
    suffix = path.suffix.lower()
    if suffix not in ORIGIN_SUFFIXES:
        report["error"] = f"not an Origin project (.opj or .opju): {path.name}"
        return report
    try:
        raw = path.read_bytes()
        primary, books = read_origin_project_all(path, raw=raw)
        figures, fidelity, listed, unowned, notes = _project_checks(raw, suffix, books, primary)
    except Exception as exc:  # noqa: BLE001 - one bad file must not stop a batch
        report["error"] = f"{type(exc).__name__}: {exc}"
        return report
    books = books or [primary]
    attributed = attribute_losses(books)
    report["omissions"] = [*unowned, *attributed.unattributed]
    report["notes"] = notes

    keep: list[tuple[DataStruct, str, int, dict[str, Any]]] = []
    for i, ds in enumerate(books):
        base, sheet = _book_key(ds, i)
        own = str(ds.metadata.get("origin_book") or "")
        problems = list(dict.fromkeys([*book_problems(ds), *attributed.by_book.get(own, [])]))
        folder = ds.metadata.get("origin_folder_path")
        texts = ds.metadata.get("origin_text_columns")
        entry: dict[str, Any] = {
            "book": base,
            "sheet": sheet,
            "long_name": str(ds.metadata.get("origin_book_long") or ""),
            "folder_path": [str(p) for p in folder] if isinstance(folder, list) else [],
            "rows": ds.n_points,
            "columns": ds.n_channels + (len(texts) if isinstance(texts, Mapping) else 0),
            "status": "written",
            "output": None,
            "problems": problems,
            "notes": book_notes(ds),
        }
        if fmt != "dwk" and not _roles_carried(ds):
            entry["notes"].append(
                "column designations, comments or date formats are not carried in "
                f"the {fmt} file (they do not line up with its columns)"
            )
        if problems and not allow_partial:
            entry["status"] = "skipped"
        elif not _has_data(ds):
            entry["status"] = "empty"
        else:
            entry["status"] = "partial" if problems else "written"
            keep.append((ds, base, sheet, entry))
        report["books"].append(entry)

    if report["omissions"] and not allow_partial:
        for _ds, _b, _s, entry in keep:
            entry["status"] = "skipped"
            entry["problems"].append("not written: the project has a loss no book owns (omissions)")
        report["error"] = "the project lost data no recovered book owns; nothing written"
        return report
    if not keep:
        skipped = any(b["status"] == "skipped" for b in report["books"])
        report["error"] = "no book could be written" + ("" if skipped else " (no worksheet data)")
        return report
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        _write(
            keep,
            out_dir,
            safe_name(prefix or path.name),
            fmt,
            report,
            path,
            primary,
            figures,
            fidelity,
            len(listed),
            imported_at,
        )
    except (OSError, ValueError) as exc:
        report["error"] = f"writing failed: {type(exc).__name__}: {exc}"
        return report
    clean = all(b["status"] in ("written", "empty") and not b["problems"] for b in report["books"])
    report["status"] = "ok" if clean and not report["omissions"] else "partial"
    return report


def _write(  # noqa: PLR0913 - one call site, every argument is the project's
    keep: list[tuple[DataStruct, str, int, dict[str, Any]]],
    out_dir: Path,
    stem: str,
    fmt: str,
    report: dict[str, Any],
    source: Path,
    primary: DataStruct,
    figures: list[dict[str, Any]],
    fidelity: Mapping[str, Any],
    listed: int,
    imported_at: str | None,
) -> None:
    taken: set[str] = set()
    if fmt == "dwk":
        target = out_dir / f"{stem}.dwk"
        ws = OriginWorkspace(
            file_name=source.name,
            books=[ds for ds, *_ in keep],
            listed=listed,
            primary_book=str(primary.metadata.get("origin_book") or ""),
            figures=figures,
            fidelity=fidelity,
            source_path=str(source.resolve()),
            imported_at=imported_at,
        )
        target.write_text(workspace_json(ws), encoding="utf-8")
        for *_, entry in keep:
            entry["output"] = target.name
        report["outputs"].append(target.name)
        return
    if fmt == "xlsx":
        by_book: dict[str, list[tuple[DataStruct, int, dict[str, Any]]]] = {}
        for ds, base, sheet, entry in keep:
            by_book.setdefault(base, []).append((ds, sheet, entry))
        for base, sheets in by_book.items():
            name = _unique(f"{stem}__{safe_name(base)}", taken)
            target = out_dir / f"{name}.xlsx"
            write_table([(f"Sheet{sheet}", ds) for ds, sheet, _ in sheets], target)
            for *_, entry in sheets:
                entry["output"] = target.name
            report["outputs"].append(target.name)
        return
    for ds, base, sheet, entry in keep:
        suffix = "" if sheet == 1 else f"__sheet{sheet}"
        name = _unique(f"{stem}__{safe_name(base)}{suffix}", taken)
        target = out_dir / f"{name}.csv"
        write_table([(f"Sheet{sheet}", ds)], target)
        entry["output"] = target.name
        report["outputs"].append(target.name)
