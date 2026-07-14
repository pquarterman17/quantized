"""Layer-level decoding for ``.opj`` graph windows: the layer-continuation
block detector and the per-layer plot-state builder, split verbatim out of
``figures.py`` (2026-07-11, MAIN #8h — the 500-line guard, no logic
changes). ``figures.py`` keeps the window walk (``extract_figures``) and
the byte-level module docstring these helpers were isolated and validated
against; this module holds the layer-scoped pieces it calls per layer:

- ``_axis`` / ``_log_heuristic`` / ``_y_scale_flag`` — the axis-range
  float64 triples and the exact Y lin/log flag at payload offset 98/99,
  with the decade heuristic as the only fallback.
- ``_is_layer_block`` / ``_LAYER_HEAD_BYTES`` — the layer-continuation
  block detector (head byte 0x1f ordinary / 0x17 stacked-panel / 0x5f
  merge-graph; see the comment at ``_LAYER_HEAD_BYTES``).
- ``_build_layer`` — one layer's full plot-state dict: axis ranges/steps,
  curve count, named-object text-bucket routing, positioned annotation
  marks, region shades, legend labels/position, per-layer curve bindings.

See ``figures.py``'s module docstring for the full byte-level trail and
corpus validation.
"""

from __future__ import annotations

import math
import struct
from typing import Any

from quantized.io.origin_project.annotation_marks import (
    _AUTO_TITLE,
    _clean_annotations,
    build_mark,
    frac_to_data,
    opj_object_fractions,
)
from quantized.io.origin_project.figure_geometry import opj_layer_frame
from quantized.io.origin_project.figure_text import (
    _LEGEND_RE,
    _first_title,
    _object_bucket,
    _object_text,
    _parse_legend_labels,
    _texts_in,
)
from quantized.io.origin_project.opj_curves import extract_curves
from quantized.io.origin_project.opj_shapes import SHAPE_TYPE, build_region_shade
from quantized.io.origin_project.origin_richtext import clean_richtext
from quantized.io.origin_project.windows import _cstring

__all__ = [
    "_LAYER_HEAD_BYTES",
    "_axis",
    "_build_layer",
    "_is_layer_block",
    "_log_heuristic",
    "_y_scale_flag",
]

# Fixed payload offset of a 133-byte object header's own ASCII name (see
# module docstring). 24 bytes is ample for every name observed corpus-wide
# (the longest, "__FRAMESRCDATAINFOS", is 19 chars).
_OBJ_NAME_OFFSET = 70
_OBJ_NAME_LIMIT = 24

# Y-axis scale flag: 2 bytes at the layer-continuation payload's offset 98/99
# (see the module docstring). Any other value falls back to the heuristic.
_Y_SCALE_FLAG_OFFSET = 98
_Y_LIN_FLAG = bytes([0x01, 0x00])
_Y_LOG_FLAG = bytes([0x08, 0x01])


def _axis(p: bytes, base: int) -> tuple[float, float]:
    lo, hi = struct.unpack_from("<d", p, base)[0], struct.unpack_from("<d", p, base + 8)[0]
    return float(lo), float(hi)


def _log_heuristic(lo: float, hi: float) -> bool:
    return lo > 0 and hi > 0 and hi / lo >= 1000.0


def _y_scale_flag(payload: bytes) -> bool | None:
    """Exact Y lin/log flag from the layer-continuation payload, or ``None``
    when the block is too short or the byte pair is unrecognized (caller
    falls back to ``_log_heuristic``) -- see the module docstring."""
    if len(payload) < _Y_SCALE_FLAG_OFFSET + 2:
        return None
    flag = payload[_Y_SCALE_FLAG_OFFSET : _Y_SCALE_FLAG_OFFSET + 2]
    if flag == _Y_LIN_FLAG:
        return False
    if flag == _Y_LOG_FLAG:
        return True
    return None


