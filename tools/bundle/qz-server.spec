# PyInstaller spec — self-contained quantized server sidecar.
# Build (from the repo root, frontend already built into src/quantized/web):
#   uv run pyinstaller tools/bundle/qz-server.spec --noconfirm
# Output: dist/qz-server/ (one-dir; ~300 MB — numpy/scipy BLAS + matplotlib).

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules  # noqa: F401

ROOT = Path(SPECPATH).resolve().parents[1]  # noqa: F821 — SPECPATH is injected

# cli.py launches uvicorn via the import STRING "quantized.app:app", which
# PyInstaller's static analysis can't follow — so app.py and every router /
# calc / io submodule must be force-collected, or the frozen sidecar boots
# straight into ModuleNotFoundError.
hidden = [
    # uvicorn's dynamically-imported workers / loops
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    # the *.auto dispatchers above import these concrete impls in a try/except;
    # pin them so the frozen build always has an HTTP + WebSocket transport
    # (the /api/ws lifecycle socket would silently fail otherwise).
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.websockets_sansio_impl",
]
hidden += collect_submodules("quantized")

a = Analysis(  # noqa: F821
    [str(ROOT / "tools" / "bundle" / "qz_entry.py")],
    pathex=[str(ROOT / "src")],
    datas=[
        # the built SPA, served by the sidecar at / (app.py looks for it at
        # Path(__file__).parent / "web", i.e. <bundle>/quantized/web)
        (str(ROOT / "src" / "quantized" / "web"), "quantized/web"),
    ],
    hiddenimports=hidden,
    excludes=[
        # dev/test-only heavyweights that must never ride along.
        # NOTE: matplotlib stays IN — quantized renders vector (PDF/SVG)
        # publication export server-side via the Agg backend (calc/figure.py).
        "pytest", "mypy", "ruff", "PyInstaller",
        "tkinter", "IPython",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    exclude_binaries=True,
    name="qz-server",
    console=True,   # logs visible when run standalone; the Tauri shell spawns
    icon=None,      # it CREATE_NO_WINDOW anyway
)

coll = COLLECT(  # noqa: F821
    exe,
    a.binaries,
    a.datas,
    name="qz-server",
)
