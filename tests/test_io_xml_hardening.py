"""XML hardening for the instrument parsers (security hardening, 2026-10-01).

XRDML and BRML are XML, and both arrive as untrusted files. Safety used to
rest on the bundled expat version (2.4+ caps entity amplification and never
fetches external entities). The parsers now refuse any document that carries
a DOCTYPE or ENTITY declaration before the stdlib parser sees it. Real
instrument files never use DTDs: every committed XRDML fixture is checked
below.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from quantized.io._safe_xml import parse_untrusted_xml
from quantized.io.bruker_brml import import_bruker_brml
from quantized.io.xrdml import import_xrdml

FIXTURES = Path(__file__).parent / "fixtures"
_GOOD_XRDML = FIXTURES / "xrdml_la2nio4.xrdml"

_XXE = '<!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
_LAUGHS = (
    '<!DOCTYPE r [<!ENTITY a "lol"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">'
    '<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">]>'
)
_EXTERNAL_DTD = '<!DOCTYPE r SYSTEM "http://attacker.invalid/evil.dtd">'


def _hostile_xrdml(tmp_path: Path, doctype: str, ref: str = "") -> Path:
    """The real La2NiO4 fixture with a DOCTYPE prepended (and an entity used)."""
    text = _GOOD_XRDML.read_text(encoding="latin-1")
    # Entity reference inside the first <entry> so a resolving parser would
    # splice the payload into the document.
    text = text.replace("<entry>", f"<entry>{ref}", 1)
    path = tmp_path / "hostile.xrdml"
    path.write_text('<?xml version="1.0"?>\n' + doctype + "\n" + text, encoding="latin-1")
    return path


@pytest.mark.parametrize(
    ("doctype", "ref"),
    [(_XXE, "&xxe;"), (_LAUGHS, "&d;"), (_EXTERNAL_DTD, "")],
    ids=["xxe", "billion-laughs", "external-dtd"],
)
def test_xrdml_refuses_dtd(tmp_path: Path, doctype: str, ref: str) -> None:
    path = _hostile_xrdml(tmp_path, doctype, ref)
    with pytest.raises(ValueError, match=r"hostile\.xrdml.*DOCTYPE"):
        import_xrdml(path)


def _hostile_brml(tmp_path: Path, doctype: str, ref: str = "") -> Path:
    xml = (
        f'<?xml version="1.0"?>\n{doctype}\n<RawData><DataRoutes>'
        '<DataRoute RouteFlag="Measured"><ScanInformation>'
        f"<MeasurementPoints>{ref}2</MeasurementPoints><ScanAxes>"
        '<ScanAxisInfo AxisId="TwoTheta" Unit="deg"><Start>10</Start><Stop>11</Stop>'
        "</ScanAxisInfo></ScanAxes></ScanInformation>"
        "<Datum>1,1,10,5,1</Datum><Datum>1,1,11,5.5,2</Datum>"
        "</DataRoute></DataRoutes></RawData>"
    )
    path = tmp_path / "hostile.brml"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("experimentCollection.xml", "<x/>")
        zf.writestr("Experiment0/RawData0.xml", xml)
    return path


@pytest.mark.parametrize(
    ("doctype", "ref"),
    [(_XXE, "&xxe;"), (_LAUGHS, "&d;"), (_EXTERNAL_DTD, "")],
    ids=["xxe", "billion-laughs", "external-dtd"],
)
def test_brml_refuses_dtd(tmp_path: Path, doctype: str, ref: str) -> None:
    path = _hostile_brml(tmp_path, doctype, ref)
    with pytest.raises(ValueError, match=r"hostile\.brml.*DOCTYPE"):
        import_bruker_brml(path)


def test_brml_malformed_xml_is_a_clean_value_error(tmp_path: Path) -> None:
    """A broken scan document is a ValueError naming the file, not a ParseError."""
    path = tmp_path / "broken.brml"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("Experiment0/RawData0.xml", "<RawData><unclosed>")
    with pytest.raises(ValueError, match=r"broken\.brml"):
        import_bruker_brml(path)


def test_helper_refuses_bare_entity_and_lowercase_doctype() -> None:
    for text in ('<!ENTITY a "x"><r/>', "<!doctype r><r/>", "<! DOCTYPE r><r/>"):
        with pytest.raises(ValueError, match=r"f\.xml.*DOCTYPE"):
            parse_untrusted_xml(text, "f.xml", kind="XML")


def test_helper_parses_plain_document() -> None:
    root = parse_untrusted_xml('<?xml version="1.0"?><r a="1"><c>x</c></r>', "f.xml", kind="XML")
    assert root.tag == "r"
    assert root.find("c") is not None


def test_normal_xrdml_still_parses() -> None:
    ds = import_xrdml(_GOOD_XRDML)
    assert ds.values.shape[0] > 100


@pytest.mark.parametrize(
    "path", sorted(FIXTURES.rglob("*.xrdml")), ids=lambda p: p.name
)
def test_committed_fixtures_carry_no_dtd(path: Path) -> None:
    """The real/synthetic instrument fixtures never declare a DTD."""
    text = path.read_text(encoding="latin-1")
    assert "<!DOCTYPE" not in text.upper()
    assert "<!ENTITY" not in text.upper()
