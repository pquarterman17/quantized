"""Origin graph templates (``.otp``/``.otpu``) -> ``GraphTemplate``
(gap-ecosystem plan item 5, decode-plan #21).

Two layers, mirroring the sibling figure/curve-style suites:

* **synthetic** -- CPYA/CPYUA-shaped fixtures built in-test (no private data)
  that exercise :func:`read_origin_template` and the ``_series_style`` /
  ``_template_overrides`` mappers in CI, including the fail-closed paths
  (wrong extension, bad magic header, no decodable content);
* **realdata** -- the local ``../test-data/origin`` corpus's 5 template
  files (``SLD_DoubleY.otp``, ``PNR.otpu``, ``PNR-SF.otpu``,
  ``SLDdouble.otpu``, ``UnpolFresnelNR.otpu``): 4 decode a full template
  (axis limits + at least one curve style); ``PNR.otpu`` pins the documented
  partial (curve styles decode, axis overrides stay ``None`` -- its single
  axis record matches none of the three known ``.opju`` forms).

See ``docs/origin_project_format.md`` sec 12 and
``io/origin_project/templates.py``'s module docstring for the recon.
"""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from quantized.io.origin_project.container import OriginProjectError
from quantized.io.origin_project.templates import (
    _series_style,
    _template_overrides,
    read_origin_template,
)

# ── synthetic CPYA (.otp) fixture builder ─────────────────────────────────────


def _block(payload: bytes) -> bytes:
    """One CPY block: <uint32 size LE><0x0A><payload><0x0A>."""
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


def _window_header(name: str) -> bytes:
    """A window-header block: ``00 00 <Name> 00 …``, >=150 B."""
    payload = b"\x00\x00" + name.encode("latin1") + b"\x00"
    payload += b"\x00" * (165 - len(payload))
    return _block(payload)


def _layer_block(x_from: float, x_to: float, y_from: float, y_to: float) -> bytes:
    """The layer-continuation block: head ``00 00 1f 00``, axis doubles at
    15/23 (X) and 58/66 (Y) -- ``figures.py``'s ``_axis`` layout."""
    payload = bytearray(240)
    payload[0:4] = bytes([0, 0, 0x1F, 0])
    struct.pack_into("<d", payload, 15, x_from)
    struct.pack_into("<d", payload, 23, x_to)
    struct.pack_into("<d", payload, 58, y_from)
    struct.pack_into("<d", payload, 66, y_to)
    return _block(bytes(payload))


def _curve_anchor(*, width500: int = 0, size500: int = 0, style: int | None = None) -> bytes:
    """The curve-anchor style record (``opj_curves.py``): id is irrelevant
    for template decode (no workbook to resolve it against) -- a line curve
    at ``#F14040``, 3.0pt wide, no symbol."""
    p = bytearray(519)
    p[0:4] = b"\x01\x00\x00\x00"
    struct.pack_into("<H", p, 4, 999)
    struct.pack_into("<H", p, 21, width500)
    struct.pack_into("<H", p, 25, size500)
    if style is not None:
        p[76] = style
    struct.pack_into("<I", p, 302, 0xFFFFFFF7)
    struct.pack_into("<I", p, 306, 0xFFFFFFF7)  # symbol color: auto (kind=0 -> unused)
    struct.pack_into("<I", p, 362, 0x014040F1)  # line color -> "#F14040"
    p[310] = 0xFF
    return _block(bytes(p))


def _dataplot_block() -> bytes:
    """A block opening with the DataPlot magic -- required immediately after
    a curve anchor for it to count as a real curve."""
    p = bytearray(852)
    p[0:8] = b"\x58\x00\x00\x00\x98\x03\x40\xb3"
    return _block(bytes(p))


def _synthetic_otp(*parts: bytes) -> bytes:
    return b"CPYA 4.3380 188 W64 #\n" + b"".join(parts)


