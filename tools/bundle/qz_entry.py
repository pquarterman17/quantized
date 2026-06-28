"""PyInstaller entry point for the self-contained server sidecar.

Equivalent to ``python -m quantized`` — kept as a separate script so the spec
has a stable target and the package itself stays untouched. The Tauri shell
spawns the frozen ``qz-server`` with ``--no-browser`` (the shell window *is*
the browser); auto-shutdown stays off (the shell kills the sidecar on close).
"""

from quantized.cli import main

if __name__ == "__main__":
    main()
