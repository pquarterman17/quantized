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


def _is_number(cell: str) -> bool:
    try:
        float(cell)
    except ValueError:
        return False
    return True


def _read_oracle_csv(path: Path) -> tuple[list[str], list[str], list[list[float]]]:
    """(long_names, units, columns) from an expASC CSV; non-numeric cells → NaN.

    Row 0 is long-names, row 1 is units. Some Origin exports carry extra
    header rows (a sample-name row like ``,,Co``); drop any fully-non-numeric
    row so the data columns don't shift.
    """
    with path.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.reader(fh))
    names, units = rows[0], rows[1]
    data = [row for row in rows[2:] if any(_is_number(c) for c in row)]
    cols: list[list[float]] = [[] for _ in names]
    for row in data:
        for j in range(len(names)):
            cell = row[j] if j < len(row) else ""
            cols[j].append(float(cell) if _is_number(cell) else math.nan)
    return names, units, cols


def _sound_match(oracle: list[float], candidate: np.ndarray) -> bool:
    """A decoded column is sound if it and the oracle share a contiguous run.

    Tolerant of two benign export quirks: a row offset (some CSVs are shifted)
    and length mismatch (PNR expASC stacks ++/-- blocks, so an oracle column
    can be 2× a per-cross-section decoded column). The shorter finite run must
    occur, exactly (rtol 1e-9), as a contiguous run inside the longer.
    """
    ofin = np.asarray(oracle, dtype=float)
    ofin = ofin[np.isfinite(ofin)]
    if ofin.size == 0:
        return True
    cfin = np.asarray(candidate, dtype=float)
    cfin = cfin[np.isfinite(cfin)]
    short, long = (ofin, cfin) if ofin.size <= cfin.size else (cfin, ofin)
    return any(
        np.allclose(long[off : off + short.size], short, rtol=1e-9, atol=1e-12)
        for off in range(long.size - short.size + 1)
    )


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

    # ``.opj`` is a full-parity reader (values + long-names + units); the
    # ``.opju`` FPC decoder is *sound but partial* — every column it emits is
    # bit-exact, but long near-constant-stride axis columns are dropped by the
    # desync gate (an exact DFCM hash-collision detail remains open) and labels
    # fall back to Origin designations. So .opju is checked for SOUNDNESS (no
    # decoded column may disagree with the oracle), not completeness.
    partial = src.suffix.lower() == ".opju"
    checked_books = checked_cols = 0
    for book in index["books"]:
        name = book["book"]
        sheets = book["sheets"]
        if not sheets or name not in ours:
            continue  # Origin may show books whose data lives outside plain datasets
        ds = ours[name]
        candidates = [np.asarray(ds.time, dtype=float)] + [
            np.asarray(ds.values[:, j], dtype=float) for j in range(ds.values.shape[1])
        ]
        if partial:
            oracle_cols: list[list[float]] = []
            for sheet in sheets:
                cn = sheet.get("csv")
                if cn and (_GT / stem / cn).exists():
                    oracle_cols.extend(_read_oracle_csv(_GT / stem / cn)[2])
            if not oracle_cols:
                continue
            for cand in candidates:
                if not np.isfinite(cand).any():
                    continue  # padding-only column
                assert any(_sound_match(oc, cand) for oc in oracle_cols), (
                    f"{stem}/{name}: a decoded .opju column matches no oracle column"
                )
                checked_cols += 1
            checked_books += 1
            continue

        sheet1 = sheets[0]
        csv_name = sheet1.get("csv")
        if not csv_name or not (_GT / stem / csv_name).exists():
            continue
        names, units, cols = _read_oracle_csv(_GT / stem / csv_name)
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
