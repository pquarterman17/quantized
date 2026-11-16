"""A NaN spelling is a missing value, not text (UX8-H item 6).

``2,000;NaN / 3,000; / 4,000;0,5`` imported R as a CATEGORICAL channel
``[0, nan, 1]`` (the codes of "NaN" and "0,5") through direct import, while
the Import Wizard read ``[nan, nan, 0.5]``. ``delimited._numeric_column``
counted "NaN" as a filled non-number cell, so one number in two "filled"
cells was not a majority. The decimal-comma reader (`_decimal_comma._is_neutral`)
and the wizard's role guess already treat a NaN spelling as missing.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io.import_preview import guess_settings, parse_import
from quantized.io.registry import import_auto


def _write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "nan.csv"
    path.write_text(text, encoding="utf-8")
    return path


def _same(values: np.ndarray, expected: list[float]) -> bool:
    return bool(np.allclose(values, expected, equal_nan=True))


@pytest.mark.parametrize(
    "text",
    [
        "T;R\n2,000;NaN\n3,000;\n4,000;0,5\n",  # the reported repro
        "T;R\n2,000;nan\n3,000;\n4,000;0,5\n",
        "T;R\n2,000;-NaN\n3,000;n/a\n4,000;0,5\n",
        "T;R\n2.0;NaN\n3.0;\n4.0;0.5\n",  # point decimals: same bug, same fix
        "T,R\n2.0,NaN\n3.0,\n4.0,0.5\n",
    ],
)
def test_nan_spelling_keeps_the_column_numeric(tmp_path: Path, text: str) -> None:
    ds = import_auto(_write(tmp_path, text))
    assert list(ds.labels) == ["R"]
    assert _same(ds.values[:, 0], [np.nan, np.nan, 0.5])
    assert _same(ds.time, [2.0, 3.0, 4.0])
    assert "categorical_levels" not in ds.metadata
    assert not any("categorical" in n for n in ds.metadata.get("notes", []))


def test_direct_import_and_wizard_agree(tmp_path: Path) -> None:
    text = "T;R\n2,000;NaN\n3,000;\n4,000;0,5\n"
    direct = import_auto(_write(tmp_path, text))
    wizard = parse_import(text, guess_settings(text))
    assert _same(direct.values[:, 0], wizard.values[:, 0].tolist())
    assert _same(direct.time, wizard.time.tolist())


def test_a_real_text_column_is_still_categorical(tmp_path: Path) -> None:
    # Words, not NaN spellings: the column stays text, as before.
    ds = import_auto(_write(tmp_path, "T;S\n2,5;red\n3,5;green\n4,5;blue\n5,5;red\n"))
    assert list(ds.labels) == ["S"]
    assert _same(ds.values[:, 0], [0, 1, 2, 0])
    assert any("categorical" in n for n in ds.metadata.get("notes", []))
