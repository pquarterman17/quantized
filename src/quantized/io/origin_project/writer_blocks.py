"""Template blocks + tail builders for the native ``.opj`` writer (item 34).

Origin's ``.opj`` loader is two-phase (``docs/origin_re/validation_log.md``):
phase 1 parses the block stream sequentially and builds pages; phase 2
requires the post-stream tail to parse to the very last byte. The 2026-07-07
PN probe series pinned the full requirement set — a file loads in real
Origin iff it has:

1. the PR3 **stream grammar**: header line, 123-byte fh block, per column
   ``[NULL][147B column header][data block]``, ``NULL NULL``, per book a
   window section (window header + sheet sub-header + per-column property
   + label blocks), closed by ``NULL NULL NULL``;
2. a **tail**: params section, NULL + project record, a note list that
   CONTAINS a ``ResultsLog`` note (presence required, content free — PN4),
   NULL, the ``37 + len(tree)`` scalar, the constant 16-byte id blob, the
   folder tree, and a global-storage section of exactly 8 indexed records
   (content lax — empty slots + the three constant records suffice, PN1);
3. the **file-size u32 at fh offset 115**.

Everything else measured lax: storage-record content (even dialog XML
referencing windows the stream lacks — PN3), tree window ordinals, fh's
seven ``rand()``-like u32s.

The byte templates below were extracted once from the local ``Moke.opj``
corpus specimen and SANITIZED — every name / count / id field is zeroed
here and patched per write by the builders. Format facts are clean-room
(``docs/origin_project_format.md``); no GPL code consulted.
"""

from __future__ import annotations

import struct

__all__ = [
    "col_header",
    "fh_size_offset",
    "make_block",
    "make_null",
    "prop_block",
    "sheet_subheader",
    "tail",
    "window_header",
]


def make_block(payload: bytes) -> bytes:
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


def make_null() -> bytes:
    return struct.pack("<I", 0) + b"\n"


# --- sanitized templates (Moke.opj, CPYA 4.3380 / Origin 9.7) --------------

FH_123 = bytes.fromhex(
    "0200350bf5ff8b1623060000000059000000000000000001000000711aa20a7f662340000020"
    "0801000000ba6300003415000098200000e23f0000d47a000000280000254d00000000000000"
    "0000000000000000000000000000000000000000000000000000000000000000000000900000"
    "000000000000000000"
)

_COL_147 = bytes.fromhex(
    "00000100000000000000a00f010000000010000000002151030000000000000000a100000000"
    "0000000000f03f000000000000f03f00000000500000000a0000000000000000000000000000"
    "0000000000000000000000000000000000000000000000000000000000000000000000000000"
    "000003000000000000000000000000000000000000000000000000000000000000"
)

_WIN_197 = bytes.fromhex(
    "000000000000000000000000000000000000000000000000000000030018023e092d05800738"
    "040000000000000013001300500000000020000000000000050004000211114f524947494e00"
    "0000002c01460000640000580258020000000000000000000000000100130000000000c30000"
    "006cc116e19ac14241efeeeef49ac1424100000000c000000058025802ffffffff0000000011"
    "000000fcffffff00190000000000000000000000000000000000000000000000000000000000"
    "00000000000000"
)

_SHEET_365 = bytes.fromhex(
    "00005e00000000000000000000000000000000000000000000000000002840000000000000f0"
    "3f080000000c0040010000000000000000010000000000000000000000000000000039400000"
    "00000000f03f0000000006004001000000000000000001000010100001000000001600000081"
    "0070000709bf02000000000000000020284c80000005010107000000000000f03f0000000000"
    "0000000000000000000000001c00000312120000000080000000000000000000080000010000"
    "00000ad7a33d0ad7a33d11001c00000000005064536865657431000000000000000000000000"
    "00000000000000000000000000000000000000b80b00000200000000006003000012000000fc"
    "ffffff000000000000000000000000fcffffff00000000fcffffff0000000006000000000000"
    "000700000000000000000000007b14ae47e17ab43f0000000000000000000000000c00000000"
    "00000000000000000000000000000000000000ffff0100"
)

