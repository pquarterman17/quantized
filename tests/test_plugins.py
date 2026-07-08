"""Plugin API v1 (quantized.plugins): discovery, manifest validation, broken-
plugin isolation, parser precedence, fit-model + step registration, the disabled
list, entry-point discovery, and the ``qz plugin list`` CLI.

Every test isolates ``QZ_CONFIG_DIR`` to a ``tmp_path`` (autouse) so it never
reads or writes the real user config dir, and unloads plugin registrations
before + after each test so the shared io/calc registries never leak between
tests.
"""

from __future__ import annotations

import json
import textwrap
import types
from collections.abc import Iterator
from pathlib import Path

import pytest

from quantized import cli
from quantized.calc.fit_models import model_names
from quantized.datastruct import DataStruct
from quantized.io.import_filters import config_dir
from quantized.io.jcamp import import_jcamp
from quantized.io.registry import _EXT_MAP, import_auto, resolve_parser
from quantized.plugins import list_steps, load_plugins, run_step, unload_plugins
from quantized.plugins import loader as plugin_loader
from quantized.routes.fitting import list_models


@pytest.fixture(autouse=True)
def _isolate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("QZ_CONFIG_DIR", str(tmp_path))
    unload_plugins()
    yield
    unload_plugins()


def _write_plugin(name: str, body: str) -> str:
    (plugin_loader.plugins_dir() / f"{name}.py").write_text(
        textwrap.dedent(body), encoding="utf-8"
    )
    return name


# ── plugin source bodies ─────────────────────────────────────────────────────
PARSER_DS = """
    from quantized.datastruct import DataStruct

    QZ_PLUGIN = {"name": "Demo Parser", "version": "1.0", "api_version": 1}

    def _read(path):
        return DataStruct.create(
            [1.0, 2.0, 3.0], [[10.0], [20.0], [30.0]],
            labels=["Signal"], units=["V"], metadata={"parser_name": "demo"},
        )

    PARSERS = [{"extensions": [".demox"], "read": _read}]
"""

PARSER_DICT = """
    QZ_PLUGIN = {"name": "Dict Parser", "version": "1", "api_version": 1}

    def _read(path):
        return {"time": [1.0, 2.0], "values": [[5.0], [6.0]],
                "labels": ["D"], "units": [""], "metadata": {}}

    PARSERS = [{"extensions": [".dictx"], "read": _read}]
"""

PARSER_SNIFF = """
    from quantized.datastruct import DataStruct

    QZ_PLUGIN = {"name": "Sniff Parser", "version": "1", "api_version": 1}

    def _sniff(data):
        return data.startswith(b"MAGIC")

    def _read(path):
        return DataStruct.create([1.0], [[9.0]], labels=["S"], units=[""])

    PARSERS = [{"extensions": [".magx"], "read": _read, "sniff": _sniff}]
"""

PARSER_SHADOW = """
    from quantized.datastruct import DataStruct

    QZ_PLUGIN = {"name": "Shadow", "version": "1", "api_version": 1}

    def _read(path):
        return DataStruct.create([1.0], [[1.0]])

    PARSERS = [{"extensions": [".jdx"], "read": _read}]
"""

MODEL_PLUGIN = """
    QZ_PLUGIN = {"name": "Demo Model", "version": "1", "api_version": 1}

    def _affine(x, p):
        return p[0] * x + p[1]

    FIT_MODELS = [{"name": "Demo Affine", "params": ["m", "b"],
                   "fn": _affine, "guess": [2.0, 1.0]}]
"""

STEP_PLUGIN = """
    from quantized.datastruct import DataStruct

    QZ_PLUGIN = {"name": "Demo Step", "version": "1", "api_version": 1}

    def _double(ds, params):
        return DataStruct.create(
            ds.time, ds.values * 2.0, labels=ds.labels, units=ds.units
        )

    STEPS = [{"name": "double", "fn": _double}]
"""

BROKEN = """
    QZ_PLUGIN = {"name": "Broken", "version": "1", "api_version": 1}
    raise RuntimeError("boom at import")
"""

BAD_API = """
    QZ_PLUGIN = {"name": "Future", "version": "1", "api_version": 99}
"""

NO_MANIFEST = """
    X = 1
"""


# ── discovery + parser registration / precedence ─────────────────────────────
def test_parser_novel_extension_end_to_end(tmp_path: Path) -> None:
    _write_plugin("p_parser", PARSER_DS)
    infos = load_plugins()
    assert any(i.name == "Demo Parser" and i.status == "loaded" for i in infos)

    f = tmp_path / "sample.demox"
    f.write_text("ignored", encoding="utf-8")
    ds = import_auto(f)
    assert ds.labels == ("Signal",)
    assert ds.time[0] == 1.0
    assert ds.values[2, 0] == 30.0


def test_parser_returning_a_dict(tmp_path: Path) -> None:
    _write_plugin("p_dict", PARSER_DICT)
    load_plugins()
    f = tmp_path / "x.dictx"
    f.write_text("x", encoding="utf-8")
    ds = import_auto(f)
    assert ds.labels == ("D",)
    assert ds.values[1, 0] == 6.0


