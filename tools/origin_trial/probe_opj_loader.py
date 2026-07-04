"""Item-34 loader-RE probe kit: does real Origin load a crafted `.opj`?

Builds variant files from the local corpus (Moke.opj + SLD_DoubleY.otp) and
loads each through one COM instance, printing ``RESULT <name> load= books=``
lines. The probe matrix, derived loader model, and decoded tail grammar live
in ``docs/origin_re/validation_log.md`` (2026-07-04 entry) — read that first.

Usage (one COM script at a time; taskkill Origin64.exe if a variant hangs a
modal in the invisible instance):

    uv run python tools/origin_trial/probe_opj_loader.py build
    uv run python tools/origin_trial/probe_opj_loader.py run P1_moke_copy.opj ...

Variants land in ``../test-data/origin/probes/`` (local corpus — never
pushed). ``build`` re-creates the informative subset of the 2026-07-04
matrix; extend ``build_variants`` for the next iteration (window-section
boundary re-cut — see the validation log's "Open blocker").
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

CORPUS = Path(r"C:\Users\patri\OneDrive\Coding\git\test-data\origin")
PROBES = CORPUS / "probes"
MOKE_TRAILER = 645420  # Parameters-section start in Moke.opj (v4.3380)
OTP_TAIL = 90422  # global-storage epilogue start in SLD_DoubleY.otp
FH_SIZE_FIELD = 22 + 5 + 115  # u32 file-size field inside the 123B fh block


def _blk(payload: bytes) -> bytes:
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


_NULL = b"\x00\x00\x00\x00\n"


def _fix_size(data: bytes) -> bytes:
    out = bytearray(data)
    struct.pack_into("<I", out, FH_SIZE_FIELD, len(out))
    return bytes(out)


def synth_tail(moke_tail: bytes, otp_tail: bytes, *, project: bytes, n_windows: int) -> bytes:
    """The minimal synthesized post-stream tail (PS1/PR2 recipe, unproven —
    blocked on the stream-side books=0 issue; see the validation log)."""
    t = moke_tail
    out = bytearray()
    out += t[:58]  # params + 00 0a terminator
    out += _NULL + _blk(t[68:156]) + _NULL  # project record + empty note list
    out += _blk(struct.pack("<I", 0x46C)) + _blk(t[1969:1985]) + _blk(t[1991:2023])
    out += _NULL + _blk(project + b"\x00")
    out += struct.pack("<I", 2) + b"\n"  # bare value fragment (not a size)
    out += _blk(t[2050:2086]) + _blk(t[2092:2187])  # 47/4D 11 11 11 records
    out += _blk(struct.pack("<I", 0)) + _blk(struct.pack("<I", 0))  # scalar, 0 subfolders
    out += _blk(struct.pack("<I", n_windows))
    for i in range(n_windows):
        out += _NULL + _blk(struct.pack("<II", 0, i)) + _NULL
    out += otp_tail  # global-storage epilogue + terminating nulls
    return bytes(out)


def build_variants() -> None:
    PROBES.mkdir(exist_ok=True)
    moke = (CORPUS / "Moke.opj").read_bytes()
    otp = (CORPUS / "SLD_DoubleY.otp").read_bytes()
    (PROBES / "P1_moke_copy.opj").write_bytes(moke)
    (PROBES / "P2_moke_no_trailer.opj").write_bytes(moke[:MOKE_TRAILER])
    (PROBES / "PT2_minus_last_byte.opj").write_bytes(moke[:-1])
    tail = synth_tail(moke[MOKE_TRAILER:], otp[OTP_TAIL:], project=b"Moke", n_windows=1)
    (PROBES / "PS_tail_only_demo.bin").write_bytes(tail)
    print(f"variants in {PROBES}")


def run(names: list[str]) -> None:
    import win32com.client as wc

    app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
    app.Visible = 0
    for name in names:
        print(f"PROBE {name} ...", flush=True)
        try:
            ok = bool(app.Load(str(PROBES / name)))
        except Exception as exc:
            print(f"RESULT {name} EXCEPTION {exc}", flush=True)
            continue
        nb = -1
        try:
            app.Execute("double __nw = 0;")
            app.Execute("doc -e W { __nw = __nw + 1; }")
            nb = int(app.LTVar("__nw"))
        except Exception:
            pass
        print(f"RESULT {name} load={ok} books={nb}", flush=True)
        try:
            app.NewProject()
        except Exception:
            pass
    print("ALL DONE", flush=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "build":
        build_variants()
    elif len(sys.argv) > 1 and sys.argv[1] == "run":
        run(sys.argv[2:])
    else:
        print(__doc__)
