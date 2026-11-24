"""Convert any registered data file: the non-Origin half of ``qz convert``
(``quantized.cli_convert``) and the quick converter.

Every file ``import_auto_sheets`` reads -- instrument files (PANalytical
``.xrdml`` / ``.raw``, Rigaku, Bruker, QD magnetometry ``.dat``), HDF5 /
NeXus, MATLAB ``.mat``, Igor ``.ibw``, images, tables -- is turned into
CSV, Excel, ``.xy``, HDF5 / NeXus, ``.mat``, JSON or ``.npz``. Each dataset of
the file (a workbook sheet, a scan, an HDF5 group, a struct, a TIFF page) is
one book. The owner policies (containers one file, flat formats one file per
dataset, long tables for 2-D maps, where metadata goes) are in
:mod:`quantized.io.convert_plan`; names come from ``plan_outputs``:

* ``csv`` / ``xy`` -- ``<prefix>.<fmt>``, or ``<prefix>__<dataset>.<fmt>`` per
  dataset of a multi-dataset file;
* ``xlsx``, ``h5``, ``nxs``, ``mat``, ``json``, ``npz`` -- one ``<prefix>.<fmt>``.

``dwk`` is refused (a ``.dwk`` workspace is built from an Origin project's
books and figures). The report entry has the shape ``convert_origin_project``
returns (plus ``format``, ``detected``, ``outcome``), so the CLI prints and
totals both alike. Nothing is overwritten (``io/write_guard.py``), no partial
output is left behind (temp file, then rename); a refused read is the entry's
``failed`` status, never an exception. Pure ``io``.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io import convert_containers as cc
from quantized.io import convert_flat as flat
from quantized.io.convert_defaults import PROVISIONAL, default_format
from quantized.io.convert_maps import is_map
from quantized.io.convert_meta import flatten_metadata
from quantized.io.convert_plan import (
    ALL_FORMATS,
    XLSX_TAB_MAX,
    Producer,
    safe_name,
    unique_name,
    write_group,
)
from quantized.io.registry import import_auto_sheets

__all__ = [
    "DATA_CONVERT_FORMATS",
    "classify_outcome",
    "convert_data_file",
    "dataset_label",
    "producer_for",
]

DATA_CONVERT_FORMATS = ALL_FORMATS


def dataset_label(ds: DataStruct, index: int) -> str:
    """The dataset's own name (sheet / scan / group), else ``Sheet<k>``."""
    name = ds.metadata.get("sheet_name")
    return str(name) if name else f"Sheet{index + 1}"


def producer_for(fmt: str, *, metadata: bool = True) -> Producer:
    """``producer(temp_path, [(name, DataStruct)])`` writing ``fmt``."""
    if fmt == "csv":
        return lambda p, sets: p.write_bytes(
            flat.format_csv(sets[0][1], sets[0][0], metadata=metadata)
        )
    if fmt == "xy":
        return lambda p, sets: p.write_bytes(
            flat.format_xy(sets[0][1], sets[0][0], metadata=metadata)
        )
    if fmt == "xlsx":
        return lambda p, sets: p.write_bytes(flat.format_workbook(sets, metadata=metadata))
    writers: dict[str, Callable[[Path, Sequence[tuple[str, DataStruct]]], object]] = {
        "h5": cc.write_h5,
        "nxs": cc.write_h5,
        "mat": cc.write_mat,
        "json": cc.write_json,
        "npz": cc.write_npz,
    }
    return writers[fmt]


def classify_outcome(entry: dict[str, Any]) -> dict[str, Any]:
    """Add ``outcome`` (``done`` | ``partial`` | ``skipped-exists`` | ``failed``)
    and ``reason`` (plain text, ``None`` when done) to a report entry."""
    problems = [str(p) for b in entry["books"] for p in b["problems"]]
    if entry["status"] == "ok":
        outcome, reason = "done", None
    elif entry["status"] == "partial":
        outcome, reason = "partial", "; ".join(dict.fromkeys(problems)) or None
    elif (
        problems and all("exists, not overwritten" in p for p in problems) and not entry["outputs"]
    ):
        outcome = "skipped-exists"
        reason = "output already exists (use --overwrite to replace it)"
    else:
        outcome = "failed"
        reason = entry["error"] or "; ".join(dict.fromkeys(problems)) or "not converted"
    entry["outcome"], entry["reason"] = outcome, reason
    return entry