def test_parser_sniff_gates_the_content(tmp_path: Path) -> None:
    _write_plugin("p_sniff", PARSER_SNIFF)
    load_plugins()
    good = tmp_path / "a.magx"
    good.write_bytes(b"MAGIC and more")
    bad = tmp_path / "b.magx"
    bad.write_bytes(b"nope")

    assert import_auto(good).labels == ("S",)
    with pytest.raises(ValueError, match="no parser registered"):
        resolve_parser(bad)


def test_plugin_cannot_shadow_builtin_extension() -> None:
    _write_plugin("p_shadow", PARSER_SHADOW)
    infos = load_plugins()
    # .jdx still resolves to the built-in JCAMP parser, unchanged.
    assert _EXT_MAP[".jdx"] is import_jcamp
    info = next(i for i in infos if i.source == "p_shadow")
    assert info.status == "loaded"
    assert ".jdx" not in info.parsers
    assert "already claimed" in info.error.lower()


# ── robustness: a broken plugin is skipped, others still load ────────────────
def test_broken_plugin_is_skipped_others_load() -> None:
    _write_plugin("a_broken", BROKEN)  # 'a' sorts first -> loads before the good one
    _write_plugin("z_good", PARSER_DS)
    infos = {i.source: i for i in load_plugins()}
    assert infos["a_broken"].status == "error"
    assert "boom" in infos["a_broken"].error
    assert infos["z_good"].status == "loaded"
    assert ".demox" in infos["z_good"].parsers


def test_incompatible_or_missing_manifest_is_skipped() -> None:
    _write_plugin("p_future", BAD_API)
    _write_plugin("p_none", NO_MANIFEST)
    infos = {i.source: i for i in load_plugins()}
    assert infos["p_future"].status == "error"
    assert "api_version" in infos["p_future"].error
    assert infos["p_none"].status == "error"
    assert "QZ_PLUGIN" in infos["p_none"].error


# ── fit models + steps ───────────────────────────────────────────────────────
def test_fit_model_visible_in_models_list() -> None:
    _write_plugin("p_model", MODEL_PLUGIN)
    load_plugins()
    assert "Demo Affine" in model_names()
    listed = [m["name"] for m in list_models()["models"]]
    assert "Demo Affine" in listed


def test_step_registered_and_runs() -> None:
    _write_plugin("p_step", STEP_PLUGIN)
    load_plugins()
    assert "double" in list_steps()
    ds = DataStruct.create([1.0, 2.0], [[3.0], [4.0]], labels=["A"], units=[""])
    out = run_step("double", ds, {})
    assert out.values[0, 0] == 6.0
    assert out.values[1, 0] == 8.0


# ── disabled list + reload / unload semantics ───────────────────────────────
def test_disabled_source_is_skipped() -> None:
    _write_plugin("p_parser", PARSER_DS)
    (config_dir() / "plugins.json").write_text(
        json.dumps({"disabled": ["p_parser"]}), encoding="utf-8"
    )
    info = next(i for i in load_plugins() if i.source == "p_parser")
    assert info.status == "disabled"
    assert info.parsers == ()
    assert ".demox" not in _EXT_MAP


def test_reload_is_idempotent() -> None:
    _write_plugin("p_parser", PARSER_DS)
    load_plugins()
    infos = load_plugins()  # a second load must not raise or double-register
    info = next(i for i in infos if i.source == "p_parser")
    assert info.status == "loaded"
    assert list(info.parsers) == [".demox"]
    assert ".demox" in _EXT_MAP


def test_unload_removes_registrations() -> None:
    _write_plugin("p_parser", PARSER_DS)
    load_plugins()
    assert ".demox" in _EXT_MAP
    unload_plugins()
    assert ".demox" not in _EXT_MAP


# ── entry-point discovery ────────────────────────────────────────────────────
def test_entry_point_plugin_loads(monkeypatch: pytest.MonkeyPatch) -> None:
    module = types.ModuleType("fake_ep_plugin")
    module.QZ_PLUGIN = {"name": "EP Parser", "version": "2", "api_version": 1}  # type: ignore[attr-defined]

    def _read(_path: object) -> DataStruct:
        return DataStruct.create([1.0], [[7.0]], labels=["E"], units=[""])

    module.PARSERS = [{"extensions": [".epx"], "read": _read}]  # type: ignore[attr-defined]

    class _FakeEP:
        name = "ep_parser"

        def load(self) -> types.ModuleType:
            return module

    def _fake_entry_points(group: str) -> list[_FakeEP]:
        return [_FakeEP()] if group == plugin_loader.ENTRY_POINT_GROUP else []

    monkeypatch.setattr(plugin_loader.metadata, "entry_points", _fake_entry_points)
    info = next(i for i in load_plugins() if i.source == "ep_parser")
    assert info.origin == "entry_point"
    assert info.status == "loaded"
    assert ".epx" in _EXT_MAP


# ── CLI: qz plugin list ──────────────────────────────────────────────────────
def test_cli_plugin_list_output(capsys: pytest.CaptureFixture[str]) -> None:
    _write_plugin("p_parser", PARSER_DS)
    cli.main(["plugin", "list"])
    out = capsys.readouterr().out
    assert "p_parser" in out
    assert "Demo Parser" in out
    assert "[loaded]" in out
    assert ".demox" in out


def test_cli_plugin_list_empty(capsys: pytest.CaptureFixture[str]) -> None:
    cli.main(["plugin", "list"])
    assert "No plugins discovered" in capsys.readouterr().out
