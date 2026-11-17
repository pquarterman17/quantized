"""A NaN spelling is number-like, never text or a category (UX8-H item 6).

``2,000;NaN / 3,000; / 4,000;0,5`` imported R as a CATEGORICAL channel
``[0, nan, 1]`` (the codes of "NaN" and "0,5") through direct import, while
the Import Wizard read ``[nan, nan, 0.5]``. ``delimited._numeric_column``
counted "NaN" as a filled non-number cell, so one number in two "filled"
cells was not a majority. The wizard's role guess counted it as a NUMBER
(``layout._is_data_cell``), so the two disagreed on ``nan, nan, nan, red, 6``
too. Both now use one rule (`_column_kind.numeric_column`): a NaN spelling is
number-like, a missing token is not filled; a text cell dropped from a
numeric column is named in a note; and a categorical column never makes
"nan" a level.
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


@pytest.mark.parametrize(
    ("text", "expected", "dropped"),
    [
        ("T;R\n2,000;NaN\n3,000;\n4,000;0,5\n", [np.nan, np.nan, 0.5], None),
        # Three NaN spellings, a word and one number: numeric, the word named.
        ("T,S\n1,nan\n2,nan\n3,nan\n4,red\n5,6\n", [np.nan] * 4 + [6.0], "'red'"),
        ("T,S\n1,NaN\n2,n/a\n3,7\n4,oops\n5,8\n", [np.nan, np.nan, 7.0, np.nan, 8.0], "'oops'"),
    ],
)
def test_direct_import_and_wizard_agree(
    tmp_path: Path, text: str, expected: list[float], dropped: str | None
) -> None:
    direct = import_auto(_write(tmp_path, text))
    settings = guess_settings(text)
    assert settings.roles == ["x", "y"]  # the wizard guesses a numeric y, like direct import
    wizard = parse_import(text, settings)
    assert _same(direct.values[:, 0], expected)
    assert _same(wizard.values[:, 0], expected)
    assert _same(direct.time, wizard.time.tolist())
    for ds in (direct, wizard):
        notes = ds.metadata.get("notes", [])
        assert not any("categorical" in n for n in notes)
        found = [n for n in notes if "read as missing (NaN)" in n]
        if dropped is None:
            assert not found
        else:
            assert len(found) == 1 and dropped in found[0] and "'S'" in found[0]


def test_a_text_column_is_text_to_both(tmp_path: Path) -> None:
    # Mostly words: the wizard guesses "label", direct import keeps it as text
    # (here the only data column, so a categorical channel) -- and "nan" in
    # it is a missing value, not a level of its own.
    text = "T,S\n1,a\n2,b\n3,nan\n4,c\n5,a\n"
    assert guess_settings(text).roles == ["x", "label"]
    ds = import_auto(_write(tmp_path, text))
    assert _same(ds.values[:, 0], [0, 1, np.nan, 2, 0])
    levels = [v for v in ds.metadata.values() if isinstance(v, dict) and v]
    assert all("nan" not in str(level) for level in levels)


def test_categorical_encoder_skips_nan_spellings() -> None:
    from quantized.io._column_kind import encode_categorical, levels_only

    codes, levels = encode_categorical(["Fe", "nan", "", "NaN", "Co", "Fe"])
    assert levels == ("Fe", "Co")
    assert _same(codes, [0, np.nan, np.nan, np.nan, 1, 0])
    assert levels_only(["Fe", "nan", "-NaN", "Co"]) == ("Fe", "Co")


def test_a_real_text_column_is_still_categorical(tmp_path: Path) -> None:
    # Words, not NaN spellings: the column stays text, as before.
    ds = import_auto(_write(tmp_path, "T;S\n2,5;red\n3,5;green\n4,5;blue\n5,5;red\n"))
    assert list(ds.labels) == ["S"]
    assert _same(ds.values[:, 0], [0, 1, 2, 0])
    assert any("categorical" in n for n in ds.metadata.get("notes", []))


def test_many_columns_with_dropped_text_get_one_combined_note(tmp_path: Path) -> None:
    # Header rows landing in the data put the same words in every column: one
    # note for the lot, not one per column.
    rows = ["T,A,B,C", "1,1,1,1", "2,2,2,2", "3,3,3,3", "4,CONC.,CONC.,units", "5,5,5,5"]
    ds = import_auto(_write(tmp_path, "\n".join(rows) + "\n"))
    found = [n for n in ds.metadata.get("notes", []) if "read as missing" in n]
    assert len(found) == 1
    assert found[0].startswith("3 columns: text cells read as missing (e.g. 'CONC.', 'units'")
