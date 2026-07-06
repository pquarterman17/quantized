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

from quantized.datastruct import DataStruct
from quantized.io.origin_project import (
    OriginProjectError,
    drop_empty_library_books,
    read_origin_books,
)


def _resolve_corpus_dir() -> Path:
    """The local-only ``../test-data/origin`` corpus; walks up from ``__file__``
    for a ``test-data`` sibling so this still resolves inside a worktree agent
    (an extra ``.claude/worktrees/<name>`` deep) -- mirrors
    ``test_io_origin_figures_opju.py``'s ``_resolve_spec_dir``."""
    candidate = Path(__file__).resolve().parents[1] / ".." / "test-data" / "origin"
    if candidate.exists():
        return candidate
    for ancestor in Path(__file__).resolve().parents:
        walked = ancestor / "test-data" / "origin"
        if walked.exists():
            return walked
    return candidate


_TD = _resolve_corpus_dir()
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


def _read_oracle_csv(
    path: Path, columns: list[dict] | None = None
) -> tuple[list[str], list[str], list[list[float]]]:
    """(long_names, units, columns) from an expASC CSV; non-numeric cells → NaN.

    expASC's header height is VARIABLE: row 0 is always long-names, but the
    units row is only written when some column has a unit, and the comments
    row only when some column has a comment (observed live 2026-07-06: a
    unitless XRD sheet exports name-row-then-data, eating the first data row
    under the old fixed two-row assumption). ``index.json`` records units and
    comments authoritatively, so when the book's column dicts are passed the
    header height is *derived* from them — never guessed from row content
    (a comments row can be fully numeric, e.g. Moke's ``525`` sample labels,
    so content-sniffing cannot distinguish it from data). Without ``columns``
    the legacy two-row layout is assumed.
    """
    try:
        with path.open(encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.reader(fh))
    except UnicodeDecodeError:
        # expASC writes ANSI unless told otherwise — a label with e.g. Å is
        # cp1252 bytes, not UTF-8 (SuperlatticeFits corpus).
        with path.open(encoding="cp1252", newline="") as fh:
            rows = list(csv.reader(fh))
    if not rows:  # an empty book exports a zero-byte CSV (XMCD Book1)
        return [], [], []
    # expASC's header height is a property of the sheet's VISIBLE columns
    # (index metadata can disagree — a hidden name-carrying column removes
    # the whole names row from the export, seen live on XMCD), so classify
    # by content: a header row has at least one non-empty NON-numeric cell
    # (or is fully empty); the first row whose non-empty cells are all
    # numeric starts the data. A pathological fully-numeric header row
    # would leak one stray row into the data — which the containment
    # matcher then fails LOUDLY for that column, so misclassification
    # cannot pass silently.
    n_header = 0
    for row in rows[:3]:
        nonempty = [cell for cell in row if cell.strip()]
        if nonempty and all(_is_number(cell) for cell in nonempty):
            break
        n_header += 1
    ncols = max(len(r) for r in rows)
    # names/units are for the metadata assertions — empty when the export
    # carried no such row (asserting index fallback short-names against
    # decoded LONG names would be apples-to-oranges).
    names = rows[0] if n_header >= 1 else [""] * ncols
    # The units row (when present) is row 1; disambiguate a names+comments
    # header (no units) via the index metadata when available.
    has_units = n_header >= 2 and (
        columns is None or any(c.get("unit", "") for c in columns)
    )
    units = rows[1] if has_units else [""] * ncols
    data = [row for row in rows[n_header:] if any(_is_number(c) for c in row)]
    cols: list[list[float]] = [[] for _ in range(ncols)]
    for row in data:
        for j in range(ncols):
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


def _finite_window(a: np.ndarray) -> np.ndarray:
    """``a`` trimmed to its first..last finite cell (internal NaNs kept)."""
    idx = np.nonzero(np.isfinite(a))[0]
    return a[idx[0] : idx[-1] + 1] if idx.size else a[:0]


def _run_eq(seg: np.ndarray, arr: np.ndarray) -> bool:
    """``seg`` occurs as a contiguous run in ``arr`` (exact over seg's finite
    cells, rtol 1e-9)."""
    if len(seg) > len(arr):
        return False
    fin = np.isfinite(seg)
    if not fin.any():
        return True
    return any(
        np.allclose(seg[fin], arr[off : off + len(seg)][fin], rtol=1e-9, atol=1e-12)
        for off in range(len(arr) - len(seg) + 1)
    )


