"""SIMS depth-profile parser: golden parity (shared + interpolated) + behaviour.

.csv/.xlsx are ambiguous with generic CSV/Excel, so the registry routes them by
content sniff: a SIMS layout (vendor banner or depth/concentration fingerprint)
goes to import_sims, everything else falls back to the generic parser.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from quantized.io import import_auto
from quantized.io.sims import import_sims, is_sims_file


def _write(tmp_path: Path, name: str, text: str) -> Path:
    p = tmp_path / name
    p.write_text(text, encoding="utf-8")
    return p


@pytest.mark.golden
def test_sims_shared_depth_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    # Shared-depth layout -> no interpolation -> exact parity.
    ds = import_sims(fixtures_dir / "sims_shared.csv")
    assert_golden(ds, "sims_shared_default.json")


@pytest.mark.golden
def test_sims_paired_interpolation_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    # Paired columns with differing depth grids -> union grid + interp1.
    ds = import_sims(fixtures_dir / "sims_barrier.csv")
    assert_golden(ds, "sims_barrier_default.json")


def test_sims_shared_structure(fixtures_dir: Path) -> None:
    ds = import_sims(fixtures_dir / "sims_shared.csv")
    assert ds.labels == ("H", "O", "Si")
    assert ds.units == ("atoms/cc", "atoms/cc", "atoms/cc")
    assert ds.metadata["x_column_name"] == "Depth"
    assert ds.metadata["is_paired_layout"] is False


def test_sims_paired_recovers_element_names(fixtures_dir: Path) -> None:
    ds = import_sims(fixtures_dir / "sims_barrier.csv")
    assert ds.metadata["is_paired_layout"] is True
    # Element names recovered from the vendor row above the header; 'Cu->' -> 'Cu'
    assert ds.labels == ("H", "C", "O", "N", "F", "Cu", "Ta", "Si", "Ti", "W")


@pytest.mark.parametrize("name", ["sims_shared.csv", "sims_barrier.csv", "sims_synth.xlsx"])
def test_registry_routes_sims(fixtures_dir: Path, name: str) -> None:
    # SIMS .csv (banner + structural) and .xlsx (Evans banner, no "SIMS" word)
    # all sniff to import_sims through auto-import.
    ds = import_auto(fixtures_dir / name)
    assert ds.metadata["parser_name"] == "import_sims"


@pytest.mark.parametrize(
    ("name", "parser"),
    # csv_xrd.csv is an XRD export: claimed by its own marker line, not SIMS.
    [("csv_xrd.csv", "import_xrd_export"), ("excel_synth.xlsx", "import_excel")],
)
def test_registry_keeps_generic_tables(fixtures_dir: Path, name: str, parser: str) -> None:
    # Non-SIMS .csv/.xlsx must fall through the SIMS sniffer to the generic parser.
    ds = import_auto(fixtures_dir / name)
    assert ds.metadata["parser_name"] == parser


def test_is_sims_file_detects_and_rejects(fixtures_dir: Path) -> None:
    assert is_sims_file(fixtures_dir / "sims_shared.csv") is True
    assert is_sims_file(fixtures_dir / "sims_synth.xlsx") is True
    assert is_sims_file(fixtures_dir / "csv_xrd.csv") is False
    assert is_sims_file(fixtures_dir / "excel_synth.xlsx") is False


# --------------------------------------------------------------------------
# D5-for-SIMS (2026-09-03 dedup pass): the same NaN-scoring bug the CSV
# parser's D5 fix addressed (`_delimited_layout._is_numeric_like`) also
# lived, unfixed, in this module's OWN `_numeric_score` copy, which still
# used the strict `_is_numeric` (NaN excluded). Below is a shared-depth
# profile whose first data row is exactly the failure shape: 5 cells, 2
# numeric (Depth, N's reading) + 3 literal "nan" spellings (H, O, X have no
# reading at this depth) -- a real ratio of 5/5 "recognized" cells, but the
# strict scorer only credits the 2 non-NaN ones, landing at 2/5 = 0.4, BELOW
# the `> 0.5` majority. That made `_detect_layout` walk straight past the
# true header (row 0) and instead crown the NaN-cell row itself as the
# header -- `import_sims` then reads column names off literal data values
# ("nan", "6.0e21", ...) and drops the real first data point (N's reading
# at Depth 0.0) entirely. `_is_numeric_like` credits the 3 "nan" cells too
# (5/5 = 1.0, comfortably > 0.5), so the true header is recovered and the
# row survives as data (H/O/X correctly NaN there; N's reading present).
_SIMS_NAN_ROW_CSV = (
    "Depth (nm),H (atoms/cc),O (atoms/cc),N (atoms/cc),X (atoms/cc)\n"
    "0.0,nan,nan,6.0e21,nan\n"
    "0.5,1.0e21,2.0e22,5.5e21,7.1e21\n"
    "1.0,1.2e21,2.2e22,5.6e21,7.2e21\n"
    "1.5,1.4e21,2.4e22,5.7e21,7.3e21\n"
)


def test_sims_first_row_with_nan_cells_is_not_eaten(tmp_path: Path) -> None:
    path = _write(tmp_path, "sims_nan_row.csv", _SIMS_NAN_ROW_CSV)
    ds = import_sims(path)

    # Header preserved: real column names, not literal data values off a
    # misdetected "header" row.
    assert ds.labels == ("H", "O", "N", "X")
    assert ds.metadata["is_paired_layout"] is False

    # Row count preserved: all 4 data rows survive, including the one whose
    # H/O/X cells are NaN.
    assert ds.n_points == 4
    assert ds.time.tolist() == pytest.approx([0.0, 0.5, 1.0, 1.5])

    # N's reading at Depth 0.0 -- the concretely-dropped data point -- is
    # present; H/O/X are correctly NaN there (no measurement), not merely
    # absent because the whole row vanished.
    n_col = ds.column("N")
    assert n_col[0] == pytest.approx(6.0e21)
    for label in ("H", "O", "X"):
        assert ds.column(label)[0] != ds.column(label)[0]  # NaN


# --------------------------------------------------------------------------
# SIMS .xlsx goes through io/excel.read_sheet: the same cell cap, the same
# part-size cap, and the sniffer preview reads only its first rows.
# --------------------------------------------------------------------------
def _sims_xlsx(path: Path, rows: int, *, far_cell: tuple[int, int] | None = None) -> Path:
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Evans Analytical Group"])
    ws.append(["Depth (nm)", "H (atoms/cc)", "O (atoms/cc)"])
    for i in range(rows):
        ws.append([float(i), 1e21 + i, 2e22 + i])
    if far_cell is not None:
        ws.cell(row=far_cell[0], column=far_cell[1], value=1.0)
    wb.save(path)
    return path


@pytest.fixture
def small_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    from quantized.io import excel

    monkeypatch.setattr(excel, "MAX_CELLS", 100_000, raising=False)


def test_sims_xlsx_cell_bomb_is_refused(tmp_path: Path, small_cap: None) -> None:
    path = _sims_xlsx(tmp_path / "bomb.xlsx", 5, far_cell=(1000, 500))
    assert is_sims_file(path) is True  # the preview's first rows are fine
    with pytest.raises(ValueError, match="cells"):
        import_sims(path)
    with pytest.raises(ValueError, match="cells"):
        import_auto(path)


def test_sims_xlsx_part_bomb_is_refused(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The sniffer's preview parses styles and shared strings whole too."""
    import zipfile

    from quantized.io import excel

    monkeypatch.setattr(excel, "MAX_PART_BYTES", 1 << 20, raising=False)
    plain = _sims_xlsx(tmp_path / "plain.xlsx", 5)
    path = tmp_path / "bomb.xlsx"
    with zipfile.ZipFile(plain) as src, zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info)
            if info.filename == "xl/styles.xml":
                data += b" " * (2 << 20)
            dst.writestr(info.filename, data)
    assert is_sims_file(path) is False
    with pytest.raises(ValueError, match="uncompressed"):
        import_sims(path)


