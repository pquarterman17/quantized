"""The XML output of the quick converter (stdlib ``xml.etree``, writing only).

One UTF-8 ``.xml`` file, every dataset in it::

    <quantized-convert version="1">
      <dataset name="..." points="N">
        <metadata truncated="a.b,c">      <!-- only when something was cut -->
          <item key="a.b">text</item>      <!-- dotted keys, one line of text -->
        </metadata>
        <column role="x" label="..." unit="...">1.0 2.5 nan</column>
        <column role="y" label="..." unit="..." levels='["a","b"]'>0 1 0</column>
      </dataset>
    </quantized-convert>

Numbers are the shortest round-trip form of the float, space-separated, ``nan``
for a gap and ``inf`` / ``-inf`` for the infinities. Metadata is flattened like
the CSV header (``convert_meta.flatten_metadata``: a value over its limit is cut
and the key listed in ``truncated``; the private keys are never written). A 2-D
map is its rows (the lossless long table); ``map_shape`` is a metadata item.
Characters XML 1.0 cannot hold are removed from text. Pure ``io``.
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET  # noqa: S405 - used to WRITE, never to parse
from collections.abc import Sequence
from pathlib import Path

import numpy as np

from quantized.datastruct import DataStruct, is_categorical
from quantized.io.convert_meta import flatten_metadata, x_label
from quantized.x_units import x_unit_of

__all__ = ["write_xml"]

# XML 1.0 forbids the C0 controls other than tab, LF and CR, and U+FFFE / U+FFFF.
# A translate table (not a regex character range) drops them.
_ILLEGAL = dict.fromkeys([*range(0x00, 0x09), 0x0B, 0x0C, *range(0x0E, 0x20), 0xFFFE, 0xFFFF])


def _clean(text: str) -> str:
    return text.encode("utf-8", "replace").decode("utf-8").translate(_ILLEGAL)


def _numbers(column: np.ndarray) -> str:
    return " ".join(repr(float(v)) for v in np.asarray(column, dtype=float))


def _column(parent: ET.Element, role: str, label: str, unit: str, values: np.ndarray) -> ET.Element:
    el = ET.SubElement(parent, "column", role=role, label=_clean(label), unit=_clean(unit))
    el.text = _numbers(values)
    return el


def write_xml(path: Path, datasets: Sequence[tuple[str, DataStruct]]) -> None:
    """``datasets`` as one XML file (layout: module doc)."""
    root = ET.Element("quantized-convert", version="1")
    for name, ds in datasets:
        el = ET.SubElement(root, "dataset", name=_clean(name), points=str(int(ds.n_points)))
        rows, cut = flatten_metadata(ds.metadata)
        if rows:
            meta = ET.SubElement(el, "metadata")
            if cut:
                meta.set("truncated", _clean(",".join(cut)))
            for key, text in rows:
                ET.SubElement(meta, "item", key=_clean(key)).text = _clean(text)
        _column(el, "x", x_label(ds), x_unit_of(ds), ds.time)
        for c, label in enumerate(ds.labels):
            unit = ds.units[c] if c < len(ds.units) else ""
            col = _column(el, "y", label, unit, ds.values[:, c])
            if is_categorical(ds, c) and ds.cat_levels:
                col.set("levels", _clean(json.dumps(list(ds.cat_levels[c]), ensure_ascii=False)))
    ET.indent(root)
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)
