"""Read Origin ``.opju`` (CPYUA, 2018+) projects — decoder pending (plan item 8).

The worksheet-data codec is cracked (``docs/origin_re/opju_container.md``):
columns are stored with a nibble-coded XOR-delta float codec, not deflate.
Two pieces remain before a trustworthy decoder ships: the deterministic
PREV/PRED predictor schedule, and formal parsing of the outer type-tagged
record framing. Until then we guide the user to the export path.
"""

from __future__ import annotations

from pathlib import Path

from quantized.datastruct import DataStruct
from quantized.io.origin_project.container import fallback

__all__ = ["read_opju"]


def read_opju(path: Path) -> DataStruct:
    raise fallback(
        path,
        f"'{path.name}' is an Origin .opju (2018+) project; "
        f"the reader for it is still in progress.",
    )
