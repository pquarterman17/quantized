"""Ground-truth oracle suite (plan item 28): our readers vs Origin's own dumps.

While the Origin trial lasted, ``tools/origin_trial/export_ground_truth.py``
made Origin itself export every project's content:
``../test-data/origin/specimens/ground_truth/<stem>/`` holds per-sheet CSVs
(long-name row + unit row + full-precision data) and an ``index.json``
(books → sheets → column metadata; graphs → axes + plot refs).

These tests compare ``read_origin_books`` output against that oracle —
the strongest "Origin agrees with us" check that can run without Origin.
Per-stem parametrized; skips where the oracle or source file is absent
(so CI and other machines stay green). ``.opju`` stems auto-activate the
moment the decoder (plan item 8) stops raising.

Comparison strategy is deliberately order-free: Origin's CSV lists columns
in sheet order while our DataStruct moves the designation-X column first,
so values are matched column-to-column by content (every oracle column must
match exactly one of ours within tolerance) and names as sets.
"""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import numpy as np
import pytest

from quantized.io.origin_project import OriginProjectError, read_origin_books

_TD = Path(__file__).resolve().parents[1] / ".." / "test-data" / "origin"
_GT = _TD / "specimens" / "ground_truth"

pytestmark = pytest.mark.realdata


def _stems() -> list[str]:
    if not _GT.exists():
        return []
    return sorted(d.name for d in _GT.iterdir() if (d / "index.json").exists())


def _source_for(stem: str) -> Path | None:
    for parent in (_TD, _TD / "specimens"):
        for ext in (".opj", ".opju"):
            p = parent / f"{stem}{ext}"
            if p.exists():
                return p
    return None


def _read_oracle_csv(path: Path) -> tuple[list[str], list[str], list[list[float]]]:
    """(long_names, units, columns) from an expASC CSV; non-numeric cells → NaN."""
    with path.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.reader(fh))
    names, units, data = rows[0], rows[1], rows[2:]
    cols: list[list[float]] = [[] for _ in names]
    for row in data:
        for j in range(len(names)):
            cell = row[j] if j < len(row) else ""
            try:
                cols[j].append(float(cell))
            except ValueError:
                cols[j].append(math.nan)
    return names, units, cols


def _column_matches(oracle: list[float], candidate: np.ndarray) -> bool:
    """Oracle column == candidate over the oracle's finite cells (rtol 1e-9)."""
    o = np.asarray(oracle, dtype=float)
    n = min(len(o), len(candidate))
    if n == 0 or len(o) - n > 1:  # allow one trailing-row slack from padding
        return n == len(o) == len(candidate)
    o, c = o[:n], np.asarray(candidate[:n], dtype=float)
    finite = np.isfinite(o)
    if not finite.any():
        return True
    return bool(np.allclose(o[finite], c[finite], rtol=1e-9, atol=1e-12))


@pytest.mark.parametrize("stem", _stems() or ["<no oracle present>"])
def test_reader_matches_origin_ground_truth(stem: str) -> None:
    if not _GT.exists() or stem == "<no oracle present>":
        pytest.skip("ground-truth oracle not present on this machine")
    src = _source_for(stem)
    if src is None:
        pytest.skip(f"source file for '{stem}' not present")
    index = json.loads((_GT / stem / "index.json").read_text(encoding="utf-8"))
    try:
        ours = {ds.metadata["origin_book"]: ds for ds in read_origin_books(src)}
    except OriginProjectError:
        pytest.skip(f"reader for {src.suffix} still pending (plan item 8)")

    checked_books = checked_cols = 0
    for book in index["books"]:
        name = book["book"]
        sheets = book["sheets"]
        if not sheets or name not in ours:
            continue  # Origin may show books whose data lives outside plain datasets
        sheet1 = sheets[0]
        csv_name = sheet1.get("csv")
        if not csv_name or not (_GT / stem / csv_name).exists():
            continue
        ds = ours[name]
        names, units, cols = _read_oracle_csv(_GT / stem / csv_name)
        candidates = [np.asarray(ds.time, dtype=float)] + [
            np.asarray(ds.values[:, j], dtype=float) for j in range(ds.values.shape[1])
        ]
        for j, oracle_col in enumerate(cols):
            assert any(_column_matches(oracle_col, c) for c in candidates), (
                f"{stem}/{name}: oracle column {j} ({names[j]!r}) matches no "
                f"decoded column"
            )
            checked_cols += 1
        # every non-empty oracle long name must appear among our labels/x
        our_names = set(ds.labels) | {ds.metadata.get("x_column_long", "")}
        for nm in names:
            if nm and not nm.startswith(("Unnamed", "Sheet")):
                assert nm in our_names, f"{stem}/{name}: long name {nm!r} missing"
        our_units = set(ds.units) | {ds.metadata.get("x_unit", "")}
        for un in units:
            if un:
                assert un in our_units, f"{stem}/{name}: unit {un!r} missing"
        checked_books += 1
    if checked_books == 0:
        pytest.skip(f"{stem}: no comparable books (all multi-sheet/non-dataset)")
    assert checked_cols > 0
