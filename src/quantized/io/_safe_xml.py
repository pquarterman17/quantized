"""Parse untrusted XML with the stdlib, refusing any DTD first.

XRDML and BRML files arrive from users, so they are untrusted input. A DTD
is what enables the XML attacks: external entities (XXE, reading local files
or URLs), entity expansion ("billion laughs"), and external DTD fetches. The
stdlib parser's safety against those depends on the bundled expat version
(2.4+). Rather than rely on that, refuse any document that declares a
DOCTYPE or ENTITY before the parser sees it. Instrument files never use DTDs
(checked against every committed XRDML fixture), so nothing real is lost.

The scan runs on the exact ``str`` handed to the parser. For ``str`` input,
pyexpat encodes to UTF-8 and ignores the document's encoding declaration, so
the characters scanned are the characters parsed. The match is deliberately
loose (any case, optional whitespace after ``<!``): a false refusal of an
odd-but-valid file costs a clear error; a miss costs the guarantee.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET  # noqa: S405 (DTDs are refused before parsing)

__all__ = ["parse_untrusted_xml"]

_DTD_DECL = re.compile(r"<!\s*(?:DOCTYPE|ENTITY)", re.IGNORECASE)


def parse_untrusted_xml(text: str, name: str, *, kind: str) -> ET.Element:
    """Parse ``text`` (the content of file ``name``) and return its root.

    Raises
    ------
    ValueError
        If the document declares a DOCTYPE or ENTITY, or is not well-formed
        XML. ``kind`` names the expected format in the message (``"XRDML"``).
    """
    if _DTD_DECL.search(text):
        raise ValueError(
            f"{name}: refusing {kind} with a DOCTYPE/ENTITY declaration "
            "(instrument files never use DTDs; they enable XXE and entity-expansion attacks)"
        )
    try:
        return ET.fromstring(text)  # noqa: S314 (DTD refused above)
    except ET.ParseError as exc:
        # ParseError is a SyntaxError, not a ValueError -> it would escape an
        # import route as a 500. Reject cleanly instead.
        raise ValueError(f"{name} is not valid {kind} (XML parse failed): {exc}") from exc
