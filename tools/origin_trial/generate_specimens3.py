"""Third-wave specimens (2026-07-04, licensed Origin): curve-binding recall,
real-form axis records, and a fit report sheet.

* ``curves_multi.opju``  — ONE graph, THREE curves from one book (B,C,D vs A):
  isolates multi-curve token runs (item 35 recall).
* ``curves_2books.opju`` — one graph, curves from TWO books: pins the token's
  book/ordinal base (y_ord is cumulative across books).
* ``curves_grouped.opju``— one plotxy call with a grouped range (1,2):(1,4):
  grouped plots may encode differently than repeated adds.
* ``axis_custom.opju``   — custom axis from/to + log X on a plain scatter:
  does a NON-default axis dialog produce the real-corpus record form?
* ``fitreport.opju``     — FitLinear on known data with a report sheet
  (``cell://`` reference columns — the item-4 residue family), if the
  X-Function runs headless.

COM rules: ONE instance, tiny projects (student page limit), never
concurrent with another COM tool. Run:
    uv run python tools/origin_trial/generate_specimens3.py
"""

from __future__ import annotations

import os

from pathlib import Path

import win32com.client as wc

CORPUS = Path(os.environ.get("QZ_TEST_DATA_ROOT") or (Path(__file__).resolve().parents[3] / "test-data")) / "origin"
SPEC = CORPUS / "specimens"

X = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
B = [111.125, 222.25, 333.375, 444.5, 555.625, 666.75, 777.875, 888.0]
C = [0.5, 1.5, 4.5, 13.5, 40.5, 121.5, 364.5, 1093.5]
D = [8.0, 6.5, 5.0, 3.5, 2.0, 0.5, -1.0, -2.5]


def main() -> None:
    SPEC.mkdir(exist_ok=True)
    app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
    app.Visible = 0

    def lt(cmd: str) -> bool:
        ok = bool(app.Execute(cmd))
        if not ok:
            print(f"  LT FAIL: {cmd}")
        return ok

    def save(path: Path) -> None:
        ok = app.Save(str(path))
        print(f"  {'saved' if ok else 'SAVE FAIL'}: {path.name}")

    def put_book(book: str, cols: list[list[float]]) -> None:
        rows = [list(r) for r in zip(*cols, strict=True)]
        app.PutWorksheet(f"[{book}]1", rows, 0, 0)

    print("== curves_multi (3 curves, one book) ==")
    app.NewProject()
    lt("newbook name:=MBook option:=lsname;")
    put_book("MBook", [X, B, C, D])
    lt("plotxy iy:=[MBook]1!(1,2) plot:=201;")
    lt("plotxy iy:=[MBook]1!(1,3) plot:=201 ogl:=1!;")  # add to layer 1
    lt("plotxy iy:=[MBook]1!(1,4) plot:=201 ogl:=1!;")
    save(SPEC / "curves_multi.opju")

    print("== curves_2books (curves from two books in one graph) ==")
    app.NewProject()
    lt("newbook name:=BookOne option:=lsname;")
    put_book("BookOne", [X, B])
    lt("newbook name:=BookTwo option:=lsname;")
    put_book("BookTwo", [X, C, D])
    lt("plotxy iy:=[BookOne]1!(1,2) plot:=201;")
    lt("plotxy iy:=[BookTwo]1!(1,3) plot:=201 ogl:=1!;")  # BookTwo col D
    save(SPEC / "curves_2books.opju")

    print("== curves_grouped (one grouped plotxy range) ==")
    app.NewProject()
    lt("newbook name:=GBook option:=lsname;")
    put_book("GBook", [X, B, C, D])
    lt("plotxy iy:=[GBook]1!(1,2):(1,4) plot:=201;")
    save(SPEC / "curves_grouped.opju")

    print("== axis_custom (non-default axis dialog: custom range + log X) ==")
    app.NewProject()
    lt("newbook name:=ABook option:=lsname;")
    put_book("ABook", [X, B])
    lt("plotxy iy:=[ABook]1!(1,2) plot:=201;")
    lt("layer.x.from = 0.2; layer.x.to = 20; layer.x.type = 2;")
    lt("layer.y.from = 50; layer.y.to = 2000; doc -uw;")
    save(SPEC / "axis_custom.opju")

    print("== fitreport (FitLinear report sheet with cell:// refs) ==")
    app.NewProject()
    lt("newbook name:=FitBook option:=lsname;")
    put_book("FitBook", [X, D])  # clean linear-ish data
    ok = lt("fitlr iy:=[FitBook]1!(1,2);")
    if not ok:
        ok = lt('nlbegin iy:=[FitBook]1!(1,2) func:=line; nlfit; nlend autoupdate:=au_off output:=1;')
    print(f"  fit ran: {ok}")
    save(SPEC / "fitreport.opju")

    app.NewProject()
    print("done.")


if __name__ == "__main__":
    main()
