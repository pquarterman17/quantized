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
    # Book3 is 3 rows, as in Origin's export (it was 32 rows of allocation
    # padding); Book4@2 (the FitLinear report sheet, 44 x 25 of evaluated
    # references in Origin) holds no decodable cell, so the Library omits it.
    "Moke.opj": {
        "books": 6,
        "lazy_books": 5,
        "actionable": 17,
        "total": 17,
        "filtered": 0,
        "curves": 39,
    },
    "XMCD.opj": {
        "books": 171,
        "lazy_books": 170,
        # #780 (12-byte curve names, F-070): 60 more GraphT* panels bind, 166 -> 239 drawn
        # curves (COM lists 245 plots: 239 drawn + 5 hidden; Graph25 has no anchor, F-096).
        "actionable": 127,
        "total": 128,
        "filtered": 1,
        "curves": 239,
    },
    "PNR.opj": {
        "books": 122,
        "lazy_books": 121,
        # #778: 326 curves were Y-error columns (D/F/J, designated "Y-error") drawn as
        # lines; they are error-bar plots now (F-064/F-065). #780: 4 hidden plots left
        # out (F-072) and 3 layers kept with every curve diagnosed (hidden /
        # column_not_resolved) instead of dropped as dead hints. 1096 - 326 - 4 = 766.
        "actionable": 208,
        "total": 208,
        "filtered": 0,
        "curves": 766,
    },
}


def _origin_file(corpus_dir: Path, name: str) -> Path:
    path = corpus_dir / "origin" / name
    if not path.is_file():
        pytest.skip(f"Origin migration corpus project missing: {name}")
    return path


# Layers that stay actionable with NO drawn curve: every plot Origin lists on them was left
# out and diagnosed (`curve_sheet_omitted`: hidden_in_origin / column_not_resolved), so the
# cockpit shows a real graph that says why it is empty (`fidelity._filter_reason`, #774).
# Before #780 these were dropped as dead source hints. Exact, so a new blank row fails.
_UNDRAWN = {"PNR.opj": [("0p023", 1), ("Graph46", 1), ("Graph47", 5)]}


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
    # one belong in ``filtered_figures`` with a reason, not as blank plot rows; the only
    # curve-less figures are the exact ``_UNDRAWN`` layers, each carrying its diagnosis.
    undrawn = []
    for figure in figures:
        if not figure.get("curves"):
            ident = (name, figure.get("name"), figure.get("layer"))
            assert figure.get("curve_sheet_omitted"), ident
            undrawn.append((figure["name"], figure.get("layer")))
        assert all(curve.get("book") and curve.get("y") for curve in figure.get("curves", []))
    assert sorted(undrawn) == _UNDRAWN.get(name, [])


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
