"""Capture per-layer FRAME GEOMETRY via COM (§13.2 #7 + the annotation
reference-frame investigation).

For every graph -> layer records ``layer.left/top/width/height`` (in
``page.unit`` units) plus the page dimensions — the layer frame's position on
the page. Written to ``specimens/ground_truth/<stem>/layer_geometry.json``.

Run: .venv/Scripts/python.exe tools/origin_trial/export_layer_geometry.py XRD hc2convert ...
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
    stems = sys.argv[1:] or ["XRD", "hc2convert"]
    app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
    app.Visible = 0

    def lt(c: str) -> bool:
        return bool(app.Execute(c))

    def ltn(expr: str) -> float:
        lt("double __d = -987654;")
        lt(f"__d = {expr};")
        return float(app.LTVar("__d"))

    for stem in stems:
        src = next((CORPUS / f"{stem}{ext}" for ext in (".opj", ".opju")
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
            nl = int(ltn("page.nlayers"))
            layers = []
            for li in range(1, nl + 1):
                lt(f"page.active = {li};")
                layers.append({
                    "layer": li,
                    "left": ltn("layer.left"),
                    "top": ltn("layer.top"),
                    "width": ltn("layer.width"),
                    "height": ltn("layer.height"),
                    "unit": ltn("layer.unit"),
                })
            out[g] = {
                "page_width": ltn("page.width"),
                "page_height": ltn("page.height"),
                "page_unit": ltn("page.unit"),
                "layers": layers,
            }
        outdir = GT / stem
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "layer_geometry.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
        print(f"{stem}: {len(out)} graphs -> layer_geometry.json")
        app.NewProject()

    app.Exit()
    print("done.")


if __name__ == "__main__":
    main()
