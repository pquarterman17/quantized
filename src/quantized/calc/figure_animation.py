"""Animation / movie export of a figure series (gap audit 9, G20).

Pure helpers behind ``POST /api/export/figure-animation``: the limits the
export refuses beyond, the fixed-axes union, and the ffmpeg-free encoders
(animated GIF, APNG, PNG-sequence ZIP) built on Pillow (already installed as
matplotlib's own dependency).  Frames are ordinary PNGs from the same renderer
the static export uses; nothing here draws a figure.

Provisional, owner to confirm: every limit below, and fixed axes defaulting ON.

Pillow merges *identical consecutive* GIF/APNG frames into one frame with the
summed duration, so the total running time is kept but a series of identical
frames reads back as fewer frames; the ZIP format always keeps every frame.
"""

from __future__ import annotations

import io
import math
import zipfile
from collections.abc import Sequence
from typing import Any

from quantized.heavy_import import heavy_imports

__all__ = [
    "FORMATS",
    "MAX_FRAMES",
    "MAX_FRAME_PIXELS",
    "MAX_SECONDS",
    "MAX_TOTAL_PIXELS",
    "check_frame_count",
    "check_frame_pixels",
    "encode_animation",
    "union_limits",
]

FORMATS = ("gif", "apng", "zip")
MAX_FRAMES = 120  # provisional
MAX_FRAME_PIXELS = 4_000_000  # one frame, width * height (provisional)
MAX_TOTAL_PIXELS = 240_000_000  # all frames together (provisional)
MAX_SECONDS = 120.0  # wall-clock budget for the whole render (provisional)
FRAME_MS_RANGE = (20, 10_000)


def check_frame_count(n: int) -> None:
    """Refuse an empty or oversized series, saying why."""
    if n < 1:
        raise ValueError("an animation needs at least one frame")
    if n > MAX_FRAMES:
        raise ValueError(
            f"{n} frames exceeds the limit of {MAX_FRAMES}; use fewer levels or datasets"
        )


def check_frame_pixels(width: int, height: int, n_frames: int) -> None:
    """Refuse frames whose pixel area (or total over the series) is too large."""
    if width * height > MAX_FRAME_PIXELS:
        raise ValueError(
            f"a {width} x {height} px frame is {width * height / 1e6:.1f} megapixels; the limit is "
            f"{MAX_FRAME_PIXELS / 1e6:.0f}. Lower the DPI or the page size."
        )
    if width * height * n_frames > MAX_TOTAL_PIXELS:
        raise ValueError(
            f"{n_frames} frames of {width} x {height} px total "
            f"{width * height * n_frames / 1e6:.0f} megapixels; the limit is "
            f"{MAX_TOTAL_PIXELS / 1e6:.0f}. Use fewer frames or a lower DPI."
        )


def union_limits(limits: Sequence[Sequence[float]]) -> tuple[float, float]:
    """The ``(lo, hi)`` covering every frame's axis limits, keeping the first
    frame's direction (a descending axis stays descending)."""
    if not limits:
        raise ValueError("no axis limits to combine")
    flat = [float(v) for pair in limits for v in pair]
    if not all(math.isfinite(v) for v in flat):
        raise ValueError("a frame has non-finite axis limits; turn off fixed axes")
    lo, hi = min(flat), max(flat)
    first = limits[0]
    return (hi, lo) if float(first[0]) > float(first[1]) else (lo, hi)


def _open_frames(pngs: Sequence[bytes]) -> list[Any]:
    with heavy_imports("PIL", "PIL.Image"):
        from PIL import Image
    frames = []
    for data in pngs:
        src = Image.open(io.BytesIO(data))
        src.load()
        if src.mode in ("RGBA", "LA", "P"):  # flatten transparency onto white
            rgba = src.convert("RGBA")
            base = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
            frames.append(Image.alpha_composite(base, rgba).convert("RGB"))
        else:
            frames.append(src.convert("RGB"))
    sizes = {f.size for f in frames}
    if len(sizes) > 1:
        raise ValueError(f"frames render at different sizes {sorted(sizes)}; use one page size")
    return frames


def encode_animation(
    pngs: Sequence[bytes],
    names: Sequence[str],
    *,
    fmt: str,
    frame_ms: int,
    loop: bool,
) -> bytes:
    """Encode ``pngs`` (in order) as ``fmt``: ``gif``, ``apng`` or ``zip``.

    ``loop`` False plays once (GIF: no loop block; APNG: one play); True loops
    forever.  ``names`` are the ZIP member names (ignored by the others).
    """
    if fmt not in FORMATS:
        raise ValueError(f"format must be one of {list(FORMATS)}")
    check_frame_count(len(pngs))
    if not FRAME_MS_RANGE[0] <= frame_ms <= FRAME_MS_RANGE[1]:
        raise ValueError(f"frame duration must be {FRAME_MS_RANGE[0]}-{FRAME_MS_RANGE[1]} ms")
    if fmt == "zip":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, data in zip(names, pngs, strict=True):
                zf.writestr(name, data)
        return buf.getvalue()
    frames = _open_frames(pngs)
    out = io.BytesIO()
    opts: dict[str, Any] = {"save_all": True, "append_images": frames[1:], "duration": frame_ms}
    if fmt == "gif":
        if loop:
            opts["loop"] = 0
        frames[0].save(out, format="GIF", **opts)
    else:
        opts["loop"] = 0 if loop else 1
        frames[0].save(out, format="PNG", **opts)
    return out.getvalue()
