"""`.xls` by content (not name), integral cells, and the 1904 date system."""

from __future__ import annotations

import datetime as dt
import shutil
from pathlib import Path

import numpy as np
import xlrd

from quantized.io.registry import import_auto, import_auto_sheets

FIX = Path(__file__).parent / "fixtures"


def test_1904_date_system_reads_the_same_calendar_date() -> None:
    assert xlrd.open_workbook(str(FIX / "tiny_legacy_1904.xls")).datemode == 1
    ds = import_auto(FIX / "tiny_legacy_1904.xls")
    first = dt.datetime.fromtimestamp(float(ds.time[0]), dt.UTC)
    assert first == dt.datetime(2024, 1, 1, tzinfo=dt.UTC)
    np.testing.assert_allclose(np.diff(ds.time), 86400.0)


def test_integral_cells_are_ints_like_xlsx() -> None:
    from quantized.io.excel_xls import _cell

    class C:
        ctype = xlrd.XL_CELL_NUMBER
        value = 2019.0

    assert _cell(None, C()) == 2019
    assert isinstance(_cell(None, C()), int)


def test_tab_separated_text_named_xls_imports_as_a_table(tmp_path: Path) -> None:
    p = tmp_path / "export.xls"
    p.write_text("T\tR\n1\t10\n2\t20\n3\t30\n", encoding="utf-8")
    ds = import_auto(p)
    np.testing.assert_allclose(ds.values[:, 0], [10, 20, 30])


def test_xlsx_renamed_xls_imports_as_xlsx(tmp_path: Path) -> None:
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["T", "R"])
    for i in range(4):
        ws.append([i, i * 2.0])
    xlsx = tmp_path / "real.xlsx"
    wb.save(xlsx)
    renamed = tmp_path / "renamed.xls"
    shutil.copy(xlsx, renamed)
    ds = import_auto(renamed)
    assert ds.metadata["parser_name"] == "import_excel"
    assert [d.metadata["parser_name"] for d in import_auto_sheets(renamed)] == ["import_excel"]
