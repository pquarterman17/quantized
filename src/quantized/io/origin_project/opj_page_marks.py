"""Place a multi-layer ``.opj`` page's free text on the panel Origin draws it on.

Each layer decodes its own text objects (``figure_layers._build_layer``) into
``annotation_marks`` in that layer's data coordinates. On a page with several
panels that is not where Origin draws them:

* **Page-attached text** (``annotation_marks.opj_page_attached``) belongs to no
  layer at all. Moke.opj Graph10 stores its panel labels "(a)"/"(b)" and the
  lower panel's legend that way, all inside layer 1's record, so "(b)" landed
  in the top panel although Origin draws it beside the bottom one.
* **Layer-attached text placed beside another panel.** XMCD.opj's GraphT*
  pages keep the lower panels' rotated Y titles ("difference (arb. units)",
  "asymmetry (%)") as free text in layer 1, positioned left of layers 2 and 3,
  whose own ``YL`` titles are blank.

Both cases use only decoded geometry: each object's page-unit anchor and box
(``annotation_marks.opj_object_anchor`` / ``opj_object_box``, the box proven
against the annotations COM oracle) and each layer's frame (§13.2 #7).

:func:`place_window_marks` moves a mark to the panel whose frame is nearest
to the object's box centre vertically (0 inside the frame's span; ties keep
the object's own layer, then the lowest layer). It then converts the anchor to
that panel's data coordinates. Single-layer pages are unchanged. A rotated
text object (the anchor is the box's bottom-left corner, the rotation
signature in ``opj_object_fractions``) whose box lies wholly left of its
panel's frame and is centred within the frame's height is drawn where a left
Y title sits. When that panel's own Y title is blank it becomes the title, in
place of a mark the plot would have to pull inside the frame.

Pure library: dicts in, dicts out.
"""

from __future__ import annotations

from typing import Any

from quantized.io.origin_project.annotation_marks import frac_to_data, page_point_fractions

__all__ = ["place_window_marks"]

Frame = tuple[int, int, int, int]


def _frame(fig: dict[str, Any]) -> Frame | None:
    f = fig.get("frame")
    if not isinstance(f, dict):
        return None
    return int(f["left"]), int(f["top"]), int(f["right"]), int(f["bottom"])


def _centre_y(geom: dict[str, Any]) -> float:
    box = geom.get("box")
    if box is not None:
        return float(box[1] + box[3]) / 2.0
    return float(geom["anchor"][1])


def _vertical_gap(y: float, frame: Frame) -> float:
    return max(frame[1] - y, 0.0, y - frame[3])


def _panel_for(geom: dict[str, Any], own: dict[str, Any], figs: list[dict[str, Any]]) -> Any:
    y = _centre_y(geom)
    best: tuple[float, int, int] | None = None
    target = own
    for fig in figs:
        frame = _frame(fig)
        if frame is None:
            continue
        key = (_vertical_gap(y, frame), 0 if fig is own else 1, int(fig.get("layer") or 0))
        if best is None or key < best:
            best, target = key, fig
    return target


def _to_panel(mark: dict[str, Any], anchor: tuple[float, float], fig: dict[str, Any]) -> bool:
    frame = _frame(fig)
    fracs = page_point_fractions(anchor[0], anchor[1], frame) if frame is not None else None
    if fracs is None:
        return False
    mark["x"], mark["y"] = frac_to_data(
        fracs[0],
        fracs[1],
        fig["x_from"],
        fig["x_to"],
        fig["y_from"],
        fig["y_to"],
        bool(fig.get("x_log")),
        bool(fig.get("y_log")),
    )
    return True


def _title_slot(geom: dict[str, Any], fig: dict[str, Any]) -> str | None:
    """``"y_title"`` for an upward-reading (900 tenths) text wholly left of the
    panel's frame and centred within its height; ``"x_title"`` for an
    unrotated text wholly below the frame and centred within its width.
    Those are the slots Origin's own axis titles occupy."""
    box, frame = geom.get("box"), _frame(fig)
    if box is None or frame is None:
        return None
    rotation = geom.get("rotation")
    if rotation == 900 and box[2] <= frame[0] and frame[1] <= (box[1] + box[3]) / 2 <= frame[3]:
        return "y_title"
    if rotation == 0 and box[1] >= frame[3] and frame[0] <= (box[0] + box[2]) / 2 <= frame[2]:
        return "x_title"
    return None


def place_window_marks(figs: list[dict[str, Any]]) -> None:
    """Re-home one window's marks onto the panel Origin draws them on (module
    docstring), in place, and drop the private ``_geom`` key from every mark."""
    placed: list[tuple[dict[str, Any], dict[str, Any], dict[str, Any] | None]] = []
    for fig in figs:
        for mark in fig.get("annotation_marks") or []:
            geom = mark.pop("_geom", None)
            target = fig
            if geom is not None and len(figs) > 1:
                target = _panel_for(geom, fig, figs)
                if target is not fig and not _to_panel(mark, geom["anchor"], target):
                    target = fig  # cannot convert: stays where its own layer put it
            placed.append((target, mark, geom if len(figs) > 1 else None))
        fig["annotation_marks"] = []
    for target, mark, geom in placed:
        slot = _title_slot(geom, target) if geom is not None else None
        if slot is not None and not target.get(slot):
            target[slot] = " ".join(mark["text"].split("\n"))
            continue
        target["annotation_marks"].append(mark)
