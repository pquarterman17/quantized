"""Image import (io.image_import): PNG / TIFF / JPEG as a 2-D map through the
existing map path; 16-bit TIFF kept; colour converted by a documented rule;
the pixel count capped before any decode (gap-5 lane D)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from quantized.calc.map import map_from_datastruct
from quantized.io import image_import
from quantized.io.registry import import_auto, import_auto_sheets, resolve_parser

FX = Path(__file__).parent / "fixtures" / "import_formats"
GRAY8 = (np.arange(24, dtype=np.uint8) * 10).reshape(4, 6)  # 6 wide, 4 tall


def _grid(ds: object) -> np.ndarray:
    """The imported map back as a (height, width) array, Y ascending upward."""
    h, w = ds.metadata["map_shape"]  # type: ignore[attr-defined]
    return np.asarray(ds.values[:, 2]).reshape(h, w)  # type: ignore[attr-defined]


def test_grayscale_png_is_a_map_with_exact_intensity_and_upright_y() -> None:
    ds = import_auto(FX / "gray8.png")
    assert ds.metadata["is2D"] is True
    assert ds.metadata["map_shape"] == [4, 6]
    assert ds.labels == ("X", "Y", "Intensity")
    assert ds.units[:2] == ("px", "px")
    # Y counts upward from the bottom edge, so the top file row is the LAST map row.
    assert np.array_equal(_grid(ds), GRAY8[::-1].astype(float))
    assert ds.values[:6, 0].tolist() == [0, 1, 2, 3, 4, 5]
    assert ds.values[:6, 1].tolist() == [0.0] * 6  # bottom row first
    assert ds.metadata["y_axis"] == "bottom-up"
    assert "greyscale" in ds.metadata["image_conversion"]


def test_16_bit_tiff_is_kept_exactly() -> None:
    ds = import_auto(FX / "gray16.tif")
    expected = (np.arange(24, dtype=np.uint16) * 2500 + 7).reshape(4, 6)
    assert ds.metadata["image_mode"].startswith("I;16")
    assert np.array_equal(_grid(ds), expected[::-1].astype(float))
    assert _grid(ds).max() > 255  # not squeezed to 8 bits


def test_colour_is_converted_to_luminance_by_the_documented_weights() -> None:
    ds = import_auto(FX / "rgb.png")
    want = 0.299 * 200 + 0.587 * 100 + 0.114 * 50
    assert np.allclose(ds.values[:, 2], want)
    assert "0.299 R + 0.587 G + 0.114 B" in ds.metadata["image_conversion"]


@pytest.mark.parametrize(("channel", "value"), [("R", 200.0), ("G", 100.0), ("B", 50.0)])
def test_a_colour_channel_can_be_asked_for(channel: str, value: float) -> None:
    ds = image_import.import_image(FX / "rgb.png", channel=channel)
    assert set(ds.values[:, 2]) == {value}
    assert channel in ds.metadata["image_conversion"]


def test_unknown_channel_and_channel_of_a_grey_image_are_refused() -> None:
    with pytest.raises(ValueError, match="unknown channel"):
        image_import.import_image(FX / "rgb.png", channel="X")
    with pytest.raises(ValueError, match="single intensity plane"):
        image_import.import_image(FX / "gray8.png", channel="G")
    with pytest.raises(ValueError, match="no alpha"):
        image_import.import_image(FX / "rgb.png", channel="A")


def test_rgba_alpha_is_ignored_for_luminance_and_available_as_a_channel(tmp_path: Path) -> None:
    arr = np.zeros((2, 3, 4), dtype=np.uint8)
    arr[..., 0] = 100
    arr[..., 1] = 100
    arr[..., 2] = 100
    arr[..., 3] = 7
    p = tmp_path / "a.png"
    Image.fromarray(arr, "RGBA").save(p)
    assert np.allclose(import_auto(p).values[:, 2], 100.0)
    assert set(image_import.import_image(p, channel="A").values[:, 2]) == {7.0}


def test_palette_png_is_expanded_before_conversion(tmp_path: Path) -> None:
    im = Image.new("P", (3, 2))
    im.putpalette([0, 0, 0, 255, 255, 255] + [0] * 762)
    im.putdata([0, 1, 0, 1, 0, 1])
    p = tmp_path / "pal.png"
    im.save(p)
    ds = import_auto(p)
    assert sorted(set(ds.values[:, 2])) == [0.0, 255.0]


def test_multi_page_tiff_offers_each_page_as_a_book() -> None:
    first, second = import_auto_sheets(FX / "pages.tif")
    assert first.metadata["sheet_name"] == "page 1" and second.metadata["sheet_name"] == "page 2"
    assert np.array_equal(_grid(second), (GRAY8[::-1] + 5).astype(float))
    assert import_auto(FX / "pages.tif").metadata["image_page"] == 0


def test_jpeg_imports_as_a_map() -> None:
    ds = import_auto(FX / "photo.jpg")
    assert ds.metadata["map_shape"] == [16, 24]
    assert ds.metadata["image_format"] == "JPEG"


@pytest.mark.parametrize("name", ["a.png", "a.tif", "a.tiff", "a.jpg", "a.jpeg", "A.PNG"])
def test_extensions_resolve_to_the_image_parser(tmp_path: Path, name: str) -> None:
    p = tmp_path / name
    p.write_bytes(b"")
    assert resolve_parser(p).__name__ == "import_image"


def test_image_works_with_the_existing_map_path() -> None:
    ds = import_auto(FX / "gray8.png")
    m = map_from_datastruct(ds, "X", "Y", "Intensity")
    assert (m.x_axis[0], m.x_axis[-1]) == (0.0, 5.0)  # the pixel columns
    assert (m.y_axis[0], m.y_axis[-1]) == (0.0, 3.0)
    assert np.nanmax(m.z_grid) == 230.0 and np.nanmin(m.z_grid) == 0.0


def test_pixel_count_is_checked_before_any_pixel_is_decoded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    p = tmp_path / "huge.png"
    Image.new("L", (3000, 3000)).save(p)  # 9 Mpx of zeros: a few KB on disk
    assert p.stat().st_size < 100_000

    def _no_decode(*_a: object, **_k: object) -> None:
        raise AssertionError("pixels were decoded before the size check")

    monkeypatch.setattr("PIL.ImageFile.ImageFile.load", _no_decode)
    monkeypatch.setattr("PIL.Image.Image.load", _no_decode)
    with pytest.raises(ValueError, match="limit is 4,194,304"):
        import_auto(p)


def test_an_image_at_the_limit_is_accepted(tmp_path: Path) -> None:
    p = tmp_path / "ok.png"
    Image.new("L", (2048, 2048), 3).save(p)
    ds = import_auto(p)
    assert ds.n_points == 2048 * 2048


def test_extra_pages_beyond_the_pixel_budget_are_named(tmp_path: Path) -> None:
    frames = [Image.new("L", (2048, 1536), k) for k in (1, 2, 3)]
    p = tmp_path / "stack.tif"
    frames[0].save(p, save_all=True, append_images=frames[1:])
    books = import_auto_sheets(p)
    assert len(books) == 1
    assert "2 further page(s) not imported" in books[0].metadata["notes"][0]


def test_corrupt_image_is_refused_cleanly(tmp_path: Path) -> None:
    p = tmp_path / "bad.png"
    p.write_bytes(b"\x89PNG\r\n\x1a\n" + b"junk" * 30)
    with pytest.raises(ValueError, match="not a readable image"):
        import_auto(p)
    q = tmp_path / "notimage.tif"
    q.write_bytes(b"hello")
    with pytest.raises(ValueError, match="not a readable image"):
        import_auto(q)
