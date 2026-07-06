"""Capture the GRAPH oracle for large projects (Hc2) via Origin COM.

``export_ground_truth.py`` skips projects whose full per-sheet dump is too big /
too slow, but their *graphs* are exactly what the figure importer must
reproduce. This captures just the graph section into
``specimens/ground_truth/<stem>/index.json`` (merging with any existing books
section), in the same shape ``export_ground_truth.py`` writes:

    {"graphs": [{"graph","long_name","layers":[
        {"x":[from,to,type], "y":[from,to,type], "plots":[ref,...],
         "x_title","y_title"}]}]}

Curve bindings (``plots``) are the key asset the ``.opju`` decoder currently
lacks entirely. Axis titles come from the ``xb.text$`` / ``yl.text$`` label
objects (the ``layer.x.label.text$`` form returns the literal, not the value);
they carry raw LabTalk escapes (``\\g(\\i(m))\\-(0)\\i(H)`` = mu-0 H), which the
decoder renders via ``origin_richtext.clean_richtext``.

CAVEAT (student/eval page limit): Origin may enumerate FEWER graphs than the
binary actually contains (the Hc2 ``.opj`` binary has Graph1..34 + FitLine* +
Residual*, but ``doc -e P`` returned 40). So this oracle is authoritative for
the BINDINGS of the graphs it *does* list, but is NOT a completeness measure --
do not compute recall/precision denominators from it.

Run (Windows, Origin installed):
    uv run python tools/origin_trial/export_hc2_oracle.py
"""
from __future__ import annotations

import json
from pathlib import Path

import win32com.client as wc

CORPUS = Path(r"C:\Users\patri\OneDrive\Coding\git\test-data\origin")
GT = CORPUS / "specimens" / "ground_truth"
FILES = ["hc2convert.opj", "Hc2 data.opju"]
MAX_PLOTS = 60


def main() -> None:
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

    for f in FILES:
        if not (CORPUS / f).exists():
            print(f"{f}: source missing, skipping")
            continue
        if not app.Load(str(CORPUS / f)):
            print(f"{f}: LOAD FAIL")
            continue
        lt('string __g$ = "";')
        lt('doc -e P { __g$ = "%(__g$)%H|"; }')
        graphs = [g for g in str(app.LTStr("__g$")).split("|") if g and "sparkline" not in g]
        out_graphs = []
        for g in graphs:
            lt(f"win -a {g};")
            nl = int(ltn("page.nlayers"))
            long_name = lts("page.longname$")
            layers = []
            for li in range(1, nl + 1):
                lt(f"page.active = {li};")
                plots = []
                for pi in range(1, MAX_PLOTS + 1):
                    lt(f"range -w __rp = {pi};")
                    ref = lts('"%(__rp)"')
                    if not ref or "###" in ref or (plots and ref == plots[-1]):
                        break
                    plots.append(ref)
                layers.append({
                    "x": [ltn("layer.x.from"), ltn("layer.x.to"), ltn("layer.x.type")],
                    "y": [ltn("layer.y.from"), ltn("layer.y.to"), ltn("layer.y.type")],
                    "plots": plots,
                    "x_title": lts("xb.text$"),
                    "y_title": lts("yl.text$"),
                })
            out_graphs.append({"graph": g, "long_name": long_name, "layers": layers})
        stem = Path(f).stem
        outdir = GT / stem
        outdir.mkdir(parents=True, exist_ok=True)
        idx = outdir / "index.json"
        data = json.loads(idx.read_text(encoding="utf-8")) if idx.exists() else {}
        data["graphs"] = out_graphs
        idx.write_text(json.dumps(data, indent=1, default=str), encoding="utf-8")
        ncur = sum(len(layer["plots"]) for gg in out_graphs for layer in gg["layers"])
        print(f"{f}: {len(out_graphs)} graphs, {ncur} plot refs -> {idx}")
        app.NewProject()

    app.Exit()
    print("done.")


if __name__ == "__main__":
    main()
