"""Regression guard for the startup-import deferrals in ``io/registry.py``
(``openpyxl``) and ``calc/sld_formula.py`` (``periodictable``).

``create_app()`` runs at every ``qz`` launch, so an optional-feature import
creeping back to module scope there would cost every user's startup time
whether or not they touch that feature. Runs in a subprocess so it observes
a genuinely fresh ``sys.modules``, independent of whatever this test process
(or pytest-xdist's worker, or an earlier test in the same session) already
imported.
"""

from __future__ import annotations

import subprocess
import sys


def test_create_app_does_not_import_optional_heavy_modules() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys\n"
            "from quantized.app import create_app\n"
            "create_app()\n"
            "print(sorted(m for m in "
            "('openpyxl', 'periodictable', 'matplotlib', 'pywebview') "
            "if m in sys.modules))",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "[]", result.stdout + result.stderr
