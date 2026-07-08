"""Beautiful-defaults audit harness (GAP_TIER3_PLAN item 2 / gap #11 residual).

Renders a small, representative set of physics figures through EVERY
publication style preset in ``quantized.calc.figure_styles`` at real export
size (each preset's own DPI), with ZERO per-figure overrides, so an owner can
eyeball whether an un-tweaked first render is already journal-grade.

Why this can't reuse ``tools/visual``: that harness screenshots the
interactive uPlot/Canvas2D surface in a real browser (see
``tools/visual/README.md``) — it never touches the matplotlib export path in
``quantized.calc.figure.render_figure``, which is what this script drives.
There is no other automated eye on that renderer's defaults.

Output (gitignored, never committed):
    tools/audit_defaults_out/<case>_<preset>.png   -- one PNG per case x preset
    tools/audit_defaults_out/index.html            -- contact sheet (rows=cases,
                                                       cols=presets) for the
                                                       owner's eyeball pass

Run:
    uv run python tools/audit_defaults.py
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from quantized.calc.figure import render_figure  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent / "audit_defaults_out"

# Exact preset list per the task spec (excludes the aps_double / nature_double
# wide variants -- same typography as aps / nature, only width differs, so
# auditing the single-column form covers their font/tick/legend behaviour).
PRESETS: tuple[str, ...] = (
    "default", "aps", "nature", "thesis", "report", "web", "presentation", "poster",
)

_RNG = np.random.default_rng(20260707)  # fixed seed: reproducible audit runs


@dataclass(frozen=True)
class Case:
    """One representative physics figure: shared x + one-or-more (label, y) series."""

    case_id: str
    display_name: str
    x: NDArray[np.float64]
    series: list[tuple[str, NDArray[np.float64]]]
    title: str
    x_label: str
    y_label: str
    x_log: bool = False
    y_log: bool = False


# --------------------------------------------------------------------------
# Synthetic physics datasets (no external files -- generated in-script).
# --------------------------------------------------------------------------


def _mh_hysteresis() -> Case:
    """M-H hysteresis loop: two branches (decreasing / increasing field) sharing
    one field axis, saturating with a coercive offset -- the standard tanh
    construction (Stoner-Wohlfarth-like squared loop), plus a small linear
    paramagnetic background and light measurement noise for realism.
    """
    h = np.linspace(-10_000.0, 10_000.0, 400)  # Oe
    ms = 1.0  # emu, normalized saturation moment
    hc = 120.0  # Oe, coercivity
    width = 60.0  # Oe, switching sharpness
    chi = 3e-6  # emu/Oe, small linear (para/dia-magnetic) background
    noise = _RNG.normal(0.0, 0.004, h.size)
    m_decreasing = ms * np.tanh((h + hc) / width) + chi * h + noise
    m_increasing = ms * np.tanh((h - hc) / width) + chi * h + noise
    return Case(
        case_id="mh_hysteresis",
        display_name="M-H hysteresis loop",
        x=h,
        series=[
            ("Decreasing H", m_decreasing.astype(float)),
            ("Increasing H", m_increasing.astype(float)),
        ],
        title="M-H Hysteresis Loop",
        x_label="Field H (Oe)",
        y_label="Moment M (emu)",
    )


def _xrd_powder() -> Case:
    """XRD powder pattern: broad exponential background + Gaussian Bragg peaks
    spanning ~3 orders of magnitude in intensity, plotted on a log-intensity
    axis (the standard XRD presentation so weak peaks stay visible)."""
    two_theta = np.linspace(20.0, 80.0, 1200)  # deg
    background = 40.0 + 300.0 * np.exp(-(two_theta - 20.0) / 25.0)
    peaks = [  # (position deg, peak intensity counts, width deg)
        (28.4, 20_000.0, 0.15),
        (33.0, 1_200.0, 0.12),
        (36.5, 8_000.0, 0.10),
        (47.5, 600.0, 0.18),
        (56.1, 3_000.0, 0.14),
        (59.9, 150.0, 0.12),
        (69.1, 900.0, 0.10),
        (76.4, 80.0, 0.15),
    ]
    intensity = background.copy()
    for pos, amp, wid in peaks:
        intensity = intensity + amp * np.exp(-0.5 * ((two_theta - pos) / wid) ** 2)
    counting_noise = _RNG.normal(0.0, np.sqrt(np.maximum(intensity, 1.0)) * 0.4, two_theta.size)
    intensity = np.clip(intensity + counting_noise, 1.0, None)
    return Case(
        case_id="xrd_powder",
        display_name="XRD powder pattern",
        x=two_theta,
        series=[("Intensity", intensity.astype(float))],
        title="XRD Powder Pattern",
        x_label="2θ (deg)",
        y_label="Intensity (counts)",
        y_log=True,
    )


def _reflectivity_rq() -> Case:
    """Specular reflectivity R(Q): total-external-reflection plateau below the
    critical edge Qc, a Q^-4 Fresnel-like decay above it damped by interfacial
    roughness (Nevot-Croce-style Gaussian factor), modulated by Kiessig
    thickness fringes -- plotted log-log, the standard reflectometry view."""
    q = np.logspace(np.log10(0.008), np.log10(0.30), 600)  # inverse Angstrom
    qc = 0.020  # critical Q, inverse Angstrom
    sigma = 6.0  # interfacial roughness, Angstrom
    thickness = 350.0  # film thickness, Angstrom
    visibility = 0.35
    fresnel = np.where(
        q < qc,
        1.0,
        (qc / (2.0 * q)) ** 4 * np.exp(-((q * sigma) ** 2)),
    )
    fringes = 1.0 + visibility * np.cos(q * thickness)
    r = fresnel * fringes
    multiplicative_noise = _RNG.normal(1.0, 0.03, q.size)
    r = np.clip(r * multiplicative_noise, 1e-8, 1.0)
    return Case(
        case_id="reflectivity_rq",
        display_name="R(Q) reflectivity",
        x=q,
        series=[("Reflectivity", r.astype(float))],
        title="Specular Reflectivity",
        x_label="Q (Å$^{-1}$)",
        y_label="R",
        x_log=True,
        y_log=True,
    )


def _transport_rt() -> Case:
    """Two-series R(T) transport comparison: linear-in-T resistivity (common
    in correlated-metal / strange-metal films) at two doping levels with
    different residual resistivity and slope -- a routine transport figure
    that exercises legend placement against two visually close curves."""
    t = np.linspace(2.0, 300.0, 600)  # K
    r_a = 5.0 + 0.15 * t + _RNG.normal(0.0, 0.4, t.size)  # ohm, lower doping
    r_b = 15.0 + 0.28 * t + _RNG.normal(0.0, 0.4, t.size)  # ohm, higher doping
    return Case(
        case_id="transport_rt",
        display_name="R(T) transport comparison",
        x=t,
        series=[
            ("Film A (undoped)", r_a.astype(float)),
            ("Film B (5% doped)", r_b.astype(float)),
        ],
        title="R(T): Doping Comparison",
        x_label="Temperature (K)",
        y_label="Resistance (Ω)",
    )


CASES: tuple[Case, ...] = (
    _mh_hysteresis(),
    _xrd_powder(),
    _reflectivity_rq(),
    _transport_rt(),
)


# --------------------------------------------------------------------------
# Rendering + contact sheet
# --------------------------------------------------------------------------


def _render_all() -> dict[tuple[str, str], Path]:
    """Render every (case, preset) pair to a PNG at that preset's own DPI
    (export size, zero per-figure overrides). Returns a path lookup."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    paths: dict[tuple[str, str], Path] = {}
    for case in CASES:
        for preset in PRESETS:
            dpi = figure_style(preset).dpi
            png = render_figure(
                case.x,
                case.series,
                title=case.title,
                x_label=case.x_label,
                y_label=case.y_label,
                x_log=case.x_log,
                y_log=case.y_log,
                fmt="png",
                style=preset,
                dpi=dpi,
            )
            out_path = OUT_DIR / f"{case.case_id}_{preset}.png"
            out_path.write_bytes(png)
            paths[(case.case_id, preset)] = out_path
            print(f"  [ok] {out_path.name}  ({len(png) / 1024:.0f} KB, {dpi} dpi)")
    return paths


