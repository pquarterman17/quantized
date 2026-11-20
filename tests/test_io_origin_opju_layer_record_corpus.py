"""``opju_layer_record`` against REAL third-party ``.opju`` projects.

Local-only (``realdata``; corpus discovery as in
``test_io_origin_opju_public_corpus``): nothing read from the corpus is
committed, every expectation is computed here at test time.

* **Positive control** -- every layer record the real-form reader
  (``opju_axis_real_form``, validated against Origin's COM axis oracle)
  decodes is also read by the fixed-offset reader, with the same X/Y ranges,
  unless the real-form reading is self-inconsistent (its major-tick step
  runs against its span or exceeds it) -- the misreads the module docstring
  names, which the saved previews show the fixed offsets get right.
* **Negative control** -- a ``03 00 00 1f/5f`` match without its record-
  length prefix (a coincidence inside another block) is never read.
"""

from __future__ import annotations

import pytest

from quantized.io.origin_project.figure_geometry import opju_anchor_has_length_prefix
from quantized.io.origin_project.figures_opju import _ANCHOR, _ANCHOR_PANEL, _find_all
from quantized.io.origin_project.opju_axis_real_form import _parse_real_record
from quantized.io.origin_project.opju_axis_specimen_form import _parse_specimen_record
from quantized.io.origin_project.opju_layer_record import layer_record
from test_io_origin_opju_public_corpus import _CORPUS

pytestmark = pytest.mark.realdata

_EXCLUDED = ("CKPEIIKA_deopjufy", "BertySnack_norigin")
_FILES = (
    sorted(
        str(p.relative_to(_CORPUS))
        for p in _CORPUS.rglob("*.opju")
        if not any(part in _EXCLUDED for part in p.parts)
    )
    if _CORPUS
    else []
)


def _close(a: float, b: float) -> bool:
    return a == b or abs(a - b) <= 1e-9 * max(1.0, abs(a))


def _inconsistent(lo: float, hi: float, step: float | None) -> bool:
    if step is None or step == 0:
        return False
    return (hi > lo) != (step > 0) or abs(step) > abs(hi - lo) * (1 + 1e-9)


@pytest.mark.skipif(not _FILES, reason="public Origin corpus not present")
@pytest.mark.parametrize("rel", _FILES)
def test_layer_record_agrees_with_real_form(rel: str) -> None:
    assert _CORPUS is not None
    b = (_CORPUS / rel).read_bytes()
    anchors = sorted(_find_all(b, _ANCHOR) + _find_all(b, _ANCHOR_PANEL))
    for i, a in enumerate(anchors):
        got = layer_record(b, a)
        if not opju_anchor_has_length_prefix(b, a):
            assert got is None, f"coincidental anchor read at {a}"
            continue
        end = anchors[i + 1] if i + 1 < len(anchors) else len(b)
        if _parse_specimen_record(b, a + 4) is not None:
            continue
        real = _parse_real_record(b, a + 4, end)
        if real is None:
            continue
        assert got is not None, f"real-form record at {a} not read"
        if all(_close(real[k], got[k]) for k in range(4)):
            continue
        assert _inconsistent(real[0], real[1], real[6]) or _inconsistent(
            real[2], real[3], real[7]
        ), f"disagreement at {a}: real {real[:4]} vs fixed {got[:4]}"
