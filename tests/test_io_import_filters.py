"""Saved import filters (io.import_filters): config-dir persistence, glob
matching + tie-break, and the registry-consult hook (gap #40 backend).

Every test isolates ``QZ_CONFIG_DIR`` to a ``tmp_path`` (an autouse fixture)
so this suite never reads or writes the real user config directory.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from quantized.io.import_filters import (
    ImportFilter,
    config_dir,
    delete_filter,
    load_filters,
    match_filter,
    save_filter,
)
from quantized.io.import_preview import ImportSettings
from quantized.io.registry import _EXT_MAP, import_auto, resolve_parser

_MESSY_WEIRD = "\n".join([
    "# header comment",
    "Temp,Moment",
    "(K),(emu)",
    "300,0.0012",
    "250,0.0015",
])


@pytest.fixture(autouse=True)
def isolated_config_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    d = tmp_path / "qzconfig"
    monkeypatch.setenv("QZ_CONFIG_DIR", str(d))
    return d


def _settings(**overrides: object) -> ImportSettings:
    base: dict[str, object] = {
        "delimiter": ",", "header_line": 0, "data_start_line": 1,
        "column_names": ["Temp", "Moment"], "roles": ["x", "y"],
    }
    base.update(overrides)
    return ImportSettings(**base)  # type: ignore[arg-type]


# ── config dir ────────────────────────────────────────────────────────────


def test_config_dir_honors_env_override_and_creates_it(isolated_config_dir: Path) -> None:
    d = config_dir()
    assert d == isolated_config_dir
    assert d.is_dir()


# ── load / save / delete ─────────────────────────────────────────────────


def test_load_filters_missing_file_is_empty() -> None:
    assert load_filters() == []


def test_save_and_load_roundtrip() -> None:
    filt = ImportFilter(name="Messy XYZ", glob="*.weird", settings=_settings())
    saved = save_filter(filt)
    assert saved.updated  # stamped with a timestamp
    loaded = load_filters()
    assert len(loaded) == 1
    assert loaded[0].name == "Messy XYZ"
    assert loaded[0].glob == "*.weird"
    assert loaded[0].settings == _settings()


def test_save_upserts_by_name() -> None:
    save_filter(ImportFilter(name="A", glob="*.dat", settings=_settings()))
    save_filter(ImportFilter(name="A", glob="*.txt", settings=_settings(delimiter="tab")))
    loaded = load_filters()
    assert len(loaded) == 1
    assert loaded[0].glob == "*.txt"
    assert loaded[0].settings.delimiter == "tab"


def test_save_empty_name_raises() -> None:
    with pytest.raises(ValueError, match="name"):
        save_filter(ImportFilter(name="   ", glob="*.dat", settings=_settings()))


def test_delete_filter() -> None:
    save_filter(ImportFilter(name="A", glob="*.dat", settings=_settings()))
    assert delete_filter("A") is True
    assert load_filters() == []
    assert delete_filter("A") is False  # already gone


# ── robustness to missing/corrupt files ──────────────────────────────────


def test_corrupt_json_loads_as_empty(isolated_config_dir: Path) -> None:
    config_dir()
    (isolated_config_dir / "import_filters.json").write_text("{not json!!", encoding="utf-8")
    assert load_filters() == []


def test_non_list_json_loads_as_empty(isolated_config_dir: Path) -> None:
    config_dir()
    (isolated_config_dir / "import_filters.json").write_text('{"oops": true}', encoding="utf-8")
    assert load_filters() == []


def test_malformed_entry_is_skipped_not_fatal(isolated_config_dir: Path) -> None:
    save_filter(ImportFilter(name="Good", glob="*.dat", settings=_settings()))
    path = isolated_config_dir / "import_filters.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload.append("not a dict")
    path.write_text(json.dumps(payload), encoding="utf-8")
    loaded = load_filters()
    assert len(loaded) == 1 and loaded[0].name == "Good"


# ── glob matching + tie-break ─────────────────────────────────────────────


def test_match_filter_by_glob() -> None:
    save_filter(ImportFilter(name="XYZ", glob="XYZ*.dat", settings=_settings()))
    assert match_filter("XYZ9000_run1.dat") is not None
    assert match_filter("other.dat") is None


def test_match_filter_case_insensitive() -> None:
    save_filter(ImportFilter(name="A", glob="*.WEIRD", settings=_settings()))
    assert match_filter("sample.weird") is not None


def test_match_filter_no_filters_returns_none() -> None:
    assert match_filter("anything.dat") is None


def test_match_filter_tie_break_specificity_wins_over_broad() -> None:
    """A narrowly-targeted glob outranks a catch-all when both match."""
    broad = ImportFilter(name="Broad", glob="*.dat", settings=_settings())
    narrow = ImportFilter(name="Narrow", glob="XYZ*.dat", settings=_settings())
    result = match_filter("XYZ9000.dat", filters=[broad, narrow])
    assert result is not None and result.name == "Narrow"
    # order in the candidate list must not matter
    result2 = match_filter("XYZ9000.dat", filters=[narrow, broad])
    assert result2 is not None and result2.name == "Narrow"


def test_match_filter_tie_break_recency_when_specificity_ties() -> None:
    """Equal-specificity globs: the most recently saved filter wins."""
    older = ImportFilter(
        name="First", glob="*.dat", settings=_settings(),
        updated="2026-01-01T00:00:00+00:00",
    )
    newer = ImportFilter(
        name="Second", glob="*.dat", settings=_settings(),
        updated="2026-01-02T00:00:00+00:00",
    )
    result = match_filter("anything.dat", filters=[older, newer])
    assert result is not None and result.name == "Second"
    result2 = match_filter("anything.dat", filters=[newer, older])
    assert result2 is not None and result2.name == "Second"


# ── registry-consult integration (the #40 acceptance case) ───────────────


def test_registry_consults_saved_filter_for_unrecognized_extension(tmp_path: Path) -> None:
    """A saved filter for '*.weird' makes import_auto parse a messy ASCII
    fixture that has no dedicated parser at all."""
    path = tmp_path / "run1.weird"
    path.write_text(_MESSY_WEIRD, encoding="utf-8")

    with pytest.raises(ValueError, match="no parser registered"):
        resolve_parser(path)

    settings = ImportSettings(
        delimiter=",", header_line=1, units_line=2, data_start_line=3,
        column_names=["Temp", "Moment"], roles=["x", "y"],
    )
    save_filter(ImportFilter(name="Weird Instrument", glob="*.weird", settings=settings))

    ds = import_auto(path)
    assert ds.labels == ("Moment",)
    assert ds.units == ("emu",)
    assert ds.time[0] == 300.0


def test_registry_saved_filter_does_not_override_unambiguous_extension(tmp_path: Path) -> None:
    """A saved filter can't hijack an extension with a dedicated, unambiguous
    parser (_EXT_MAP) — filters only fill the gap before content sniffers."""
    path = tmp_path / "scan.jdx"  # .jdx -> import_jcamp, unambiguous
    path.write_text("dummy", encoding="utf-8")
    save_filter(ImportFilter(name="Hijack", glob="*.jdx", settings=_settings()))
    assert resolve_parser(path) is _EXT_MAP[".jdx"]
