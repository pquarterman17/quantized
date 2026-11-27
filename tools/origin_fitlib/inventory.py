"""Dev-time inventory of Origin's built-in fit functions against quantized's registry.

Reads a LOCAL Origin install (never started, never copied): the ``FitFunc``
folder's ``NLSF.CNF`` (category -> definition-file list) and each ``*.FDF``
header (function name, parameter names, independent-variable count, form).
Prints one markdown table row per function: category, Origin name, parameters,
and whether the registry has it (exact name, or missing).

Nothing from the definition files is stored here; the output is a working
list for the porter, not something to commit verbatim.

    uv run python tools/origin_fitlib/inventory.py [FitFunc dir] [--missing]
"""

from __future__ import annotations

import sys
from pathlib import Path

from quantized.calc.fit_models import FIT_MODELS

DEFAULT_DIRS = (
    r"C:\Program Files\OriginLab\Origin2026b\FitFunc",
    "/Applications/Origin/FitFunc",
)
# Registry names that differ from Origin's (Origin name -> registry name).
RENAMED = {"Logistic": "Logistic (Origin)", "Boltzman": "Boltzmann", "Poly5": "Poly5"}


def _read_ini(path: Path) -> dict[str, dict[str, str]]:
    """Tolerant INI read: script bodies in the definition files are not key=value."""
    out: dict[str, dict[str, str]] = {}
    cur: dict[str, str] = {}
    for line in path.read_text(encoding="latin-1").splitlines():
        s = line.strip()
        if s.startswith("[") and s.endswith("]"):
            cur = out.setdefault(s[1:-1].lower(), {})
        elif "=" in s and not s.startswith((";", "//")):
            k, v = s.split("=", 1)
            cur.setdefault(k.strip(), v.split(";")[0].split("	")[0].strip())
    return out


def categories(root: Path) -> dict[str, list[str]]:
    """definition-file stem (lower) -> categories listing it."""
    cnf = _read_ini(root / "NLSF.CNF")
    skip = {"nlsf control", "category"}
    out: dict[str, list[str]] = {}
    for sec, items in cnf.items():
        if sec in skip:
            continue
        for stem in items.values():
            out.setdefault(stem.strip().lower(), []).append(sec)
    return out


def header(path: Path) -> dict[str, str]:
    sec = _read_ini(path)
    gi = sec.get("general information", {})
    fp = sec.get("fitting parameters", {})
    return {"name": gi.get("Function Name", path.stem), "nx": gi.get("Number Of Independent Variables", "1"),
            "form": gi.get("Function Form", ""), "params": fp.get("Names", "")}


def main(argv: list[str]) -> int:
    root = next((Path(a) for a in argv if not a.startswith("--")), None)
    root = root or next((Path(d) for d in DEFAULT_DIRS if Path(d).is_dir()), None)
    if root is None:
        print("no Origin FitFunc folder found; pass it as an argument")
        return 1
    cats = categories(root)
    rows = []
    for f in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if f.suffix.lower() != ".fdf":
            continue
        h = header(f)
        have = h["name"] in FIT_MODELS or RENAMED.get(h["name"], "") in FIT_MODELS
        rows.append((", ".join(cats.get(f.stem.lower(), ["(none)"])), h["name"], h["nx"], h["form"],
                     h["params"], "yes" if have else "MISSING"))
    only_missing = "--missing" in argv
    for r in sorted(rows):
        if only_missing and r[-1] != "MISSING":
            continue
        print(" | ".join(r))
    print(f"# {len(rows)} functions, {sum(r[-1] == 'MISSING' for r in rows)} missing", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
