"""Enable ``python -m quantized`` → runs the ``qz`` CLI.

The Tauri desktop shell's dev fallback spawns the server as
``python -m quantized --no-browser`` (so ``kill()`` reaches uvicorn directly,
not an orphaned launcher). Keeping this module trivial means the entry point
stays stable regardless of how ``cli.main`` evolves.
"""

from __future__ import annotations

from quantized.cli import main

if __name__ == "__main__":
    main()