def test_sims_xlsx_fixture_tokens_stay_rectangular(fixtures_dir: Path) -> None:
    """The bounded reader trims trailing blanks; the SIMS tokens are padded back,
    so the fixture's banner and blank rows read as before the shared reader."""
    from quantized.io.sims import _read_excel_tokens

    tokens = _read_excel_tokens(fixtures_dir / "sims_synth.xlsx", 0)
    assert tokens[:5] == [
        ["Evans Analytical Group", "", ""],
        ["Sample : ID TEST-XLSX", "", ""],
        ["Drawn Curves", "3", ""],
        ["", "", ""],
        ["Depth (nm)", "H (atoms/cc)", "O (atoms/cc)"],
    ]
    ds = import_sims(fixtures_dir / "sims_synth.xlsx")
    assert ds.labels == ("H", "O")
    assert ds.time.tolist() == pytest.approx([0.0, 1.0, 2.0, 3.0])
    assert ds.column("H").tolist() == pytest.approx([1e21, 2e21, 1.5e21, 1.2e21])


def test_sims_preview_reads_only_its_first_rows(tmp_path: Path, small_cap: None) -> None:
    # 40k rows x 3 columns passes the cap: the import refuses, the preview does not.
    path = _sims_xlsx(tmp_path / "tall.xlsx", 40_000)
    assert is_sims_file(path) is True
    with pytest.raises(ValueError, match="cells"):
        import_sims(path)
