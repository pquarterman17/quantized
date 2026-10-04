"""Local Origin migration-cockpit contract over representative real projects.

The parser sweep in ``test_api_parsers.py`` protects crash safety.  This file
protects the *migration inventory* handed to the frontend: workbook laziness,
actionable versus filtered graph records, decoded curve bindings, and stable
graph-layer identities.  The private sibling corpus is never committed and the
tests skip automatically on CI/machines where it is absent.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from quantized.routes.parsers import _import_with_books

# Small/ordinary, multi-workbook, partially decoded, and very large projects.
# These counts are deliberately exact: changing one is a user-visible migration
# change and should require reviewing/updating this contract rather than silently
# altering the cockpit totals.
_PROJECTS = {
    "RockingCurve.opju": {
        "books": 3,
        "lazy_books": 2,
        "actionable": 6,
        "total": 6,
        "filtered": 0,
        "curves": 8,
    },
    "Moke.opj": {
        "books": 7,
        "lazy_books": 6,
        "actionable": 17,
        "total": 17,
        "filtered": 0,
        "curves": 39,
    },
    "XMCD.opj": {
        "books": 171,
        "lazy_books": 170,
        "actionable": 67,
        "total": 128,
        "filtered": 61,
        "curves": 166,
    },
    "PNR.opj": {
        "books": 122,
        "lazy_books": 121,
        "actionable": 205,
        "total": 208,
        "filtered": 3,
        "curves": 1096,
    },
}


def _origin_file(corpus_dir: Path, name: str) -> Path:
    path = corpus_dir / "origin" / name
    if not path.is_file():
        pytest.skip(f"Origin migration corpus project missing: {name}")
    return path


@pytest.mark.realdata
@pytest.mark.parametrize(("name", "expected"), _PROJECTS.items())
def test_origin_migration_inventory_contract(
    corpus_dir: Path,
    name: str,
    expected: dict[str, int],
) -> None:
    payload, handle = _import_with_books(_origin_file(corpus_dir, name))

    assert handle is None, "Origin projects use lazy workbook references, not dataset handles"
    books = payload.get("books", [])
    figures = payload.get("figures", [])
    manifest = payload["origin_fidelity"]

    actual = {
        "books": len(books),
        "lazy_books": sum(book.get("lazy") is True for book in books),
        "actionable": len(figures),
        "total": manifest["graph_records_total"],
        "filtered": manifest["graph_records_filtered"],
        "curves": sum(len(figure.get("curves", [])) for figure in figures),
    }
    assert actual == expected
    assert manifest["graph_records_actionable"] == len(figures)
    assert manifest["graph_records_total"] == (
        manifest["graph_records_actionable"] + manifest["graph_records_filtered"]
    )
    assert len(manifest["filtered_figures"]) == manifest["graph_records_filtered"]
    assert payload.get("book_source"), "lazy workbooks need a reloadable source reference"

    # One row in the cockpit represents one saved graph layer.  Duplicate
    # (window, layer) identities would cause React keys/grouping to conceal a
    # record even though the summary count still looked correct.
    identities = [(figure["name"], figure.get("layer")) for figure in figures if figure.get("name")]
    assert len(identities) == len(set(identities))

    # Actionable figures must carry an honest decoded binding.  Records without
    # one belong in ``filtered_figures`` with a reason, not as blank plot rows.
    for figure in figures:
        assert figure.get("curves"), (name, figure.get("name"), figure.get("layer"))
        assert all(curve.get("book") and curve.get("y") for curve in figure["curves"])


@pytest.mark.realdata
def test_every_top_level_origin_project_reconciles_cockpit_counts(corpus_dir: Path) -> None:
    origin = corpus_dir / "origin"
    files = sorted((*origin.glob("*.opj"), *origin.glob("*.opju")))
    if not files:
        pytest.skip("Origin corpus is unavailable")

    problems: list[str] = []
    for path in files:
        payload, _handle = _import_with_books(path)
        manifest = payload["origin_fidelity"]
        actionable = len(payload.get("figures", []))
        filtered = len(manifest["filtered_figures"])
        total = manifest["graph_records_total"]
        if (actionable, filtered, actionable + filtered) != (
            manifest["graph_records_actionable"],
            manifest["graph_records_filtered"],
            total,
        ):
            problems.append(
                f"{path.name}: figures={actionable}, filtered={filtered}, "
                f"manifest={manifest['graph_records_actionable']}/"
                f"{manifest['graph_records_filtered']}/{total}"
            )

    assert not problems, "Origin cockpit count mismatches:\n" + "\n".join(problems)
