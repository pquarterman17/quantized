"""Headless calculator registry — the scripting/automation entry point for the
DiraCulator calculator domains (the Python analogue of MATLAB ``api = DiraCulator()``).

The ``calc/`` domain modules are already pure and headless; this module gives them
a **single, discoverable, stable surface**: a name → pure-function catalog so any
calculation can be listed, described, and invoked by name with a params dict —
without the GUI, the HTTP routes, or knowing each module's import path.

    >>> from quantized.calc.registry import call_calculator, list_calculators
    >>> call_calculator("crystal.d_spacing", {"system": "cubic",
    ...     "a": 5.4309, "b": 5.4309, "c": 5.4309, "h": 1, "k": 1, "l": 1})["d"]
    3.135...

Discovery:

    >>> [op["name"] for op in list_calculators(domain="xray")]
    ['xray.bragg_d_spacing', 'xray.bragg_two_theta', 'xray.q_from_two_theta', ...]
    >>> describe_calculator("xray.bragg_d_spacing")["params"]   # signature params
    [{'name': 'two_theta', 'required': True, 'default': None}, ...]

Pure layer: imports only ``quantized.calc.*`` (no fastapi/pydantic). The thin
``routes/calc.py`` adapter exposes the same catalog + call over HTTP; a CLI could
wrap it identically. Operation names are ``<domain>.<operation>`` and are stable —
treat them as API.
"""

from __future__ import annotations

import inspect
import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from quantized.calc import (
    constants,
    crystallography,
    diffusion,
    electrical,
    electrochemistry,
    magnetic,
    optics,
    semiconductor,
    sld_formula,
    substrates,
    superconductor,
    thermal,
    thin_film,
    unit_convert,
    vacuum,
    xray,
)

__all__ = [
    "CALCULATORS",
    "CalcOp",
    "call_calculator",
    "describe_calculator",
    "list_calculators",
]


@dataclass(frozen=True)
class CalcOp:
    """One headless calculator operation: a stable name → pure function.

    ``name`` is ``<domain>.<operation>``; ``fn`` is the pure ``calc`` callable it
    dispatches to. The human summary is derived from the function's docstring, so
    it never drifts from the implementation.
    """

    name: str
    domain: str
    fn: Callable[..., Any]

    @property
    def summary(self) -> str:
        doc = (self.fn.__doc__ or "").strip()
        return doc.splitlines()[0].strip() if doc else ""


def _ops(domain: str, module: object, names: list[str]) -> list[CalcOp]:
    """Register ``<domain>.<name>`` → ``module.<name>`` for each name."""
    return [CalcOp(f"{domain}.{n}", domain, getattr(module, n)) for n in names]


# The curated catalog. Operation names are stable public API; the second segment
# is the calc function name (so a name maps predictably to its source), except the
# two aliased singletons (units.convert / constants.list).
_OPS: list[CalcOp] = [
    CalcOp("units.convert", "units", unit_convert.unit_convert),
    CalcOp("constants.list", "constants", constants.constants),
    *_ops(
        "xray",
        xray,
        ["bragg_d_spacing", "bragg_two_theta", "q_from_two_theta", "two_theta_from_q", "xray_calc"],
    ),
    *_ops(
        "crystal",
        crystallography,
        ["d_spacing", "cell_volume", "theoretical_density", "plane_spacings"],
    ),
    *_ops("sld", sld_formula, ["sld_from_formula"]),
    *_ops(
        "electrical",
        electrical,
        [
            "resistivity",
            "sheet_resistance",
            "conductivity",
            "mobility",
            "current_density",
            "hall_single_point",
            "hall_analysis",
            "wiedemann_franz",
        ],
    ),
    *_ops("thermal", thermal, ["wiedemann_franz", "debye_temperature", "thermal_diffusivity"]),
    *_ops("diffusion", diffusion, ["arrhenius", "diffusion_length", "fick_flux"]),
    *_ops(
        "optics",
        optics,
        [
            "fresnel_coefficients",
            "critical_angle",
            "brewster_angle",
            "penetration_depth",
            "skin_depth",
            "dielectric_to_refractive",
            "refractive_to_dielectric",
        ],
    ),
    *_ops(
        "vacuum",
        vacuum,
        [
            "mean_free_path",
            "monolayer_time",
            "knudsen_number",
            "pump_down_time",
            "sputter_yield",
            "gas_flow",
        ],
    ),
    *_ops(
        "electrochemistry",
        electrochemistry,
        [
            "nernst_potential",
            "butler_volmer",
            "tafel_slope",
            "ohmic_drop",
            "double_layer_capacitance",
        ],
    ),
    *_ops(
        "substrates",
        substrates,
        ["get_substrate", "list_substrates", "lattice_mismatch", "substrate_table"],
    ),
    *_ops(
        "semiconductor",
        semiconductor,
        [
            "intrinsic_carrier_conc",
            "carrier_concentration",
            "fermi_level",
            "built_in_potential",
            "depletion_width",
            "debye_length",
            "hall_coefficient",
            "mobility_model",
            "thermal_velocity",
            "sheet_carrier_density",
            "diffusion_coeff",
            "diffusion_length",
            "dos_effective_mass",
            "material_presets",
        ],
    ),
    *_ops(
        "superconductor",
        superconductor,
        [
            "london_depth",
            "coherence_length",
            "gl_parameter",
            "critical_fields",
            "depairing_current",
            "bcs_gap",
            "material_presets",
        ],
    ),
    *_ops(
        "thinfilm",
        thin_film,
        [
            "deposition_rate",
            "sputter_rate",
            "kiessig_thickness",
            "stoney_stress",
            "projected_range",
            "multilayer_thermal_conductivity",
            "thermal_mismatch_strain",
            "diffusion_length_thermal",
            "dose_from_current",
            "dose_to_concentration",
        ],
    ),
    *_ops(
        "magnetic",
        magnetic,
        [
            "moment_convert",
            "bohr_magneton_convert",
            "demag_factor",
            "demag_named",
            "curie_weiss_moment",
            "curie_weiss_fit",
            "langevin",
            "magnetization",
            "domain_wall",
            "moment_per_atom",
        ],
    ),
]

