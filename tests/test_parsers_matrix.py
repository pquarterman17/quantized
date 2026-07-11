"""Parameterized parser matrix: every registered parser x every corpus file.

PORT_PLAN W9 #52. The registry (``quantized.io.registry``) is the single
source of truth for what quantized can import; this module walks every
available corpus for files whose extension the registry claims and asserts,
for each one, that

- ``resolve_parser`` routes it (fixtures MUST route; local-corpus files a
  sniffer legitimately declines are skipped with a reason),
- the import returns a valid frozen :class:`~quantized.datastruct.DataStruct`
  (2-D values, time length == row count, labels/units lengths == column
  count, finite-or-NaN values, metadata mapping present), and
- a re-import is deterministic (same labels/units/shape/values).

Corpus roots:

- ``tests/fixtures/``            committed -> runs everywhere, including CI
- ``../quantized_matlab/+test_datasets/``  shared MATLAB corpus -> ``realdata``
- ``../test-data/``              local instrument corpus     -> ``realdata``

``test_registry_route_coverage`` additionally reports, per registry route
(extension -> parser), whether ANY corpus file exercises it — a route with no
file at all xfails by name, so the coverage gap list is visible in every run.

Origin RE-harness artifacts under ``../test-data/origin`` (byte-surgery
``probes/``, ``specimens/_probe``/``_folder_probe``, and the ``ground_truth``
/ ``verify`` oracle CSV exports) are excluded: they are inputs/outputs of the
decoder's own dedicated suites (``test_io_origin_*``), not instrument data —
several are deliberately truncated or hostile.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path

import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io.registry import _EXT_MAP, _SNIFFERS, resolve_parser

TESTS_DIR = Path(__file__).parent
FIXTURES = TESTS_DIR / "fixtures"

# Every extension the registry claims (unambiguous map + sniffer chains).
KNOWN_EXTS = frozenset(_EXT_MAP) | frozenset(_SNIFFERS)

# Path prefixes (posix, relative to the corpus root) excluded from the walk.
# See module docstring: Origin RE probes are deliberately corrupt, and the
# oracle CSV trees are decoder ground truth, not import corpus.
_EXCLUDE_PREFIXES = (
    "origin/probes/",
    "origin/specimens/_probe/",
    "origin/specimens/_folder_probe/",
    "origin/specimens/ground_truth/",
    # RE probe artifacts (byte-probing specimens with *_truth.json oracles,
    # exercised by test_io_origin_project/-_fuzz), not instrument data.
    "origin/specimens/probe_",
)

# Known-gap corpus files: relative posix path -> reason. These xfail (not
# skip) so the gap stays visible until the decoder grows the feature. Add
# entries ONLY with a named, documented gap.
_KNOWN_GAPS: dict[str, str] = {
    # Multi-scan RSM .brml: the 1-D parser declines by pinned contract
    # (test_io_bruker_brml.test_fairmat_rsm_rejected). Real coverage gap:
    # no 2-D .brml import yet.
    "Bruker/FAIRmat_RSM.brml": "multi-scan RSM .brml is declined by the 1-D parser (contract)",
    "bruker/xrd/FAIRmat_RSM.brml": (
        "multi-scan RSM .brml is declined by the 1-D parser (contract)"
    ),
    # Matrix-only Origin project: the matrix (MBook) codec is undecoded
    # (origin format gap register §13.2 #9); a clean OriginProjectError with
    # guidance is the pinned contract (test_io_origin_fuzz).
    "origin/specimens/matrix_spec.opju": (
        "matrix-only Origin project: MBook codec undecoded (format gap register 13.2 #9)"
    ),
}


def _find_sibling(name: str) -> Path | None:
    """Resolve a sibling checkout (``test-data``, ``quantized_matlab``).

    Worktree-safe: an agent worktree lives extra levels deep, so walk every
    ancestor for the sibling instead of assuming ``../../`` (same approach as
    ``conftest._resolve_test_data_corpus``).
    """
    for ancestor in TESTS_DIR.resolve().parents:
        candidate = ancestor / name
        if candidate.is_dir():
            return candidate
    return None


def _walk_corpus(root: Path) -> Iterator[Path]:
    """Yield corpus files with a registry-claimed extension, sorted, pruned."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in {".git", "node_modules"})
        for fname in sorted(filenames):
            path = Path(dirpath) / fname
            if path.suffix.lower() not in KNOWN_EXTS:
                continue
            rel = path.relative_to(root).as_posix()
            if any(rel.startswith(prefix) for prefix in _EXCLUDE_PREFIXES):
                continue
            yield path


# Corpus roots: key -> (path, needs realdata marker). Fixtures are committed
# and run in CI; the sibling corpora are local-only.
_MATLAB_CHECKOUT = _find_sibling("quantized_matlab")
_ROOTS: dict[str, tuple[Path | None, bool]] = {
    "fixtures": (FIXTURES, False),
    "matlab": (
        _MATLAB_CHECKOUT / "+test_datasets" if _MATLAB_CHECKOUT is not None else None,
        True,
    ),
    "local": (_find_sibling("test-data"), True),
}


