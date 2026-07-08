"""Smoke test over the ../test-data sibling corpus (ORIGIN_GAP_PLAN #45).

One representative file per vendor/technique goes through import_auto and
must yield a well-formed DataStruct. Local-only (realdata marker): skips
in CI and on machines without the corpus checkout.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io.registry import import_auto

pytestmark = pytest.mark.realdata

REPRESENTATIVES = [
    "quantum-design/magnetometry/mpms_mvsh.dat",
    "quantum-design/magnetometry/vsm_mh_perp_a.dat",
    "ncnr/reflectometry/PNR_NoSpinFlip/S3_150Oe_From300Oe.refl",
    "ncnr/reflectometry/PNR_SF/S11_20G_NSF.pnr",
    "reductus/xrr/NbAu_XRR_v2.refl",
    "refl1d/xrr/Nb XRR/XRR-refl.dat",
    "rigaku/xrd/YIG_Py_S3.raw",
    "bruker/xrd/xylib_BT86.raw",
    "bruker/xrd/FAIRmat_2thomega.brml",
    "panalytical/xrd/La2NiO4_1.xrdml",
    "panalytical/xrd/peakpo_feooh.xrdml",
    "jcamp/ir/ethanol.jdx",
    "jcamp/torture/sqzdupd1.jdx",
    "synthetic/netcdf/andi_ms_tic.cdf",
    "synthetic/netcdf/generic_spectrum.nc",
    "eag/sims/sims_depth_profile.xlsx",
    "synthetic/sims/sims_stack_oxide.csv",
]


@pytest.mark.parametrize("rel", REPRESENTATIVES)
def test_corpus_file_imports(corpus_dir: Path, rel: str) -> None:
    path = corpus_dir / rel
    if not path.exists():
        pytest.skip(f"corpus file missing: {rel}")
    ds = import_auto(str(path))
    assert ds.values.ndim == 2
    assert ds.values.shape[0] > 0
    assert len(ds.labels) == ds.values.shape[1]
    assert np.isfinite(ds.values).any()


def test_corpus_xrdml_full_sweep(corpus_dir: Path) -> None:
    """ORIGIN_GAP_PLAN #46 (PIXcel3D audit): EVERY PANalytical corpus file must
    parse — schemas 1.0-2.2, PIXcel/PIXcel1D/PIXcel3D/GaliPIX3D detectors,
    1-D scans, RSMs (mesh/snapshot/coupled), and pole figures (mesh_kind
    "pole", gap #46 residual — see test_io_xrdml.py::test_pole_figure_*)."""
    files = sorted((corpus_dir / "panalytical" / "xrd").glob("*.xrdml"))
    if not files:
        pytest.skip("no PANalytical corpus files present")
    failures: list[str] = []
    for f in files:
        try:
            ds = import_auto(str(f))
            assert ds.values.shape[0] > 0
        except Exception as exc:  # noqa: BLE001 — collecting a per-file report
            failures.append(f"{f.name}: {type(exc).__name__}: {exc}")
    assert not failures, "corpus files failed to parse:\n" + "\n".join(failures)
