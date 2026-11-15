"""Convert any other registered data file to CSV / XLSX: the non-Origin half of
``qz convert`` (``quantized.cli_convert``).

``qz convert`` was written for Origin projects; the same command now takes
every file ``import_auto_sheets`` reads -- HDF5 / NeXus, MATLAB ``.mat``, Igor
``.ibw``, images, and the instrument and table formats -- so an archive can be
turned into plain tables with no GUI. Each dataset of the file (a workbook
sheet, an HDF5 group, a struct, a TIFF page) is one book, written the way
``io/origin_convert.py`` writes a sheet:

* ``csv``  -- ``<prefix>.csv`` for a one-dataset file, else
  ``<prefix>__<dataset>.csv`` per dataset;
* ``xlsx`` -- one workbook, ``<prefix>.xlsx``, a tab per dataset.

``dwk`` is refused (a ``.dwk`` workspace is built from an Origin project's
books and figures). The report entry has the shape ``convert_origin_project``
returns, so the CLI prints and totals both alike. Nothing is overwritten
(``io/write_guard.py``); a refused read is the entry's ``failed`` status, never
an exception. Pure ``io``.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.datastruct_table import write_table
from quantized.io.origin_convert import safe_name
from quantized.io.registry import import_auto_sheets
from quantized.io.write_guard import WriteRefused

__all__ = ["DATA_CONVERT_FORMATS", "convert_data_file"]

DATA_CONVERT_FORMATS = ("csv", "xlsx")
_XLSX_TAB_MAX = 31


def _label(ds: DataStruct, index: int) -> str:
    name = ds.metadata.get("sheet_name")
    return str(name) if name else f"Sheet{index + 1}"


def _unique(name: str, taken: set[str], limit: int | None = None) -> str:
    base = name[:limit] if limit else name
    out, k = base, 2
    while out.lower() in taken:
        suffix = f"~{k}"
        out, k = (base[: limit - len(suffix)] if limit else base) + suffix, k + 1
    taken.add(out.lower())
    return out


def convert_data_file(
    path: Path,
    out_dir: Path,
    fmt: str,
    *,
    prefix: str | None = None,
    overwrite: bool = False,
    protected: Sequence[Path | str] = (),
) -> dict[str, Any]:
    """Convert one data file; return its report entry (never raises for a bad
    file -- the failure is the entry's ``status``/``error``)."""
    report: dict[str, Any] = {
        "source": str(path),
        "status": "failed",
        "error": None,
        "outputs": [],
        "omissions": [],
        "notes": [],
        "books": [],
    }
    if fmt not in DATA_CONVERT_FORMATS:
        report["error"] = (
            f"{fmt!r} output is for Origin projects only; "
            f"choose {' or '.join(DATA_CONVERT_FORMATS)}"
        )
        return report
    try:
        books = import_auto_sheets(path)
    except Exception as exc:  # noqa: BLE001 - one bad file must not stop a batch
        report["error"] = f"{type(exc).__name__}: {exc}"
        return report
    report["notes"] = [str(n) for n in books[0].metadata.get("notes", [])]
    taken: set[str] = set()
    seen: set[str] = set()
    labels = [_unique(_label(ds, i), seen) for i, ds in enumerate(books)]
    for i, ds in enumerate(books):
        report["books"].append(
            {
                "book": labels[i],
                "sheet": i + 1,
                "long_name": "",
                "folder_path": [],
                "rows": ds.n_points,
                "columns": ds.n_channels + 1,
                "status": "written" if ds.n_points and np.isfinite(ds.values).any() else "empty",
                "output": None,
                "problems": [],
                "notes": [],
            }
        )
    pairs = zip(books, report["books"], strict=True)
    keep = [(ds, e) for ds, e in pairs if e["status"] == "written"]
    if not keep:
        report["error"] = "no dataset holds numbers"
        return report
    out_dir.mkdir(parents=True, exist_ok=True)
    guard = {"overwrite": overwrite, "protected": [path, *protected]}
    stem = safe_name(prefix or path.name)
    try:
        _write(keep, out_dir, stem, fmt, report, guard, taken)
    except (OSError, ValueError) as exc:
        report["error"] = f"writing failed: {type(exc).__name__}: {exc}"
        return report
    if not report["outputs"]:
        report["error"] = "nothing written: every output was refused"
        return report
    clean = all(b["status"] in ("written", "empty") for b in report["books"])
    report["status"] = "ok" if clean else "partial"
    return report


def _write(
    keep: list[tuple[DataStruct, dict[str, Any]]],
    out_dir: Path,
    stem: str,
    fmt: str,
    report: dict[str, Any],
    guard: dict[str, Any],
    taken: set[str],
) -> None:
    if fmt == "xlsx":
        target = out_dir / f"{stem}.xlsx"
        tabs: set[str] = set()
        sheets = [(_unique(safe_name(e["book"]), tabs, _XLSX_TAB_MAX), ds) for ds, e in keep]
        try:
            write_table(sheets, target, **guard)
        except WriteRefused as exc:
            _refuse([e for _, e in keep], exc)
            return
        for _, e in keep:
            e["output"] = target.name
        report["outputs"].append(target.name)
        return
    for ds, e in keep:
        single = len(report["books"]) == 1
        name = stem if single else _unique(f"{stem}__{safe_name(e['book'])}", taken)
        target = out_dir / f"{name}.csv"
        try:
            write_table([(e["book"], ds)], target, **guard)
        except WriteRefused as exc:
            _refuse([e], exc)
            continue
        e["output"] = target.name
        report["outputs"].append(target.name)


def _refuse(entries: list[dict[str, Any]], exc: WriteRefused) -> None:
    for e in entries:
        e["status"] = "skipped"
        e["problems"].append(str(exc))
