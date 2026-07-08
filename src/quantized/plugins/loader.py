"""Plugin discovery + loading (gap #8).

Discovers plugins from two sources and registers their contributions through the
SAME chokepoints the built-ins use (so there is never a second dispatch path):

- drop-in ``.py`` modules in ``<config_dir>/plugins/`` (``config_dir`` reused
  from :mod:`quantized.io.import_filters` — the repo's one config-dir concept);
- installed packages exposing the ``quantized.plugins`` entry-point group.

Trust model: a plugin is arbitrary Python you chose to install — treated exactly
like anything you ``pip install``. There is NO sandbox (sandboxing a Python
interpreter is a losing game). Install only plugins you trust. See
``docs/plugins.md``.

Robustness: a plugin that raises on import, declares a missing/incompatible
manifest, or tries to shadow a built-in extension is LOGGED and SKIPPED — it
never takes down startup or the other plugins.

Pure ``plugins`` layer — no fastapi/pydantic imports (guarded by
``test_repo_integrity``).
"""

from __future__ import annotations

import importlib.util
import json
import logging
import sys
from collections.abc import Callable, Iterator, Mapping
from importlib import metadata
from pathlib import Path
from types import ModuleType
from typing import Any

from quantized.calc.fit_models import FIT_MODELS, register_model, unregister_model
from quantized.datastruct import DataStruct
from quantized.io.import_filters import config_dir
from quantized.io.registry import (
    Parser,
    Sniffer,
    register_parser,
    unregister_plugin_parsers,
)
from quantized.plugins import steps as step_registry
from quantized.plugins.contract import (
    InvalidManifest,
    PluginInfo,
    PluginManifest,
    validate_manifest,
)

__all__ = [
    "ENTRY_POINT_GROUP",
    "load_plugins",
    "loaded_plugins",
    "plugins_dir",
    "unload_plugins",
]

_log = logging.getLogger("quantized.plugins")

ENTRY_POINT_GROUP = "quantized.plugins"
_PLUGINS_SUBDIR = "plugins"
_CONFIG_FILENAME = "plugins.json"
_SNIFF_BYTES = 65536  # bytes handed to a plugin's optional bytes -> bool sniffer
_INF = float("inf")

# Cache of the most recent load, and the model names it registered (so an
# idempotent reload / test teardown can pop exactly those from the shared
# FIT_MODELS without touching a built-in model).
_LOADED: list[PluginInfo] = []
_PLUGIN_MODEL_NAMES: list[str] = []


# ── Public directory / config helpers ───────────────────────────────────────
def plugins_dir() -> Path:
    """The drop-in plugins directory (``<config_dir>/plugins``), created on demand."""
    directory = config_dir() / _PLUGINS_SUBDIR
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _disabled_sources() -> set[str]:
    """Source identifiers the user has disabled (``<config_dir>/plugins.json``).

    Shape: ``{"disabled": ["source-name", ...]}``. Missing/corrupt -> none
    disabled. A disabled plugin is never imported (a broken plugin can be parked
    without deleting it).
    """
    path = config_dir() / _CONFIG_FILENAME
    if not path.is_file():
        return set()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        return set()
    disabled = raw.get("disabled") if isinstance(raw, Mapping) else None
    if not isinstance(disabled, list):
        return set()
    return {str(item) for item in disabled}


# ── Discovery ────────────────────────────────────────────────────────────────
def _discover() -> Iterator[tuple[str, str, Callable[[], ModuleType]]]:
    """Yield ``(source, origin, importer)`` for every discovered plugin.

    File plugins first (sorted, deterministic), then entry points. ``importer``
    is a thunk that imports and returns the module (and may raise — the caller
    isolates it).
    """
    for path in sorted(plugins_dir().glob("*.py")):
        if path.name.startswith("_"):
            continue
        yield path.stem, "file", _file_importer(path.stem, path)
    for entry in _entry_points():
        yield entry.name, "entry_point", _ep_importer(entry)


