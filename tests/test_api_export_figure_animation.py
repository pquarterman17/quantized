"""POST /api/export/figure-animation (gap audit 9, G20): round-trip with Pillow.

There is no numeric oracle beyond the file format itself: frames, durations,
loop flag and sizes are read back with Pillow; axis limits are read back from
the same renderer's own hit-map (``/figure-hitmap``).
"""

from __future__ import annotations

import io
import zipfile

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageSequence

from quantized.app import create_app
from quantized.calc import figure_animation as anim
from quantized.routes import export_figure_animation as route

client = TestClient(create_app())


def _figure(scale: float, **extra: object) -> dict[str, object]:
    return {
        "dataset": {
            "time": [0.0, 1.0, 2.0, 3.0],
            "values": [[scale * v] for v in (1.0, 2.0, 4.0, 3.0)],
            "labels": ["signal"],
            "units": ["a.u."],
            "metadata": {},
        },
        "y_keys": [0],
        "dpi": 60,
        **extra,
    }


def _body(n: int = 3, **extra: object) -> dict[str, object]:
    frames = [{"figure": _figure(10.0 ** i), "label": f"T = {10 * (i + 1)} K"} for i in range(n)]
    return {"frames": frames, **extra}


def _post(body: dict[str, object]):
    return client.post("/api/export/figure-animation", json=body)


def test_gif_frame_count_order_and_durations() -> None:
    r = _post(_body(3, frame_ms=250))
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/gif"
    assert r.headers["x-animation-frames"] == "3"
    im = Image.open(io.BytesIO(r.content))
    frames = [f.copy().convert("RGB") for f in ImageSequence.Iterator(im)]
    assert im.n_frames == 3
    durations = []
    for i in range(im.n_frames):
        im.seek(i)
        durations.append(im.info["duration"])
    assert durations == [250, 250, 250]
    assert im.info["loop"] == 0
    # Distinct scales -> distinct frames, in request order (first differs from last).
    assert frames[0].tobytes() != frames[2].tobytes()


def test_gif_loop_off_writes_no_loop_block() -> None:
    r = _post(_body(2, loop=False))
    assert "loop" not in Image.open(io.BytesIO(r.content)).info


def test_apng_roundtrip() -> None:
    r = _post(_body(3, format="apng", frame_ms=100, loop=False))
    assert r.status_code == 200, r.text
    im = Image.open(io.BytesIO(r.content))
    assert im.format == "PNG" and im.n_frames == 3
    assert im.info["loop"] == 1
    assert im.info["duration"] == 100


def test_zip_frames_in_order_match_static_export() -> None:
    r = _post(_body(3, format="zip", fixed_axes=False))
    assert r.status_code == 200, r.text
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = zf.namelist()
    assert [n.split("_")[1] for n in names] == ["001", "002", "003"]
    assert names[0].endswith("T___10_K.png")
    static = client.post(
        "/api/export/figure",
        json={**_figure(1.0), "fmt": "png", "title": "T = 10 K"},
    )
    assert zf.read(names[0]) == static.content  # same renderer, same bytes


def _limits(frame: dict[str, object]) -> tuple[list[float], list[float]]:
    out = client.post("/api/export/figure-hitmap", json=frame["figure"]).json()["axes"]
    return out["xlim"], out["ylim"]


def test_fixed_axes_give_identical_limits_across_frames(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[dict[str, object]] = []
    real = route.render_figure_request

    def spy(fig, *, fmt, dpi):
        seen.append(fig.overrides)
        return real(fig, fmt=fmt, dpi=dpi)

    monkeypatch.setattr(route, "render_figure_request", spy)
    body = _body(3, format="zip")
    assert _post(body).status_code == 200
    assert len(seen) == 3 and all(o == seen[0] for o in seen)
    # The shared y range covers the largest frame (scale 100 -> max 400), the
    # smallest frame (scale 1 -> min 1) and matplotlib's autoscale margin.
    ylo, yhi = seen[0]["y_lim"]
    assert ylo <= 1.0 and yhi >= 400.0
    # Reading limits back through the hit-map of each rendered frame agrees.
    for frame in body["frames"]:
        frame["figure"] = {**frame["figure"], "overrides": seen[0]}  # type: ignore[index]
        assert _limits(frame) == (seen[0]["x_lim"], seen[0]["y_lim"])  # type: ignore[index]


def test_fixed_axes_off_leaves_each_frame_autoscaled(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[object] = []
    real = route.render_figure_request
    monkeypatch.setattr(
        route, "render_figure_request",
        lambda fig, *, fmt, dpi: (seen.append(fig.overrides), real(fig, fmt=fmt, dpi=dpi))[1],
    )
    assert _post(_body(2, format="zip", fixed_axes=False)).status_code == 200
    assert seen == [None, None]


def test_fixed_axes_refuses_secondary_axis_with_reason() -> None:
    body = _body(2)
    body["frames"][0]["figure"]["y2_keys"] = [0]  # type: ignore[index]
    r = _post(body)
    assert r.status_code == 422 and "Fixed axes" in r.json()["detail"]


def test_union_keeps_descending_direction() -> None:
    assert anim.union_limits([(10.0, 0.0), (8.0, -2.0)]) == (10.0, -2.0)
    assert anim.union_limits([(0.0, 1.0), (-1.0, 0.5)]) == (-1.0, 1.0)
    with pytest.raises(ValueError, match="non-finite"):
        anim.union_limits([(0.0, float("nan"))])


def test_frame_count_limit_refuses_with_reason() -> None:
    assert _post({"frames": []}).status_code == 422
    r = _post(_body(anim.MAX_FRAMES + 1))
    assert r.status_code == 422
    with pytest.raises(ValueError, match="exceeds the limit"):
        anim.check_frame_count(anim.MAX_FRAMES + 1)


def test_pixel_limits_refuse_with_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(anim, "MAX_FRAME_PIXELS", 1000)
    r = _post(_body(2))
    assert r.status_code == 422 and "megapixels" in r.json()["detail"]
    monkeypatch.setattr(anim, "MAX_FRAME_PIXELS", 4_000_000)
    monkeypatch.setattr(anim, "MAX_TOTAL_PIXELS", 10_000)
    r = _post(_body(2))
    assert r.status_code == 422 and "Use fewer frames" in r.json()["detail"]


def test_timeout_refuses_with_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(anim, "MAX_SECONDS", -1.0)
    r = _post(_body(2))
    assert r.status_code == 408 and "limit" in r.json()["detail"]


def test_bad_duration_and_format_refused() -> None:
    assert _post(_body(2, frame_ms=1)).status_code == 422
    assert _post(_body(2, format="mp4")).status_code == 422


def test_mixed_frame_sizes_refused() -> None:
    body = _body(2)
    body["frames"][1]["figure"]["width_in"] = 3.0  # type: ignore[index]
    body["frames"][1]["figure"]["height_in"] = 2.0  # type: ignore[index]
    r = _post(body)
    assert r.status_code == 422 and "different sizes" in r.json()["detail"]
