"""PRIMARY_SOFTWARE_AUDIT_PLAN P3.6 (~line 8687-8688): "Windows/macOS vector
copy and 300-DPI raster fallback" / "Expected bounding box, transparency,
fonts, and scale" -- the RASTER half.

"Copy figure" (MAIN_PLAN #35, ``frontend/src/lib/copyFigureCommand.ts``) has
no dedicated backend route: it builds a ``FigureSpec`` and POSTs it straight
to ``POST /api/export/figure`` at ``COPY_FIGURE_DPI = 300`` /
``COPY_FIGURE_FMT = "png"`` / ``COPY_FIGURE_STYLE = "default"``, then hands
the response bytes to the browser Clipboard API. That backend route is the
one thing testable from here -- the OS-clipboard half (an actual Windows/
macOS paste into Word/PowerPoint/Keynote) needs a real desktop and is NOT
covered by this suite; see the module docstring in
``test_export_copy_figure_vector.py`` for the matching vector-copy half and
what neither file can verify.

Every render below goes through the real FastAPI route via ``TestClient``,
never a hand-rolled ``matplotlib`` call, and reads the ACTUAL bytes a client
would receive: PNG chunk structure (``pHYs``), pixel dimensions, alpha
channel. No PIL/Pillow dependency is added for this -- Pillow already ships
transitively as matplotlib's PNG codec (see ``tests/test_api_export.py`` and
others already importing it) -- and the ``pHYs`` chunk itself is parsed by
hand (stdlib ``struct``) so the DPI assertion is against the literal bytes on
the wire, not merely what Pillow *derives* from them.

Not pixel-exact across OSes (CI runs ubuntu/windows/mac): every assertion
here is a structural/numeric fact (chunk values, pixel counts, channel
values) that a font-rasterizer or subpixel-AA difference cannot move.
"""

from __future__ import annotations

import struct
from io import BytesIO
from typing import Any

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from quantized.app import app

client = TestClient(app)

# The "Copy figure" contract (copyFigureCommand.ts): 300 DPI, PNG, "default"
# style -- pinned here as a plain constant (not imported from the frontend)
# so this module has no cross-language import; drifting the two apart is
# caught by ``frontend/src/lib/copyFigureCommand.test.ts`` on that side.
_COPY_DPI = 300
_N = 20


def _dataset() -> dict[str, Any]:
    xs = [float(i) for i in range(_N)]
    ys = [float(i) ** 0.5 for i in xs]
    return {
        "time": xs,
        "values": [[y] for y in ys],
        "labels": ["Signal"],
        "units": ["V"],
        "metadata": {},
    }


def _payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "dataset": _dataset(),
        "fmt": "png",
        "style": "default",
        "dpi": _COPY_DPI,
        "title": "Copy figure test",
        "x_label": "Time",
        "y_label": "Signal (V)",
    }
    payload.update(overrides)
    return payload


def _render_png(**overrides: Any) -> bytes:
    resp = client.post("/api/export/figure", json=_payload(**overrides))
    assert resp.status_code == 200, resp.text
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"
    return resp.content


