"""quantized plugin system (gap #8).

A stable, pure contract for third-party contributions — parsers, fit models, and
pipeline steps — discovered from a drop-in config-dir folder or from installed
packages via the ``quantized.plugins`` entry point. See ``docs/plugins.md`` for
the full contract, worked examples, and the trust model.

Public surface::

    from quantized.plugins import load_plugins, loaded_plugins, plugins_dir
    from quantized.plugins import list_steps, run_step
"""

from __future__ import annotations

from quantized.plugins.contract import (
    API_VERSION,
    InvalidManifest,
    PluginInfo,
    PluginManifest,
)
from quantized.plugins.loader import (
    ENTRY_POINT_GROUP,
    load_plugins,
    loaded_plugins,
    plugins_dir,
    unload_plugins,
)
from quantized.plugins.steps import list_steps, run_step

__all__ = [
    "API_VERSION",
    "ENTRY_POINT_GROUP",
    "InvalidManifest",
    "PluginInfo",
    "PluginManifest",
    "list_steps",
    "load_plugins",
    "loaded_plugins",
    "plugins_dir",
    "run_step",
    "unload_plugins",
]