def _entry_points() -> list[Any]:
    try:
        found = metadata.entry_points(group=ENTRY_POINT_GROUP)
    except Exception:  # pragma: no cover - importlib.metadata is robust
        return []
    return sorted(found, key=lambda e: e.name)


def _file_importer(source: str, path: Path) -> Callable[[], ModuleType]:
    def _load() -> ModuleType:
        module_name = f"quantized_plugins.{source}"
        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            raise ImportError(f"cannot create an import spec for {path}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        try:
            spec.loader.exec_module(module)
        except Exception:
            sys.modules.pop(module_name, None)
            raise
        return module

    return _load


def _ep_importer(entry: Any) -> Callable[[], ModuleType]:
    def _load() -> ModuleType:
        loaded: ModuleType = entry.load()
        return loaded

    return _load


# ── Loading ──────────────────────────────────────────────────────────────────
def load_plugins() -> list[PluginInfo]:
    """Discover, validate, and register all plugins; return one info per plugin.

    Idempotent: a prior load's registrations are removed first, so this can be
    called again to reload. Called once at app startup (:func:`quantized.app.create_app`).
    """
    unload_plugins()
    disabled = _disabled_sources()
    infos: list[PluginInfo] = []
    for source, origin, importer in _discover():
        if source in disabled:
            infos.append(PluginInfo(source=source, origin=origin, status="disabled"))
            continue
        infos.append(_load_one(source, origin, importer))
    _LOADED[:] = infos
    return infos


def loaded_plugins() -> list[PluginInfo]:
    """The plugins from the most recent :func:`load_plugins` (empty if never run)."""
    return list(_LOADED)


def unload_plugins() -> None:
    """Remove all plugin-registered contributions (idempotent reload / tests)."""
    unregister_plugin_parsers()
    for name in _PLUGIN_MODEL_NAMES:
        unregister_model(name)
    _PLUGIN_MODEL_NAMES.clear()
    step_registry.unregister_plugin_steps()
    _LOADED.clear()


def _load_one(
    source: str, origin: str, importer: Callable[[], ModuleType]
) -> PluginInfo:
    try:
        module = importer()
    except Exception as exc:  # a plugin must never crash startup
        _log.warning("plugin %r failed to import: %s", source, exc)
        return PluginInfo(
            source=source, origin=origin, status="error", error=f"import failed: {exc}"
        )
    try:
        manifest = validate_manifest(module)
    except InvalidManifest as exc:
        _log.warning("plugin %r has an invalid manifest: %s", source, exc)
        return PluginInfo(source=source, origin=origin, status="error", error=str(exc))
    return _register(source, origin, manifest, module)


# ── Contribution registration (per-contribution isolation) ──────────────────
def _register(
    source: str, origin: str, manifest: PluginManifest, module: ModuleType
) -> PluginInfo:
    problems: list[str] = []
    parsers = _register_parsers(getattr(module, "PARSERS", None), problems)
    models = _register_models(getattr(module, "FIT_MODELS", None), problems)
    steps = _register_steps(getattr(module, "STEPS", None), manifest.name, problems)
    _log.info(
        "plugin %r (v%s) loaded: %d parser(s), %d model(s), %d step(s)",
        manifest.name, manifest.version, len(parsers), len(models), len(steps),
    )
    return PluginInfo(
        source=source,
        origin=origin,
        status="loaded",
        name=manifest.name,
        version=manifest.version,
        error="; ".join(problems),
        parsers=tuple(parsers),
        fit_models=tuple(models),
        steps=tuple(steps),
    )


def _as_specs(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list | tuple) else []


def _register_parsers(specs: Any, problems: list[str]) -> list[str]:
    registered: list[str] = []
    for spec in _as_specs(specs):
        if not isinstance(spec, Mapping):
            problems.append("bad parser spec (not a mapping)")
            continue
        exts = spec.get("extensions")
        read = spec.get("read")
        sniff = spec.get("sniff")
        if not isinstance(exts, list | tuple) or not exts or read is None:
            problems.append("bad parser spec (needs 'extensions' + 'read')")
            continue
        parser = _wrap_read(read)
        wrapped_sniff = _wrap_sniff(sniff) if sniff is not None else None
        for raw_ext in exts:
            ext = str(raw_ext)
            try:
                register_parser([ext], parser, sniff=wrapped_sniff)
            except ValueError as exc:
                problems.append(str(exc))
                continue
            registered.append(_norm_ext(ext))
    return registered


def _register_models(specs: Any, problems: list[str]) -> list[str]:
    registered: list[str] = []
    for spec in _as_specs(specs):
        if not isinstance(spec, Mapping):
            problems.append("bad fit-model spec (not a mapping)")
            continue
        name = spec.get("name")
        fn = spec.get("fn")
        params_raw = spec.get("params", spec.get("param_names"))
        if (
            not isinstance(name, str)
            or not name
            or fn is None
            or not isinstance(params_raw, list | tuple)
        ):
            problems.append(f"bad fit-model spec for {name!r}")
            continue
        if name in FIT_MODELS:
            problems.append(f"fit model '{name}' is already registered")
            continue
        params = [str(p) for p in params_raw]
        n = len(params)
        guess = spec.get("guess")
        p0 = [float(v) for v in guess] if isinstance(guess, list | tuple) else [1.0] * n
        if len(p0) != n:
            p0 = (p0 + [1.0] * n)[:n]
        register_model(name, "Plugin", fn, params, p0, [-_INF] * n, [_INF] * n)
        _PLUGIN_MODEL_NAMES.append(name)
        registered.append(name)
    return registered


def _register_steps(specs: Any, plugin_name: str, problems: list[str]) -> list[str]:
    registered: list[str] = []
    for spec in _as_specs(specs):
        if not isinstance(spec, Mapping):
            problems.append("bad step spec (not a mapping)")
            continue
        name = spec.get("name")
        fn = spec.get("fn")
        if not isinstance(name, str) or not name or fn is None:
            problems.append(f"bad step spec for {name!r}")
            continue
        try:
            step_registry.register_step(name, fn, plugin=plugin_name)
        except ValueError as exc:
            problems.append(str(exc))
            continue
        registered.append(name)
    return registered


# ── Adapters: plugin callable shapes -> registry callable shapes ────────────
def _norm_ext(ext: str) -> str:
    lowered = ext.lower()
    return lowered if lowered.startswith(".") else f".{lowered}"


def _wrap_read(read: Any) -> Parser:
    """Adapt a plugin ``read(path)`` (returns a DataStruct OR a DataStruct dict)
    to the registry's ``Callable[[Path], DataStruct]``."""

    def parser(path: Path) -> DataStruct:
        result = read(path)
        if isinstance(result, DataStruct):
            return result
        if isinstance(result, Mapping):
            return DataStruct.from_dict(result)
        raise TypeError(
            "plugin parser 'read' must return a DataStruct or a DataStruct dict, "
            f"got {type(result).__name__}"
        )

    return parser


def _wrap_sniff(sniff: Any) -> Sniffer:
    """Adapt a plugin ``sniff(bytes)`` to the registry's ``Callable[[Path], bool]``.

    The first :data:`_SNIFF_BYTES` bytes of the file are handed to the plugin. A
    sniffer that raises or a file that cannot be read is treated as "no match"
    (a plugin sniffer must never break resolution for other parsers)."""

    def _sniff_path(path: Path) -> bool:
        try:
            with path.open("rb") as handle:
                data = handle.read(_SNIFF_BYTES)
        except OSError:
            return False
        try:
            return bool(sniff(data))
        except Exception:
            return False

    return _sniff_path
