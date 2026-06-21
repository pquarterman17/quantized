"""SIMS depth-profile parser: golden parity (shared + interpolated) + behaviour.

Direct-call only — .csv/.xlsx are ambiguous with generic CSV/Excel, so the
registry doesn't auto-route SIMS (same ambiguity MATLAB has).
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from quantized.io.sims import import_sims


@pytest.mark.golden
def test_sims_shared_depth_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    # Shared-depth layout -> no interpolation -> exact parity.
    ds = import_sims(fixtures_dir / "sims_shared.csv")
    assert_golden(ds, "sims_shared_default.json")


@pytest.mark.golden
def test_sims_paired_interpolation_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    # Paired columns with differing depth grids -> union grid + interp1.
    ds = import_sims(fixtures_dir / "sims_barrier.csv")
    assert_golden(ds, "sims_barrier_default.json")


def test_sims_shared_structure(fixtures_dir: Path) -> None:
    ds = import_sims(fixtures_dir / "sims_shared.csv")
    assert ds.labels == ("H", "O", "Si")
    assert ds.units == ("atoms/cc", "atoms/cc", "atoms/cc")
    assert ds.metadata["x_column_name"] == "Depth"
    assert ds.metadata["is_paired_layout"] is False


def test_sims_paired_recovers_element_names(fixtures_dir: Path) -> None:
    ds = import_sims(fixtures_dir / "sims_barrier.csv")
    assert ds.metadata["is_paired_layout"] is True
    # Element names recovered from the vendor row above the header; 'Cu->' -> 'Cu'
    assert ds.labels == ("H", "C", "O", "N", "F", "Cu", "Ta", "Si", "Ti", "W")
