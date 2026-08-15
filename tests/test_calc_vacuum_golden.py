"""Golden parity vs MATLAB ``+calc/+vacuum`` (DiraCulator ``buildVacuumTab``).

Staged by the DIRACULATOR_AUDIT P1 campaign: freeze cases live in
``tools/matlab/freeze_dira_film_super_vacuum.m`` (not yet merged into
``freeze_calc_values.m``), so every test here SKIPS until the owner runs
MATLAB and commits ``tests/golden/calc_dira_vacuum_*.json``.

``calc.vacuum`` output keys already match the MATLAB struct field names
verbatim (``mfp``, ``tMono``, ``Kn``, ...), so no key remapping is needed
(contrast ``test_calc_thin_film_golden.py``).

``sputter_yield`` note (class d, intentional divergence): DiraCulator's Card
3 ``doSputterYield()`` button callback calls
``calc.vacuum.sputterYield(efSYMat.Value, efSYIon.Value, efSYE.Value)`` --
i.e. positionally ``(material, ion, energy)`` -- against the function's own
``sputterYield(material, energy, opts.ion=...)`` signature. That swaps a
char string into the ``energy (1,1) double`` argument slot, which fails the
MATLAB ``arguments`` block validation on every click: a GUI wiring bug, not
a bug in ``+calc/+vacuum/sputterYield.m`` itself. PORT_CHECKLIST.md records
this as "Fixed sputterYield GUI arg-order bug". The Python route
(``routes/vacuum.py``) already calls ``sputter_yield(material, energy,
ion=...)`` -- the function's own correct signature -- so the test below
freezes and checks that same intended behavior; no formula correction is
needed, only the GUI's argument order was ever wrong.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from quantized.calc import vacuum


@pytest.mark.golden
def test_mean_free_path_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    """Card-1 formula is duplicated inline in the MATLAB GUI (``doMFP()``)
    rather than calling ``calc.vacuum.meanFreePath``, but the inline formula
    is identical -- freezing the ``+calc`` function directly."""
    g = load_golden("calc_dira_vacuum_mean_free_path.json")
    result = vacuum.mean_free_path(1e-4, temperature=300.0, d=3.64e-10)
    compare_calc(result, g["output"])


@pytest.mark.golden
def test_monolayer_time_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_vacuum_monolayer_time.json")
    result = vacuum.monolayer_time(1.33e-4)
    compare_calc(result, g["output"])


@pytest.mark.golden
def test_knudsen_number_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_vacuum_knudsen_number.json")
    result = vacuum.knudsen_number(0.05, 0.1)
    compare_calc(result, g["output"])


@pytest.mark.golden
def test_pump_down_time_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_vacuum_pump_down_time.json")
    result = vacuum.pump_down_time(50.0, 100.0, 1e5, 1e-4)
    compare_calc(result, g["output"])


@pytest.mark.golden
def test_sputter_yield_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_vacuum_sputter_yield.json")
    result = vacuum.sputter_yield("Cu", 500.0, ion="Ar")
    compare_calc(result, g["output"])


@pytest.mark.golden
def test_gas_flow_matches_matlab(
    load_golden: Callable[[str], dict[str, Any]],
    compare_calc: Callable[..., None],
) -> None:
    g = load_golden("calc_dira_vacuum_gas_flow.json")
    result = vacuum.gas_flow(1e-3, 1e-5, 0.025, 0.5)
    compare_calc(result, g["output"])
