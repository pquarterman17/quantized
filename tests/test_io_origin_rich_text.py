"""Origin ``.ogs`` graph titles: exponent units as LabTalk rich text.

Graph text (``xb.text$`` / ``yl.text$`` / ``label -yr``) spells a unit by the
same rule as the screen and the SVG/PDF export (``unit_display``), with each
superscript run written as Origin's ``\\+(...)`` escape. Worksheet long names
and units, and the CSV, keep the file's raw unit for round-trip fidelity.
"""

from __future__ import annotations

import pytest

from quantized.datastruct import DataStruct
from quantized.io.origin import GraphSpec, format_origin_script, origin_rich_unit


def _ds() -> DataStruct:
    return DataStruct.create(
        [1000.0, 2000.0],
        [[1.0, 5.0], [2.0, 6.0]],
        labels=["M", "Q"],
        units=["emu/cm3", "Ang^-1"],
        metadata={"x_column_name": "Wavenumber", "x_column_unit": "cm^-1"},
    )


@pytest.mark.parametrize(
    ("raw", "rich"),
    [
        ("cm^-1", "cm\\+(-1)"),
        ("cm-1", "cm\\+(-1)"),
        ("emu/cm3", "emu/cm\\+(3)"),
        ("Ang^-1", "Å\\+(-1)"),
        ("um", "µm"),
        ("cm⁻¹", "cm\\+(-1)"),  # already-typeset Unicode superscripts too
        ("A/m^{2}", "A/m\\+(2)"),
        ("deg", "deg"),
        ("cps", "cps"),
        ("1e-6 emu", "1e-6 emu"),  # scientific notation is not an exponent
        ("$\\mu_B$", "$\\mu_B$"),  # mathtext is left as written
        ("", ""),
    ],
)
def test_origin_rich_unit(raw: str, rich: str) -> None:
    assert origin_rich_unit(raw) == rich


def test_default_graph_titles_use_rich_text_columns_keep_raw() -> None:
    ds = DataStruct.create(
        [1000.0, 2000.0], [[1.0], [2.0]], labels=["M"], units=["emu/cm3"],
        metadata={"x_column_name": "Wavenumber", "x_column_unit": "cm^-1"},
    )
    csv_text, ogs = format_origin_script(ds)
    assert 'xb.text$ = "Wavenumber (cm\\+(-1))";' in ogs
    assert 'yl.text$ = "M (emu/cm\\+(3))";' in ogs
    # Worksheet metadata and the CSV units row stay raw (round-trip fidelity).
    assert 'wks.col1.unit$ = "cm^-1";' in ogs
    assert 'wks.col2.unit$ = "emu/cm3";' in ogs
    assert csv_text.splitlines()[1] == "cm^-1,emu/cm3"


def test_plot_state_graph_titles_use_rich_text() -> None:
    _, ogs = format_origin_script(_ds(), graph=GraphSpec(y_keys=(0,)))
    assert 'xb.text$ = "Wavenumber (cm\\+(-1))";' in ogs
    assert 'yl.text$ = "M (emu/cm\\+(3))";' in ogs
    # Channel as X, and the secondary axis's `label -yr` title.
    _, ogs = format_origin_script(
        _ds(), graph=GraphSpec(y_keys=(0, 1), x_key=None, y2_keys=(1,))
    )
    assert 'label -yr "Q (Å\\+(-1))";' in ogs
    _, ogs = format_origin_script(_ds(), graph=GraphSpec(y_keys=(0,), x_key=1))
    assert 'xb.text$ = "Q (Å\\+(-1))";' in ogs


def test_plain_ascii_units_are_byte_identical() -> None:
    # The MATLAB golden's units (deg, cps) carry no exponent: no rich text.
    ds = DataStruct.create(
        [1.0, 2.0], [[1.0], [2.0]], labels=["Intensity"], units=["cps"],
        metadata={"x_column_name": "2-Theta", "x_column_unit": "deg"},
    )
    _, ogs = format_origin_script(ds)
    assert 'xb.text$ = "2-Theta (deg)";' in ogs
    assert 'yl.text$ = "Intensity (cps)";' in ogs
    assert "\\" not in ogs
