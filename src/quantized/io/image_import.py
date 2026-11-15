"""Image import (``.png``, ``.tif``/``.tiff``, ``.jpg``/``.jpeg``) as a 2-D map.

An image is a grid of intensities, so it lands in the shared map DataStruct
(``io/_array_books.py``): one row per pixel with ``X`` (column), ``Y`` and
``Intensity`` channels, ``metadata.is2D`` and ``map_shape = [height, width]``.
The Map tab, cuts and heatmap export read it like any other map.

**Axes.** ``X`` is the pixel column (0 at the left). ``Y`` is the pixel row
counted UPWARD from the bottom edge (``Y = height - 1 - row``), so the heatmap,
whose y axis grows upward, shows the picture the right way up. The flip is
recorded (``metadata.y_axis = "bottom-up"``); it changes coordinates only, never
a pixel value.

**Intensity.** Greyscale images give their stored values exactly: 8-bit as
0-255, 16-bit TIFF (``I;16`` and its big-endian form) as 0-65535, 32-bit
integer / float TIFF as stored. Nothing is rescaled.

**Colour.** A colour image has no single intensity, so the conversion is explicit
and recorded (``metadata.image_conversion``). By default it is converted to
luminance with the ITU-R BT.601 weights Pillow's own greyscale conversion uses,
``L = 0.299 R + 0.587 G + 0.114 B``, computed in floating point from the 8-bit
channels (not rounded back to an integer). Pass ``channel="R"``/``"G"``/``"B"``
(or ``"A"`` for an alpha channel) to take that one channel unchanged.
Palette images are expanded to RGB first.

**Safety.** The pixel count is read from the header and checked BEFORE any pixel
is decoded (``MAX_MAP_POINTS``, 2048 x 2048). Multi-page TIFFs give each page as
its own book, within the same budget in total.

Pure layer. Pillow (HPND) is imported lazily.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct
from quantized.heavy_import import heavy_imports
from quantized.io._array_books import MAX_BOOKS, MAX_MAP_POINTS, grid_map_datastruct

__all__ = ["CHANNELS", "import_image", "read_image_books"]

CHANNELS = ("luminance", "R", "G", "B", "A")

# ITU-R BT.601, the weights Pillow's own convert("L") applies.
_LUMA = np.array([0.299, 0.587, 0.114])
_CHANNEL_INDEX = {"R": 0, "G": 1, "B": 2, "A": 3}
# Pillow modes that are already a single intensity plane.
_GREY_MODES = {"1", "L", "I", "F", "I;16", "I;16L", "I;16B", "I;16N"}


def _pillow() -> Any:
    with heavy_imports("PIL", "PIL.Image"):
        from PIL import Image  # noqa: PLC0415
    return Image


def _open(path: Path) -> Any:
    """Open ``path`` and check its size from the header. Nothing is decoded."""
    image_mod = _pillow()
    try:
        # Pillow's own bomb guard warns past ~89 Mpx and raises past twice that;
        # both are ValueError-shaped here via the except below.
        im = image_mod.open(path)
    except (image_mod.UnidentifiedImageError, image_mod.DecompressionBombError, OSError) as exc:
        raise ValueError(f"not a readable image ({type(exc).__name__}): {path.name}") from exc
    w, h = im.size
    if w * h > MAX_MAP_POINTS:
        im.close()
        raise ValueError(
            f"image is {w} x {h} = {w * h:,} pixels; the limit is {MAX_MAP_POINTS:,} "
            "(2048 x 2048). Crop or downscale it first"
        )
    return im


def _intensity(im: Any, channel: str) -> tuple[NDArray[np.float64], str]:
    """``(2-D float64 plane, how it was obtained)`` for the current frame."""
    if channel not in CHANNELS:
        raise ValueError(f"unknown channel {channel!r}; choose one of {', '.join(CHANNELS)}")
    mode = im.mode
    if mode in _GREY_MODES:
        if channel not in ("luminance",):
            raise ValueError(f"a {mode} image has a single intensity plane; no channel {channel!r}")
        return np.asarray(im, dtype=float), f"{mode} greyscale, values as stored"
    if mode in ("LA", "La"):
        arr = np.asarray(im.convert("LA"), dtype=float)
        if channel == "A":
            return arr[..., 1], "alpha channel"
        if channel != "luminance":
            raise ValueError(f"a greyscale+alpha image has no channel {channel!r}")
        return arr[..., 0], "greyscale channel (alpha ignored)"
    if mode == "P":
        im = im.convert("RGBA" if "transparency" in im.info else "RGB")
        mode = im.mode
    if mode in ("RGB", "RGBA", "CMYK", "YCbCr", "LAB", "HSV", "RGBa", "PA"):
        if mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA" if mode in ("RGBa", "PA") else "RGB")
            mode = im.mode
        arr = np.asarray(im, dtype=float)
        if channel == "luminance":
            return (
                np.asarray(arr[..., :3] @ _LUMA, dtype=float),
                "luminance 0.299 R + 0.587 G + 0.114 B (ITU-R BT.601) from colour; alpha ignored",
            )
        if channel == "A":
            if mode != "RGBA":
                raise ValueError("this colour image has no alpha channel")
            return arr[..., 3], "alpha channel"
        return arr[..., _CHANNEL_INDEX[channel]], f"{channel} channel of colour image, as stored"
    raise ValueError(f"unsupported image mode {mode!r}")


def _frame_book(im: Any, path: Path, channel: str, page: int | None) -> DataStruct:
    z, how = _intensity(im, channel)
    h, w = z.shape
    meta: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_image",
        "image_mode": str(im.mode),
        "image_format": str(im.format or ""),
        "image_conversion": how,
        "image_size": [int(w), int(h)],
        "y_axis": "bottom-up",
    }
    if page is not None:
        meta["image_page"] = page
        meta["sheet_name"] = f"page {page + 1}"
    return grid_map_datastruct(
        z[::-1, :],  # row 0 of the file is the TOP of the picture: draw it upright
        np.arange(w, dtype=float),
        np.arange(h, dtype=float),
        x_label="X",
        x_unit="px",
        y_label="Y",
        y_unit="px",
        metadata=meta,
    )


def read_image_books(path: str | Path, *, channel: str = "luminance") -> list[DataStruct]:
    """Every frame of ``path`` as a map book (one for a single-frame image)."""
    p = Path(path)
    im = _open(p)
    try:
        n_frames = int(getattr(im, "n_frames", 1))
        budget = MAX_MAP_POINTS
        books: list[DataStruct] = []
        skipped = 0
        for k in range(min(n_frames, MAX_BOOKS)):
            im.seek(k)
            w, h = im.size
            if budget - w * h < 0:
                skipped = n_frames - k
                break
            budget -= w * h
            books.append(_frame_book(im, p, channel, k if n_frames > 1 else None))
        if n_frames > MAX_BOOKS:
            skipped = n_frames - MAX_BOOKS
    finally:
        im.close()
    if skipped:
        note = (
            f"{skipped} further page(s) not imported "
            f"(limit: {MAX_BOOKS} pages and {MAX_MAP_POINTS:,} pixels in total)."
        )
        first = books[0]
        books[0] = DataStruct.create(
            first.time,
            first.values,
            labels=first.labels,
            units=first.units,
            metadata={**first.metadata, "notes": [note]},
        )
    return books


def import_image(filepath: str | Path, *, channel: str = "luminance") -> DataStruct:
    """Import ``.png`` / ``.tif`` / ``.tiff`` / ``.jpg`` as a 2-D map (first page
    of a multi-page TIFF). ``channel`` picks ``"luminance"`` (default, for
    colour), ``"R"``, ``"G"``, ``"B"`` or ``"A"``; see the module docstring."""
    return read_image_books(filepath, channel=channel)[0]
