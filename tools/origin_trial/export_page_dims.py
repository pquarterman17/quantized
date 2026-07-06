"""Capture per-graph PAGE DIMENSIONS via COM (print-factor investigation).

The stored curve line-width (u16@282 of the shared curve record) is a
pre-scale value: oracle width = stored/1000 * factor, with factor varying
per graph page (1, 16/30, 11/30, 1/6 across the corpus). Origin's reported
width scales with the page's *dimension*, so capture what Origin says about
each graph page: ``page.width``, ``page.height``, ``page.unit``,
``page.resx/resy`` — plus one plot's ``line.width`` as the cross-check.

Written to ``specimens/ground_truth/<stem>/page_dims.json``.

Run: .venv/Scripts/python.exe tools/origin_trial/export_page_dims.py \
        "UnpolPlots" "RockingCurve" "Hc2 data"
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import win32com.client as wc

CORPUS = Path(r"C:\Users\patri\OneDrive\Coding\git\test-data\origin")
GT = CORPUS / "specimens" / "ground_truth"


def main() -> None:
    stems = sys.argv[1:] or ["UnpolPlots", "RockingCurve", "Hc2 data"]
    app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
    app.Visible = 0

    def lt(c: str) -> bool:
        return bool(app.Execute(c))

    def ltn(expr: str) -> float:
        lt("double __d = -987654;")
        lt(f"__d = {expr};")
        return float(app.LTVar("__d"))

    for stem in stems:
        src = next((CORPUS / f"{stem}{ext}" for ext in (".opju", ".opj")
                    if (CORPUS / f"{stem}{ext}").exists()), None)
        if src is None or not app.Load(str(src)):
            print(f"{stem}: missing/LOAD FAIL")
            continue
        lt('string __g$ = "";')
        lt('doc -e P { __g$ = "%(__g$)%H|"; }')
        graphs = [g for g in str(app.LTStr("__g$")).split("|") if g and "sparkline" not in g]
        out = {}
        for g in graphs:
            lt(f"win -a {g};")
            out[g] = {
                "width": ltn("page.width"),
                "height": ltn("page.height"),
                "unit": ltn("page.unit"),
                "resx": ltn("page.resx"),
                "resy": ltn("page.resy"),
                "plot1_width": ltn("layer.plot1.line.width"),
                "plot1_symsize": ltn("layer.plot1.symbol.size"),
            }
        outdir = GT / stem
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "page_dims.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
        print(f"{stem}: {len(out)} graphs -> page_dims.json")
        app.NewProject()

    app.Exit()
    print("done.")


if __name__ == "__main__":
    main()
