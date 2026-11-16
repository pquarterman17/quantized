"""``.opju`` axis-record separator variants: the LAST byte's ``0x08`` bit
(third pass) and a category layer's END separator ending ``02`` (fourth).

The real-form axis record (``opju_axis_real_form``) splits its X span, the
layer-geometry payload and its Y span with ``8x <id> <plen> 00 <flag> 01``.
The final byte reads ``09`` (= ``01 | 0x08``) instead of ``01`` on the
SECOND layer of an Origin double-Y graph (the ``DOUBLEY`` template, measured
2026-11-15 on all 8 plot-corpus ``double_y`` specimens: layer 1 ``... 00 01``,
layer 2 ``... 00 09``). With ``09`` neither separator pass matches, so the
right-axis layer was never recovered (``graph_layer_not_recovered``) and the
figure lost its right Y axis and every curve on it. Read with ``09`` admitted,
all 8 layer-2 records decode exactly to Origin's own ``layer.x/y.from/to``
(``oracle.json``). The bit's meaning is not decoded (it is not only "right
axis": the real corpus also carries it on the panel layers of multi-panel
pages, e.g. ``SOP_meas``), so it is used ONLY to find the separator, never
interpreted.

Admitted as a THIRD pass after the strict and wide ones: a record reaches it
only when neither of those parsed it, so every record decoded before parses
byte-identically. Real corpus (359 ``.opju``, 2026-11-15): 709 graph layers in
28 files are recovered that were not before (673 of them the coincident
second layer of a 2-layer page), and no existing figure changes. Origin 2026b
COM on every one: ``layer.x/y.from/to`` 2,836 / 2,836 exact, ``x/y.type``
1,418 / 1,418, and all 720 decoded curves are plots Origin draws on that
layer with the same Y and X dataset (``%Z`` / ``xof``); 0 wrong, 0 phantom.
"""

from __future__ import annotations

import re

__all__ = ["SEP_END_02", "SEP_LAST_FLAG8"]

# Same lead and 5th-byte flag set as ``opju_axis_real_form._SEP_WIDE``; only
# the last byte widens, to ``01`` or ``09``.
SEP_LAST_FLAG8 = re.compile(
    rb"[\x80\x81]..\x00[\x00\x01\x08\x30\x40\x41\x48\x80\x88\xc0][\x01\x09]", re.DOTALL
)

# The END separator of a category-axis layer (box / violin / strip and the
# box-family real files) ends in ``02``, not ``01``: ``80 35 08 00 00 02``
# after an ordinary ``80 04 07 00 00 01`` first separator. Measured
# 2026-11-15 on the plot corpus: all 30 box / violin / strip specimens whose
# layer did not decode carry it, and the pass decodes every one to Origin's
# own ``layer.x/y.from/to`` (oracle.json); real corpus: 50 layers, all equal
# to COM. Admitted ONLY on the end separator, after a first separator ending
# ``01`` (the fourth, retry-only pass, after ``SEP_LAST_FLAG8``): records
# with ``02`` on BOTH separators (workbook-embedded graphs) stay undecoded.
SEP_END_02 = re.compile(
    rb"[\x80\x81]..\x00[\x00\x01\x08\x30\x40\x41\x48\x80\x88\xc0]\x02", re.DOTALL
)