_PROP_519 = bytes.fromhex(
    "1000000000000b00000000a10000000000000000000000000000000000000000000000000021"
    "5100000000000000000000000001000000000020000000000000000000000000000000006500"
    "0000000000000000000000000000000000000000000000000000000000000000000000000000"
    "0000000000000000000000000000000000000000000000000000000000000000000000000000"
    "0000000000000000000000000000000000000000000000000000000000000000000000000000"
    "0000000000000000000000000000000000000000000000000000000000000000000000000000"
    "0000000000000000000000000000000000000000000000000000000000000000000000000000"
    "0000000000000000000000000000000000000000000000000000000000000000000000000000"
    "0000000000000000000000000000000000000000000000000000000000000000000000000000"
    "0000000000000000000000000000000000000000000000000000000000000000000000000000"
    "0000000000000000000000000000000000000000000000000000000000000000000000000000"
    "0000000000000000000000000000000000000000000000000000000000000000000000000000"
    "00000000000000000000000000000000f03f000000000000f03f4b1100000000000000000000"
    "00000000000000000000000000000000000000000000000000"
)

_PARAMS = bytes.fromhex(
    "494d474558500a00000000000000000a41584953545950450a00000000000000000a70616765"
    "5f6e6f636c69636b0a00000000000000000a000a"
)

_PROJREC_88 = bytes.fromhex(
    "0000000000000000000000000000000000000000000000000000000000000000571e907ac3c2"
    "4241571e907ac3c2424100000000000000000000000000000000000000000000000000000000"
    "000000000000000000000000"
)

_TREE_HDR32 = bytes.fromhex(
    "000000000000000000000000000000001cd232de9ac14241571e907ac3c24241"
)

_TREE_ATTRS = bytes.fromhex(
    "471111110100000000000000000000000000000000000000000000000000000000000000"
)

_TREE_FSTORAGE = bytes.fromhex(
    "4d11111101000000000000004300000040247b5b307c347c466f6c6465724c61737455736564"
    "7c33317c38343232313934395d7d3c4f726967696e53746f726167653e3c2f4f726967696e53"
    "746f726167653e000000000000000000000000"
)

# The __LayerInfoStorage record group (133B '#' header + 72B descriptor +
# 58B owned-storage marker), byte-identical across every corpus workbook.
# Origin's loader requires a window section to carry AT LEAST ONE
# ``133B/72B/content`` record group (PJ1 with none -> load refused; PK1 with
# only this one -> loads); this is the smallest invariant one.
_GRP_133 = bytes.fromhex(
    "0000230000000064006400000000000000000000000000000000000000000000000000480000"
    "000001013e003e00c2ffc2ff00010000000000000000000000100000000000005f5f4c617965"
    "72496e666f53746f726167650000000000000000000037000000000000000000000000000028"
    "01000000000000000000000000000000000000"
)
_GRP_72 = bytes.fromhex(
    "08d0053c073a00000064000000000000000000000000000000d00500003c0700000000480000"
    "000001013e003e00c2ffc2ff00010000000000000000000000100000000000005f5f"
)
_GRP_58 = bytes.fromhex(
    "40247b5b307c347c5f53746f726167655f4562646465645f70616765735f446174615f7c387c"
    "3833343535363236335d7d5c305c305c305c3000"
)


def sheet_storage_group() -> bytes:
    """The framed ``__LayerInfoStorage`` record group + its closing NULL —
    the loader-required minimum of the per-sheet record-group run."""
    return (
        make_block(_GRP_133)
        + make_block(_GRP_72)
        + make_block(_GRP_58)
        + make_null()
    )


# Global-storage records byte-identical across every corpus project
# (map_opj_tail2 sweep: Moke / XRD / MnN / SuperlatticeFits):
_STORAGE_IDX5 = bytes.fromhex("3e111111" + "01000000") + bytes(16)
_STORAGE_IDX6 = bytes(4)
_STORAGE_IDX7 = bytes.fromhex("5d111111" + "01000100") + bytes(24)
_ID_BLOB = bytes.fromhex("de361003") + bytes(12)


def fh_size_offset(header_line: bytes) -> int:
    """Absolute file offset of the fh block's file-size u32 (payload @115)."""
    return len(header_line) + 5 + 115


def col_header(dataset: str, nrows: int, col_id: int) -> bytes:
    """147-byte dataset column header: name @88, filled rows u32 @25,
    allocated rows u32 @6, per-column id u16 @113."""
    p = bytearray(_COL_147)
    struct.pack_into("<I", p, 6, nrows)
    struct.pack_into("<I", p, 25, nrows)
    enc = dataset.encode("latin1", errors="replace")[:23]
    p[88 : 88 + len(enc) + 1] = enc + b"\x00"
    struct.pack_into("<H", p, 113, col_id & 0xFFFF)
    return bytes(p)


