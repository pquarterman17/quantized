"""European decimal-comma support for delimited text (`decimal` option).

``decimal="auto"`` (the default) converts a column written with a decimal
comma only when the delimiter is not a comma, every cell has the comma-number
shape, and the reading is unambiguous. ``"1,500"`` alone could be 1.5 or 1500,
so such a column still fails closed and points at the Import Wizard.
``decimal="."`` is the old behaviour exactly; ``decimal=","`` forces the
European reading. A pure US file takes exactly the old code path.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.io import _decimal_comma
from quantized.io.delimited import import_csv
from quantized.io.import_preview import (
    ImportSettings,
    guess_settings,
    parse_import,
    preview_import,
)


def _write(tmp_path: Path, text: str, name: str = "eu.csv") -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


_EU = "Temp (K);Moment (emu)\n300,5;1,25E-3\n301;1,5E-3\n302,25;1,75E-3\n"
_AMBIGUOUS = "A;B\n1,500;2,250\n3,750;4,125\n5,000;6,875\n"


# --- auto: unambiguous columns convert --------------------------------------


@pytest.mark.parametrize("delim", [";", "\t"])
def test_auto_converts_unambiguous_decimal_comma(tmp_path: Path, delim: str) -> None:
    ds = import_csv(_write(tmp_path, _EU.replace(";", delim)))
    assert ds.time.tolist() == [300.5, 301.0, 302.25]  # "301" is an integer: neutral
    assert np.allclose(ds.values[:, 0], [1.25e-3, 1.5e-3, 1.75e-3])
    assert list(ds.labels) == ["Moment"]
    assert list(ds.units) == ["emu"]
    assert ds.metadata["x_column_name"] == "Temp"
    assert ds.metadata["decimal_separator"] == ","
    assert ds.metadata["decimal_comma_columns"] == ["Temp (K)", "Moment (emu)"]
    assert any("decimal separator" in n for n in ds.metadata["notes"])


def test_auto_reads_dot_as_thousands_separator(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "x;y\n1;1.234,5\n2;12.000,25\n3;-0,5\n"))
    assert ds.values[:, 0].tolist() == [1234.5, 12000.25, -0.5]
    assert ds.metadata["decimal_comma_columns"] == ["y"]


def test_auto_three_digit_column_with_exponent_is_unambiguous(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "x;y\n1;1,500\n2;2,250E1\n"))
    assert ds.values[:, 0].tolist() == [1.5, 22.5]


# --- auto: ambiguous columns fail closed ---------------------------------------


def test_auto_ambiguous_three_digit_column_fails_closed(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Import Wizard") as info:
        import_csv(_write(tmp_path, _AMBIGUOUS))
    assert "1.5 or 1500" in str(info.value)


def test_auto_ambiguity_is_judged_column_by_column(tmp_path: Path) -> None:
    # Column B is clearly decimal comma; column A still has no evidence.
    with pytest.raises(ValueError, match="'A'"):
        import_csv(_write(tmp_path, "A;B\n1,500;2,5\n3,750;4,25\n"))


# --- forced comma --------------------------------------------------------------


def test_forced_comma_reads_ambiguous_column_as_decimal(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, _AMBIGUOUS), decimal=",")
    assert ds.time.tolist() == [1.5, 3.75, 5.0]
    assert ds.values[:, 0].tolist() == [2.25, 4.125, 6.875]
    assert ds.metadata["decimal_comma_columns"] == ["A", "B"]


def test_forced_comma_treats_dot_as_thousands(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "x;y\n1;1.234\n2;2.000,5\n"), decimal=",")
    assert ds.values[:, 0].tolist() == [1234.0, 2000.5]


def test_forced_comma_with_comma_delimiter_raises(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="delimiter"):
        import_csv(_write(tmp_path, "x,y\n1,2\n3,4\n"), decimal=",")


def test_unknown_decimal_value_raises(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="decimal"):
        import_csv(_write(tmp_path, "x;y\n1;2\n"), decimal="period")


# --- point: today's behaviour exactly -------------------------------------------


def test_point_keeps_the_old_fail_closed_error(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="re-export it with '.'"):
        import_csv(_write(tmp_path, _EU), decimal=".")


# --- pure US files: same path, same result ----------------------------------------


def _forbid_decimal_path(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("decimal-comma path must not run for a pure US file")

    monkeypatch.setattr(_decimal_comma, "layout_rows", boom)
    monkeypatch.setattr(_decimal_comma, "resolve_decimal_columns", boom)


@pytest.mark.parametrize(
    "text",
    [
        "Temp (K),Moment (emu)\n300.5,1.25e-3\n301,1.5e-3\n",
        "Temp (K);Moment (emu)\n300.5;1.25e-3\n301;1.5e-3\n",
        "Temp\tMoment\tTag\n300.5\t1.25e-3\ta\n301\t1.5e-3\tb\n",
    ],
)
def test_pure_us_file_takes_the_old_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, text: str
) -> None:
    path = _write(tmp_path, text)
    reference = import_csv(path, decimal=".")
    _forbid_decimal_path(monkeypatch)
    ds = import_csv(path)
    assert ds.time.tolist() == reference.time.tolist()
    assert np.array_equal(ds.values, reference.values)
    assert ds.metadata == reference.metadata
    assert "decimal_separator" not in ds.metadata


def test_us_text_cells_with_commas_are_left_alone(tmp_path: Path) -> None:
    path = _write(tmp_path, "T;M;Who\n1;2.5;Smith, J\n2;3.5;Doe, A\n")
    ds = import_csv(path)
    assert ds.metadata["text_columns"] == {"Who": ["Smith, J", "Doe, A"]}
    assert ds.metadata == import_csv(path, decimal=".").metadata


# --- Import Wizard engine ----------------------------------------------------------


def test_wizard_guess_finds_header_above_decimal_comma_rows() -> None:
    settings = guess_settings(_EU)
    assert settings.header_line == 0
    assert settings.data_start_line == 1
    assert settings.decimal == "auto"


def test_wizard_auto_parse_converts_and_records_metadata() -> None:
    ds = parse_import(_EU, guess_settings(_EU))
    assert ds.time.tolist() == [300.5, 301.0, 302.25]
    assert ds.metadata["decimal_separator"] == ","
    assert ds.metadata["decimal_comma_columns"] == ["Temp", "Moment"]
    # "auto" is the default and stays off the wire (the pre-option shape).
    assert "decimal" not in ds.metadata["import_settings"]


def test_wizard_ambiguous_preview_asks_for_the_separator() -> None:
    with pytest.raises(ValueError, match="decimal separator"):
        preview_import(_AMBIGUOUS, guess_settings(_AMBIGUOUS))


def test_wizard_forced_comma_and_point() -> None:
    base = guess_settings(_AMBIGUOUS).to_dict()
    ds = parse_import(_AMBIGUOUS, ImportSettings.from_dict({**base, "decimal": ","}))
    assert ds.time.tolist() == [1.5, 3.75, 5.0]
    # "." is the wizard's old behaviour: the cells simply do not parse.
    ds_point = parse_import(_AMBIGUOUS, ImportSettings.from_dict({**base, "decimal": "."}))
    assert np.isnan(ds_point.time).all()
    assert "decimal_separator" not in ds_point.metadata


def test_wizard_forced_comma_with_comma_delimiter_raises() -> None:
    settings = ImportSettings(delimiter="comma", data_start_line=0, decimal=",")
    with pytest.raises(ValueError, match="delimiter"):
        preview_import("1,2\n3,4\n", settings)


def test_settings_round_trip_keeps_decimal() -> None:
    settings = ImportSettings.from_dict({"delimiter": "semicolon", "decimal": ","})
    assert settings.to_dict()["decimal"] == ","
    assert ImportSettings().decimal == "auto"


def test_parse_route_passes_decimal_through() -> None:
    from quantized.app import app

    client = TestClient(app)
    base = guess_settings(_AMBIGUOUS).to_dict()
    bad = client.post("/api/import/parse", json={"text": _AMBIGUOUS, "settings": base})
    assert bad.status_code == 422
    assert "Import Wizard" in bad.json()["detail"]
    ok = client.post(
        "/api/import/parse", json={"text": _AMBIGUOUS, "settings": {**base, "decimal": ","}}
    )
    assert ok.status_code == 200
    assert ok.json()["time"] == [1.5, 3.75, 5.0]
