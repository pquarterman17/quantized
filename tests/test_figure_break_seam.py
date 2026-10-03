"""X-break export: tick labels either side of a seam must not run together
(plot audit round 2 — "1.5" and "2.5" printed as one "1.52.5")."""

import matplotlib

matplotlib.use("Agg")

from matplotlib.figure import Figure  # noqa: E402

from quantized.calc.figure_break import clear_seam_labels  # noqa: E402


def _panels(left: tuple[float, float], right: tuple[float, float]) -> tuple[Figure, list]:
    fig = Figure(figsize=(6.0, 4.0))
    widths = [left[1] - left[0], right[1] - right[0]]
    grid = {"width_ratios": widths, "wspace": 0.06}
    axes = list(fig.subplots(1, 2, sharey=True, gridspec_kw=grid))
    axes[0].set_xlim(*left)
    axes[1].set_xlim(*right)
    return fig, axes


def _labels(ax) -> list[float]:
    lo, hi = ax.get_xlim()
    return [round(float(t), 6) for t in ax.get_xticks() if lo <= t <= hi]


def test_drops_the_incoming_panels_first_tick_when_it_meets_the_seam() -> None:
    fig, axes = _panels((0.0, 1.55), (2.45, 4.0))
    assert 1.5 in _labels(axes[0]) and 2.5 in _labels(axes[1])
    clear_seam_labels(fig, axes)
    assert 1.5 in _labels(axes[0])
    assert 2.5 not in _labels(axes[1])
    assert 3.0 in _labels(axes[1])
    assert axes[1].get_xlim() == (2.45, 4.0)


def test_leaves_ticks_alone_when_the_seam_has_room() -> None:
    fig, axes = _panels((0.0, 2.2), (2.8, 5.0))
    before = _labels(axes[1])
    clear_seam_labels(fig, axes)
    assert _labels(axes[1]) == before
