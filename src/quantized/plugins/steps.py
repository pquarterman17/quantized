"""Pipeline-step registry for plugin-contributed steps (gap #8).

A step is a pure transform ``fn(DataStruct, params) -> DataStruct``. Plugin API
v1 REGISTERS and LISTS steps server-side; surfacing them in the frontend
pipeline palette and replaying them in templates/batches is a later ecosystem
item. Giving steps a small pure home here means the contract is complete now,
without a premature route.

All steps are plugin-contributed (there are no built-in steps), so
:func:`unregister_plugin_steps` simply clears the registry.

Pure ``plugins`` layer — imports only :mod:`quantized.datastruct`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from quantized.datastruct import DataStruct

__all__ = [
    "StepSpec",
    "get_step",
    "list_steps",
    "register_step",
    "run_step",
    "unregister_plugin_steps",
]

StepFn = Callable[[DataStruct, dict[str, Any]], DataStruct]


@dataclass(frozen=True)
class StepSpec:
    """One registered pipeline step: a stable ``name`` -> pure transform."""

    name: str
    fn: StepFn
    plugin: str = ""


_STEPS: dict[str, StepSpec] = {}


def register_step(name: str, fn: StepFn, *, plugin: str = "") -> None:
    """Register a pipeline step under ``name``.

    Refuses (``ValueError``) an empty name or a duplicate — a plugin cannot
    silently override another plugin's step.
    """
    if not name or not name.strip():
        raise ValueError("step name must be a non-empty string")
    if name in _STEPS:
        raise ValueError(f"step '{name}' is already registered")
    _STEPS[name] = StepSpec(name=name, fn=fn, plugin=plugin)


def list_steps() -> list[str]:
    """Names of all registered steps, sorted for a stable listing."""
    return sorted(_STEPS)


def get_step(name: str) -> StepSpec:
    """The :class:`StepSpec` registered under ``name`` (``KeyError`` if unknown)."""
    if name not in _STEPS:
        raise KeyError(f"unknown step: {name!r}")
    return _STEPS[name]


def run_step(
    name: str, data: DataStruct, params: dict[str, Any] | None = None
) -> DataStruct:
    """Run a registered step — the seam the later execution-wiring item builds on.

    Raises ``KeyError`` for an unknown step and ``TypeError`` if the step returns
    something other than a :class:`DataStruct`.
    """
    result = get_step(name).fn(data, params or {})
    if not isinstance(result, DataStruct):
        raise TypeError(
            f"step '{name}' must return a DataStruct, got {type(result).__name__}"
        )
    return result


def unregister_plugin_steps() -> None:
    """Clear all plugin-registered steps (idempotent reload / test isolation)."""
    _STEPS.clear()
