"""Technique tag contract (PLOT_WORKFLOW_PLAN item 1).

`import_auto` (`io/registry.py`) is the single dispatch chokepoint that
stamps `metadata['technique']` + normalizes `metadata['parser_name']` via
`io.technique.stamp_technique`. These tests exercise that chokepoint across
representative parsers -- including the QD/PPMS mvsh-vs-mvst-vs-transport
refinement and the generic/never-guess fallback -- plus the pure mapping
table directly.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from quantized.datastruct import DataStruct
from quantized.io import import_auto
from quantized.io.technique import (
    GENERIC,
    MAGNETOMETRY_MVSH,
    MAGNETOMETRY_MVST,
    REFLECTOMETRY,
    SIMS,
    SPECTROSCOPY,
    TECHNIQUES,
    TRANSPORT,
    XRD_POWDER,
    XRD_RSM,
    resolve_technique,
    stamp_technique,
)


# ── Registry chokepoint: real files through import_auto ─────────────────────
def test_qd_vsm_field_sweep_is_mvsh(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "qd_edp124.dat")
    assert ds.metadata["parser_name"] == "import_qd_vsm"
    assert ds.metadata["technique"] == MAGNETOMETRY_MVSH


def test_qd_vsm_temperature_sweep_is_mvst(fixtures_dir: Path) -> None:
    # mpms_zfc_classic.dat: the file's "Field" column is held constant, so
    # import_qd_vsm's own auto-x swap (_X_SWEEP_FALLBACKS, io/qd.py:99)
    # resolves the sweep axis to Temperature -- the refiner reads that
    # already-resolved column name, not the (moot) default x_axis spec.
    ds = import_auto(fixtures_dir / "mpms_zfc_classic.dat")
    assert ds.metadata["x_column_name"] == "Temperature"
    assert ds.metadata["technique"] == MAGNETOMETRY_MVST


def test_ppms_resistance_file_is_transport_not_magnetometry(tmp_path: Path) -> None:
    """The class this refiner exists for: a QD/PPMS-shaped file is not always
    magnetometry. A Resistance-vs-Temperature transport measurement sniffs
    into the same import_ppms parser (see test_io_qd.py's
    test_ppms_resistance_vs_temperature_no_field_column) and must NOT be
    silently tagged as magnetometry just because it shares the parser."""
    f = tmp_path / "rvt.dat"
    f.write_text(
        "Temperature (K),Resistance (Ohm)\n100,150\n150,155\n200,160\n250,165\n300,170\n",
        encoding="latin-1",
    )
    ds = import_auto(f)
    assert ds.metadata["parser_name"] == "import_ppms"
    assert ds.metadata["technique"] == TRANSPORT


def test_lakeshore_defaults_to_mvst(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "lakeshore_synth.csv")
    assert ds.metadata["parser_name"] == "import_lake_shore"
    assert ds.metadata["technique"] == MAGNETOMETRY_MVST


def test_xrdml_rsm_is_xrd_rsm(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "xrdml_rsm_synthetic.xrdml")
    assert ds.metadata["is2D"] is True
    assert ds.metadata["technique"] == XRD_RSM


def test_xrdml_1d_scan_is_xrd_powder(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "xrdml_la2nio4.xrdml")
    assert ds.metadata["is2D"] is False
    assert ds.metadata["technique"] == XRD_POWDER


@pytest.mark.parametrize(
    "name",
    ["ncnr_j395.refl", "ncnr_s11_nsf.pnr", "ncnr_s3.datA", "refl1d_nbau_profile.dat"],
)
def test_reflectometry_family_all_tag_reflectometry(fixtures_dir: Path, name: str) -> None:
    ds = import_auto(fixtures_dir / name)
    assert ds.metadata["technique"] == REFLECTOMETRY


def test_sims_is_sims(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "sims_barrier.csv")
    assert ds.metadata["technique"] == SIMS


def test_generic_csv_never_guesses(fixtures_dir: Path) -> None:
    """Content-ambiguous imports (plain CSV) stamp 'generic', never a guess."""
    ds = import_auto(fixtures_dir / "csv_xrd.csv")
    assert ds.metadata["parser_name"] == "import_csv"
    assert ds.metadata["technique"] == GENERIC


@pytest.mark.parametrize(
    "name",
    [
        "qd_edp124.dat",
        "mpms_zfc_classic.dat",
        "ppms_synth.dat",
        "lakeshore_synth.csv",
        "xrdml_rsm_synthetic.xrdml",
        "xrdml_la2nio4.xrdml",
        "ncnr_j395.refl",
        "ncnr_s11_nsf.pnr",
        "ncnr_s3.datA",
        "refl1d_nbau_profile.dat",
        "sims_barrier.csv",
        "csv_xrd.csv",
    ],
)
def test_technique_always_in_closed_vocabulary(fixtures_dir: Path, name: str) -> None:
    ds = import_auto(fixtures_dir / name)
    assert ds.metadata["technique"] in TECHNIQUES


# ── The mapping table + stamping helper directly (no corpus needed) ─────────
def _tiny_ds(metadata: dict[str, object] | None = None) -> DataStruct:
    return DataStruct.create([0.0, 1.0], [[1.0], [2.0]], metadata=metadata)


def test_resolve_technique_static_table_entries() -> None:
    ds = _tiny_ds()
    assert resolve_technique("import_jcamp", ds) == SPECTROSCOPY
    assert resolve_technique("import_netcdf", ds) == GENERIC
    assert resolve_technique("read_origin_project", ds) == GENERIC
    assert resolve_technique("import_preview", ds) == GENERIC


def test_resolve_technique_unknown_parser_is_generic() -> None:
    """A plugin-registered or otherwise unmapped parser is ambiguous by
    definition here -- generic, never a guess."""
    assert resolve_technique("some_third_party_plugin_parser", _tiny_ds()) == GENERIC


def test_stamp_technique_falls_back_to_dispatched_name_when_parser_silent() -> None:
    """read_origin_project (and any parser that doesn't self-report
    parser_name) still gets one, from the dispatched callable's own name."""

    def fake_parser(path: Path) -> DataStruct:  # pragma: no cover - never invoked
        raise NotImplementedError(str(path))

    stamped = stamp_technique(_tiny_ds({"source": "x"}), fake_parser)
    assert stamped.metadata["parser_name"] == "fake_parser"
    assert stamped.metadata["technique"] == GENERIC


