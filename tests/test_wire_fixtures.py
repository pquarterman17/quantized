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
from quantized.routes._payload import datastruct_payload

WIRE_DIR = Path(__file__).parent / "fixtures" / "wire"


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
