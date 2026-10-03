"""The desktop Open dialog's "Data files" filter offers every registered parser.

The native dialog (``desktop_bridge_dialogs.IMPORT_FILE_TYPES``) is the desktop
twin of the browser's ``IMPORT_ACCEPT`` (guarded in ``openFilePicker.test.ts``).
An extension the registry reads but the filter omits is hidden under the
default filter, so a user cannot pick it without switching to "All files".
"""

from __future__ import annotations

import re

from quantized.desktop_bridge_dialogs import IMPORT_FILE_TYPES
from quantized.io.registry import _EXT_MAP, _SNIFFERS, _STRUCTURE_MAP


def _data_filter_exts() -> set[str]:
    data = next(t for t in IMPORT_FILE_TYPES if t.startswith("Data files"))
    return {m.lower() for m in re.findall(r"\*(\.[A-Za-z0-9]+)", data)}


def test_data_filter_covers_every_registered_extension() -> None:
    registered = set(_EXT_MAP) | set(_SNIFFERS) | set(_STRUCTURE_MAP)
    missing = sorted(registered - _data_filter_exts())
    assert missing == [], f"desktop Data files filter omits {missing}"


def test_orso_is_offered() -> None:
    assert ".ort" in _data_filter_exts()
