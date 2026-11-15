"""Install hints must name the real PyPI distribution, ``quantized-lab``.

The bare name ``quantized`` on PyPI belongs to an unrelated, abandoned
2019-era alpha (see RELEASE.md, "Distribution name"). A user who follows a
``pip install quantized[desktop]`` hint from an error message installs that
third-party package instead of ours. Every hint was fixed before the 0.35
release; this guard keeps a new one from reappearing in code, error
messages, generated scripts or docs.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# `pip install quantized`, `pipx install quantized`, `uv tool install
# quantized`, with any flags (e.g. `-i <index-url>`) between, where the name
# is NOT followed by `-` or a word character (so `quantized-lab` passes).
_INSTALL_BARE = re.compile(
    r"\b(?:pip|pipx|uv\s+pip|uv\s+tool)\s+install\s+"
    r"(?:-{1,2}[\w-]+(?:[ =]\S+)?\s+)*"
    r"quantized(?![-\w])"
)
# An extras spec on the bare name anywhere (`quantized[desktop]`), e.g. in
# "optional (``quantized[office]``)" prose with no `pip install` before it.
_EXTRA_BARE = re.compile(r"(?<![-\w/.])quantized\[")

_SCAN_DIRS = ("src", "docs", "frontend/src")
_SCAN_FILES = ("README.md", "RELEASE.md", "pyproject.toml", "CHANGELOG.md")
_SUFFIXES = {".py", ".md", ".ts", ".tsx", ".json", ".toml", ".txt", ".rst", ".html"}


def _files() -> list[Path]:
    out = [ROOT / f for f in _SCAN_FILES if (ROOT / f).is_file()]
    for d in _SCAN_DIRS:
        for p in (ROOT / d).rglob("*"):
            if (
                p.is_file()
                and p.suffix in _SUFFIXES
                and "node_modules" not in p.parts
                and "__pycache__" not in p.parts
                # src/quantized/web is the built SPA (a copy of frontend/src).
                and "web" not in p.relative_to(ROOT).parts[:3]
            ):
                out.append(p)
    return out


def _offenders(text: str) -> list[str]:
    return [m.group(0) for rx in (_INSTALL_BARE, _EXTRA_BARE) for m in rx.finditer(text)]


def test_distribution_name_is_quantized_lab() -> None:
    """The guard below is only right while this is the published name."""
    data = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert data["project"]["name"] == "quantized-lab"


def test_patterns_catch_the_wrong_hint_and_pass_the_right_one() -> None:
    bad = [
        "pip install quantized[desktop]",
        "--desktop needs pywebview: pip install quantized",
        "pip install -i https://test.pypi.org/simple/ quantized",
        "pipx install quantized",
        "optional (``quantized[office]``)",
    ]
    good = [
        "pip install quantized-lab[desktop]",
        "pip install -i https://test.pypi.org/simple/ quantized-lab",
        "uv tool install quantized-lab",
        "pip install quantized-acme-reader",
        "exactly like anything you `pip install`. quantized does",
        "import quantized.api as qz",
    ]
    assert all(_offenders(s) for s in bad), [s for s in bad if not _offenders(s)]
    assert not any(_offenders(s) for s in good), [s for s in good if _offenders(s)]


def test_no_install_hint_names_the_squatted_package() -> None:
    hits: list[str] = []
    for path in _files():
        text = path.read_text(encoding="utf-8", errors="replace")
        for lineno, line in enumerate(text.splitlines(), 1):
            for found in _offenders(line):
                hits.append(f"{path.relative_to(ROOT)}:{lineno}: {found!r}")
    assert not hits, (
        "Install hints must say `quantized-lab` (the bare `quantized` on PyPI "
        "is an unrelated project):\n" + "\n".join(hits)
    )
