"""Multi-panel page layout math (FIGURE_AUTHORING_WORKFLOW_PLAN F3.5): the
pure, matplotlib-object-free pieces of "adjustable spacing, shared/
independent axes, link/unlink, alignment, and recommended resize modes" --
split out of ``calc.figure_page`` to keep that module under its 500-line
ceiling (the same reason ``figure_break.py``/``figure_labels.py``/
``figure_overrides.py`` exist separately, rather than growing the composer
module itself).

Three small, independently testable concerns:

- :func:`validate_layout` -- raise on an unknown ``resize_mode`` or an
  out-of-range gap.
- :func:`layout_engine_kwargs` -- ``resize_mode`` -> the matplotlib
  ``Figure(layout=...)`` engine name plus the gridspec ``wspace``/``hspace``
  kwargs that apply under it. matplotlib's own vocabulary
  (``Figure.set_layout_engine``): ``"constrained"`` (this module's default,
  and the RECOMMENDED mode for an ordinary grid page -- it auto-avoids
  overlapping titles/labels while still respecting an explicit gap, since a
  gridspec's ``wspace``/``hspace`` are an ADDITIVE floor under constrained
  layout, not a replacement for its own padding), ``"tight"`` (recommended
  when minimizing whitespace matters more than an exact gap -- it trims the
  rendered bounding box post-layout and recomputes its own spacing, so an
  explicit row/col gap is NOT honored in this mode -- a real, named
  tradeoff, not a silently dropped setting), or ``"none"`` (fixed manual
  spacing only -- the gridspec's ``wspace``/``hspace`` apply exactly, with
  no automatic adjustment; this is what free page-coordinate placement has
  always used implicitly, offered here on the grid path too as an explicit
  escape hatch for when constrained layout's own adjustments fight a
  deliberately tight gap).
- :func:`share_targets` -- for "shared/independent axes" + "link/unlink":
  which EARLIER panel (by placement-order index) each panel should share
  its x/y axis with, when the page links that axis. Today's link
  granularity is page-wide ("link all" / "unlink all") -- the acceptance
  journey (A6: "link then unlink axes" on a 2x2 page) only needs that core,
  not arbitrary per-row/per-column link groups. This function is the one
  seam a future per-group link feature would extend without touching
  ``calc.figure_page``'s axes-construction loop.
"""

from __future__ import annotations

__all__ = ["LAYOUT_RESIZE_MODES", "layout_engine_kwargs", "share_targets", "validate_layout"]

LAYOUT_RESIZE_MODES = ("constrained", "tight", "none")

# Generous fraction-of-average-panel-size bound (matplotlib's own default is
# ~0.2) -- guards absurd values without constraining legitimate use.
_MAX_GAP = 10.0


def validate_layout(row_gap: float | None, col_gap: float | None, resize_mode: str) -> None:
    """Raise ``ValueError`` on an unknown ``resize_mode`` or an out-of-range
    gap. ``None`` (the default -- "don't override the engine's own
    spacing") is always valid regardless of ``resize_mode``."""
    if resize_mode not in LAYOUT_RESIZE_MODES:
        raise ValueError(f"resize_mode must be one of {LAYOUT_RESIZE_MODES}")
    for name, gap in (("row_gap", row_gap), ("col_gap", col_gap)):
        if gap is not None and not (0.0 <= gap <= _MAX_GAP):
            raise ValueError(f"{name} must be between 0 and {_MAX_GAP}")


def layout_engine_kwargs(
    resize_mode: str, row_gap: float | None, col_gap: float | None
) -> tuple[str | None, dict[str, float]]:
    """(matplotlib ``layout`` engine name or ``None``, gridspec
    ``wspace``/``hspace`` kwargs to pass alongside it). ``"tight"`` ignores
    an explicit gap (its own whitespace-trimming pass recomputes spacing
    from scratch); ``"constrained"`` and ``"none"`` both pass ``wspace``/
    ``hspace`` straight through to the gridspec (`"constrained"` then
    treats it as an additive floor over its own padding; ``"none"`` honors
    it exactly, with no further adjustment). ``row_gap``/``col_gap`` of
    ``None`` (the default) omits the corresponding kwarg entirely, so the
    gridspec falls back to matplotlib's own default spacing -- today's
    exact, byte-identical rendering."""
    engine = None if resize_mode == "none" else resize_mode
    if resize_mode == "tight":
        return engine, {}
    spacing: dict[str, float] = {}
    if col_gap is not None:
        spacing["wspace"] = col_gap
    if row_gap is not None:
        spacing["hspace"] = row_gap
    return engine, spacing


def share_targets(n: int, link: bool) -> list[int | None]:
    """For each of ``n`` panels in placement order, the index of the
    earlier panel it should matplotlib ``sharex``/``sharey`` with, or
    ``None`` (no sharing). ``link=False`` -> every panel independent
    (today's behaviour, byte-identical). ``link=True`` -> every panel after
    the first shares with panel 0 -- matplotlib's shared-axis autoscale
    then unions every member's data range onto one set of limits, which is
    exactly "shared axes" (panels become visually comparable), the page's
    "link all" core."""
    if not link or n <= 1:
        return [None] * n
    return [None] + [0] * (n - 1)
