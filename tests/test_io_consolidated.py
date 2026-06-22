"""Consolidated CSV export: golden parity vs MATLAB.

Port of the per-dataset-block path of ``saveConsolidatedNeutronCSV.m``. The
golden froze MATLAB's output for two synthetic same-measurement neutron scans
(3 and 2 rows) in both header styles; we rebuild the identical inputs and assert
byte-for-byte. Regenerate via ``tools/matlab/freeze_export_extra.m``.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from quantized.datastruct import DataStruct
from quantized.io.consolidated import consolidate_csv


def _datasets() -> list[tuple[DataStruct, str]]:
    ds1 = DataStruct.create(
        [0.01, 0.02, 0.03],
        [[1.0, 0.10], [0.5, 0.05], [0.25, 0.02]],
        labels=["R", "dR"],
        units=["", ""],
        metadata={"xColumnName": "Qz", "xColumnUnit": "1/A", "source": "meas_a.refl"},
    )
    ds2 = DataStruct.create(
        [0.01, 0.02],
        [[0.9, 0.09], [0.45, 0.04]],
        labels=["R", "dR"],
        units=["", ""],
        metadata={"xColumnName": "Qz", "xColumnUnit": "1/A", "source": "meas_b.refl"},
    )
    return [(ds1, "meas_a.refl"), (ds2, "meas_b.refl")]


@pytest.mark.golden
@pytest.mark.parametrize("fmt", ["standard", "origin"])
def test_consolidated_matches_matlab(
    fmt: str,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    ref = load_golden(f"consolidated_csv_{fmt}.json")
    text = consolidate_csv(_datasets(), fmt=fmt)
    assert text.splitlines() == ref["csv"]


def test_ragged_columns_blank_pad() -> None:
    # The shorter dataset leaves trailing cells blank, not NaN.
    text = consolidate_csv(_datasets(), fmt="standard")
    last = text.splitlines()[-1]
    assert last == "0.03,0.25,0.02,,,"


def test_bad_fmt_raises() -> None:
    with pytest.raises(ValueError, match="fmt"):
        consolidate_csv(_datasets(), fmt="nope")
