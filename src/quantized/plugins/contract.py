"""Plugin contract v1: the stable, versioned shape a quantized plugin declares.

A plugin is a Python module (a drop-in ``.py`` file or an installed package
exposing the ``quantized.plugins`` entry point) that defines a manifest and,
optionally, any of three contribution lists. This module owns the *contract*
(the manifest + its validation and the discovery-result record); the *loader*
(:mod:`quantized.plugins.loader`) owns discovery and registration.

Manifest — required::

    QZ_PLUGIN = {"name": "My Plugin", "version": "1.2.0", "api_version": 1}

Contributions — any subset, each a list of plain dicts (see docs/plugins.md):

- ``PARSERS``    — ``{"extensions": [".ext"], "read": path -> DataStruct|dict,
                      "sniff"?: bytes -> bool}``
- ``FIT_MODELS`` — ``{"name": str, "params": [str, ...],
                      "fn": (x, params) -> y, "guess"?: [float, ...]}``
- ``STEPS``      — ``{"name": str, "fn": (DataStruct, params) -> DataStruct}``

Pure ``plugins`` layer — no fastapi/pydantic imports (guarded by
``test_repo_integrity``). Plugins can never reach ``quantized.routes``.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

__all__ = [
    "API_VERSION",
    "InvalidManifest",
    "PluginInfo",
    "PluginManifest",
    "validate_manifest",
]

# The contract version this quantized build speaks. A plugin declaring any other
# ``api_version`` is skipped (logged) — never loaded against an incompatible host.
API_VERSION = 1


class InvalidManifest(ValueError):
    """A module's ``QZ_PLUGIN`` manifest is missing or not v1-compatible."""


@dataclass(frozen=True)
class PluginManifest:
    """The validated ``QZ_PLUGIN`` metadata of one plugin."""

    name: str
    version: str
    api_version: int


@dataclass(frozen=True)
class PluginInfo:
    """What one discovered plugin is and what it contributed.

    The record surfaced by ``qz plugin list`` and cached by the loader.
    ``source`` is the stable identifier used for enable/disable (the module file
    stem for a drop-in plugin, or the entry-point name for a packaged one); the
    manifest ``name`` is human-facing and only known once the manifest validates.
    """

    source: str  # module stem (file plugin) | entry-point name — the identifier
    origin: str  # "file" | "entry_point"
    status: str  # "loaded" | "disabled" | "error"
    name: str = ""  # manifest name (blank until the manifest validates)
    version: str = ""
    error: str = ""  # problem text: import/manifest failure, or rejected contributions
    parsers: tuple[str, ...] = ()
    fit_models: tuple[str, ...] = ()
    steps: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "origin": self.origin,
            "status": self.status,
            "name": self.name,
            "version": self.version,
            "error": self.error,
            "parsers": list(self.parsers),
            "fit_models": list(self.fit_models),
            "steps": list(self.steps),
        }


def validate_manifest(module: object) -> PluginManifest:
    """Read and validate ``module.QZ_PLUGIN``.

    Raises :class:`InvalidManifest` when the manifest is missing, malformed, or
    declares an ``api_version`` this build does not speak. On success the
    manifest is guaranteed to have a non-empty ``name`` and ``api_version`` equal
    to :data:`API_VERSION`.
    """
    raw = getattr(module, "QZ_PLUGIN", None)
    if not isinstance(raw, Mapping):
        raise InvalidManifest("module defines no QZ_PLUGIN dict")
    api = raw.get("api_version")
    if api != API_VERSION:
        raise InvalidManifest(
            f"unsupported api_version {api!r} (this quantized speaks v{API_VERSION})"
        )
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip():
        raise InvalidManifest("QZ_PLUGIN['name'] must be a non-empty string")
    version = str(raw.get("version", "0"))
    return PluginManifest(name=name.strip(), version=version, api_version=API_VERSION)