def test_stamp_technique_prefers_parser_self_reported_name() -> None:
    """import_mpms (and the saved-import-filter wrapper) re-tag parser_name
    themselves; the chokepoint must respect that over the dispatched
    callable's own __name__."""

    def dispatched_wrapper(path: Path) -> DataStruct:  # pragma: no cover - never invoked
        raise NotImplementedError(str(path))

    ds = _tiny_ds({"parser_name": "import_mpms", "x_column_name": "Temperature"})
    stamped = stamp_technique(ds, dispatched_wrapper)
    assert stamped.metadata["parser_name"] == "import_mpms"
    assert stamped.metadata["technique"] == MAGNETOMETRY_MVST


def test_stamp_technique_is_additive_over_existing_metadata() -> None:
    """Stamping must not drop any pre-existing metadata key (additive, not
    a metadata-shape rewrite) -- CAUTION from PLOT_WORKFLOW_PLAN item 1."""

    def parser(path: Path) -> DataStruct:  # pragma: no cover - never invoked
        raise NotImplementedError(str(path))

    ds = _tiny_ds({"source": "somefile.dat", "custom_field": 42})
    stamped = stamp_technique(ds, parser)
    assert stamped.metadata["source"] == "somefile.dat"
    assert stamped.metadata["custom_field"] == 42
    assert "technique" in stamped.metadata
    assert "parser_name" in stamped.metadata
