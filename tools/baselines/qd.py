"""QD-style ``.dat`` M-vs-H parametric series (journey 2).

Plain-CSV layout (no ``[Header]``/``[Data]`` markers) modeled on the existing
``tests/fixtures/ppms_synth.dat`` fixture, which routes through
``io/qd.py``'s ``is_ppms_dat`` sniffer -> ``import_ppms``. Three temperatures,
each a full field sweep (up then down), so the journey exercises picking a
sweep/series apart in the UI.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from common import fmt_sig, write_text

__all__ = ["write_qd_mvsh_series"]

_HEADER = (
    "Comment,Time Stamp (sec),Temperature (K),Magnetic Field (Oe),"
    "Moment (emu),M. Std. Err. (emu)"
)


def _hysteresis_branch(
    h: np.ndarray, *, ms: float, hc: float, hk: float, going_up: bool
) -> np.ndarray:
    """Phenomenological double-tanh loop branch (up-sweep vs down-sweep)."""
    sign = 1.0 if going_up else -1.0
    return ms * np.tanh((h - sign * hc) / hk)


def _field_loop(h_max: float, n_half: int) -> tuple[np.ndarray, np.ndarray]:
    """Field values for a full up/down loop and a boolean 'going up' mask."""
    up = np.linspace(-h_max, h_max, n_half)
    down = np.linspace(h_max, -h_max, n_half)[1:]  # skip the shared endpoint
    h = np.concatenate([up, down])
    going_up = np.concatenate([np.ones(n_half, dtype=bool), np.zeros(down.size, dtype=bool)])
    return h, going_up


def write_qd_mvsh_series(path: Path, *, seed: int, n_half: int = 101) -> None:
    """M-vs-H hysteresis loops at 3 temperatures (parametric series journey)."""
    rng = np.random.default_rng(seed)
    temperatures = (100.0, 200.0, 300.0)
    # Softer, weaker loop at higher T (a plausible ferromagnet-near-Tc trend).
    params = {
        100.0: {"ms": 2.4e-4, "hc": 850.0, "hk": 900.0},
        200.0: {"ms": 1.7e-4, "hc": 400.0, "hk": 1100.0},
        300.0: {"ms": 0.9e-4, "hc": 90.0, "hk": 1400.0},
    }
    h_max = 5000.0

    lines = [_HEADER]
    t_stamp = 1000.0
    dt = 1.5
    for temp in temperatures:
        h, going_up = _field_loop(h_max, n_half)
        p = params[temp]
        moment = _hysteresis_branch(h, ms=p["ms"], hc=p["hc"], hk=p["hk"], going_up=True)
        moment_down = _hysteresis_branch(h, ms=p["ms"], hc=p["hc"], hk=p["hk"], going_up=False)
        moment = np.where(going_up, moment, moment_down)
        moment = moment + rng.normal(scale=0.01 * p["ms"], size=moment.size)
        stderr = np.full_like(moment, 0.01 * p["ms"])

        for i in range(h.size):
            row = [
                "",
                fmt_sig(t_stamp),
                fmt_sig(temp),
                fmt_sig(h[i]),
                fmt_sig(moment[i]),
                fmt_sig(stderr[i]),
            ]
            lines.append(",".join(row))
            t_stamp += dt

    write_text(path, "\n".join(lines) + "\n")
