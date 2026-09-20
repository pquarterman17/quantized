"""Fail a release build when its git tag disagrees with the package version."""

from __future__ import annotations

import argparse
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def package_version() -> str:
    """Return the canonical version declared by the Python package."""
    data = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    return str(data["project"]["version"])


def validate_release_tag(tag: str, version: str) -> None:
    """Require a ``vX.Y.Z`` tag whose suffix exactly matches *version*."""
    expected = f"v{version}"
    if tag != expected:
        raise ValueError(
            f"release tag {tag!r} does not match package version {version!r}; "
            f"run `uv run python tools/bump_version.py {tag.removeprefix('v')}` "
            "and tag the resulting commit"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tag", help="release tag, for example v0.26.1")
    args = parser.parse_args()

    version = package_version()
    try:
        validate_release_tag(args.tag, version)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"release tag {args.tag} matches package version {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