def _matrix_params() -> list[object]:
    params: list[object] = []
    for key, (root, is_realdata) in _ROOTS.items():
        if root is None or not root.is_dir():
            continue
        marks = [pytest.mark.realdata] if is_realdata else []
        for path in _walk_corpus(root):
            rel = path.relative_to(root).as_posix()
            case_marks = list(marks)
            reason = _KNOWN_GAPS.get(rel)
            if reason is not None:
                case_marks.append(pytest.mark.xfail(reason=reason, strict=False))
            params.append(
                pytest.param(key, path, id=f"{key}:{rel}", marks=case_marks)
            )
    return params


_MATRIX = _matrix_params()


@pytest.fixture(autouse=True)
def _isolated_import_filters(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Point QZ_CONFIG_DIR at an empty dir so a user's saved import filters
    (io/import_filters — consulted by resolve_parser BEFORE the sniffers)
    cannot reroute matrix files on a developer machine."""
    monkeypatch.setenv("QZ_CONFIG_DIR", str(tmp_path / "qz-config"))


def _assert_valid_datastruct(ds: object, name: str) -> DataStruct:
    """The frozen-DataStruct invariants every parser must honour."""
    assert isinstance(ds, DataStruct), f"{name}: parser returned {type(ds)!r}"
    assert ds.values.ndim == 2, f"{name}: values must be 2-D"
    assert ds.time.ndim == 1, f"{name}: time must be 1-D"
    assert ds.time.shape[0] == ds.values.shape[0], (
        f"{name}: time length {ds.time.shape[0]} != row count {ds.values.shape[0]}"
    )
    assert ds.values.shape[0] > 0, f"{name}: import produced zero rows"
    n_cols = ds.values.shape[1]
    assert n_cols > 0, f"{name}: import produced zero columns"
    assert len(ds.labels) == n_cols, f"{name}: {len(ds.labels)} labels for {n_cols} columns"
    assert len(ds.units) == n_cols, f"{name}: {len(ds.units)} units for {n_cols} columns"
    # finite-or-NaN: +/-Inf in imported data means a parse/scale bug upstream.
    assert not np.isinf(ds.time).any(), f"{name}: time contains +/-Inf"
    assert not np.isinf(ds.values).any(), f"{name}: values contain +/-Inf"
    assert hasattr(ds.metadata, "keys"), f"{name}: metadata mapping missing"
    return ds


@pytest.mark.parametrize(("root_key", "path"), _MATRIX)
def test_parser_matrix(root_key: str, path: Path) -> None:
    if not path.is_file():  # corpus moved since collection
        pytest.skip(f"corpus file vanished: {path.name}")
    try:
        parser = resolve_parser(path)
    except ValueError as exc:
        if root_key == "fixtures":
            raise  # every committed fixture MUST route
        pytest.skip(f"no registered parser claims {path.name}: {exc}")

    ds = _assert_valid_datastruct(parser(path), path.name)

    # Re-import must be deterministic: identical labels/units/shape/values.
    ds2 = _assert_valid_datastruct(parser(path), path.name)
    assert ds2.labels == ds.labels, f"{path.name}: labels differ between imports"
    assert ds2.units == ds.units, f"{path.name}: units differ between imports"
    assert ds2.values.shape == ds.values.shape, f"{path.name}: shape differs between imports"
    assert np.array_equal(ds2.time, ds.time, equal_nan=True), (
        f"{path.name}: time differs between imports"
    )
    assert np.array_equal(ds2.values, ds.values, equal_nan=True), (
        f"{path.name}: values differ between imports"
    )


# ── Route coverage: which (extension -> parser) entries have NO corpus file ──

@lru_cache(maxsize=1)
def _all_corpus_files() -> tuple[Path, ...]:
    """Every walkable corpus file across the available roots (walked once)."""
    files: list[Path] = []
    for _key, (root, _is_realdata) in _ROOTS.items():
        if root is not None and root.is_dir():
            files.extend(_walk_corpus(root))
    return tuple(files)


def _route_params() -> list[object]:
    """One case per unique registry route (extension, parser name)."""
    seen: set[tuple[str, str]] = set()
    params: list[object] = []
    for ext, parser in _EXT_MAP.items():
        seen.add((ext, parser.__name__))
    for ext, chain in _SNIFFERS.items():
        for _sniff, parser in chain:
            seen.add((ext, parser.__name__))
    for ext, name in sorted(seen):
        params.append(pytest.param(ext, name, id=f"{ext}->{name}"))
    return params


@pytest.mark.parametrize(("ext", "parser_name"), _route_params())
def test_registry_route_coverage(ext: str, parser_name: str) -> None:
    """xfail (by name) for every registry route no corpus file exercises.

    Runs against whatever corpora are present: in CI that is the committed
    fixtures only, so locally-covered routes may still xfail there — the
    local run is the authoritative coverage report.
    """
    candidates = [p for p in _all_corpus_files() if p.suffix.lower() == ext]

    if ext in _EXT_MAP:
        # Unambiguous extension: any file of that extension exercises it.
        if not candidates:
            pytest.xfail(f"no corpus file with '{ext}' for {parser_name}")
        return

    for path in candidates:
        try:
            if resolve_parser(path).__name__ == parser_name:
                return  # route exercised
        except ValueError:
            continue
    pytest.xfail(f"no corpus file routes '{ext}' to {parser_name}")