def _png_phys_chunk(data: bytes) -> tuple[int, int, int] | None:
    """(x_px_per_unit, y_px_per_unit, unit) from the PNG's ``pHYs`` chunk, by
    walking the chunk stream directly (8-byte signature, then
    [len:4][type:4][data][crc:4] repeating) -- no Pillow needed for this part
    either, so the assertion is against the literal wire bytes."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos = 8
    while pos + 8 <= len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        if ctype == b"pHYs":
            x, y, unit = struct.unpack(">IIB", data[pos + 8 : pos + 8 + 9])
            return x, y, unit
        pos += 8 + length + 4
    return None


def _rgba(png: bytes) -> np.ndarray:
    with Image.open(BytesIO(png)) as im:
        return np.asarray(im.convert("RGBA"))


def _alpha_bbox(png: bytes) -> tuple[int, int, int, int, int, int]:
    """(x0, x1, y0, y1, width, height): the pixel bounding box of every
    non-fully-transparent pixel, plus the canvas size. Requires the render to
    use ``transparent=True`` -- otherwise every pixel is opaque and the "box"
    is trivially the whole canvas, which is why every caller below renders
    transparent first and asks whether the INK reaches the edges."""
    arr = _rgba(png)
    h, w = arr.shape[0], arr.shape[1]
    ys, xs = np.nonzero(arr[:, :, 3])
    assert len(xs) > 0, "fully transparent render -- nothing was drawn"
    return int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max()), w, h


# ---------------------------------------------------------------------------
# pHYs chunk / DPI (task: "The pHYs chunk reflects 300 DPI (~=11811 px/m)")
# ---------------------------------------------------------------------------


def test_png_300dpi_writes_a_phys_chunk_of_11811_px_per_meter() -> None:
    # 300 dpi = 300 / 0.0254 m = 11811.02... px/m; PNG's pHYs is an integer
    # px/unit pair, so 11811 (unit=1, meters) is what a correct 300 DPI write
    # rounds to. This is the literal fact a paste target reads to decide "this
    # image is N inches wide" -- get it wrong and Word/PowerPoint size the
    # pasted figure off-scale even though the pixel data is correct.
    phys = _png_phys_chunk(_render_png())
    assert phys is not None, "no pHYs chunk in the PNG -- paste target can't infer physical size"
    x_ppu, y_ppu, unit = phys
    assert unit == 1, "pHYs unit must be meters (1), not 'unknown' (0)"
    assert x_ppu == y_ppu  # square pixels
    assert abs(x_ppu - 11811) <= 1


def test_png_dpi_metadata_agrees_with_the_phys_chunk() -> None:
    # Pillow derives Image.info["dpi"] FROM the pHYs chunk on read -- an
    # independent-library cross-check that the hand-parsed chunk above means
    # what a real PNG consumer would read out of it.
    data = _render_png()
    with Image.open(BytesIO(data)) as im:
        dpi_x, dpi_y = im.info["dpi"]
    assert abs(dpi_x - 300.0) < 0.01
    assert abs(dpi_y - 300.0) < 0.01


def test_png_dpi_is_reflected_at_a_non_default_value_too() -> None:
    # Not hardcoded to 300 alone: the chunk tracks whatever DPI was requested,
    # so a future change to COPY_FIGURE_DPI is still caught correctly.
    x_ppu, _y_ppu, _unit = _png_phys_chunk(_render_png(dpi=150)) or (0, 0, 0)
    assert abs(x_ppu - 5906) <= 1  # 150 / 0.0254


# ---------------------------------------------------------------------------
# Pixel dimensions = figure inches x dpi
# ---------------------------------------------------------------------------


def test_png_pixel_dimensions_equal_the_default_style_size_times_300dpi() -> None:
    # "default" (the Copy-figure style) is 15.24cm x 10.16cm = 6in x 4in
    # exactly -- chosen upstream so this is a round-number check, not a
    # coincidence of float rounding.
    with Image.open(BytesIO(_render_png())) as im:
        assert im.size == (1800, 1200)


def test_png_pixel_dimensions_equal_a_custom_figure_size_times_dpi() -> None:
    # Generalizes the check above off a non-default width_in/height_in, so a
    # regression that only special-cases the default preset's size is caught.
    with Image.open(BytesIO(_render_png(width_in=5.0, height_in=3.0))) as im:
        assert im.size == (1500, 900)


# ---------------------------------------------------------------------------
# Transparency: transparent canvas on request, theme background otherwise
# ---------------------------------------------------------------------------


def test_png_transparent_background_is_fully_transparent_at_every_corner() -> None:
    arr = _rgba(_render_png(transparent=True))
    h, w = arr.shape[0], arr.shape[1]
    for y, x in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)):
        assert arr[y, x, 3] == 0


def test_png_opaque_background_is_the_theme_white_at_every_corner() -> None:
    # "default"'s figure/axes patches are drawn white (no dark-theme bleed
    # into the exported artifact -- publication figures are print/paste
    # backgrounds, not a copy of the app's on-screen theme).
    arr = _rgba(_render_png(transparent=False))
    h, w = arr.shape[0], arr.shape[1]
    for y, x in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)):
        assert tuple(arr[y, x]) == (255, 255, 255, 255)


# ---------------------------------------------------------------------------
# Bounding box: tight by default, no clipped labels; honors explicit margins
# ---------------------------------------------------------------------------


def test_png_tight_layout_bbox_has_no_clipped_content() -> None:
    # transparent=True turns "clipped" into an observable fact: a label or
    # tick drawn AT the canvas edge (x0==0, or x1==w-1, ...) means it was cut
    # off, since tight_layout is supposed to leave room for every artist.
    x0, x1, y0, y1, w, h = _alpha_bbox(_render_png(transparent=True))
    margin = 4  # px of slack past "exactly touching the edge"
    assert x0 >= margin, f"content starts at x={x0}, touching the left edge"
    assert x1 <= w - 1 - margin, f"content reaches x={x1} of width {w}, touching the right edge"
    assert y0 >= margin, f"content starts at y={y0}, touching the top edge"
    assert y1 <= h - 1 - margin, f"content reaches y={y1} of height {h}, touching the bottom edge"
    # "Tight", not merely "unclipped": the auto margin shouldn't be huge --
    # under a third of the canvas on any one side.
    assert x0 < w / 3
    assert (w - 1 - x1) < w / 3
    assert y0 < h / 3
    assert (h - 1 - y1) < h / 3


def test_png_configured_margins_widen_the_bbox_margin_on_every_side() -> None:
    # The property-panel "margins" override (calc.figure_overrides) skips
    # tight_layout and sets the axes rect from explicit figure fractions
    # (calc.figure.py: "if not ov.get('margins'): fig.tight_layout()"). This
    # proves the override actually reaches the RENDERED pixels -- a request
    # for a bigger margin must produce a bigger empty border, not just an
    # internal axes-rect number nothing reads.
    tight = _alpha_bbox(_render_png(transparent=True, title=""))
    configured = _alpha_bbox(
        _render_png(
            transparent=True,
            title="",
            overrides={"margins": {"left": 0.30, "right": 0.15, "top": 0.15, "bottom": 0.30}},
        )
    )
    tx0, tx1, ty0, ty1, w, h = tight
    cx0, cx1, cy0, cy1, cw, ch = configured
    assert (cw, ch) == (w, h)
    assert cx0 > tx0, "left margin did not widen"
    assert (cw - 1 - cx1) > (w - 1 - tx1), "right margin did not widen"
    assert cy0 > ty0, "top margin did not widen"
    assert (ch - 1 - cy1) > (h - 1 - ty1), "bottom margin did not widen"
    # The generous margins chosen above must still not clip anything.
    assert cx0 > 0 and cx1 < cw - 1 and cy0 > 0 and cy1 < ch - 1


# ---------------------------------------------------------------------------
# Scale: the same figure at 1x and 2x gives proportional raster sizes
# ---------------------------------------------------------------------------


def test_png_scale_2x_dpi_doubles_pixel_dimensions_exactly() -> None:
    with Image.open(BytesIO(_render_png(dpi=300))) as im1:
        size1 = im1.size
    with Image.open(BytesIO(_render_png(dpi=600))) as im2:
        size2 = im2.size
    assert size2 == (size1[0] * 2, size1[1] * 2)


def test_png_scale_2x_figure_geometry_doubles_pixel_dimensions_exactly() -> None:
    # A different scale axis from DPI: doubling width_in/height_in at a FIXED
    # dpi must double the raster the same way doubling dpi at fixed geometry
    # does -- both are "make it 2x", and both must be exact multiples, not an
    # off-by-rounding approximation.
    with Image.open(BytesIO(_render_png(width_in=4.0, height_in=3.0))) as im1:
        size1 = im1.size
    with Image.open(BytesIO(_render_png(width_in=8.0, height_in=6.0))) as im2:
        size2 = im2.size
    assert size2 == (size1[0] * 2, size1[1] * 2)