def _column_matches(oracle: list[float], candidate: np.ndarray) -> bool:
    """Oracle column content is explained by the decoded column (rtol 1e-9).

    The COM oracle exports Origin's *view* while the decoder reads the
    *stored* dataset, and three view artifacts are real in the corpus
    (2026-07-06): a hidden/filtered leading row (XMCD ``T1066all3`` exports
    549 of the stored 550 rows — the decode's rows 1.. match the export
    exactly), masked cells exported as ``--`` (NaN here), and view stacking
    that repeats the dataset verbatim (MnN ``Book1``: the same 146 rows
    exactly 3x in every column). So:

    * oracle ≤ decode: the oracle's finite window must occur as one
      contiguous run inside the decode's finite window;
    * oracle > decode: ONLY an exact k-fold tiling of the decode's finite
      window is accepted — a genuinely-longer dataset with distinct tail
      rows does not tile, so real truncation still fails loudly.
    """
    o = _finite_window(np.asarray(oracle, dtype=float))
    c = _finite_window(np.asarray(candidate, dtype=float))
    if o.size == 0:
        return True  # an all-NaN/empty oracle column carries no content
    if c.size == 0:
        return False
    if o.size <= c.size:
        return _run_eq(o, c)
    k, rem = divmod(o.size, c.size)
    if rem or k < 2:
        return False
    return all(_run_eq(o[i * c.size : (i + 1) * c.size], c) for i in range(k))


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
    # Some oracles are graph-only (e.g. the Hc2 COM capture skipped the expensive
    # per-sheet dump); with no "books" section there's nothing to compare here.
    if not index.get("books"):
        pytest.skip(f"{stem}: oracle has no books section (graph-only)")
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
                    oracle_cols.extend(
                        _read_oracle_csv(_GT / stem / cn, sheet.get("columns"))[2]
                    )
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
        names, units, cols = _read_oracle_csv(
            _GT / stem / csv_name, sheet1.get("columns")
        )
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


def test_realdata_opju_wide_book_column_names() -> None:
    """The .opju column-name reader must scale to Hc2's wide measurement sheets
    (37-42 columns, past Z into AA.., interleaved book windows). Every recovered
    long-name must match Origin's own CSV export exactly (no WRONG names -- a
    mis-named column is worse than a generic one), and coverage must clear a
    floor. Regression guard for the _MAX_RUN / Excel-lettering / broadened-label
    / independent-anchor fix."""
    src = _TD / "Hc2 data.opju"
    gt_dir = _GT / "Hc2 data"
    if not src.exists() or not gt_dir.exists():
        pytest.skip("Hc2 corpus not present")
    generic = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ")

    def gt_names(book: str) -> set[str]:
        out: set[str] = set()
        for p in gt_dir.glob(f"{book}_s*.csv"):
            with p.open(encoding="utf-8-sig", newline="") as fh:
                out |= {c for c in next(csv.reader(fh)) if c and c != "TDI Format 1.5"}
        return out

    books = read_origin_books(src)
    recovered = matched = 0
    total_labels = named_labels = 0
    for b in books:
        total_labels += len(b.labels)
        named_labels += sum(
            1 for lab in b.labels if str(lab) and not (len(str(lab)) == 1 and str(lab) in generic)
        )
        gts = gt_names(str(b.metadata.get("origin_book", "")))
        if not gts:
            continue
        for lab in [*b.labels, b.metadata.get("x_column_long", "")]:
            lab = str(lab)
            if not lab or (len(lab) == 1 and lab in generic):
                continue
            recovered += 1
            if lab in gts:
                matched += 1
    assert recovered > 200, f"far too few names recovered ({recovered})"
    assert matched == recovered, f"{recovered - matched} WRONG column names (must be 0)"
    assert named_labels / total_labels >= 0.6, f"coverage {named_labels}/{total_labels} below floor"


@pytest.mark.parametrize("stem", ["Hc2 data", "hc2convert"])
def test_realdata_empty_report_books_gated_from_library(stem: str) -> None:
    """Origin fit/report sheets surface as empty pseudo-books (``Book2@N`` shells
    whose numeric values are empty and whose content is unresolved ``cell://``
    stubs). ``drop_empty_library_books`` must hide every book with no finite data
    and no text, and must never drop a data-bearing book. The Hc2 project alone
    produced 48 such shells in the ``.opju`` (and 3 in the ``.opj``)."""
    src = _TD / f"{stem}.opju"
    if not src.exists():
        src = _TD / f"{stem}.opj"
    if not src.exists():
        pytest.skip(f"{stem} not in corpus")
    books = read_origin_books(src)
    kept = drop_empty_library_books(books)
    kept_ids = {id(b) for b in kept}

    def has_data(b: DataStruct) -> bool:
        return bool(b.values.size) and int(np.count_nonzero(np.isfinite(b.values))) > 0

    # No data-bearing book is ever gated.
    for b in books:
        if has_data(b):
            assert id(b) in kept_ids, f"{b.metadata.get('origin_book')} has data but was gated"
    # Every kept book has plottable data or text content.
    for b in kept:
        assert has_data(b) or b.metadata.get("origin_text_columns")
    # Hc2 genuinely has empty shells to gate.
    assert len(kept) < len(books)
