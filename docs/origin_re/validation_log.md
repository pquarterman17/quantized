# Origin trial-window validation log (plan item 31)

Manual/COM checks that need a real Origin install; run whenever a license is
present. Origin 2026b trial window: ~2026-07-03 → early July 2026.

## 2026-07-04 (overnight run)

- **Ground-truth exports** — Origin itself exported worksheet CSVs + JSON
  indexes for the corpus (`specimens/ground_truth/`): all 5 `.opju` (Hc2 data
  repeatedly wedged the invisible instance — written off), `.opj` oracles for
  XRD/XMCD/+ (Moke in flight), all trial specimens. These power the oracle
  suite (`tests/test_io_origin_ground_truth.py`).
- **Codec probes** — `probe_c.opju`, `probe_dfcm.opju`, `probe_bits.opju`
  (+ truth JSONs) generated via COM with designed value patterns; proved the
  `.opju` codec is canonical Burtscher FPC and pinned its parameters (see
  `opju_container.md`).
- **`.opju` codec SOLVED (2026-07-04)** — the bit-flip probes localized the
  FPC hash key to the high mantissa/exponent bits; a joint oracle-fit across
  three XAS columns pinned the exact FCM/DFCM shifts + 2^12 table. `read_opju`
  now decodes worksheet columns bit-exact, verified by the ground-truth oracle
  suite (XAS 243/243; hundreds of columns across RockingCurve/UnpolPlots/Fixed
  Lambdas/Hc2). Residual gap: long near-constant-stride axis columns diverge on
  an exact DFCM collision detail and are dropped by the desync gate.
- **Writer Origin-compatibility — FAILED (2026-07-04):** a specimen `.opj`
  written by `writer.py` did NOT load in real Origin via COM `app.Load`
  ("Origin loads OUR .opj: False"). Our native `.opj` writer round-trips
  through our own reader only; real Origin rejects the file structure. The
  cross-platform export path (Origin-ASCII + `.ogs`) is unaffected and remains
  the recommended way to move quantized data into Origin. Fixing the native
  writer to satisfy Origin's loader is open follow-up work.

## 2026-07-04 (item 34 probe session — writer loader-RE, student license)

Crafted-file probes against COM `app.Load` (runner:
`$CLAUDE_JOB_DIR/tmp/opj_probe/run_probes.py`; variants built from Moke.opj +
SLD_DoubleY.otp). Each probe reports `load=` and a `doc -e W` book count —
the book count reveals how far Origin's parser got even when load fails.

**Probe matrix (all on 2026-07-04):**

| probe | content | load | books |
|-------|---------|------|-------|
| P1 | Moke.opj untouched | **True** | 6 |
| P0/P4/P4b | our writer's output (± real fh block, ± size fix) | False | 0 |
| P2/P2b | Moke truncated at trailer boundary (± size fix) | False | **6** |
| PT2 | Moke minus its LAST byte | False | 6 |
| PT1/PT3/PTA/PTB | partial trailers (mid-cut / footer-only / clean early cuts) | False | 6 |
| P6/P6b/P6c | content spliced INTO Moke (ours or a cloned real book) | False | **0** |
| PS1/PR1/PR2 | reduced/synthesized stream (even all-real blocks) ± synth tail | False | 0 |

**Loader model derived:** two-phase. Phase 1 parses the block stream
sequentially and BUILDS pages (books appear even with no trailer). Phase 2
requires the post-stream tail to parse to the very last byte AND to be
consistent with the stream (window count/order); any mismatch → total abort
(books=0). A partially-valid tail is never accepted (PT2: one missing byte
fails).

**Tail structure decoded (the "differently framed trailer" is NOT one blob):**

1. **Parameters section** (openopj-documented): `<name>\n<f64>\n` pairs
   (Moke: IMGEXP, AXISTYPE, page_noclick — all 0.0), terminator `00 0A`.
2. Null block, then an **88-byte project record** (framed as a normal block):
   zeros + two f64 Julian dates (created/modified — match the results log).
3. **Note list** (normal blocks): per note `name-block` + `content-block`
   (Moke: "ResultsLog" + the log text), list ends with a null block.
4. **Project/folder tree**: `blk(4)=0x46c scalar (unpinned)`, `blk(16)`
   (unpinned ids), then per folder: `blk(32)` header (zeros + 2 dates), null,
   `blk(name\0)`, bare `u32=2\n` fragment (no payload — NOT a size!),
   `blk(0x24)` attrs (tag `47 11 11 11`), `blk(0x5f)` OriginStorage XML
   (tag `4D 11 11 11`, FolderLastUsed), `blk(4)` scalar 0, `blk(4)` subfolder
   count, [subfolders recurse], `blk(4)` window count, then per window:
   `null, blk(8) = <u32 flags=0><u32 ordinal>, null`. **Windows are referenced
   by 0-based ordinal into the windows-section order — no file offsets
   anywhere** (verified: no window-block offset appears in the tail as u32).
5. **Global-storage EOF run** (`00 10 00 00 <idx> <size> … \n <data>` records
   + `3E/5D/33/34 11 11 11` records), ending with two null blocks. The
   `.otp` template's whole tail (3,950 B) is ONLY this part — it is the
   mandatory CPYA epilogue; SLD_DoubleY.otp is the minimal oracle for it.

**File-header block (123 B, v4.3380):** real content, NOT zeros; u32 at
offset **115 = exact file size** (v4.3227/XRD does not have this). Patching
it alone does not change any probe outcome (necessary-but-not-sufficient at
most).

**Open blocker (where the next session picks up):** even an all-real reduced
stream (fh + Book2's dataset triples + Book2's "window group") yields
books=0 — the window-section cut was misaligned. Per openopj's section list
there is a window LIST header before the per-window SECTIONS: the ~427 B
block right after the datasets and the ~776–840 B blocks (starting
`58 00 00 00 …`) are the real section headers; the named `00 00 BookN\0`
348–365 B blocks (+ '^' 365 B + '#' 133 B sub-blocks) sit INSIDE a section.
Next: map window-section boundaries by the 776–840 B headers, re-cut a
single-book reduction on those boundaries, re-probe; then substitute
synthesized pieces one at a time. After the stream yields books=1, re-test
the synthesized minimal tail (built in the PS1/PR2 probes above) and pin the
`blk(4)=0x46c` scalar + `blk(16)` ids.

## How to re-run

`tools/origin_trial/export_ground_truth.py` (skips completed stems);
`tools/origin_trial/generate_specimens.py`. One COM script at a time; kill
zombie `Origin64.exe` before starting; never run two concurrently.
