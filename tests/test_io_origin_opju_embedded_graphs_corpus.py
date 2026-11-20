"""The graph-page census against Origin 2026b's COM page list (``realdata``).

The oracle is ``origin/ground_truth_public/axis_ranges.json`` under the
test-data root (``doc -e P`` page names per project; skipped when absent).
Nothing read from it or from the corpus is committed: every expectation is
computed here at test time.

Every page Origin lists that ``extract_figures_opju`` does not decode must be
accounted for in exactly one way:

* reported as an unrecovered graph page (``opju_graph_pages``), or
* reported as an embedded workbook graph (``opju_embedded_graphs``), or
* not stored in the file at all: no page-header name field
  ``<namelen+2> 00 00 <name> <trail>`` anywhere (the sparklines Origin draws
  again on load).

Negative control: nothing either report lists is outside Origin's page list.
"""

from __future__ import annotations

import functools
import json
import re
from pathlib import Path
from typing import Any

import pytest

from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_embedded_graphs import embedded_graphs
from quantized.io.origin_project.opju_graph_pages import MAX_REPORTED, unrecovered_graph_pages

pytestmark = pytest.mark.realdata

_AXIS_JSON = "origin/ground_truth_public/axis_ranges.json"


def _stored(b: bytes, name: str) -> bool:
    nm = name.encode("latin1")
    head = re.escape(bytes([len(nm) + 2]) + b"\x00\x00" + nm) + rb"[\x80-\xff]"
    return re.search(head, b) is not None


@functools.cache
def _census(corpus_dir: Path) -> dict[str, Any] | None:
    path = corpus_dir / _AXIS_JSON
    if not path.is_file():
        return None
    files = json.loads(path.read_text(encoding="utf-8"))["files"]
    out: dict[str, Any] = {"unaccounted": [], "twice": [], "extra": [], "classes": {}}
    classes: dict[str, int] = out["classes"]
    for rel, pages in files.items():
        project = corpus_dir / rel
        if not project.is_file():
            continue
        b = project.read_bytes()
        names = {f["name"] for f in extract_figures_opju(b)}
        report = unrecovered_graph_pages(b, names)
        assert report.missing <= MAX_REPORTED  # the list is complete here
        standalone = {g["page_name"] for g in report.pages}
        embedded = {e.name for e in embedded_graphs(b) if e.name not in names}
        out["extra"] += [(rel, n) for n in (standalone | embedded) - pages.keys()]
        for page in pages:
            if page in names:
                classes["decoded"] = classes.get("decoded", 0) + 1
                continue
            how = [
                c
                for c, hit in (
                    ("graph_page", page in standalone),
                    ("embedded", page in embedded),
                    ("not_stored", not _stored(b, page)),
                )
                if hit
            ]
            if not how:
                out["unaccounted"].append((rel, page))
            elif len(how) > 1:
                out["twice"].append((rel, page, how))
            else:
                classes[how[0]] = classes.get(how[0], 0) + 1
    return out


@pytest.fixture
def census(corpus_dir: Path) -> dict[str, Any]:
    result = _census(corpus_dir)
    if result is None:
        pytest.skip(f"{_AXIS_JSON} not present")
    return result


def test_every_oracle_page_is_decoded_or_accounted_for(census: dict[str, Any]) -> None:
    assert census["classes"].get("decoded", 0) > 1000  # the oracle was exercised
    assert census["classes"].get("embedded", 0) > 0  # and the embedded census
    assert census["unaccounted"] == []
    assert census["twice"] == []


def test_no_reported_page_outside_origins_list(census: dict[str, Any]) -> None:
    assert census["extra"] == []
