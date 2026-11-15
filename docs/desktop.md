# Desktop window (`qz --desktop`)

`uv run qz --desktop` (or `pip install quantized-lab[desktop]` then
`qz --desktop`) opens the app in a native pywebview window instead of a
browser tab. Everything works the same as in a browser tab, plus native file
dialogs and real source paths for re-import.

## Vector "Copy figure" into Word and PowerPoint (Windows, opt-in)

In a browser, **Copy figure** puts a 300-DPI PNG on the clipboard, plus an SVG
where the browser accepts one. The success message always says which one went
("as vector (SVG) + PNG" or "as a 300-DPI PNG (not vector)").

On Windows the desktop window can instead write the clipboard natively, like
Origin's *Copy Page*. It puts three formats on the clipboard in one go:

- the figure as SVG with every glyph as an outline (the registered
  `image/svg+xml` format; Microsoft 365 Word and PowerPoint paste it as a
  scalable, ungroupable graphic);
- the 300-DPI PNG (`PNG`), which older Office pastes instead;
- a bitmap (`CF_DIB`) for apps that read neither.

There is no EMF: no permissively licensed EMF writer exists, so Office 2016
and older paste the PNG. Both renders come from the same renderer as
**File ▸ Export**, so the paste matches an export.

This path is **off by default** until it has been checked on real Windows +
Office. To turn it on:

1. Install the desktop extra on Windows (`pip install quantized-lab[desktop]`
   brings pywin32 with it).
2. Set `QZ_WIN_CLIPBOARD=1` before launching, e.g. in PowerShell:
   `$env:QZ_WIN_CLIPBOARD = "1"; qz --desktop`.

The setting is read when the window opens. Without it (or on macOS/Linux) the
desktop window uses the browser clipboard path described above.

**Only the pywebview window (`qz --desktop`) has this path, not the installed
Windows app.** The native clipboard is a method on pywebview's Python bridge
(`desktop_bridge_clipboard.py`), which the page reaches as `window.pywebview`.
The Tauri installer (`Quantized_x64-setup.exe`) runs the same page in a Tauri
window over a PyInstaller sidecar: there is no pywebview bridge in that
window, and the sidecar is built with `uv sync --group bundle` and no
`desktop` extra (`.github/workflows/release.yml`), so pywin32 is not in it
either. In the installed app, Copy figure uses the browser clipboard path,
whatever `QZ_WIN_CLIPBOARD` says.

### Smoke test (owner, once, before making it default-on)

With the flag set, open a dataset, right-click the plot and choose
**Copy figure**; the message must read "copied … as vector (SVG) + PNG".
Paste into Microsoft 365 PowerPoint: the figure must arrive as a graphic that
stays sharp at 400 % zoom and offers *Graphics Format ▸ Convert to Shape*.
Paste into Word: same. Paste into Paint: a bitmap appears at the right size.
Then repeat **Copy figure (vector)** on a statistics plot. Finally copy while
another program holds the clipboard open (e.g. a clipboard manager mid-paste)
and confirm a "copy failed: …" message rather than silence. Record the Office
build and the result in `plans/FUTURE_SCOPE.md` under the vector-clipboard
item.
