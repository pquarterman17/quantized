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


def test_non_q_x_axis_keeps_its_own_name() -> None:
    # The MATLAB writer came from the neutron tool and always titled X "Q"; the
    # GUI offers it for every dataset, so a magnetometry sweep exported as
    # "Q (K)". A Q axis keeps "Q" (golden parity); any other keeps its name.
    mpms = DataStruct.create(
        [2.0, 5.0],
        [[1e-3], [2e-3]],
        labels=["Long Moment"],
        units=["emu"],
        metadata={"x_column_name": "Temperature", "x_column_unit": "K"},
    )
    std = consolidate_csv([(mpms, "mpms.dat"), _datasets()[0]], fmt="standard")
    assert std.splitlines()[0] == "Temperature (K),Long Moment (emu),Q (1/A),R,dR"
    org = consolidate_csv([(mpms, "mpms.dat")], fmt="origin")
    assert org.splitlines()[0] == "Temperature,Long Moment"


def test_designations_follow_declared_error_roles() -> None:
    ds = DataStruct.create(
        [0.01, 0.02],
        [[1.0, 0.1, 1e-4], [0.5, 0.05, 1e-4]],
        labels=["R", "sR", "sQz"],
        units=["", "", "1/A"],
        metadata={
            "x_column_name": "Qz",
            "error_roles": [
                {"channel": 1, "target": 0, "axis": "y", "side": "both"},
                {"channel": 2, "target": -1, "axis": "x", "side": "both"},
            ],
        },
    )
    org = consolidate_csv([(ds, "a.ort")], fmt="origin")
    assert org.splitlines()[3] == "X,Y,yEr,xEr"
