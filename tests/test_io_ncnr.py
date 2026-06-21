"""NCNR reductus .refl parser: golden parity vs MATLAB + behaviour."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.ncnr import import_ncnr_refl


@pytest.mark.golden
def test_ncnr_refl_matches_matlab(
    fixtures_dir: Path,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    ref = load_golden("ncnr_j395_default.json")
    ds = import_ncnr_refl(fixtures_dir / "ncnr_j395.refl")
    assert list(ds.labels) == list(ref["labels"])
    assert list(ds.units) == list(ref["units"])
    assert_allclose(ds.time, np.asarray(ref["time"], dtype=float), rtol=1e-9, atol=1e-12)
    ref_values = np.asarray(ref["values"], dtype=float).reshape(ds.values.shape)
    assert_allclose(ds.values, ref_values, rtol=1e-9, atol=1e-12)


def test_ncnr_refl_structure(fixtures_dir: Path) -> None:
    ds = import_ncnr_refl(fixtures_dir / "ncnr_j395.refl")
    # time = Qz; values = Intensity / uncertainty / resolution
    assert ds.labels == ("Intensity", "uncertainty", "resolution")
    assert ds.metadata["x_column_name"] == "Qz"
    assert ds.n_channels == 3
    assert ds.n_points == 325


def test_registry_routes_refl(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "ncnr_j395.refl")
    assert ds.metadata["parser_name"] == "import_ncnr_refl"
