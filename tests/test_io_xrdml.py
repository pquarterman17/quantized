"""PANalytical XRDML parser: golden parity vs MATLAB + behaviour."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.xrdml import import_xrdml


@pytest.mark.golden
def test_xrdml_default_matches_matlab(
    fixtures_dir: Path,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    ref = load_golden("xrdml_la2nio4_default.json")
    ds = import_xrdml(fixtures_dir / "xrdml_la2nio4.xrdml")  # default: cps
    assert list(ds.labels) == list(ref["labels"])
    assert list(ds.units) == list(ref["units"])
    assert_allclose(ds.time, np.asarray(ref["time"], dtype=float), rtol=1e-9, atol=1e-9)
    ref_values = np.asarray(ref["values"], dtype=float).reshape(ds.values.shape)
    assert_allclose(ds.values, ref_values, rtol=1e-9, atol=1e-9)


def test_xrdml_defaults_cps(fixtures_dir: Path) -> None:
    ds = import_xrdml(fixtures_dir / "xrdml_la2nio4.xrdml")
    assert ds.labels == ("Intensity",)
    assert ds.units == ("cps",)
    assert ds.metadata["x_column_name"] == "2-Theta"
    assert ds.n_points > 0
    # 2theta is monotonic increasing across the scan
    assert ds.time[0] < ds.time[-1]


def test_xrdml_counts_option(fixtures_dir: Path) -> None:
    cps = import_xrdml(fixtures_dir / "xrdml_la2nio4.xrdml", intensity="cps")
    counts = import_xrdml(fixtures_dir / "xrdml_la2nio4.xrdml", intensity="counts")
    assert counts.units == ("counts",)
    ct = counts.metadata["counting_time"]
    # cps == counts / counting_time
    assert_allclose(cps.values, counts.values / ct, rtol=1e-12)


def test_registry_routes_xrdml(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "xrdml_la2nio4.xrdml")
    assert ds.metadata["parser_name"] == "import_xrdml"
