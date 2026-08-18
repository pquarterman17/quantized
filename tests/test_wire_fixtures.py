"""Shared backend/frontend wire fixtures (P1.4 review round, P1-1).

The wire-key-mismatch bug this pins: the backend emits ``cat_levels``
(snake_case, ``routes/_payload.datastruct_payload``); an earlier revision of
the frontend's ``DataStruct`` declared the field in camelCase, so nothing
translated -- every categorical accessor was dead code against a REAL
imported dataset, only same-language fixtures (which used the wrong key
themselves) ever exercised it.

``tests/fixtures/wire/`` is reachable from both suites: this test compares
the backend's ACTUAL ``datastruct_payload()`` output against the committed
JSON byte-for-byte, and ``frontend/src/lib/categoricalWireFixture.test.ts``
parses the SAME JSON file through the frontend's real DataStruct pipeline
(``lib/workspace.ts``'s ``parseWorkspace``/``serializeWorkspace``) and
accessors. A key-name (or any other shape) drift between the two languages
now fails on ONE side or the other, not silently.

Regenerate (only when the fixture is meant to change) via:

    uv run python -c "
    import json
    from pathlib import Path
    from quantized.io.delimited import import_csv
    from quantized.routes._payload import datastruct_payload
    src = Path('tests/fixtures/wire/categorical_import.csv')
    payload = datastruct_payload(import_csv(src))
    payload['metadata']['source'] = 'categorical_import.csv'
    Path('tests/fixtures/wire/categorical_import_payload.json').write_text(
        json.dumps(payload, indent=2, sort_keys=True) + chr(10), encoding='utf-8')
    "
"""

from __future__ import annotations

import json
from pathlib import Path

from quantized.io.delimited import import_csv
from quantized.io.import_preview import ImportSettings, parse_import
from quantized.routes._payload import datastruct_payload

WIRE_DIR = Path(__file__).parent / "fixtures" / "wire"

# P1.6 review round P3(a): the `label_import.csv` fixture's ImportSettings --
# a multi-row header/units/label instrument export with a 2-line preamble,
# exercising label_line-derived channel labels AND metadata["comments"]
# retention (io/import_preview.py) across the SAME wire boundary the P1.4
# categorical fixture above pins for cat_levels. Regenerate (only when the
# fixture is meant to change) via:
#
#     uv run python -c "
#     import json
#     from pathlib import Path
#     from quantized.io.import_preview import ImportSettings, parse_import
#     from quantized.routes._payload import datastruct_payload
#     src = Path('tests/fixtures/wire/label_import.csv')
#     settings = ImportSettings(delimiter=',', header_line=2, units_line=3,
#                                label_line=4, data_start_line=5, roles=['x', 'y', 'y'])
#     payload = datastruct_payload(parse_import(src.read_text(encoding='utf-8'), settings))
#     payload['metadata']['source'] = 'label_import.csv'
#     Path('tests/fixtures/wire/label_import_payload.json').write_text(
#         json.dumps(payload, indent=2, sort_keys=True) + chr(10), encoding='utf-8')
#     "
_LABEL_IMPORT_SETTINGS = ImportSettings(
    delimiter=",", header_line=2, units_line=3, label_line=4,
    data_start_line=5, roles=["x", "y", "y"],
)


def test_categorical_import_payload_matches_wire_fixture() -> None:
    """The backend's ACTUAL datastruct_payload() output for the committed
    input CSV must match the committed JSON byte-for-byte (key-for-key,
    value-for-value) -- this is the artifact the frontend fixture test reads
    directly, so any drift here is exactly the class of bug P1-1 was."""
    src = WIRE_DIR / "categorical_import.csv"
    ds = import_csv(src)
    payload = datastruct_payload(ds)
    # The real path is machine/tempdir-specific and not part of the wire-key
    # contract this fixture pins -- normalized the same way the fixture was
    # generated, so the comparison is otherwise fully byte-for-byte.
    payload["metadata"]["source"] = "categorical_import.csv"

    fixture_text = (WIRE_DIR / "categorical_import_payload.json").read_text(encoding="utf-8")
    expected = json.loads(fixture_text)
    assert payload == expected


def test_wire_fixture_carries_the_categorical_channel_snake_case_key() -> None:
    """Pin the literal key name -- the actual bug was a NAME mismatch, so
    assert the name, not just structural equivalence."""
    payload = json.loads((WIRE_DIR / "categorical_import_payload.json").read_text(encoding="utf-8"))
    assert "cat_levels" in payload
    assert "catLevels" not in payload
    assert payload["cat_levels"] == {"1": ["NbAu-1", "NbAu-2"]}


def test_label_import_payload_matches_wire_fixture() -> None:
    """P1.6 review round P3(a): the wizard's `parse_import` path (label_line
    -derived channel labels + retained preamble `comments`) is a SEPARATE
    code path from `import_csv` above -- this pins its ACTUAL output against
    the committed JSON byte-for-byte, same discipline as the categorical
    fixture, so a P2-1/P3-style regression (the "(unit)" suffix reintroduced,
    or comments silently dropped) fails HERE, not just in a hand probe."""
    src = WIRE_DIR / "label_import.csv"
    ds = parse_import(src.read_text(encoding="utf-8"), _LABEL_IMPORT_SETTINGS)
    payload = datastruct_payload(ds)
    payload["metadata"]["source"] = "label_import.csv"

    fixture_text = (WIRE_DIR / "label_import_payload.json").read_text(encoding="utf-8")
    expected = json.loads(fixture_text)
    assert payload == expected


def test_wire_fixture_carries_label_derived_labels_and_comments() -> None:
    """Pin the literal values -- the label row overrides the header-derived
    name, and the 2-line preamble survives as `metadata.comments`."""
    payload = json.loads((WIRE_DIR / "label_import_payload.json").read_text(encoding="utf-8"))
    assert payload["labels"] == ["NbAu-Alpha", "NbAu-Beta"]
    assert payload["metadata"]["comments"] == ["# Sample: NbAu bilayer", "# Operator: pq"]