def window_header(book: str, long_name: str = "") -> bytes:
    """Window header: short name @2; a display long name (when it differs)
    rides the real files' owned-storage slot at payload offset 195, anchored
    by the ``@${`` marker the reader decodes (197-byte minimal variant
    otherwise — both shapes exist in the corpus)."""
    p = bytearray(_WIN_197[:195])
    enc = book.encode("latin1", errors="replace")[:24]
    p[2 : 2 + len(enc) + 1] = enc + b"\x00"
    if long_name and long_name != book:
        p += long_name.encode("latin1", errors="replace") + b"@${[0|]}\x00"
    else:
        p += b"\x00\x00"
    return bytes(p)


def sheet_subheader(nrows: int) -> bytes:
    """365-byte sheet sub-header (``Pd`` block, sheet name fixed 'Sheet1'):
    row count u16 @82."""
    p = bytearray(_SHEET_365)
    struct.pack_into("<H", p, 82, min(nrows, 0xFFFF))
    return bytes(p)


def prop_block(serial: int, short: str, designation: int, x_serial: int) -> bytes:
    """519-byte column property block — the column-association model measured
    across every corpus workbook (61 columns, 6 books):

    * @4  u16: the column's global dataset serial — Origin binds column <->
      dataset by matching this against the dataset's 1-based ordinal in the
      file's stream order (the PN/PT probe series' central finding);
    * @30 u16: the constant 9 in every corpus column (semantics unknown —
      cloned, never varied);
    * @35 u16: the associated X column's serial for Y/Y-error columns,
      0 for X/disregard columns themselves;
    * @38: designation flag — X 0x51, Y/Y-error 0x61, disregard 0x41;
    * @51: X-group index (1-based; the writer emits one X group per book);
    * @0x11 designation code, @0x12 short name.

    Getting @35/@38 wrong doesn't refuse the load — it silently unbinds the
    DATA (columns render empty), the PU5 probe's failure mode.
    """
    p = bytearray(_PROP_519)
    struct.pack_into("<H", p, 4, serial & 0xFFFF)
    struct.pack_into("<H", p, 30, 9)
    is_x = designation in (1, 3)  # X and disregard carry no X-association
    struct.pack_into("<H", p, 35, 0 if is_x else x_serial & 0xFFFF)
    p[38] = {3: 0x51, 1: 0x41}.get(designation, 0x61)
    p[51] = 1
    p[0x11] = designation
    enc = short.encode("latin1", errors="replace")[:11]
    p[0x12 : 0x12 + len(enc) + 1] = enc + b"\x00"
    return bytes(p)


def tail(n_windows: int, root_name: str = "Project") -> bytes:
    """The full post-stream tail: params through the global-storage section.

    The note list carries the loader-required ``ResultsLog`` note (PN4:
    absence -> load refused); the tree is one root folder holding every
    window by stream ordinal; storage is the minimal 8-record set (PN1).
    """
    tree = bytearray()
    tree += make_block(_TREE_HDR32) + make_null()
    tree += make_block(root_name.encode("latin1", errors="replace") + b"\x00")
    tree += struct.pack("<I", 2) + b"\n"  # bare marker fragment (not a block)
    tree += make_block(_TREE_ATTRS) + make_block(_TREE_FSTORAGE)
    tree += make_block(struct.pack("<I", n_windows))
    for ordinal in range(n_windows):
        tree += make_null() + make_block(struct.pack("<II", 0, ordinal)) + make_null()
    tree += make_block(struct.pack("<I", 0))  # no subfolders

    out = bytearray()
    out += _PARAMS
    out += make_null() + make_block(_PROJREC_88)
    out += make_block(b"ResultsLog") + make_block(b" ")
    out += make_null()  # note-list terminator
    out += make_block(struct.pack("<I", 37 + len(tree))) + make_block(_ID_BLOB)
    out += tree
    out += make_null()
    out += make_block(b"\x00\x10\x00\x00" + struct.pack("<I", 8))
    slot = {5: _STORAGE_IDX5, 6: _STORAGE_IDX6, 7: _STORAGE_IDX7}
    for idx in range(8):
        data = slot.get(idx, b"")
        out += (
            b"\x00\x10\x00\x00"
            + struct.pack("<II", idx, len(data))
            + bytes(16)
            + b"\n"
            + data
            + b"\n"
        )
    return bytes(out)
