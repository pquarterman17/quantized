"""Origin export (CSV + .ogs LabTalk script): golden parity vs MATLAB.

Port of ``+utilities/exportOriginScript.m``. The golden freezes the writer's
output (line arrays) on the XRDML fixture with explicit book/sheet names. The
``.ogs`` ``// Date:`` line is a wall-clock timestamp and is exempted; every
other line — and the whole CSV — must match byte-for-byte.
Regenerate via ``tools/matlab/freeze_export_extra.m``.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from quantized.io.origin import format_origin_script
from quantized.io.xrdml import import_xrdml


@pytest.mark.golden
def test_origin_export_matches_matlab(
    fixtures_dir: Path,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    ref = load_golden("origin_export.json")
    ds = import_xrdml(fixtures_dir / "xrdml_la2nio4.xrdml")

    csv_text, ogs_text = format_origin_script(
        ds,
        csv_name=ref["csv_name"],
        book_name=ref["book"],
        sheet_name=ref["sheet"],
        make_graph=True,
        created="",
    )

    assert csv_text.splitlines() == ref["csv"]

    actual = ogs_text.splitlines()
    expected = ref["ogs"]
    assert len(actual) == len(expected)
    for a, e in zip(actual, expected, strict=True):
        if e.startswith("// Date:"):
            continue  # non-deterministic timestamp
        assert a == e


def test_origin_yerr_designation() -> None:
    # A label that looks like an error column gets LabTalk type 3 (yErr).
    from quantized.datastruct import DataStruct

    ds = DataStruct.create(
        [1.0, 2.0],
        [[10.0, 0.1], [20.0, 0.2]],
        labels=["R", "dR"],
        units=["", ""],
        metadata={"x_column_name": "Q", "x_column_unit": "1/A"},
    )
    _, ogs = format_origin_script(ds, make_graph=False)
    assert "wks.col2.type = 1;  // Y" in ogs  # R -> Y
    assert "wks.col3.type = 3;  // yErr" in ogs  # dR -> yErr