# A layer-continuation block's 3rd payload byte -- normally 0x1f (every
# window's first layer, and every subsequent OVERLAID layer, e.g. a
# double-Y graph's 2nd layer: validated on Moke's Graph7 AND on
# SLD_DoubleY.otp's two-layer double-Y template, both 0x1f/0x1f). A second,
# rarer value, 0x1f - 0x08 = 0x17, appears ONLY as a subsequent STACKED/
# TILED-PANEL layer (Origin's "N Panels" layout, a structurally different
# multi-layer mechanism from double-Y overlay) -- isolated on Moke's Graph4
# (layers 0x1f then 0x17, second layer's axis range (400.0, 1500.0) matches
# the oracle's 2nd-layer Y range exactly) and its composite copy inside
# Graph10. Corpus-wide grep (Moke/XRD/SuperlatticeFits/PNR/hc2convert/XMCD/
# MnN_Diffusion_PNR) finds 0x17 nowhere else at all -- and never outside a
# graph window's own span -- so accepting it is not a guess, it is confirmed
# structural evidence, not (yet) a generalized "any byte works" heuristic:
# only these two exact values are recognized; anything else falls through
# and is not treated as a layer boundary.
#
# A THIRD value, 0x1f | 0x40 = 0x5f, marks every layer of an Origin "Merge
# Graph Windows" result (decode-plan item 40, isolated 2026-07-09 on
# PNR.opj's ``Graph30``-``Graph33``/``PNRDWMerge``/``PNRmerge_Jan16`` --
# these 6 graph windows were previously invisible to `extract_figures`
# entirely, since their FIRST post-header block already reads 0x5f, so the
# window-vs-worksheet gate in `extract_figures` rejected them outright).
# Every merged window's 0x5f blocks decode with the SAME fixed-offset axis
# record `_build_layer` already reads (x/y from-to-step, the y-scale flag,
# the source_hint cstring) -- confirmed by cross-checking the independent
# `extract_curves` anchor scan over each window's span, which resolves real
# curves against real, currently-imported books (e.g. `PNRDWMerge`'s 48
# curves all bind to `DW*` books; `Graph31`'s 18 curves all bind to
# `Book35`/`Book36`/`Book37`) -- not synthetic axis-shaped garbage. A merge
# window's own layer count (2-9 in this corpus) is the total layer count
# across every graph merged into it, exactly the existing multi-layer/
# multi-panel model already built for genuine double-Y and stacked-panel
# windows (`_build_layer` is agnostic to *why* a layer boundary exists).
_LAYER_HEAD_BYTES = (0x1F, 0x17, 0x5F)


def _is_layer_block(payload: bytes) -> bool:
    """A layer-continuation block: head ``00 00 <0x1f|0x17|0x5f> 00``, ≥90 B
    (the axis-range triples' fixed offsets need at least that much). Graph
    windows repeat this block once per layer (see module docstring); this
    same detector both identifies a window header as a *graph* header
    (checked against the block right after it -- the first layer, 0x1f for
    an ordinary graph or 0x5f for every layer of a merged one) and finds
    every subsequent layer boundary inside one (0x1f, the rarer 0x17, or
    0x5f -- see ``_LAYER_HEAD_BYTES``)."""
    return (
        len(payload) >= 90
        and payload[0] == 0
        and payload[1] == 0
        and payload[2] in _LAYER_HEAD_BYTES
        and payload[3] == 0
    )


