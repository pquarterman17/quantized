"""Convert an Origin project (``.opj`` / ``.opju``) to CSV, XLSX or ``.dwk`` files.

The engine behind ``qz convert`` (``quantized.cli_convert``) and
``quantized.api.convert_origin_project``: no Origin, no server. Every book and
sheet the reader returns (:func:`~quantized.io.origin_project.read_origin_books`)
is considered, not only the primary book ``qz.load`` gives.

**Fail closed, per book.** A book whose own metadata says it is incomplete
is reported and NOT written (:func:`book_problems`): columns the decoder could
not read (``origin_columns_lost``, ``origin_worksheet_losses``), or an X
column that was not recovered (the book's X would be row numbers). Nothing is
guessed or filled in. ``allow_partial=True`` writes such a book anyway, with
its problems still in the report and the project still marked ``partial``.
A book with no data at all (an Origin report-sheet shell) is listed as
``empty``. Project-level omissions the reader reports (datasets or matrices
that belong to no recovered book) make the project ``partial`` too.

**Outputs** (deterministic; ``<prefix>`` defaults to the project's file name,
e.g. ``run1.opj``, and every part is made filename-safe):

* ``csv``  -- one file per sheet: ``<prefix>__<Book>.csv``, and
  ``<prefix>__<Book>__sheet<k>.csv`` for sheet ``k >= 2`` of a book;
* ``xlsx`` -- one workbook per Origin book, ``<prefix>__<Book>.xlsx``, a tab
  per sheet (``Sheet1``, ``Sheet2``, ...);
* ``dwk``  -- one Quantized workspace per project, ``<prefix>.dwk``: every
  written sheet a worksheet, in the project's Project Explorer folders under
  a folder named after the file (what importing the project in the app gives).

Tables carry the Long Name and Units header rows the importers read back
(``io.datastruct_table``). Pure ``io`` layer: paths in, files and a plain
report dict out.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Literal

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.datastruct_table import write_table
from quantized.io.origin_project import read_origin_books
from quantized.io.origin_project.worksheet_fidelity import worksheet_fidelity_summary
from quantized.io.workspace_dwk import DwkDataset, workspace_json

__all__ = ["CONVERT_FORMATS", "book_problems", "convert_origin_project", "safe_name"]

ConvertFormat = Literal["csv", "xlsx", "dwk"]
CONVERT_FORMATS: tuple[str, ...] = ("csv", "xlsx", "dwk")
ORIGIN_SUFFIXES = (".opj", ".opju")

#: ``origin_worksheet_losses`` kinds that mean data of THIS book is missing or
#: unsure (``io/origin_project/opju_worksheet.py``). Not listed, and so only a
#: note: ``grammar_only`` (read from an older format without a length check)
#: and ``stale_cells`` (cells past Origin's own last used row, never data).
_BLOCKING_LOSSES = {
    "undecoded": "column(s) not decoded",
    "checksum_failed": "column(s) failed their checksum (values may be corrupt)",
    "unread_dataset": "attached dataset(s) not read",
    "text_unresolved": "column(s) with text cells that could not be read",
    "no_header": "column(s) found without a column header",
    "complex_imaginary": "complex column(s): imaginary part not imported",
    "matrix_coordinates": "matrix X/Y coordinates not recovered (axes would be cell indices)",
}
_NOTED_LOSSES = {
    "grammar_only": "column(s) read from an older Origin format without a length check",
    "stale_cells": "column(s) with cells past Origin's last used row dropped",
}
#: ``worksheet_fidelity_summary`` codes that are not a loss of data.
_NOT_LOSSES = {"stale_cells_dropped"}

_UNSAFE = re.compile(r"[^\w.\- ]+")


def safe_name(text: str) -> str:
    """``text`` as one filename component: anything but word characters,
    ``.``, ``-`` and spaces becomes ``_``; never empty."""
    cleaned = _UNSAFE.sub("_", text).strip(" .")
    return cleaned or "_"


def _names(entry: object) -> str:
    columns = entry.get("columns") if isinstance(entry, Mapping) else None
    return ", ".join(str(c) for c in columns) if isinstance(columns, list) and columns else ""


def book_problems(ds: DataStruct) -> tuple[list[str], list[str]]:
    """``(problems, notes)`` for one book. Any problem means the book is
    incomplete and is not written unless partial output was asked for."""
    meta = ds.metadata
    problems: list[str] = []
    notes: list[str] = []
    lost = meta.get("origin_columns_lost")
    if isinstance(lost, Mapping):
        for column, reason in lost.items():
            problems.append(f"column {column} not decoded ({reason})")
    losses = meta.get("origin_worksheet_losses")
    if isinstance(losses, Mapping):
        for kind, entry in losses.items():
            count = entry.get("count") if isinstance(entry, Mapping) else None
            if not isinstance(count, int) or count <= 0:
                continue
            names = _names(entry)
            label = _BLOCKING_LOSSES.get(kind)
            text = f"{count} {label or _NOTED_LOSSES.get(kind, kind)}"
            text += f": {names}" if names else ""
            (problems if label or kind not in _NOTED_LOSSES else notes).append(text)
    if meta.get("x_column_recovered") is False:
        reason = meta.get("x_column_unrecovered_reason")
        why = f": {reason}" if isinstance(reason, str) and reason else " (it would be row numbers)"
        problems.append("X column not recovered" + why)
    if meta.get("origin_decode") == "content_sniffing":
        notes.append("read by the legacy content scan (no worksheet headers in this file)")
    return problems, notes


def _has_data(ds: DataStruct) -> bool:
    """The Library's own test (``drop_empty_library_books``: numbers, or
    text), plus a worksheet's X column alone -- it is data of its own, while
    a matrix's X/Y are generated coordinates."""
    matrix = bool(ds.metadata.get("origin_matrix"))
    cells = ds.values[:, 2:] if matrix else ds.values
    numbers = bool(cells.size) and int(np.count_nonzero(np.isfinite(cells))) > 0
    x_only = not matrix and bool(np.isfinite(ds.time).any())
    return numbers or x_only or bool(ds.metadata.get("origin_text_columns"))


