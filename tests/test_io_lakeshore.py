"""Lake Shore VSM parser: golden parity (synthetic fixture) + behaviour.

Direct-call only — auto-routing .csv to Lake Shore vs generic CSV is
ambiguous, so the registry doesn't sniff it (matches the MATLAB ambiguity).
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from quantized.io.lakeshore import import_lake_shore


@pytest.mark.golden
def test_lakeshore_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    ds = import_lake_shore(fixtures_dir / "lakeshore_synth.csv")
    assert_golden(ds, "lakeshore_synth_default.json")


def test_lakeshore_defaults_temp_moment(fixtures_dir: Path) -> None:
    ds = import_lake_shore(fixtures_dir / "lakeshore_synth.csv")
    assert ds.labels == ("Moment",)
    assert ds.units == ("emu",)
    assert ds.metadata["x_column_name"] == "Temperature"
    assert ds.n_points == 5


def test_lakeshore_all_columns(fixtures_dir: Path) -> None:
    ds = import_lake_shore(fixtures_dir / "lakeshore_synth.csv", y_axis="all")
    assert ds.n_channels == 2  # Magnetic Field + Moment (Temperature is x)
    assert "Moment" in ds.labels


def test_sniffer_accepts_lakeshore_rejects_generic(fixtures_dir: Path, tmp_path: Path) -> None:
    """MAIN_PLAN #7: the registry sniffer keys on the instrument preamble."""
    from quantized.io.lakeshore import is_lakeshore_file

    assert is_lakeshore_file(fixtures_dir / "lakeshore_synth.csv")
    generic = tmp_path / "generic.csv"
    generic.write_text("a,b,c\n1,2,3\n4,5,6\n", encoding="utf-8")
    assert not is_lakeshore_file(generic)
    assert not is_lakeshore_file(tmp_path / "missing.csv")  # never raises


def test_import_auto_routes_lakeshore_csv(fixtures_dir: Path) -> None:
    """Registered 2026-07-11 (was unregistered -> generic import_csv, which
    returns every column; the Lake Shore parser defaults to Moment only)."""
    from quantized.io.registry import import_auto

    ds = import_auto(fixtures_dir / "lakeshore_synth.csv")
    assert ds.labels == ("Moment",)
    assert ds.metadata.get("all_column_names") == ["Temperature", "Magnetic Field", "Moment"]


def test_sniffer_rejects_vendor_mention_outside_preamble(tmp_path: Path) -> None:
    """Review finding: 'Lake Shore' in a comment/data column must not reroute
    a generic CSV away from import_csv — the marker must title the file."""
    from quantized.io.lakeshore import is_lakeshore_file

    mention = tmp_path / "mention.csv"
    mention.write_text(
        "a,b,c\n1,2,3\n4,5,6\n# exported near a Lake Shore 8600\n", encoding="utf-8"
    )
    assert not is_lakeshore_file(mention)
    # Preamble marker but NO instrument columns anywhere -> still not claimed.
    bare = tmp_path / "bare.csv"
    bare.write_text("Lake Shore note\nx,y\n1,2\n", encoding="utf-8")
    assert not is_lakeshore_file(bare)


def test_unresolvable_moment_column_raises(tmp_path: Path) -> None:
    """Review finding: NO_COLUMN=-1 used to silently import the LAST column."""
    import pytest as _pytest

    from quantized.io.lakeshore import import_lake_shore

    f = tmp_path / "ls.csv"
    f.write_text(
        "Lake Shore VSM Measurement\nTemperature (K),Voltage (V)\n300,1\n200,2\n",
        encoding="utf-8",
    )
    with _pytest.raises(ValueError, match="could not be resolved"):
        import_lake_shore(f)
