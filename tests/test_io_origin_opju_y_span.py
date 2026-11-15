"""``.opju`` Y-span start grammar: geometry double, tagged literal run, specimen skeleton.

Three Y-span misreads pinned as "value-token defects" were three mechanisms (see
``docs/origin_project_format.md``, "Y-span start grammar"), all found against
Origin 2026b COM ``layer.y.from/to`` (``test_io_origin_opju_page_attribution``):

* The layer-geometry payload OPENS with its own value token (``82 03 fc 8c 40``
  = 927.5, ``c3 66 02 7b 40`` = 438.4). With ``y_from`` elided the scan started
  AT that double and read it as ``y_from`` (927.5 / 438.4 for Origin's 0).
* A tagged value's ``nn`` literals can include the LEAD byte of the next RLE
  token: ``85 03 e8 3f`` + ``cd c2 cc 03 f0 3f`` is 0.75, then 1.05 -- the
  3-byte value ``e8 3f cd`` is implausible, so the old reader skipped ``y_from``.
* A real-form record whose geometry double has no X-scale trailer (type byte
  ``02``) matched the specimen skeleton, whose fixed ``+3`` filler skip then ate
  the first Y tag (``8d 03 40 6e 40`` = 242 read as 240).

Synthetic bytes lock the proven grammar; the proof is the whole-corpus run
against the oracle.
"""

from __future__ import annotations

from quantized.io.origin_project.figures_opju import _parse_specimen_record, extract_figures_opju

_X = b"\x89\x01" b"\x9a\xc2\x99\x02\xc9\x3f" b"\x84\x01\x40" b"\x83\x02\xe0\x3f"  # [0.2, 2.0]
_END = b"\x81\x35\x08\x00\x00\x01" b"\x8f\xc2\xf5\x28\x5c\x8f\x57\xc0" + b"\x00" * 32


def _y(sep: bytes, payload: bytes, y_span: bytes) -> tuple[float, float] | None:
    rec = b"\x03\x00\x00\x1f" + _X + sep + payload + y_span + _END
    figs = extract_figures_opju(b"CPYUA 4.3811 222\n" + rec)
    if not figs:
        return None
    assert len(figs) == 1
    return (figs[0]["y_from"], figs[0]["y_to"])


# ── geometry double is not y_from ─────────────────────────────────────────────


def test_tagged_geometry_double_is_not_y_from() -> None:
    """TEA Graph12: ``82 03 fc 8c 40`` (927.5) opens the payload, Y is
    ``8d 03 40 8f 40`` = 1000 (from elided) + step 100. Origin: [0, 1000]."""
    got = _y(
        b"\x81\x0c\x04\x00\x00\x01",
        b"\x82\x03\xfc\x8c\x40",
        b"\x8d\x03\x40\x8f\x40\x83\x02\x59\x40",
    )
    assert got == (0.0, 1000.0)


def test_rle_geometry_double_is_not_y_from() -> None:
    """origin_scientific_colors ColorPage2: ``c3 66 02 7b 40`` (438.4) then
    ``8f 01 40`` = 2.0 + step 1.0. Origin: [0, 2]."""
    got = _y(b"\x81\x05\x06\x00\x00\x01", b"\xc3\x66\x02\x7b\x40", b"\x8f\x01\x40\x83\x02\xf0\x3f")
    assert got == (0.0, 2.0)


def test_stored_y_from_after_geometry_double_is_unchanged() -> None:
    """Negative control: a real ``y_from`` token after the same geometry double
    still reads as ``y_from`` (10) -- only the geometry token is skipped."""
    got = _y(
        b"\x81\x0c\x04\x00\x00\x01",
        b"\x82\x03\xfc\x8c\x40",
        b"\x86\x02\x24\x40\x83\x02\x54\x40\x83\x02\x24\x40",
    )
    assert got == (10.0, 80.0)


# ── tagged literal run carrying the next token's lead byte ────────────────────

_SEP10 = b"\x81\x0d\x0a\x00\x00\x01"
_GEO = b"\x3d\x0a\xd7\xa3\x70\x3d\x5d\x40\x01"


def test_tagged_value_run_carries_next_rle_lead() -> None:
    """hyperspectral Graph4: ``85 03 e8 3f`` + lead ``cd`` of the RLE 1.05
    (``cd c2 cc 03 f0 3f``) + step 0.05. Origin: [0.75, 1.05]."""
    span = b"\x03\xe8\x3f" b"\xcd\xc2\xcc\x03\xf0\x3f" b"\x9a\xc2\x99\x02\xa9\x3f"
    got = _y(_SEP10, _GEO + b"\x85", span)
    assert got == (0.75, 1.05)


def test_tagged_run_without_following_rle_fails_closed() -> None:
    """Negative control: the same ``85 03 e8 3f cd`` with no RLE marker after it
    is not a value + lead (and ``e8 3f cd`` is no plausible value): no Y span,
    so the layer is omitted rather than guessed."""
    assert _y(_SEP10, _GEO + b"\x85", b"\x03\xe8\x3f\xcd\x03\xf0\x3f") is None


def test_full_width_tagged_value_is_unchanged() -> None:
    """Negative control: a 3-byte tagged value that IS plausible stays one value
    (``83 03 80 56 40`` = 90), whatever follows it."""
    got = _y(_SEP10, _GEO + b"\x85", b"\x03\x80\x56\x40\x83\x02\x24\x40")
    assert got == (0.0, 90.0)


# ── real-form record with a specimen-looking skeleton ─────────────────────────

_SKELETON_TAIL = (
    b"\x81\x05\x06\x00\x00\x01" b"\x9a\xc1\x99\x03\x19\x76\xc0\x80\x0c\x10\x10\x00"
    b"\x88\xe9\x6c\x00\x00\x12\x00\x20\x22" + b"\x00" * 40
)


def _payload(blob: bytes) -> int:
    return blob.index(b"\x03\x00\x00\x1f") + 4


def _skeleton(ctx_and_filler: bytes) -> bytes:
    return (
        b"CPYUA 4.3811 222\n\x03\x00\x00\x1f"
        b"\x96\x03\x80\x66\x40\x83\x02\x34\x40"  # X: [0, 180] step 20
        b"\x81\x04\x06\x00\x00\x01\xc3\x66" + ctx_and_filler + _SKELETON_TAIL
    )


def test_specimen_skeleton_without_scale_trailer_defers_to_real_form() -> None:
    """ColorPage1 layer 7: type byte 02 (geometry = ``7b 40`` only), Y span
    ``8d 03 40 6e 40`` = 242. The specimen reader's fixed +3 skip ate the ``8d``
    tag and read 240; the real-form reader gets it right."""
    blob = _skeleton(b"\x02\x7b\x40\x8d\x03\x40\x6e\x40\x83\x02\x34\x40")
    assert _parse_specimen_record(blob, _payload(blob)) is None
    assert [(f["y_from"], f["y_to"]) for f in extract_figures_opju(blob)] == [(0.0, 242.0)]


def test_specimen_skeleton_with_scale_trailer_stays_specimen() -> None:
    """Negative control: type byte 03 + ``7b 40 01`` is the true specimen filler;
    the specimen reader still accepts it and the figure decodes."""
    blob = _skeleton(b"\x03\x7b\x40\x01\x8d\x03\x40\x6e\x40\x83\x02\x34\x40")
    assert _parse_specimen_record(blob, _payload(blob)) is not None
    assert [(f["y_from"], f["y_to"]) for f in extract_figures_opju(blob)] == [(0.0, 242.0)]
