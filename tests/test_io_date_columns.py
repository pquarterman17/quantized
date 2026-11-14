"""Date/time X columns import as timestamps, by both import paths (audit #7).

Direct import already read an ISO or US-slash date column as UTC epoch
seconds with ``time_is_datetime``. Two gaps: the dotted European form
(``14.11.2026 10:00:00`` -- Nanonis and German/Swiss locale exports) was not
recognised at all, and the Import Wizard read any date X with ``float()``
alone, so the same file came through the wizard as an all-NaN X. Synthetic
fixtures only.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest

from quantized.io.delimited import import_csv
from quantized.io.import_preview import guess_settings, parse_import

_STAMPS = [datetime(2026, 11, 14, h, 30, tzinfo=UTC).timestamp() for h in (10, 11, 12)]

_LAYOUTS = {
    "iso": "2026-11-14 {h:02d}:30:00",
    "us-slash": "11/14/2026 {h:02d}:30:00",
    "dotted": "14.11.2026 {h:02d}:30:00",
    "year-slash": "2026/11/14 {h:02d}:30",
}


def _text(layout: str) -> str:
    rows = [f"{_LAYOUTS[layout].format(h=h)};{20 + h}" for h in (10, 11, 12)]
    return "Date;Temp (C)\n" + "\n".join(rows) + "\n"


@pytest.mark.parametrize("layout", list(_LAYOUTS))
def test_direct_import_reads_the_date_column(tmp_path: Path, layout: str) -> None:
    path = tmp_path / "log.csv"
    path.write_text(_text(layout), encoding="utf-8")
    ds = import_csv(path)
    assert ds.metadata["time_is_datetime"] is True
    np.testing.assert_allclose(ds.time, _STAMPS)


@pytest.mark.parametrize("layout", list(_LAYOUTS))
def test_the_wizard_reads_the_same_date_column(layout: str) -> None:
    text = _text(layout)
    ds = parse_import(text, guess_settings(text))
    assert ds.metadata["time_is_datetime"] is True
    assert ds.metadata["time_timezone"] == "UTC"
    np.testing.assert_allclose(ds.time, _STAMPS)
    assert ds.labels == ("Temp",)


def test_a_numeric_x_is_not_a_date() -> None:
    text = "T;R\n1;2\n2;3\n3;4\n"
    ds = parse_import(text, guess_settings(text))
    assert "time_is_datetime" not in ds.metadata
