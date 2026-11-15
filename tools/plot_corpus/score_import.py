"""Check 1: score quantized's Origin import of every corpus specimen.

Plan item 2 of ``plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md``. Each specimen's
``.opju`` goes through quantized's REAL import path -- the composition
``routes/parsers.py::_import_with_books`` and ``io/origin_convert.py`` both
use: ``read_origin_project_all`` -> ``drop_empty_library_books`` ->
``origin_figures_and_fidelity`` (figure decode, sheet re-binding, preview
attach, graph-page recovery report). The result is scored against Origin's
own answers (``oracle.json``) and the generator's planted data
(``family.json`` / ``.truth.json``):

* ``curves``     -- the import's decoded curve bindings (book, sheet, X, Y);
* ``drawn``      -- what the frontend would plot for the figure
  (``frontend_view``: decoded selection, histogram stage, or the dataset
  default view it falls back to);
* ``values``     -- every planted cell; ``column_meta`` designation/long/units;
* ``plot_type``  -- the kind quantized draws vs the Origin type;
* ``axes``       -- from/to/log per layer; ``styles`` -- planted colour, line
  width, dash, symbol, symbol size; ``error_bars`` -- 231/233 companions.

Every item is ``match`` / ``wrong`` / ``phantom`` / ``omitted`` (+ reason).
Writes ``scorecard.json`` and ``scorecard.md`` (``score_report.py``).

    uv run python tools/plot_corpus/score_import.py \\
        --corpus <corpus> --generated <gen> --out <dir>
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
from frontend_view import drawn_curves  # noqa: E402
from import_compare import (  # noqa: E402
    classify_curves,
    compare_axes,
    compare_styles,
    oracle_curves,
    pair_figures,
    score_plot_type,
    verdict,
)
from import_values import (  # noqa: E402
    compare_matrix,
    compare_sheet,
    match_sheets,
    table_of,
    truth_sheets,
)
from score_report import write_reports  # noqa: E402

from quantized.datastruct import DataStruct  # noqa: E402
from quantized.io.origin_project import (  # noqa: E402
    drop_empty_library_books,
    read_origin_project_all,
)
from quantized.io.origin_project.import_manifest import (  # noqa: E402
    origin_figures_and_fidelity,
)

__all__ = ["XYZ_TYPES", "import_specimen", "score_import", "score_specimen"]

# Types whose curve is an (X, Y, Z) triple or a matrix: Origin's per-plot X
# dataset is not the X (an XYZ contour reports the Y column), and no XY curve
# list can stand for the figure, so the drawn view gets one verdict.
XYZ_TYPES = frozenset({"contour_xyz", "contour_matrix", "heatmap_matrix", "ternary"})


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def import_specimen(path: Path) -> tuple[list[DataStruct], list[dict[str, Any]], dict[str, Any]]:
    """``(books, figures, fidelity manifest)`` exactly as the import route
    builds them for an Origin project."""
    raw = path.read_bytes()
    primary, all_books = read_origin_project_all(path, raw=raw)
    books = drop_empty_library_books(all_books)
    figs, fidelity = origin_figures_and_fidelity(raw, path.suffix.lower(), books, primary=primary)
    return books, figs, dict(fidelity)


def _candidate(ds: DataStruct) -> dict[str, Any]:
    vals = np.asarray(ds.values, dtype=float)
    if vals.ndim == 1:
        vals = vals.reshape(-1, 1)
    return {
        "name": str(ds.metadata.get("origin_book") or ""),
        "metadata": dict(ds.metadata),
        "time": [float(t) for t in np.asarray(ds.time, dtype=float)],
        "values": vals.tolist(),
    }


def _why_missing(fig: Mapping[str, Any] | None, fidelity: Mapping[str, Any]) -> str:
    omissions = set(fidelity.get("omissions") or [])
    if fig is None:
        return "graph_layer_not_recovered" + (
            " (graphs_not_recovered)" if "graphs_not_recovered" in omissions else ""
        )
    if not fig.get("curves"):
        if not fig.get("name"):
            return "no_curve_bindings_decoded (graph page unattributed: id table empty)"
        return "no_curve_bindings_decoded"
    return "curve_not_decoded"


def _error_bar_verdicts(
    curves: Sequence[Mapping[str, Any]],
    sheet_ids: Mapping[tuple[str, str], str],
    tables: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    by_id = {t["id"]: t for t in tables}
    out = []
    for c in curves:
        if not c.get("error_bar"):
            continue
        table = by_id.get(sheet_ids.get((c["book"], c["sheet"]), c["book"]))
        col = None if table is None else table["columns"].get(c["y"])
        d = None if col is None else col.get("designation")
        where = {"book": c["book"], "sheet": c["sheet"], "y": c["y"], "kind": c["error_bar"]}
        if d is None:
            out.append(verdict("omitted", origin=where, reason="no_designation_decoded"))
        else:
            out.append(verdict("match" if d == c["error_bar"] else "wrong", origin=where,
                               quantized=d))
    return out


def _text_x(v: dict[str, Any], tables: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """A curve Origin plots against a TEXT X column is drawn by quantized
    against the row index (text X is no numeric channel): not a wrong
    binding, an unrepresented one."""
    if v["status"] != "wrong" or v.get("field") != "x" or (v.get("quantized") or {}).get("x"):
        return v
    o = v.get("origin") or {}
    table = next((t for t in tables if t["id"] == o.get("book")), None)
    col = None if table is None else table["columns"].get(o.get("x"))
    if col is not None and "text" in col:
        return verdict("omitted", origin=o, quantized=v.get("quantized"),
                       reason="text_x_drawn_against_row_index")
    return v


def score_specimen(spec_dir: Path, generated: Path | None) -> dict[str, Any]:
    """The full verdict tree for one ``<corpus>/<type>/<family>/`` specimen."""
    oracle = _load(spec_dir / "oracle.json")
    ptype, family_name = str(oracle.get("type")), str(oracle.get("family"))
    head: dict[str, Any] = {"type": ptype, "family": family_name}
    if oracle.get("status") != "ok" or not (spec_dir / "specimen.opju").is_file():
        return {**head, "status": "not_built", "reason": oracle.get("reason")}
    truth_path = spec_dir / f"{family_name}.truth.json"
    truth = _load(truth_path) if truth_path.is_file() else {}
    fam_path = None if generated is None else generated / family_name / "family.json"
    family = _load(fam_path) if fam_path is not None and fam_path.is_file() else None

    books, figs, fidelity = import_specimen(spec_dir / "specimen.opju")
    tables = [table_of(b.metadata, b.time, b.values, b.labels, b.units) for b in books]
    candidates = [_candidate(b) for b in books]

    # -- worksheet values (needs the generator's family.json) ----------------
    sheet_ids: dict[tuple[str, str], str] = {}
    values: dict[str, Any] = {}
    phantom_sheets: list[dict[str, Any]] = []
    if family is not None:
        sheets = truth_sheets(family)
        sheet_ids, phantom_sheets = match_sheets(sheets, tables)
        origin_books = set(oracle.get("books") or [])
        for v in phantom_sheets:
            if v["reason"] == "matches no planted sheet" and (
                str(v["quantized"]).split("@", 1)[0] not in origin_books
            ):
                v["reason"] = "book absent from Origin's own book list (hidden/internal)"
        units = {
            (s["book"], s["sheet"]): {c["short"]: c.get("units", "") for c in s["columns"]}
            for s in truth.get("sheets", [])
        }
        by_id = {t["id"]: t for t in tables}
        for s in sheets:
            if s["deleted"]:
                continue
            key = f"{s['book']}!{s['sheet']}"
            table = by_id.get(sheet_ids.get((s["book"], s["sheet"]), ""))
            values[key] = compare_sheet(s, table, units.get((s["book"], s["sheet"])))
        for m in family.get("matrices", []):
            table = next((t for t in tables if t["matrix"] and t["id"] == m["name"]), None)
            values[f"{m['name']}!matrix"] = {"Z": {"values": compare_matrix(m, table)}}

    # -- graph ---------------------------------------------------------------
    graph = oracle.get("graph") or {}
    ocurves = oracle_curves(graph)
    requested = list(oracle.get("requested_styles") or [])
    pairs, extra = pair_figures(figs, graph)
    layers_out = []
    plain_pos = 0
    for li, fi, how in pairs:
        fig = None if fi is None else figs[fi]
        why = _why_missing(fig, fidelity)
        layer = next(ly for ly in graph["layers"] if int(ly.get("index", 0)) == li)
        mine = [c for c in ocurves if c["layer"] == li]
        decoded = list((fig or {}).get("curves") or [])
        curve_v, phantoms = classify_curves(mine, decoded, sheet_ids, why)
        styles = []
        for v, c in zip(curve_v, [c for c in mine if not c.get("error_bar")], strict=True):
            req = requested[plain_pos] if plain_pos < len(requested) else None
            plain_pos += 1
            dec = decoded[v["decoded_index"]] if v["status"] in ("match", "wrong") else None
            styles.append(compare_styles(c["plot"], req, dec, why if dec is None else ""))
        drawn = (
            drawn_curves(fig, candidates) if fig is not None
            else {"dataset": None, "via": "none", "kind": "none", "curves": []}
        )
        drawn_v, drawn_ph = classify_curves(
            mine, drawn["curves"], sheet_ids,
            "figure_not_drawn" if drawn["via"] == "none" else "not_in_drawn_view",
        )
        if ptype in XYZ_TYPES:
            drawn_v, drawn_ph = [verdict(
                "omitted",
                reason="figure_not_drawn" if drawn["via"] == "none"
                else "xyz_plot_has_no_xy_curve_view (default view draws columns as lines vs X)",
                quantized=drawn["curves"],
            )], []
        drawn_v = [_text_x(v, tables) for v in drawn_v]
        kind = str(drawn["kind"])
        pt = (
            verdict("omitted", origin=ptype, reason=why) if fig is None
            else score_plot_type(ptype, [c["plot_type"] for c in mine], kind)
        )
        layers_out.append(
            {
                "layer": li,
                "figure_index": fi,
                "paired_by": how,
                "figure_name": None if fig is None else fig.get("name"),
                "curves": curve_v + phantoms,
                "drawn_via": drawn["via"],
                "drawn": drawn_v + drawn_ph,
                "styles": styles,
                "plot_type": pt,
                "axes": compare_axes(layer.get("axes") or {}, fig, why),
                "error_bars": _error_bar_verdicts(mine, sheet_ids, tables),
            }
        )
    return {
        **head,
        "status": "scored",
        "fidelity_status": fidelity.get("status"),
        "fidelity_omissions": sorted(fidelity.get("omissions") or []),
        "n_books": len(books),
        "n_figures": len(figs),
        "sheet_ids": {f"{b}!{s}": i for (b, s), i in sheet_ids.items()},
        "phantom_sheets": phantom_sheets,
        "phantom_figures": [
            verdict(
                "phantom", quantized={"name": figs[i].get("name"), "layer": figs[i].get("layer")}
            )
            for i in extra
        ],
        "values": values,
        "layers": layers_out,
    }


def score_import(corpus: Path, generated: Path | None) -> list[dict[str, Any]]:
    """Score every ``<corpus>/<type>/<family>/oracle.json`` specimen."""
    out = []
    for oracle in sorted(corpus.glob("*/*/oracle.json")):
        try:
            out.append(score_specimen(oracle.parent, generated))
        except Exception as exc:  # one broken specimen must not hide the rest
            out.append(
                {
                    "type": oracle.parent.parent.name,
                    "family": oracle.parent.name,
                    "status": "import_error",
                    "reason": f"{type(exc).__name__}: {exc}",
                }
            )
    return out


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--corpus", type=Path, required=True)
    ap.add_argument("--generated", type=Path, help="generate.py output (family.json values)")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    specimens = score_import(args.corpus, args.generated)
    json_path, md_path = write_reports(specimens, args.out)
    print(f"scored {len(specimens)} specimens -> {json_path}, {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
