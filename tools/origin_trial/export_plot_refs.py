"""Export per-plot dataset references — the item-35 curve-binding oracle.

`export_ground_truth.py`'s per-plot dump came back empty for every project:
`range __rp = {pi}` (a COLUMN-range form) does not bind data plots, and
`layer.nplots` is not a live property on this Origin's LabTalk. The working
recipe (found by live probing, 2026-07-04):

    win -a <graph>; page.active = <li>;
    range -w __rw = <pi>;        # -w = plot range in the active layer
    ref$ = "%(__rw)";            # full [Book]"Sheet"!Col"LongName" reference

Plots are enumerated by probing ``pi`` upward until the substitution stops
yielding a fresh, non-``###`` reference (there is no working plot-count
property). Writes ``specimens/ground_truth/<stem>/plots.json``::

    {"<graph>": {"<layer>": ["<ref>", ...]}}

Skips sparkline windows and stems whose plots.json already exists (delete to
re-run). Page-limited student license: only the small stems are listed.

Run:  uv run python tools/origin_trial/export_plot_refs.py
"""

from __future__ import annotations

import json
from pathlib import Path

import win32com.client as wc

CORPUS = Path(r"C:\Users\patri\OneDrive\Coding\git\test-data\origin")
GT = CORPUS / "specimens" / "ground_truth"
STEMS = [
    "XAS",
    "RockingCurve",
    "UnpolPlots",
    "Fixed Lambdas SI",
    "specimens/fig_pairs",
    "specimens/fig_lin",
    "specimens/fig_log",
    "specimens/fig_linx",
    "specimens/fig_logx",
    "specimens/fig_xylog",
]
MAX_PLOTS = 40  # probe ceiling per layer


def main() -> None:
    app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
    app.Visible = 0

    def lt(cmd: str) -> bool:
        return bool(app.Execute(cmd))

    def lts(expr: str) -> str:
        lt('string __s$ = "";')
        lt(f"__s$ = {expr};")
        return str(app.LTStr("__s$"))

    def ltn(expr: str) -> float:
        lt("double __d = 0;")
        lt(f"__d = {expr};")
        return float(app.LTVar("__d"))

    for stem in STEMS:
        src = CORPUS / f"{stem}.opju"
        outdir = GT / Path(stem).name
        out = outdir / "plots.json"
        if out.exists():
            print(f"== {stem} == plots.json exists, skipping")
            continue
        if not src.exists():
            print(f"== {stem} == source missing, skipping")
            continue
        print(f"== {stem} ==")
        if not app.Load(str(src)):
            print("  LOAD FAIL")
            continue
        lt('string __acc$ = "";')
        lt('doc -e P { __acc$ = "%(__acc$)%H|"; }')
        graphs = [g for g in str(app.LTStr("__acc$")).split("|") if g]
        result: dict[str, dict[str, list[str]]] = {}
        for g in graphs:
            if g.startswith("sparkline"):
                continue
            lt(f"win -a {g}; doc -uw;")
            layers: dict[str, list[str]] = {}
            for li in range(1, int(ltn("page.nlayers")) + 1):
                lt(f"page.active = {li};")
                refs: list[str] = []
                for pi in range(1, MAX_PLOTS + 1):
                    lt(f"range -w __rw = {pi};")
                    ref = lts('"%(__rw)"')
                    if not ref or "###" in ref or (refs and ref == refs[-1]):
                        break
                    refs.append(ref)
                layers[str(li)] = refs
            result[g] = layers
        outdir.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=1), encoding="utf-8")
        n = sum(len(r) for ls in result.values() for r in ls.values())
        print(f"  {len(result)} graphs, {n} plot refs -> {out.name}")
    app.NewProject()
    print("done.")


if __name__ == "__main__":
    main()
