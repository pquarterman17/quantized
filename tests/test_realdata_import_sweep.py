"""Every non-EM corpus data file imports, with its vendor's technique
(round-4 import audit). Local-only: the ../test-data corpus is private, so
this skips in CI.

``test_realdata_corpus.py`` imports one representative per vendor; this
sweeps every file the registry recognises by name, so a regression in any
sniffer or parser shows up against the real instrument files.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io.registry import import_auto, is_recognised_data_name

pytestmark = pytest.mark.realdata

# Electron-microscopy / imaging folders (fermiviewer's scope) are not swept.
VENDORS = (
    "quantum-design", "bruker/xrd", "bruker/ftir", "rigaku", "panalytical", "ncnr",
    "orso", "reductus", "refl1d", "eag", "spc", "jcamp", "synthetic",
)

# Files the registry refuses on purpose, with the reason.
EXPECTED_REFUSALS = {
    "orso/reflectometry/orsopy_not_orso.ort": "not an ORSO file",  # negative fixture
    "bruker/xrd/FAIRmat_RSM.brml": "reciprocal-space maps are not supported",
}

# Technique by corpus folder prefix; refl1d/ncnr exports mix reflectivity
# (reflectometry) with SLD profiles (generic), so those are not pinned.
TECHNIQUE_BY_PREFIX = {
    "quantum-design/": ("magnetometry.mvsh", "magnetometry.mvst"),
    "panalytical/xrd/": ("xrd.powder", "xrd.rsm", "generic"),
    "rigaku/": ("xrd.powder",),
    "bruker/xrd/": ("xrd.powder",),
    "bruker/ftir/": ("spectroscopy",),
    "jcamp/": ("spectroscopy",),
    "spc/": ("spectroscopy",),
    "eag/": ("sims",),
    "synthetic/sims/": ("sims",),
    "orso/": ("reflectometry",),
    "reductus/": ("reflectometry",),
}


def _corpus_files(root: Path) -> list[str]:
    files: list[str] = []
    for vendor in VENDORS:
        for path in sorted((root / vendor).rglob("*")):
            if path.is_file() and is_recognised_data_name(path.name):
                files.append(path.relative_to(root).as_posix())
    return files


def test_every_corpus_data_file_imports(corpus_dir: Path) -> None:
    failures: list[str] = []
    for rel in _corpus_files(corpus_dir):
        refusal = EXPECTED_REFUSALS.get(rel)
        try:
            ds = import_auto(corpus_dir / rel)
        except Exception as exc:  # noqa: BLE001 - collected and reported together
            if refusal is None or refusal not in str(exc):
                failures.append(f"{rel}: {type(exc).__name__}: {exc}")
            continue
        if refusal is not None:
            failures.append(f"{rel}: imported, expected a refusal ({refusal})")
            continue
        if ds.values.shape[0] == 0 or not np.isfinite(ds.values).any():
            failures.append(f"{rel}: no finite data")
        if np.isnan(ds.time).all():
            failures.append(f"{rel}: x axis is all NaN")
        technique = ds.metadata.get("technique")
        for prefix, allowed in TECHNIQUE_BY_PREFIX.items():
            if rel.startswith(prefix) and technique not in allowed:
                failures.append(f"{rel}: technique {technique!r} not in {allowed}")
    assert failures == []
