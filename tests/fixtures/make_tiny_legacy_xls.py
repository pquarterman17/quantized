"""Regenerates tests/fixtures/tiny_legacy.xls and tiny_legacy_1904.xls.

xlrd only reads .xls, so the two binary fixtures were written once with xlwt
(not a project dependency):

    uv run --with xlwt python tests/fixtures/make_tiny_legacy_xls.py

tiny_legacy.xls: sheet "Scan" (header + unit rows, numeric, text and date
columns), "Second" (numeric), "Summary" (text only, so it is skipped).
tiny_legacy_1904.xls: one sheet with a date column under the 1904 date system.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import xlwt  # type: ignore[import-not-found]

HERE = Path(__file__).parent


def _legacy() -> None:
    wb = xlwt.Workbook()
    ws = wb.add_sheet("Scan")
    for c, h in enumerate(["Field", "Moment", "Note", "When"]):
        ws.write(0, c, h)
    ws.write(1, 0, "(Oe)")
    ws.write(1, 1, "(emu)")
    dfmt = xlwt.easyxf(num_format_str="YYYY-MM-DD")
    for i in range(6):
        ws.write(2 + i, 0, float(i * 100))
        ws.write(2 + i, 1, 0.5 * i + 1)
        ws.write(2 + i, 2, "ok" if i % 2 == 0 else "low")
        ws.write(2 + i, 3, dt.datetime(2024, 1, 1 + i), dfmt)
    ws2 = wb.add_sheet("Second")
    ws2.write(0, 0, "T")
    ws2.write(0, 1, "R")
    for i in range(5):
        ws2.write(1 + i, 0, float(i))
        ws2.write(1 + i, 1, float(i * i))
    wb.add_sheet("Summary").write(0, 0, "nothing numeric here")
    wb.save(str(HERE / "tiny_legacy.xls"))


def _1904() -> None:
    wb = xlwt.Workbook()
    wb.dates_1904 = True
    ws = wb.add_sheet("Log")
    ws.write(0, 0, "When")
    ws.write(0, 1, "Value")
    dfmt = xlwt.easyxf(num_format_str="YYYY-MM-DD")
    for i in range(4):
        ws.write(1 + i, 0, dt.datetime(2024, 1, 1 + i), dfmt)
        ws.write(1 + i, 1, float(i))
    wb.save(str(HERE / "tiny_legacy_1904.xls"))


if __name__ == "__main__":
    _legacy()
    _1904()