def _write_contact_sheet(paths: dict[tuple[str, str], Path]) -> Path:
    """Write index.html: a grid (rows=cases, cols=presets) of inline <img>
    tags with labels, for the owner's eyeball pass."""
    header_cells = "".join(f"<th>{preset}</th>" for preset in PRESETS)
    rows: list[str] = []
    for case in CASES:
        cells = []
        for preset in PRESETS:
            fname = paths[(case.case_id, preset)].name
            st = figure_style(preset)
            cells.append(
                f'<td><img src="{fname}" alt="{case.case_id} / {preset}" '
                f'loading="lazy"><div class="meta">{st.fig_width_cm:g}'
                f"×{st.fig_height_cm:g} cm @ {st.dpi} dpi</div></td>"
            )
        rows.append(
            f'<tr><th class="rowhead">{case.display_name}<br>'
            f'<span class="sub">{case.case_id}</span></th>{"".join(cells)}</tr>'
        )
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Beautiful-defaults audit contact sheet</title>
<style>
  body {{ font-family: system-ui, sans-serif; background: #1c1c1c; color: #eee; margin: 24px; }}
  h1 {{ font-size: 18px; }}
  table {{ border-collapse: collapse; }}
  th, td {{ border: 1px solid #444; padding: 6px; vertical-align: top; text-align: left; }}
  th {{ background: #2a2a2a; font-size: 12px; }}
  th.rowhead {{ min-width: 140px; }}
  .sub {{ font-size: 10px; color: #999; }}
  img {{ max-width: 260px; max-height: 200px; background: #fff; display: block; }}
  .meta {{ font-size: 10px; color: #999; margin-top: 2px; }}
</style>
</head>
<body>
<h1>Beautiful-defaults audit &mdash; rows = physics cases, cols = presets, zero overrides</h1>
<table>
<tr><th></th>{header_cells}</tr>
{"".join(rows)}
</table>
</body>
</html>
"""
    index_path = OUT_DIR / "index.html"
    index_path.write_text(html, encoding="utf-8")
    return index_path


def main() -> None:
    print(f"Rendering {len(CASES)} cases x {len(PRESETS)} presets = "
          f"{len(CASES) * len(PRESETS)} PNGs into {OUT_DIR}")
    paths = _render_all()
    index_path = _write_contact_sheet(paths)
    print(f"\nContact sheet: {index_path}")


if __name__ == "__main__":
    main()
