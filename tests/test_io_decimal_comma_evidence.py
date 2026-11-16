"""Decimal-comma columns settled by the FILE's evidence (UX audit 8, finding 7).

A ``;`` (or tab) file such as ``2,000;0,00527`` used to fail auto-import:
the temperature column alone could be 2.0 or 2000, even though the column
beside it can only be a decimal comma. Under ``decimal="auto"`` an ambiguous
column is now read as decimal comma when another column in a ``;``/tab file
PROVES the decimal comma (``0,5``; not a pair-like ``1,1``) and no cell in the
file is a point decimal (``10.5`` means the comma groups thousands), judged
over every data row (start, middle or end), with a note saying so. Anything
less still fails closed.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io.delimited import import_csv
from quantized.io.import_preview import (
    ImportSettings,
    guess_settings,
    parse_import,
    preview_import,
)
from quantized.io.registry import import_auto

FIXTURE = Path(__file__).parent / "fixtures" / "delimited_text" / "decimal_comma_rt.csv"


def _write(tmp_path: Path, text: str, name: str = "eu.csv") -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


def test_semicolon_rt_file_imports_without_the_wizard() -> None:
    ds = import_auto(FIXTURE)
    assert ds.metadata["parser_name"] == "import_csv"
    assert ds.metadata["x_column_name"] == "Temperatur"
    assert ds.metadata["x_column_unit"] == "K"
    assert list(ds.labels) == ["Widerstand"] and list(ds.units) == ["Ohm"]
    assert ds.time[:3].tolist() == [2.0, 10.609, 19.217]
    assert ds.time[-1] == 200.0  # "200,000" is 200, not 200000
    assert np.isclose(ds.values[0, 0], 0.0054)
    assert ds.metadata["decimal_comma_columns"] == ["Temperatur", "Widerstand"]
    note = next(n for n in ds.metadata["notes"] if "because" in n)
    assert "'Temperatur'" in note and "'Widerstand'" in note and "semicolon" in note


def test_wizard_previews_and_parses_the_same_file() -> None:
    text = FIXTURE.read_text(encoding="utf-8")
    settings = guess_settings(text)
    preview = preview_import(text, settings)  # used to 422 with no preview
    assert preview["decimal_comma_columns"] == ["Temperatur", "Widerstand"]
    ds = parse_import(text, settings)
    assert ds.time[:2].tolist() == [2.0, 10.609]
    assert any("because" in n for n in ds.metadata["notes"])


def test_tab_delimiter_counts_as_evidence_too(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "T\tR\n2,000\t0,5\n3,500\t0,75\n"))
    assert ds.time.tolist() == [2.0, 3.5]
    assert "tab-delimited" in " ".join(ds.metadata["notes"])


def test_evidence_at_the_end_of_the_file_counts(tmp_path: Path) -> None:
    # Every row but the LAST is ambiguous in both columns: the decision is
    # made over the whole file, not a leading sample.
    rows = [f"{k},{250 + k:03d};{k + 1},{500 + k:03d}" for k in range(1, 200)]
    rows.append("300,125;7,25")
    ds = import_csv(_write(tmp_path, "A;B\n" + "\n".join(rows) + "\n"))
    assert ds.time[0] == 1.251 and ds.values[0, 0] == 2.501
    assert ds.values[-1, 0] == 7.25


@pytest.mark.parametrize(
    "text",
    [
        "A;B\n2,000;3,500\n4,000;5,250\n",  # every column ambiguous
        "A\tB\n2,000\t3,500\n4,000\t5,250\n",
        "A B\n1,500 2,5\n3,750 4,25\n",  # whitespace delimiter: not locale evidence
    ],
)
def test_no_file_evidence_still_fails_closed(tmp_path: Path, text: str) -> None:
    with pytest.raises(ValueError, match="'A'.*Import Wizard"):
        import_csv(_write(tmp_path, text))
    with pytest.raises(ValueError, match="decimal separator"):
        preview_import(text, guess_settings(text))


def test_point_choice_is_unchanged_by_evidence(tmp_path: Path) -> None:
    # decimal="." never enters the comma path: the old fail-closed refusal.
    with pytest.raises(ValueError, match="re-export it with '.'"):
        import_csv(FIXTURE, decimal=".")


# --- counter-evidence: the European reading would be 1000x too small ------------


@pytest.mark.parametrize(
    "text",
    [
        # A point decimal ("10.5") says the comma in "1,234" groups thousands;
        # "1,1" / "2,0" read like pairs or labels, not proof of a decimal comma.
        "Angle\tCounts\tPeak\n10.5\t1,234\t1,1\n11.0\t2,345\t2,0\n",
        # "0,1" would prove it, but "0.5" in the next column says otherwise.
        "Field\tMoment\tIdx\n1,000\t0.5\t0,1\n2,000\t0.6\t0,2\n",
        # A point decimal at the very END of the file still counts.
        "A;B\n" + "".join(f"{k},500;0,{k}5\n" for k in range(1, 50)) + "9,000;0.5\n",
    ],
)
def test_point_decimal_or_weak_proof_still_fails_closed(tmp_path: Path, text: str) -> None:
    with pytest.raises(ValueError, match="Import Wizard"):
        import_csv(_write(tmp_path, text))
    with pytest.raises(ValueError, match="decimal separator"):
        preview_import(text, guess_settings(text))


def test_label_like_comma_values_are_not_proof(tmp_path: Path) -> None:
    # No point decimal anywhere, but "1,1" / "2,0" alone settle nothing.
    with pytest.raises(ValueError, match="'Counts'"):
        import_csv(_write(tmp_path, "T;Counts;Pos\n300;1,234;1,1\n301;2,345;2,0\n"))


# Decision (documented in `_decimal_comma._settled_by_file`): in a ';' file
# with no point decimal anywhere, "1,234" beside "0,5" is read with the file's
# one locale -- 1.234, not 1234 -- and the note says so; Point overrides it.
_SEMI = "T;Counts;R\n300;1,234;0,5\n301;2,000;0,6\n"


def test_semicolon_counts_beside_decimal_comma_read_as_decimal(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, _SEMI))
    assert ds.time.tolist() == [300.0, 301.0]
    assert ds.values[:, 0].tolist() == [1.234, 2.0]
    assert ds.values[:, 1].tolist() == [0.5, 0.6]
    note = next(n for n in ds.metadata["notes"] if "because" in n)
    assert "'Counts'" in note and "'R'" in note and "no column uses a decimal point" in note


def test_wizard_point_choice_overrides_the_evidence() -> None:
    base = guess_settings(_SEMI).to_dict()
    ds = parse_import(_SEMI, ImportSettings.from_dict({**base, "decimal": "."}))
    assert np.isnan(ds.values[:, 0]).all()  # "1,234" is not a number under Point
    assert not any("because" in n for n in ds.metadata.get("notes", []))


def test_wizard_note_uses_the_edited_column_names() -> None:
    settings = guess_settings(_SEMI).to_dict()
    settings["column_names"] = ["Temp", "Intensity", "Resistance"]
    ds = parse_import(_SEMI, ImportSettings.from_dict(settings))
    note = next(n for n in ds.metadata["notes"] if "because" in n)
    assert "'Intensity'" in note and "'Resistance'" in note