def test_otp_synthetic_template_decodes_axis_and_curve_style(tmp_path: Path) -> None:
    blob = _synthetic_otp(
        _window_header("Graph1"),
        _layer_block(0.0, 10.0, 0.0, 100.0),
        _curve_anchor(width500=1500, style=0xC8) + _dataplot_block(),
    )
    path = tmp_path / "specimen.otp"
    path.write_bytes(blob)
    out = read_origin_template(path)
    assert out["name"] == "specimen"
    assert out["style"] == "default"
    assert out["overrides"] == {"x_lim": [0.0, 10.0], "y_lim": [0.0, 100.0]}
    assert out["seriesStyles"] == [
        {"width": 3.0, "connect": "straight", "color": "#F14040"}
    ]


def test_otp_synthetic_template_no_workbook_never_needed() -> None:
    """A template's curve style decodes with NO column-storage block anywhere
    in the file -- confirms the id/book/column machinery is genuinely never
    consulted (see module docstring)."""
    blob = _synthetic_otp(
        _window_header("Graph1"),
        _layer_block(0.0, 1.0, 0.0, 1.0),
        _curve_anchor(width500=250, style=0xC9, size500=4500) + _dataplot_block(),
    )
    from quantized.io.origin_project.templates import _template_curve_styles_opj

    styles = _template_curve_styles_opj(blob)
    assert styles == [{"style": "scatter", "color": "#F14040", "lineWidth": 0.5, "symbolSize": 9.0}]


# ── synthetic CPYUA (.otpu) fixture builder ───────────────────────────────────


def _layer_bytes_otpu(x_from: float, x_to: float, y_from: float, y_to: float) -> bytes:
    """Minimal CPYUA axis record the "real" form parser accepts -- reuses the
    exact linear-record shape ``test_io_origin_figures_opju.py``'s
    ``_layer_bytes`` builds (anchor + compact-encoded X/Y spans + a linear
    type byte); duplicated locally per this repo's one-file-one-fixture-set
    test convention."""

    def _pack_compact(value: float, width: int) -> bytes:
        return bytes(reversed(struct.pack(">d", value)[:width]))

    def _encode_value(value: float) -> bytes:
        for width in (1, 2, 3):
            chunk = _pack_compact(value, width)
            be = bytes(reversed(chunk)) + b"\x00" * (8 - width)
            if struct.unpack(">d", be)[0] == value:
                return b"\x00\x00" + chunk
        return b"\x00\x00" + struct.pack("<d", value)

    out = bytearray(b"\x03\x00\x00\x1f")  # anchor
    out += _encode_value(x_from) if x_from != 0.0 else b""
    out += _encode_value(x_to)
    out += b"\x83\x02" + _pack_compact(1.0, 2)  # X step
    out += b"\x81\x04\x06\x00\x00\x01\xc3\x66"  # Y-transition marker
    out += bytes([0x03])  # linear type byte
    out += b"\x7b\x40\x01"  # filler + linear X flag
    out += _encode_value(y_from) if y_from != 0.0 else b""
    out += _encode_value(y_to)
    out += b"\x83\x02" + _pack_compact(1.0, 2)  # Y step
    out += b"\x81\x05\x06\x00\x00\x01\x9a\xc1"  # trailer
    out += b"\r\n"
    out += b"\x00" * 32
    return bytes(out)


def _chunks_to_519(*chunks: bytes, reached: int) -> bytes:
    """Append chained zero-length skip chunks so the stream completes the
    519-byte record exactly -- mirrors
    ``test_io_origin_curve_style.py``'s helper of the same name."""
    stream = b"".join(chunks)
    pad = 519 - reached
    tail = b""
    while pad > 0:
        step = min(pad, 0x3F + 3)
        tail += bytes([0x80 + step - 3, 0x00])
        pad -= step
    return stream + tail


