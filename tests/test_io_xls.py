"""Legacy ``.xls`` import (xlrd) and the Origin window-file hint."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io.registry import import_auto, import_auto_sheets

FIXTURE = Path(__file__).parent / "fixtures" / "tiny_legacy.xls"


def test_xls_numeric_text_and_date_columns() -> None:
    ds = import_auto(FIXTURE)
    assert ds.metadata["parser_name"] == "import_xls"
    assert ds.metadata["sheet_name"] == "Scan"
    np.testing.assert_allclose(ds.time, [0, 100, 200, 300, 400, 500])
    assert list(ds.labels) == ["Moment"]
    assert list(ds.units) == ["emu"]
    np.testing.assert_allclose(ds.values[:, 0], [1.0, 1.5, 2.0, 2.5, 3.0, 3.5])
    text = ds.metadata["text_columns"]
    assert text["Note"][:2] == ["ok", "low"]
    assert text["When"][0].startswith("2024-01-01")


def test_xls_one_dataset_per_data_sheet() -> None:
    sheets = import_auto_sheets(FIXTURE)
    assert [d.metadata["sheet_name"] for d in sheets] == ["Scan", "Second"]
    np.testing.assert_allclose(sheets[1].values[:, 0], [0, 1, 4, 9, 16])
    assert any("Summary" in n for n in sheets[0].metadata["notes"])


def test_ogw_hint_is_honest(tmp_path: Path) -> None:
    p = tmp_path / "g.ogw"
    p.write_bytes(b"CPYA 1 \n" + b"\0" * 32)
    with pytest.raises(ValueError) as exc:
        import_auto(p)
    msg = str(exc.value)
    assert "can't decode Origin window files" in msg
    assert ".opj/.opju" in msg
    assert "open it in Origin and save" not in msg
