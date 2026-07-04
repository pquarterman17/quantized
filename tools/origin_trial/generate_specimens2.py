"""Second-wave specimens (licensed-Origin window, 2026-07-04).

Two gaps the first wave couldn't cover:

* ``notes_probe.opju`` — a Notes window with KNOWN text (+ a small known
  worksheet), so a notes-window scraper can be validated honestly
  (plan item 6, notes half). Truth in ``notes_probe_truth.json``.
* ``fig_logx.opju`` / ``fig_linx.opju`` — a single-variable diff pair for the
  X-axis lin→log flag (the first wave only toggled Y; items 14/33 fall back
  to a decade heuristic for X). Same graph, only ``layer.x.type`` differs.
* ``fig_xylog.opju`` — BOTH axes log. Disambiguates the combined scale byte:
  it is ``0x0d`` here just as for Y-log-only, proving the byte does NOT encode
  X once Y is log (so X-log is only recoverable in the Y-linear ``0x04`` case).

COM rules as ever: ONE Origin.ApplicationSI instance, never concurrent with
another COM tool; page-limited student editions handle these tiny projects.

Run:  uv run python tools/origin_trial/generate_specimens2.py
"""

from __future__ import annotations

import json
from pathlib import Path

import win32com.client as wc

CORPUS = Path(r"C:\Users\patri\OneDrive\Coding\git\test-data\origin")
SPEC = CORPUS / "specimens"

X = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
Y = [111.125, 222.25, 333.375, 444.5, 555.625, 666.75, 777.875, 888.0]

NOTE_TEXT = "QZNOTE line one: sample MnN 30nm\nQZNOTE line two: field sweep at 300K"


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

    print("== notes_probe (Notes window with known text) ==")
    app.NewProject()
    lt("newbook name:=NBook option:=lsname;")
    put_book("NBook", [X, Y])
    lt("window -n n NProbe;")
    # Notes text via the `note` object of the active notes window; try the
    # known variants (LabTalk surface differs across versions).
    line1, line2 = NOTE_TEXT.split("\n")
    ok = lt(f'note.text$ = "{line1}";') and lt(f'note.text$ = note.text$ + "%(CRLF)" + "{line2}";')
    if not ok:
        ok = lt(f'win -o NProbe {{note.text$ = "{line1}"}};')
    print(f"  notes text set: {ok}")
    save(SPEC / "notes_probe.opju")
    (SPEC / "notes_probe_truth.json").write_text(
        json.dumps({"window": "NProbe", "text": NOTE_TEXT.split("\n")}, indent=1),
        encoding="utf-8",
    )

    print("== fig_linx / fig_logx (single-variable: layer.x.type) ==")
    app.NewProject()
    lt("newbook name:=GBook option:=lsname;")
    put_book("GBook", [X, Y])
    lt("plotxy iy:=[GBook]1!(1,2) plot:=201;")
    lt("layer.x.type = 1; layer.y.type = 1; doc -uw;")
    save(SPEC / "fig_linx.opju")
    lt("layer.x.type = 2; layer.y.type = 1; doc -uw;")
    save(SPEC / "fig_logx.opju")
    lt("layer.x.type = 2; layer.y.type = 2; doc -uw;")  # BOTH log
    save(SPEC / "fig_xylog.opju")

    app.NewProject()
    print("done.")


if __name__ == "__main__":
    main()
