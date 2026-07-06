"""Capture the CURVE-STYLE oracle (color / line-width / symbol) via Origin COM.

The figure decoders resolve which columns a curve plots and whether it's a
line or a scatter, but NOT its visual style: color, line width, symbol shape
and size are undecoded (`.opj`) or 1-bit (`.opju` line-vs-scatter only). That
is the single biggest visible gap between a "restored" figure and one that
matches Origin. This script captures Origin's own per-curve style so a decode
of the style bytes can be VERIFIED rather than guessed.

For every graph -> layer -> data plot it records, keyed by the plot's own
`[Book]Sheet!Col` dataset reference (so style ties to the same (book, column)
the curve-binding decoder resolves):

    {"plot", "ref", "color", "color_rgb", "line_width", "line_color",
     "line_connect", "symbol_kind", "symbol_size"}

`color` is Origin's raw ocolor int; `color_rgb` is the low-24-bit `#RRGGBB`
decode when the high (type) byte marks a direct RGB (type 1) — recorded so
the verifier can compare either form. Plot enumeration is sentinel-based: a
read of `layer.plotN.color` that leaves the LabTalk var at the sentinel means
plot N does not exist (LabTalk has no reliable `nplots` on all versions).

Written to `specimens/ground_truth/<stem>/curve_style.json` (separate file;
a failed capture can't corrupt the graph/annotation oracles). Same student/
eval COM page-limit caveat as every other COM oracle: authoritative for the
plots it lists, not a completeness measure.

Run (Windows, Origin installed):
    .venv/Scripts/python.exe tools/origin_trial/export_curve_style_oracle.py
"""
from __future__ import annotations

import json
from pathlib import Path

import win32com.client as wc

CORPUS = Path(r"C:\Users\patri\OneDrive\Coding\git\test-data\origin")
GT = CORPUS / "specimens" / "ground_truth"
FILES = [
    "hc2convert.opj",
    "Hc2 data.opju",
    "RockingCurve.opju",
    "UnpolPlots.opju",
    # style-decode specimens (auto/increment colour work, 2026-07-06)
    "specimens/style_group.opju",
    "specimens/style_ungrouped.opju",
    "specimens/style_mixed.opju",
    "specimens/curves_grouped.opju",
]
MAX_PLOTS = 60
_SENTINEL = -987654.0


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
        lt(f"double __d = {_SENTINEL};")
        lt(f"__d = {expr};")
        return float(app.LTVar("__d"))

    def color_rgb(ocolor: float) -> str | None:
        # Origin ocolor: high byte is the color type; type 1 = direct RGB in the
        # low 24 bits (0xTT_RRGGBB or 0xTT_BBGGRR -- both decoded, verifier picks).
        if ocolor == _SENTINEL or ocolor != ocolor:
            return None
        v = int(ocolor)
        if (v >> 24) != 1:
            return None  # palette index / auto -- not a direct RGB
        low = v & 0xFFFFFF
        r, g, b = low & 0xFF, (low >> 8) & 0xFF, (low >> 16) & 0xFF
        return f"#{r:02X}{g:02X}{b:02X}"

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
        out: dict[str, list[dict[str, object]]] = {}
        n_plots = 0
        for g in graphs:
            lt(f"win -a {g};")
            nl = int(ltn("page.nlayers"))
            plots: list[dict[str, object]] = []
            for li in range(1, nl + 1):
                lt(f"page.active = {li};")
                for pi in range(1, MAX_PLOTS + 1):
                    color = ltn(f"layer.plot{pi}.color")
                    if color == _SENTINEL:
                        break  # plot pi does not exist on this layer
                    lt(f"range -w __rp = {pi};")
                    plots.append({
                        "layer": li,
                        "plot": pi,
                        "ref": lts('"%(__rp)"'),
                        "color": color,
                        "color_rgb": color_rgb(color),
                        "line_width": ltn(f"layer.plot{pi}.line.width"),
                        "line_color": ltn(f"layer.plot{pi}.line.color"),
                        "line_connect": ltn(f"layer.plot{pi}.line.connect"),
                        "symbol_kind": ltn(f"layer.plot{pi}.symbol.kind"),
                        "symbol_size": ltn(f"layer.plot{pi}.symbol.size"),
                    })
                    n_plots += 1
            if plots:
                out[g] = plots
        stem = Path(f).stem
        outdir = GT / stem
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "curve_style.json").write_text(
            json.dumps(out, indent=1, default=str), encoding="utf-8"
        )
        print(f"{f}: {len(out)} graphs, {n_plots} plots -> {outdir / 'curve_style.json'}")
        app.NewProject()

    app.Exit()
    print("done.")


if __name__ == "__main__":
    main()
