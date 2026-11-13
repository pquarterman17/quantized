"""Origin-safe names (integration review items 6 and 7).

The .ogs export's book/sheet names kept underscores, non-ASCII letters and
leading digits (``re.sub(r"\\W", "_", …)``), which Origin rejects as short
names; the download names dropped accented letters ("Ångström run" ->
"ngstr_m_run"). Both now fold accents and the .ogs uses the .opj writer's
short-name rule.
"""

from __future__ import annotations

from quantized.datastruct import DataStruct
from quantized.io._origin_names import ascii_fold, origin_short_name
from quantized.io.origin import format_origin_project_script, format_origin_script
from quantized.routes._export_common import _safe_name


def test_ascii_fold_keeps_the_readable_stem() -> None:
    assert ascii_fold("Ångström run") == "Angstrom run"
    assert ascii_fold("θ scan") == "θ scan"  # no ASCII base: left for the caller


def test_origin_short_name_rule() -> None:
    assert origin_short_name("Ångström run_2", "Book1") == "Angstromrun2"
    assert origin_short_name("2024 sample", "Book1") == "B2024sample"
    assert origin_short_name("θθ", "Book1") == "Book1"
    used: set[str] = set()
    names = [origin_short_name(n, "x", used) for n in ("Run", "run", "RUN")]
    assert names == ["Run", "run2", "RUN3"]


def test_download_name_folds_accents() -> None:
    assert _safe_name("Ångström run", ".opj") == "Angstrom_run.opj"


def _ds() -> DataStruct:
    return DataStruct.create([0.0, 1.0], [[1.0], [2.0]], labels=["M"], units=[""])


def test_ogs_book_and_sheet_names_are_origin_short_names() -> None:
    _, ogs = format_origin_script(_ds(), book_name="2024_Ångström run", sheet_name="sheet 1")
    assert 'newbook name:="B2024Angstromrun" sheet:=1;' in ogs
    assert 'wks.name$ = "sheet1";' in ogs


def test_project_script_book_names_are_unique_ignoring_case() -> None:
    _csvs, script = format_origin_project_script([(_ds(), "Run"), (_ds(), "run")])
    assert "// ---- Book 1: Run ----" in script and "// ---- Book 2: run2 ----" in script
