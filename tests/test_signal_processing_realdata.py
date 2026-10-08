"""Representative local-corpus acceptance for the general signal workbench.

These tests deliberately exercise the same pure correction engine used by the
live preview, linked worksheet commit, and Pipeline Studio replay.  The sibling
corpus is optional in CI, but on a developer machine this protects the common
XRD, SIMS, reflectometry, and magnetometry paths with real instrument files.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from quantized.calc.corrections import apply_corrections
from quantized.io.registry import import_auto

pytestmark = pytest.mark.realdata


@pytest.mark.parametrize(
    ("relative", "params"),
    [
        (
            "panalytical/xrd/La2NiO4_1.xrdml",
            {
                "signalChannels": [0],
                "xTrimMin": 10.0,
                "xTrimMax": 80.0,
                "smoothEnabled": True,
                "smoothMethod": "savitzky-golay",
                "smoothWindow": 5,
                "smoothPolyOrder": 3,
            },
        ),
        (
            "eag/sims/sims_depth_profile.xlsx",
            {
                "signalChannels": [0],
                "normMethod": "Reference",
                "normReferenceMin": 0.8,
                "normReferenceMax": 2.5,
            },
        ),
        (
            "ncnr/reflectometry/PNR_NoSpinFlip/S3_650Oe_From700mT.refl",
            {
                "signalChannels": [0, 2],
                "normMethod": "Reference",
                "normReferenceMin": 0.005,
                "normReferenceMax": 0.012,
            },
        ),
        (
            "quantum-design/magnetometry/vsm_mh_perp_a.dat",
            {"signalChannels": [0], "detrendOrder": 1},
        ),
    ],
)
def test_real_instrument_signal_transform_is_non_destructive(
    corpus_dir: Path,
    relative: str,
    params: dict[str, Any],
) -> None:
    path = corpus_dir / relative
    if not path.exists():
        pytest.skip(f"corpus file missing: {relative}")
    bytes_before = hashlib.sha256(path.read_bytes()).digest()
    source = import_auto(path)
    time_before = source.time.copy()
    values_before = source.values.copy()

    result = apply_corrections(source, params)

    np.testing.assert_array_equal(source.time, time_before)
    np.testing.assert_array_equal(source.values, values_before)
    assert hashlib.sha256(path.read_bytes()).digest() == bytes_before
    assert result.values.shape[1] == source.values.shape[1]
    assert np.isfinite(result.values[:, params["signalChannels"]]).any()
    assert result is not source
