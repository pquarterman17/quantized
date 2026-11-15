"""Install hints must name the real PyPI distribution, ``quantized-lab``.

The bare name ``quantized`` on PyPI belongs to an unrelated, abandoned
2019-era alpha (see RELEASE.md, "Distribution name"). A user who follows a
``pip install quantized[desktop]`` hint from an error message installs that
third-party package instead of ours. Every hint was fixed before the 0.35
release; this guard keeps a new one from reappearing in code, error
messages, generated scripts, docs, tooling or CI.

Only a package ARGUMENT of an install command counts, so code such as
``x = quantized[0]`` or prose that merely mentions the package never fires.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# An install command: pip / pip3 / python -m pip / uv pip / uv tool / pipx /
# conda / mamba ... install, or uv / poetry add. Its arguments run to the end
# of the line or the first shell separator / closing code span.
_INSTALL = re.compile(
    r"\b(?:(?:python3?\s+-m\s+)?pip3?|uv\s+pip|uv\s+tool|pipx|conda|mamba|micromamba)\s+install\b"
    r"|\b(?:uv|poetry)\s+add\b"
)
_ARGS_END = re.compile(r"&&|\|\||[;|`)]")
# A package argument naming the bare distribution: quoted or not, with or
# without extras / a version specifier; `quantized-lab`, `quantized_x` and a
# path like `./quantized` do not match.
_BARE = re.compile(r"""^["']?quantized(?:\[[^\]]*\])?(?:[=<>~!].*)?["']?$""")

_SCAN_DIRS = (
    "src",
    "docs",
    "tools",
    "frontend/src",
    "frontend/e2e",
    "frontend/scripts",
    ".github",
    "src-tauri",
)
_SCAN_FILES = ("README.md", "RELEASE.md", "CHANGELOG.md", "CONTRIBUTING.md", "pyproject.toml")
_SUFFIXES = {
    ".py", ".md", ".ts", ".tsx", ".js", ".mjs", ".json", ".toml", ".txt", ".rst", ".html",
    ".yml", ".yaml", ".sh", ".ps1", ".bat", ".cmd", ".nsh", ".rs", ".cfg", ".ini", ".spec",
}  # fmt: skip
# The built SPA (a copy of frontend/src) and vendored trees.
_EXCLUDE_PREFIXES = ("src/quantized/web/", "src-tauri/target/")


def _files() -> list[Path]:
    out = [ROOT / f for f in _SCAN_FILES if (ROOT / f).is_file()]
    for d in _SCAN_DIRS:
        base = ROOT / d
        if not base.is_dir():
            continue
        for p in base.rglob("*"):
            rel = p.relative_to(ROOT).as_posix()
            if (
                p.is_file()
                and p.suffix in _SUFFIXES
                and "node_modules" not in p.parts
                and "__pycache__" not in p.parts
                and not rel.startswith(_EXCLUDE_PREFIXES)
            ):
                out.append(p)
    return out


def _offenders(line: str) -> list[str]:
    found = []
    for m in _INSTALL.finditer(line):
        rest = line[m.end() :]
        end = _ARGS_END.search(rest)
        args = rest[: end.start()] if end else rest
        for tok in args.split():
            if _BARE.match(tok.rstrip(".,")):
                found.append(f"{m.group(0)} ... {tok}")
    return found


def test_distribution_name_is_quantized_lab() -> None:
    """The guard below is only right while this is the published name."""
    data = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert data["project"]["name"] == "quantized-lab"


BAD = [
    "pip install quantized[desktop]",
    "--desktop needs pywebview: pip install quantized",
    "pip install -i https://test.pypi.org/simple/ quantized",
    "pipx install quantized",
    "pip3 install quantized",
    "python -m pip install --user quantized",
    "pip install --upgrade quantized",
    "pip install numpy quantized",
    "pip install 'quantized'",
    'pip install "quantized[stats]"',
    "pip install quantized==0.35",
    "uv add quantized",
    "uv tool install quantized",
    "conda install -c conda-forge quantized",
    "run `pip install quantized[office]` first",
]
GOOD = [
    "pip install quantized-lab[desktop]",
    "pip install -i https://test.pypi.org/simple/ quantized-lab",
    "uv tool install quantized-lab",
    "uv add 'quantized-lab[bumps]'",
    "pip install quantized-acme-reader",
    "exactly like anything you `pip install`. quantized does",
    "import quantized.api as qz",
    "x = quantized[0]",
    "const g = quantized[graph];",
    "pip install numpy && python -c 'import quantized'",
    "optional (``quantized[office]``)",
]


def test_patterns_catch_the_wrong_hint_and_pass_the_right_one() -> None:
    assert [s for s in BAD if not _offenders(s)] == []
    assert [s for s in GOOD if _offenders(s)] == []


def test_the_scan_covers_tooling_and_ci_but_not_the_built_spa() -> None:
    rels = {p.relative_to(ROOT).as_posix() for p in _files()}
    assert any(r.startswith("tools/") for r in rels)
    assert any(r.startswith("docs/") for r in rels)
    assert any(r.startswith(".github/") for r in rels)
    assert not any(r.startswith("src/quantized/web/") for r in rels)


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