def _curve_token_otpu() -> bytes:
    """A unified id-token (``01 01 01 80 03 <id-chunk>``) whose sparse stream
    completes a 519-byte style record: kind=circle(2), style byte 0xC9
    (scatter), symbol color -> "#F14040"."""
    record = _chunks_to_519(
        bytes([0x80, 0x03, 0x07, 0x00, 0x21]),  # skip 3 -> id u16 @4 + byte @6
        bytes([0x8D, 0x01, 0x02]),  # skip 16 -> kind=2 (circle) @23
        bytes([0xB1, 0x01, 0xC9]),  # skip 52 -> style byte c9 @76
        bytes([0xBF, 0x00, 0xBF, 0x00, 0xBF, 0x00]),  # 3 chained 66-zero skips -> @275
        bytes([0x98, 0x01, 0xF7]),  # skip 27 -> sentinel lead f7 @302
        bytes([0xC0, 0xFF]),  # RLE: 3x ff @303-305 (completes 0xFFFFFFF7)
        bytes([0x05, 0xF1, 0x40, 0x40, 0x01, 0xFF]),  # bare literal: color+term @306-310
        reached=311,
    )
    return b"\x01\x01\x01" + record


def _synthetic_otpu(*parts: bytes) -> bytes:
    return b"CPYUA 4.3380 188\n" + b"".join(parts)


def test_otpu_synthetic_template_decodes_axis_and_curve_style(tmp_path: Path) -> None:
    blob = _synthetic_otpu(_layer_bytes_otpu(0.0, 5.0, 0.0, 50.0), _curve_token_otpu())
    path = tmp_path / "specimen.otpu"
    path.write_bytes(blob)
    out = read_origin_template(path)
    assert out["name"] == "specimen"
    assert out["style"] == "default"
    assert out["overrides"] == {"x_lim": [0.0, 5.0], "y_lim": [0.0, 50.0]}
    # lineWidth/symbolSize (offsets 21/25) are left unset by this minimal
    # reconstruction stream, so only style + color decode -- mirrors
    # test_io_origin_curve_style.py's identical reconstruction fixture.
    assert out["seriesStyles"] == [{"marker": True, "width": 0, "color": "#F14040"}]


# ── fail-closed behavior ──────────────────────────────────────────────────────


def test_rejects_wrong_extension(tmp_path: Path) -> None:
    path = tmp_path / "notes.txt"
    path.write_text("hello")
    with pytest.raises(OriginProjectError, match=r"not an Origin graph template"):
        read_origin_template(path)


def test_rejects_bad_magic_otp(tmp_path: Path) -> None:
    path = tmp_path / "fake.otp"
    path.write_bytes(b"not a real origin file, just plain text padding")
    with pytest.raises(OriginProjectError, match=r"CPYA .otp template \(bad header\)"):
        read_origin_template(path)


def test_rejects_bad_magic_otpu(tmp_path: Path) -> None:
    path = tmp_path / "fake.otpu"
    path.write_bytes(b"also not a real origin file, just padding text")
    with pytest.raises(OriginProjectError, match=r"CPYUA .otpu template \(bad header\)"):
        read_origin_template(path)


def test_rejects_valid_header_with_no_decodable_content(tmp_path: Path) -> None:
    """A CPYA file with the right magic but no window/layer/curve at all
    (e.g. a workbook/analysis template, out of scope) fails closed rather
    than fabricating an empty template."""
    path = tmp_path / "workbook.otp"
    path.write_bytes(_synthetic_otp(_window_header("Book1")))  # a worksheet, not a graph
    with pytest.raises(OriginProjectError, match=r"no graph layer or curve style"):
        read_origin_template(path)


def test_partial_when_curves_decode_but_no_layer(tmp_path: Path) -> None:
    """Curve style can decode even when the axis-record scan finds no layer
    at all (the corpus's PNR.otpu case, see module docstring) -- overrides
    stays None, seriesStyles is populated, never a hard failure."""
    blob = _synthetic_otp(
        _window_header("Graph1"),
        # no _layer_block at all -- extract_figures finds no layer for this
        # window, but the curve anchor is still a standalone record.
        _curve_anchor(width500=1500, style=0xC8) + _dataplot_block(),
    )
    path = tmp_path / "styles_only.otp"
    path.write_bytes(blob)
    out = read_origin_template(path)
    assert out["overrides"] is None
    assert out["seriesStyles"] == [
        {"width": 3.0, "connect": "straight", "color": "#F14040"}
    ]