def _build_layer(
    blocks: list[tuple[int, bytes]],
    id_map: dict[int, tuple[str, str]],
    x_columns: dict[str, str],
    col_order: dict[str, list[tuple[str, int]]] | None,
    name: str,
    layer_no: int,
    start: int,
    end: int,
) -> dict[str, Any]:
    """One layer's plot-state dict: axis ranges from its own
    layer-continuation block (``blocks[start]``); curves/curve-count/
    annotations/titles/legend scoped to the half-open ``blocks[start:end)``
    -- exactly this layer's own content, since layer records, curve anchors,
    and graph-child objects are sequential within a window span (module
    docstring; validated against Moke's Graph4/Graph7/Graph10).

    Text routing (2026-07-05): walks the block span tracking which named
    object is "current" (``_object_bucket``) and files each block's
    recovered text into that bucket -- ``x_title``/``y_title``/``y2_title``
    (single string), ``legend`` (raw ``\\l(n)`` lines, parsed after the loop),
    or ``annotations`` (floating text, cleaned of internal-storage noise).
    The bucket starts as ``"annotations"`` (so text preceding the first
    header, or an entire layer with no resolvable header at all, degrades to
    the pre-2026-07-05 flat scrape rather than losing text). A curve header
    (``payload[2] == 0x07``) only increments ``n_curves``, exactly as
    before -- it does NOT change the current bucket, since a real curve's
    own style/DataPlot body never produces recognizable text anyway (every
    instance checked corpus-wide already scans to ``[]``) and a curve
    template can legitimately sit *between* two objects that share one
    bucket (e.g. a layer's fixed 2-curve template between ``Legend`` and a
    later ``Text`` annotation). Any OTHER named or unresolved header does
    switch the bucket, including to ``"ignore"`` for uninteresting objects.
    """
    layer_payload = blocks[start][1]
    x_from, x_to = _axis(layer_payload, 15)
    y_from, y_to = _axis(layer_payload, 58)
    # The triples' third double IS the major tick increment (88/88 exact vs
    # the axis_ticks COM oracle, 2026-07-06 -- 13.2 #8).
    x_step = float(struct.unpack_from("<d", layer_payload, 31)[0])
    y_step = float(struct.unpack_from("<d", layer_payload, 74)[0])
    hint = _cstring(layer_payload, 208, 24) or ""
    y_log = _y_scale_flag(layer_payload)
    # Final scale flags, needed up-front: positions (annotation marks, the
    # legend box) interpolate in log10 space on log axes (annotation_marks).
    x_log = _log_heuristic(x_from, x_to)  # no isolated X flag found in .opj
    y_log_final = y_log if y_log is not None else _log_heuristic(y_from, y_to)
    frame = opj_layer_frame(layer_payload)
    n_curves = 0
    all_texts: list[str] = []  # every recognized text run -- feeds legend_ns/n_curves as before
    bucket_texts: dict[str, list[str]] = {
        "x_title": [],
        "y_title": [],
        "y2_title": [],
        "legend": [],
        "annotations": [],
    }
    bucket = "annotations"  # default until a named header switches it (see docstring)
    # Positioned annotation marks: one per Text*/Line* OBJECT, its fraction
    # pair read from the header payload (annotation_marks.py) and its lines
    # grouped until the next named header — multi-line text stays ONE mark.
    marks: list[dict[str, Any]] = []
    mark_fracs: tuple[float, float] | None = None
    mark_lines: list[str] = []
    mark_active = False  # only text owned by a named Text*/Line* header groups
    # The Legend object's own header carries the SAME position fields
    # every text object does (§13.2 #3, 2026-07-06) — box top-left.
    legend_fracs: tuple[float, float] | None = None
    # Region-shape objects (Rect* bands, item 41 — see opj_shapes.py).
    shades: list[dict[str, Any]] = []

    def _flush_mark() -> None:
        nonlocal mark_fracs
        mark = build_mark(
            mark_fracs, mark_lines, x_from, x_to, y_from, y_to, x_log, y_log_final
        )
        if mark is not None:
            marks.append(mark)
        mark_fracs = None
        mark_lines.clear()

    for k in range(start + 1, end):
        size, payload = blocks[k]
        if size == 133 and len(payload) > 2 and payload[2] == 0x07:
            n_curves += 1  # the curve counter only -- does not touch `bucket` (see docstring)
            continue
        if size == 133 and len(payload) > 2 and payload[2] == SHAPE_TYPE:
            # A closed-shape graphic object (Rect* region band, item 41):
            # its geometry + fill live in the body block right after the
            # header — decoded via opj_shapes; its header still ends any
            # open annotation grouping exactly like other named headers.
            bucket = "ignore"
            _flush_mark()
            mark_active = False
            body = blocks[k + 1][1] if k + 1 < end else b""
            shade = build_region_shade(body, x_from, x_to, y_from, y_to, x_log, y_log_final)
            if shade is not None:
                shades.append(shade)
            continue
        if size == 133 and len(payload) > 2:
            bucket = _object_bucket(_cstring(payload, _OBJ_NAME_OFFSET, _OBJ_NAME_LIMIT))
            _flush_mark()
            mark_active = bucket == "annotations"
            if mark_active:
                mark_fracs = opj_object_fractions(payload, frame)
            if bucket == "legend" and legend_fracs is None:
                legend_fracs = opj_object_fractions(payload, frame)
            # Never text-scan the header block itself: its geometry floats can
            # contain printable accidents that would land in the just-set
            # bucket (hc2convert's Graph13-18 all surfaced a bogus y_title
            # "TEP]" from 4 printable bytes inside the YL header's own
            # position doubles). Real object text lives in the CONTENT block
            # that follows, never in the header.
            continue
        if size < 1200 and not _is_layer_block(payload):
            # A block OWNED by a Text/Line annotation header that is exactly
            # a NUL-terminated string is the object's verbatim text -- exact,
            # no noise heuristics (they drop 'X'/'*'/'Si' peak labels). Split
            # per line so the flat annotations bucket keeps the same per-line
            # shape both containers use (marks re-join with newline anyway).
            exact = _object_text(payload) if mark_active else None
            if exact is not None:
                found = [line for line in exact.split("\n") if line.strip()]
            else:
                found = _texts_in(payload)
            all_texts.extend(found)
            if bucket in bucket_texts:
                bucket_texts[bucket].extend(found)
            if mark_active:
                mark_lines.extend(found)
    _flush_mark()
    titles = [
        t for t in bucket_texts["annotations"] if not _AUTO_TITLE.match(t) and "\\l(" not in t
    ]
    legend_ns = [int(n) for t in all_texts for n in _LEGEND_RE.findall(t)]
    return {
        "name": name,
        "layer": layer_no,
        "x_from": x_from,
        "x_to": x_to,
        "x_log": x_log,
        "y_from": y_from,
        "y_to": y_to,
        "y_log": y_log_final,
        # The layer frame rect in page units (multi-panel layout, §13.2 #7);
        # None when the quad is missing/degenerate.
        "frame": (
            dict(zip(("left", "top", "right", "bottom"), frame, strict=True))
            if frame is not None
            else None
        ),
        # Major tick increments (the axis triples' step doubles, 13.2 #8).
        "x_step": x_step if math.isfinite(x_step) and x_step > 0 else None,
        "y_step": y_step if math.isfinite(y_step) and y_step > 0 else None,
        "source_hint": hint,
        "n_curves": max(legend_ns) if legend_ns else n_curves,
        "annotations": [clean_richtext(a) for a in _clean_annotations(titles)[:12]],
        # Positioned floating text (box top-left, data coords) — only objects
        # whose header fractions decoded; the rest stay text-only above.
        "annotation_marks": marks,
        # Filled region-shape objects (Rect* bands) in data coords (item 41).
        "region_shades": shades,
        "x_title": _first_title(bucket_texts["x_title"]),
        "y_title": _first_title(bucket_texts["y_title"]),
        "y2_title": _first_title(bucket_texts["y2_title"]),
        "legend_labels": _parse_legend_labels(bucket_texts["legend"]),
        # Raw legend lines for the WINDOW-level composite-legend pass
        # (`distribute_legend_layers` — dotted ``\\l(layer.plot)`` entries
        # belong to other layers' dicts); popped before figures ship.
        "_legend_raw": list(bucket_texts["legend"]),
        # Legend box top-left in data coords, or None (never guessed).
        "legend_pos": (
            dict(
                zip(
                    ("x", "y"),
                    frac_to_data(
                        *legend_fracs, x_from, x_to, y_from, y_to, x_log, y_log_final
                    ),
                    strict=True,
                )
            )
            if legend_fracs is not None
            else None
        ),
        # item 2: curves attributed positionally to THIS layer only.
        "curves": extract_curves(blocks, start, end, id_map, x_columns, col_order),
    }