CALCULATORS: dict[str, CalcOp] = {op.name: op for op in _OPS}

# Stable-name invariant: no domain accidentally registers two ops under one name.
assert len(CALCULATORS) == len(_OPS), "duplicate calculator operation name"

DOMAINS: tuple[str, ...] = tuple(dict.fromkeys(op.domain for op in _OPS))


def _jsonable(value: Any) -> Any:
    """A signature default reduced to a JSON-safe form (or ``str`` fallback)."""
    if value is None or isinstance(value, bool | int | str):
        return value
    if isinstance(value, float):
        return None if math.isnan(value) else value
    return str(value)


def _param_specs(fn: Callable[..., Any]) -> list[dict[str, Any]]:
    """Positional/keyword params of ``fn`` (name, required, default) for discovery."""
    specs: list[dict[str, Any]] = []
    for name, p in inspect.signature(fn).parameters.items():
        if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        required = p.default is inspect.Parameter.empty
        specs.append(
            {
                "name": name,
                "required": required,
                "default": None if required else _jsonable(p.default),
            }
        )
    return specs


def list_calculators(domain: str | None = None) -> list[dict[str, Any]]:
    """The catalog: ``{name, domain, summary}`` for every op (optionally one domain)."""
    ops = _OPS if domain is None else [op for op in _OPS if op.domain == domain]
    return [{"name": op.name, "domain": op.domain, "summary": op.summary} for op in ops]


def describe_calculator(name: str) -> dict[str, Any]:
    """Full description of one op: name, domain, summary, and its signature params."""
    op = CALCULATORS.get(name)
    if op is None:
        raise KeyError(_unknown_message(name))
    return {
        "name": op.name,
        "domain": op.domain,
        "summary": op.summary,
        "params": _param_specs(op.fn),
    }


def call_calculator(name: str, params: dict[str, Any] | None = None) -> Any:
    """Invoke a calculator by name with a params dict (``fn(**params)``).

    Raises ``KeyError`` for an unknown ``name``, and ``ValueError`` for invalid
    parameters (a ``TypeError`` from the call — missing/extra/misnamed args) or a
    domain-validation failure raised by the calc function itself.
    """
    op = CALCULATORS.get(name)
    if op is None:
        raise KeyError(_unknown_message(name))
    kwargs = params or {}
    try:
        return op.fn(**kwargs)
    except TypeError as exc:
        expected = ", ".join(s["name"] for s in _param_specs(op.fn)) or "(none)"
        raise ValueError(f"invalid parameters for {name!r} ({exc}); expected: {expected}") from exc


def _unknown_message(name: str) -> str:
    return (
        f"unknown calculator {name!r}; "
        f"see list_calculators() for the {len(CALCULATORS)} available"
    )
