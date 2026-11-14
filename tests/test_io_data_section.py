"""A ``[DATA]`` section heading anchors the table (worksheet audit #3).

Instrument files such as Nanonis spectroscopy write a tab-separated
``key<TAB>value`` preamble, then a lone ``[DATA]`` heading, then the column
header and the numbers. The heading has no tab, so it used to disqualify tab
in the delimiter vote (the whole file became one all-NaN column), and a
preamble line holding two numbers scored as data, so the "header" was the
first preamble line. Synthetic fixtures only.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io._delimiter_vote import data_section_start, vote_lines
from quantized.io.delimited import import_csv
from quantized.io.import_preview import ImportSettings, guess_settings, parse_import


def _spectroscopy(preamble: list[str]) -> str:
    lines = [*preamble, "", "[DATA]", "Bias calc (V)\tCurrent (A)\tLI Demod 1 X (A)"]
    for i in range(30):
        v = -1 + i * 0.05
        lines.append(f"{v:.6E}\t{v * 1e-10:.6E}\t{v * v * 1e-12:.6E}")
    return "\n".join(lines) + "\n"


_PLAIN = ["Experiment\tbias spectroscopy", "Date\t14.11.2026 10:00:00", "User\t"]
# A preamble line with two numbers scores exactly like a data row.
_NUMERIC = ["Experiment\tbias spectroscopy", "Sweep range (V)\t-1\t1", "Points\t30\t0"]


@pytest.mark.parametrize("preamble", [_PLAIN, _NUMERIC], ids=["plain", "numeric-preamble"])
def test_guess_settings_starts_the_table_below_the_data_heading(preamble: list[str]) -> None:
    text = _spectroscopy(preamble)
    s = guess_settings(text)
    lines = text.splitlines()
    assert lines[s.header_line or 0].startswith("Bias calc")
    assert s.data_start_line == s.header_line + 1  # type: ignore[operator]
    assert s.column_names == ["Bias calc (V)", "Current (A)", "LI Demod 1 X (A)"]
    ds = parse_import(text, s)
    assert ds.metadata["x_column_name"] == "Bias calc"
    assert ds.labels == ("Current", "LI Demod 1 X")
    assert ds.units == ("A", "A")
    assert len(ds.time) == 30 and np.isfinite(ds.values).all()


@pytest.mark.parametrize("preamble", [_PLAIN, _NUMERIC], ids=["plain", "numeric-preamble"])
def test_direct_import_starts_the_table_below_the_data_heading(
    tmp_path: Path, preamble: list[str]
) -> None:
    path = tmp_path / "spectrum.dat"
    path.write_text(_spectroscopy(preamble), encoding="utf-8")
    ds = import_csv(path)
    assert ds.metadata["x_column_name"] == "Bias calc"
    assert ds.labels == ("Current", "LI Demod 1 X")
    assert len(ds.time) == 30 and np.isfinite(ds.values).all()
    # the preamble is kept, not lost
    assert any("Experiment" in c for c in ds.metadata["comments"])


def test_only_a_data_heading_anchors_and_the_last_one_wins() -> None:
    assert data_section_start(["[Header]", "a\t1", "[Settings]", "b\t2"]) == 0
    assert data_section_start(["[Data]", "x", "[Measurement Data]", "y"]) == 3
    # a heading never takes part in the delimiter vote
    assert vote_lines("[DATA]\nx\ty\n1\t2\n") == ["x\ty", "1\t2"]


def test_a_free_text_preamble_line_does_not_defeat_the_delimiter_vote(tmp_path: Path) -> None:
    """Audit #2's wizard file: one free-text line above a ``;`` table has no
    delimiter at all, which disqualified every candidate in the first ten
    lines -- the file fell back to comma and imported as ONE column."""
    lines = ["# instrument", "Junk line here", "Time;Voltage;Current", "s;V;A"]
    lines += [f"{i};{i * 0.5:.2f};{i * i * 0.01:.3f}" for i in range(12)]
    text = "\n".join(lines) + "\n"
    s = guess_settings(text)
    assert s.column_names == ["Time", "Voltage", "Current"]
    assert (s.header_line, s.units_line, s.data_start_line) == (2, 3, 4)
    path = tmp_path / "preamble.txt"
    path.write_text(text, encoding="utf-8")
    ds = import_csv(path)
    assert ds.labels == ("Voltage", "Current") and ds.units == ("V", "A")
    assert ds.metadata["x_column_name"] == "Time"


def test_no_roles_given_keeps_a_text_column_as_text() -> None:
    """The wizard clears the guessed roles when the delimiter changes (the
    columns are re-split); the parse then defaults like `guess_settings`
    does, so a text column is kept as text, not an all-NaN numeric channel."""
    text = "T;Sample;R\n1;a;10\n2;b;20\n3;c;30\n"
    s = guess_settings(text)
    ds = parse_import(
        text, ImportSettings(delimiter="semicolon", header_line=0, data_start_line=1)
    )
    assert s.roles == ["x", "label", "y"]
    assert ds.labels == ("R",)
    assert ds.metadata["text_columns"] == {"Sample": ["a", "b", "c"]}