def _project_omissions(books: list[DataStruct]) -> list[str]:
    """What the reader says it did not recover anywhere in the project."""
    out: list[str] = []
    for ds in books:
        diag = ds.metadata.get("origin_data_diagnostics")
        if isinstance(diag, Mapping):
            out += [str(x) for x in diag.get("omissions") or [] if x]
        fidelity = ds.metadata.get("origin_worksheet_fidelity")
        if isinstance(fidelity, Mapping):
            losses = worksheet_fidelity_summary(fidelity)["losses"]
            for loss in losses if isinstance(losses, list) else []:
                if isinstance(loss, Mapping) and loss.get("code") not in _NOT_LOSSES:
                    examples = ", ".join(str(e) for e in loss.get("examples") or [])
                    out.append(
                        f"{loss.get('count')} {str(loss.get('code')).replace('_', ' ')}"
                        + (f" (e.g. {examples})" if examples else "")
                    )
    return list(dict.fromkeys(out))


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


def convert_origin_project(
    path: Path,
    out_dir: Path,
    fmt: str,
    *,
    prefix: str | None = None,
    allow_partial: bool = False,
) -> dict[str, Any]:
    """Convert one project; return its report entry (never raises for a bad
    project file -- the failure is the entry's ``status``/``error``).

    Report: ``{"source", "status": "ok"|"partial"|"failed", "error",
    "outputs": [...], "omissions": [...], "books": [{"book", "sheet",
    "long_name", "folder_path", "rows", "columns", "status":
    "written"|"partial"|"skipped"|"empty", "output", "problems", "notes"}]}``.
    """
    if fmt not in CONVERT_FORMATS:
        raise ValueError(f"unknown format {fmt!r}; choose one of {', '.join(CONVERT_FORMATS)}")
    report: dict[str, Any] = {
        "source": str(path),
        "status": "failed",
        "error": None,
        "outputs": [],
        "omissions": [],
        "books": [],
    }
    if path.suffix.lower() not in ORIGIN_SUFFIXES:
        report["error"] = f"not an Origin project (.opj or .opju): {path.name}"
        return report
    try:
        books = read_origin_books(path)
    except Exception as exc:  # noqa: BLE001 - one bad file must not stop a batch
        report["error"] = f"{type(exc).__name__}: {exc}"
        return report
    stem = safe_name(prefix or path.name)
    report["omissions"] = _project_omissions(books)

    keep: list[tuple[DataStruct, str, int, dict[str, Any]]] = []
    for i, ds in enumerate(books):
        base, sheet = _book_key(ds, i)
        problems, notes = book_problems(ds)
        folder = ds.metadata.get("origin_folder_path")
        entry: dict[str, Any] = {
            "book": base,
            "sheet": sheet,
            "long_name": str(ds.metadata.get("origin_book_long") or ""),
            "folder_path": [str(p) for p in folder] if isinstance(folder, list) else [],
            "rows": ds.n_points,
            "columns": 1 + ds.n_channels + len(ds.metadata.get("origin_text_columns") or {}),
            "status": "written",
            "output": None,
            "problems": problems,
            "notes": notes,
        }
        if problems and not allow_partial:
            entry["status"] = "skipped"  # before the empty test: say what was lost
        elif not _has_data(ds):
            entry["status"] = "empty"
        else:
            entry["status"] = "partial" if problems else "written"
            keep.append((ds, base, sheet, entry))
        report["books"].append(entry)

    if not keep:
        report["error"] = "no book could be written" + (
            "" if any(b["status"] == "skipped" for b in report["books"]) else " (no worksheet data)"
        )
        return report
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        _write(keep, out_dir, stem, fmt, path, report)
    except (OSError, ValueError) as exc:
        report["error"] = f"writing failed: {type(exc).__name__}: {exc}"
        return report
    clean = all(b["status"] in ("written", "empty") and not b["problems"] for b in report["books"])
    report["status"] = "ok" if clean and not report["omissions"] else "partial"
    return report


def _write(
    keep: list[tuple[DataStruct, str, int, dict[str, Any]]],
    out_dir: Path,
    stem: str,
    fmt: str,
    source: Path,
    report: dict[str, Any],
) -> None:
    taken: set[str] = set()
    if fmt == "dwk":
        target = out_dir / f"{stem}.dwk"
        root = source.stem
        entries = [
            DwkDataset(
                name=f"{root}:{ds.metadata.get('origin_book') or base}",
                data=ds,
                folder_path=[root, *entry["folder_path"]],
            )
            for ds, base, _sheet, entry in keep
        ]
        target.write_text(workspace_json(entries), encoding="utf-8")
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