# ── pure mapper unit tests ─────────────────────────────────────────────────────


def test_series_style_scatter_hides_the_connecting_line() -> None:
    assert _series_style({"style": "scatter", "color": "#F14040"}) == {
        "marker": True,
        "width": 0,
        "color": "#F14040",
    }


def test_series_style_line_gets_a_default_width_overridden_by_decoded_one() -> None:
    assert _series_style({"style": "line"}) == {"width": 1.5}
    assert _series_style({"style": "line", "lineWidth": 2.5}) == {"width": 2.5}


def test_series_style_line_symbol_keeps_both_encodings() -> None:
    assert _series_style({"style": "line_symbol", "lineWidth": 2.0}) == {
        "width": 2.0,
        "marker": True,
    }


def test_series_style_symbol_turns_marker_on_without_a_shape_field() -> None:
    out = _series_style({"symbol": "circle", "symbolSize": 6.0})
    assert out == {"marker": True, "marker_size": 6.0}
    assert "markerShape" not in (out or {})  # no shape field in ExportSeriesStyle -- documented gap


def test_series_style_nothing_decoded_is_none() -> None:
    assert _series_style({}) is None


def test_series_style_rejects_malformed_color() -> None:
    assert _series_style({"color": "red"}) is None
    assert _series_style({"color": "#12345"}) is None


def test_template_overrides_degenerate_range_is_absent() -> None:
    fig = {
        "x_from": 1.0,
        "x_to": 1.0,
        "y_from": 0.0,
        "y_to": 10.0,
        "legend_labels": [],
        "legend_pos": None,
    }
    assert _template_overrides(fig) == {"y_lim": [0.0, 10.0]}


def test_template_overrides_legend_position_maps_to_nearest_quadrant() -> None:
    fig = {
        "x_from": 0.0,
        "x_to": 10.0,
        "x_log": False,
        "y_from": 0.0,
        "y_to": 10.0,
        "y_log": False,
        "legend_labels": ["%(1)"],
        "legend_pos": {"x": 8.0, "y": 9.0},
    }
    ov = _template_overrides(fig)
    assert ov is not None
    assert ov["legend"] == {"show": True, "loc": "upper right"}


def test_template_overrides_all_absent_is_none() -> None:
    fig = {
        "x_from": float("nan"),
        "x_to": float("nan"),
        "y_from": float("nan"),
        "y_to": float("nan"),
        "legend_labels": [],
        "legend_pos": None,
    }
    assert _template_overrides(fig) is None


# ── realdata: the local ../test-data/origin corpus ────────────────────────────

realdata = pytest.mark.realdata

_FULL_CASES = ["SLD_DoubleY.otp", "PNR-SF.otpu", "SLDdouble.otpu", "UnpolFresnelNR.otpu"]


@realdata
@pytest.mark.parametrize("fname", _FULL_CASES)
def test_realdata_corpus_templates_decode_a_full_style(corpus_dir: Path, fname: str) -> None:
    src = corpus_dir / "origin" / fname
    if not src.exists():
        pytest.skip(f"'{fname}' not present in the local corpus")
    out = read_origin_template(src)
    assert out["name"] == Path(fname).stem
    assert out["style"] == "default"
    assert out["overrides"] is not None
    assert "x_lim" in out["overrides"]
    assert out["seriesStyles"]  # at least one decoded curve style
    assert any(s for s in out["seriesStyles"] if s)  # at least one non-empty style


@realdata
def test_realdata_pnr_otpu_partial_styles_only(corpus_dir: Path) -> None:
    """The documented one-off: PNR.otpu's single axis record matches none of
    the three known ``.opju`` forms, but its curve style tokens still decode
    -- overrides stays None, seriesStyles is populated."""
    src = corpus_dir / "origin" / "PNR.otpu"
    if not src.exists():
        pytest.skip("'PNR.otpu' not present in the local corpus")
    out = read_origin_template(src)
    assert out["name"] == "PNR"
    assert out["overrides"] is None
    assert out["seriesStyles"]
    assert any(s and s.get("color") for s in out["seriesStyles"])
