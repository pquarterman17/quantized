"""Capture per-graph EXTRAS (titles, legend text+position, folder paths) via COM.

Generic companion to ``export_ground_truth.py`` (which records books, axis
ranges, and curve bindings but neither titles, legends, nor the Project
Explorer folder of each window). For every graph window it records, per layer:

    {"x_title", "y_title",
     "legend": {"text", "x", "y", "x1", "y1", "attach"} | None,
     "x_from", "x_to", "y_from", "y_to"}

plus a top-level ``"folders": {window_name: "/path/"}`` map covering every
workbook AND graph window (captured via the ``pe_path`` X-Function after
activating each window; if Project Explorer does not follow window activation
in this Origin build the map degrades to identical roots and is written as
``None`` -- the consumer must treat a ``None`` folders section as "unverified",
never as "root").

Written to ``specimens/ground_truth/<stem>/graph_extras.json`` -- a SEPARATE
file from ``index.json`` so a failed capture cannot corrupt the graph oracle
(same isolation rationale as ``export_annotation_oracle.py``).

Titles come from the ``xb.text$`` / ``yl.text$`` label objects (the
``layer.x.label.text$`` form returns the literal, not the value). The legend
is the auto-named ``Legend`` graphic object: ``exist("Legend", 16)`` guards it
(type code 16 = graphic object), and ``Legend.x/.y`` are read in the object's
own attach coordinate system with ``Legend.attach`` recorded so the verifier
decides the mapping (0=page, 1=layer scale/data units, 2=layer-frame fraction).

CAVEAT (student/eval page limit): Origin may enumerate FEWER graphs than the
binary contains. This oracle is authoritative for the graphs it lists, NOT a
completeness measure.

Run (Windows, Origin installed):
    .venv/Scripts/python.exe tools/origin_trial/export_graph_extras.py XRD Moke
(defaults to XRD when no stems are given; a stem matches <stem>.opj or
<stem>.opju in the corpus).
"""
from __future__ import annotations

import os

import json
import sys
from pathlib import Path

import win32com.client as wc

CORPUS = Path(os.environ.get("QZ_TEST_DATA_ROOT") or (Path(__file__).resolve().parents[3] / "test-data")) / "origin"
GT = CORPUS / "specimens" / "ground_truth"


def main() -> None:
    stems = sys.argv[1:] or ["XRD"]
    app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
    app.Visible = 0

    def lt(c: str) -> bool:
        return bool(app.Execute(c))

    def lts(expr: str) -> str:
        lt('string __s$ = "";')
        lt(f"__s$ = {expr};")
        return str(app.LTStr("__s$"))

    def ltn(expr: str) -> float:
        lt("double __d = 0;")
        lt(f"__d = {expr};")
        return float(app.LTVar("__d"))

    def obj_exists(name: str) -> bool:
        try:
            return ltn(f"exist({name},16)") > 0
        except Exception:
            return False

    def active_folder() -> str:
        # pe_path is an X-Function: output lands in the named string variable.
        lt('string __p$ = "";')
        lt("pe_path path:=__p$;")
        return str(app.LTStr("__p$"))

    def windows(kind: str) -> list[str]:
        lt('string __acc$ = "";')
        lt(f'doc -e {kind} {{ __acc$ = "%(__acc$)%H|"; }}')
        return [w for w in str(app.LTStr("__acc$")).split("|") if w]

    for stem in stems:
        src = next((CORPUS / f"{stem}{ext}" for ext in (".opj", ".opju")
                    if (CORPUS / f"{stem}{ext}").exists()), None)
        if src is None:
            print(f"{stem}: no .opj/.opju in corpus, skipping")
            continue
        if not app.Load(str(src)):
            print(f"{stem}: LOAD FAIL")
            continue

        folders: dict[str, str] = {}
        for w in windows("W") + windows("P"):
            lt(f"win -a {w};")
            folders[w] = active_folder()

        graphs = [g for g in windows("P") if "sparkline" not in g]
        out_graphs: dict[str, list[dict[str, object]]] = {}
        for g in graphs:
            lt(f"win -a {g};")
            nl = int(ltn("page.nlayers"))
            layers: list[dict[str, object]] = []
            for li in range(1, nl + 1):
                lt(f"page.active = {li};")
                legend = None
                if obj_exists("Legend"):
                    legend = {
                        "text": lts("Legend.text$"),
                        "x": ltn("Legend.x"),
                        "y": ltn("Legend.y"),
                        "x1": ltn("Legend.x1"),
                        "y1": ltn("Legend.y1"),
                        "attach": ltn("Legend.attach"),
                    }
                layers.append({
                    "layer": li,
                    "x_title": lts("xb.text$"),
                    "y_title": lts("yl.text$"),
                    "legend": legend,
                    "x_from": ltn("layer.x.from"), "x_to": ltn("layer.x.to"),
                    "y_from": ltn("layer.y.from"), "y_to": ltn("layer.y.to"),
                })
            out_graphs[g] = layers

        # A PE that never followed window activation yields one identical path
        # for every window -- unverifiable, so write None rather than lie.
        distinct = set(folders.values())
        folders_out = folders if len(distinct) > 1 else None
        if folders_out is None:
            print(f"{stem}: WARNING folder capture degenerate ({distinct!r}), writing null")

        outdir = GT / stem
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "graph_extras.json").write_text(
            json.dumps({"folders": folders_out, "graphs": out_graphs},
                       indent=1, default=str),
            encoding="utf-8",
        )
        nleg = sum(1 for ls in out_graphs.values() for ly in ls if ly["legend"])
        print(f"{stem}: {len(out_graphs)} graphs, {nleg} legends, "
              f"{len(folders)} window folders -> graph_extras.json")
        app.NewProject()

    app.Exit()
    print("done.")


if __name__ == "__main__":
    main()
