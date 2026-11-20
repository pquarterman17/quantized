"""Long-lived worker: reads ``{"id","path"}`` lines on stdin, answers on stdout.

The parent (runner.py) enforces the per-file timeout by killing and
restarting this process, so one pathological file costs one restart. Replies
carry an ``@@`` prefix so stray prints from the importer cannot corrupt them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    sys.path.insert(0, sys.argv[1])  # the source tree under test (<root>/src)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from origin_regress_lib.fingerprint import fingerprint_file

    for line in sys.stdin:
        req = json.loads(line)
        fp = fingerprint_file(Path(req["path"]))
        sys.stdout.write("@@" + json.dumps({"id": req["id"], "fp": fp}) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
