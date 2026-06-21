"""``qz`` CLI entry point (skeleton).

The full run model — serve API + built SPA, ``--desktop`` (pywebview),
``--dev`` (Vite HMR + reloading backend), auto-shutdown on last-tab-close —
lands in M1 #6. For now ``qz`` runs the bare API on :8000 for smoke-testing.
"""

from __future__ import annotations

import uvicorn


def main() -> None:
    """Run the API server (placeholder until the M1 #6 run model)."""
    uvicorn.run("quantized.app:app", host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