def convert_data_file(  # noqa: PLR0913 - one call site per surface
    path: Path,
    out_dir: Path,
    fmt: str,
    *,
    prefix: str | None = None,
    overwrite: bool = False,
    protected: Sequence[Path | str] = (),
    metadata: bool = True,
) -> dict[str, Any]:
    """Convert one data file; return its report entry (never raises for a bad
    file -- the failure is the entry's ``status``/``error``). ``metadata=False``
    leaves the ``#`` header / ``metadata`` sheet out of the flat formats."""
    report: dict[str, Any] = {
        "source": str(path),
        "format": fmt,
        "status": "failed",
        "error": None,
        "outputs": [],
        "omissions": [],
        "notes": [],
        "books": [],
    }
    if fmt not in (*DATA_CONVERT_FORMATS, "auto"):
        report["error"] = (
            f"{fmt!r} output is for Origin projects only; choose one of "
            f"{', '.join(DATA_CONVERT_FORMATS)}"
        )
        return report
    try:
        books = import_auto_sheets(path)
    except Exception as exc:  # noqa: BLE001 - one bad file must not stop a batch
        report["error"] = f"{type(exc).__name__}: {exc}"
        return report
    first = books[0].metadata
    report["notes"] = [str(n) for n in first.get("notes", [])]
    report["detected"] = {
        "parser": str(first.get("parser_name") or ""),
        "technique": str(first.get("technique") or ""),
    }
    if fmt == "auto":  # the guess (io/convert_defaults.py), from what was parsed
        fmt = default_format(
            report["detected"]["technique"] or "generic",
            len(books),
            has_map=any(is_map(ds) for ds in books),
        )
        report["format_source"] = f"auto ({PROVISIONAL})"
    report["format"] = fmt
    seen: set[str] = {"metadata"} if fmt == "xlsx" else set()
    limit = XLSX_TAB_MAX if fmt == "xlsx" else None
    labels = [
        unique_name(safe_name(dataset_label(ds, i)), seen, limit) for i, ds in enumerate(books)
    ]
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
                "notes": _flat_notes(ds, fmt) if metadata else [],
            }
        )
    keep = [
        (e["book"], ds, e)
        for ds, e in zip(books, report["books"], strict=True)
        if e["status"] == "written"
    ]
    if not keep:
        report["error"] = "no dataset holds numbers"
        return report
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        guard = {"overwrite": overwrite, "protected": [path, *protected]}
        stem = safe_name(prefix or path.name)
        write_group(keep, out_dir, stem, fmt, report, guard, producer_for(fmt, metadata=metadata))
    except (OSError, ValueError) as exc:
        report["error"] = f"writing failed: {type(exc).__name__}: {exc}"
        return report
    if not report["outputs"]:
        report["error"] = "nothing written: every output was refused or failed"
        return report
    clean = all(b["status"] in ("written", "empty") for b in report["books"])
    report["status"] = "ok" if clean else "partial"
    return report


def _flat_notes(ds: DataStruct, fmt: str) -> list[str]:
    if fmt not in ("csv", "xy", "xlsx"):
        return []
    _, cut = flatten_metadata(ds.metadata)
    notes = []
    if cut:
        notes.append(
            f"metadata value(s) cut in the {fmt} file (kept whole in h5/nxs/mat/json/npz): "
            + ", ".join(cut)
        )
    if fmt == "xy" and ds.metadata.get("origin_text_columns"):
        notes.append("text columns are not written to .xy")
    return notes
