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

**STREAM MODEL SOLVED (same session, probes PR3/PR4):** the earlier books=0
reductions were miscut, not misparsed. The valid stream shape is::

    <header line> <123B fh block>
    per column: [NULL][147B col-header][data block]
    NULL NULL                          ← datasets/windows section separator
    per window: [named header block][sub-blocks … props+labels]
                (a window section = its `00 00 <Name>\0` header block through
                 its last label block; NO leading null — the separator/closure
                 nulls belong BETWEEN sections)
    NULL NULL NULL                     ← closes the windows section (matches
                                          the real file's stream end)

PR3 (hdr + fh + Book2's 12 dataset triples + 2×NULL + Book2's window section
#863–#917 + 3×NULL, fh size fixed) → **books=1**: Origin builds the workbook
from a fully reduced stream. The window-section boundary is the NAMED header
block (not the 776–840 B `58…` blocks — those are per-layer records inside
graph sections).

**Remaining delta (tail only, ~1 KB):** PR4 = PR3 + the synthesized minimal
tail (params, project record, empty notes, 1-window tree, `.otp` epilogue)
→ load=False books=1 (consistent but insufficient). PR5/PR6 (Moke's real
19-window tail or real epilogue on the 1-window stream) → books=0,
confirming strict stream↔tail consistency (an over-full tree/epilogue
aborts everything). Next session: (a) map Moke's ~400 B between tree-end
(~+2700) and epilogue start (+3099 = the `00 10 00 00` idx-0 entry with
LAYMANAGE storage) — per openopj these are the File list / attachment
lists; (b) regenerate the tree for 1 window with the parsed grammar and
clone that middle verbatim; (c) pin the `blk(4)=0x46c` scalar (candidate:
byte length of some tree region) and the `blk(16)` ids. All probe variants
live under `$CLAUDE_JOB_DIR/tmp/opj_probe/` and rebuild via
`tools/origin_trial/probe_opj_loader.py`.

## 2026-07-04 (item 25 live verification)

`send_to_origin` verified against real Origin 2026b (student license):
workbook created, values cell-exact (spot-checked via LabTalk col reads),
X labels from metadata, units land. Two defects found live and fixed:
LabTalk has **no backslash escape** (an escaped `\"` lands literally —
embedded quotes now downgrade to `'`), and the writer-family
`x_column_long`/`x_unit` metadata keys weren't read (now accepted as
fallbacks). Origin's `wks.nrows` reports ALLOCATED rows (32 for a 4-row
put) — compare filled cells, never nrows.

## 2026-07-04 (per-plot oracle regenerated — item 35 unblocked)

`export_ground_truth.py`'s `graphs[].layers[].plots` was **empty for every
project**: `range __rp = {pi}` is a column-range form that never binds a
data plot, and `layer.nplots` / `layer.nplot` / `layer.plotN.data.*` are
not live on this Origin's LabTalk (probed). Working recipe: `range -w
__rw = {pi}` (plot range in the active layer) + the plain `%(__rw)`
substitution → the FULL `[Book]"Sheet"!Col"LongName"` reference; enumerate
`pi` upward until the substitution stops yielding fresh non-`###` text.
`tools/origin_trial/export_plot_refs.py` wrote `plots.json` for 10 stems
(92 refs). First comparison against the shipped `opju_curves` decoder:
fig_pairs 2/2 · XAS 2/3 · RockingCurve 2/4 · Fixed Lambdas 2/14 correct,
0 wrong on those — but UnpolPlots decoded **2 false bindings**
(PrNiO3STOprof/refl col C, unplotted per oracle). Precision rework is in
flight against this oracle.

## 2026-07-04 (item 34, probe session 2 — the PRC/PRE differential series)

Single-byte and single-section edits of REAL Moke.opj, each probed via COM
`Load` (all with the fh size field @115 refreshed where sizes changed):

| edit | load | conclusion |
|------|------|------------|
| 1 byte in tree folder name / params name | True | no global checksum |
| 1 byte deep inside epilogue slot idx1 | False | slot blobs must parse internally |
| tree winref ordinal 0→18 (nonexistent) | **True** | tree refs are LAX — never the gate |
| ResultsLog note removed entirely | False | — |
| ResultsLog note present but content stubbed to 1 byte | **True** | the NOTE'S PRESENCE is required, content free |
| each epilogue slot idx0..3 emptied (one at a time) | **True** ×4 | every slot's content is individually optional |
| all four slots emptied together | **False** | slot-emptying does NOT compose — some combination required |
| ONE window (Graph12) removed from the stream | **False** | any window removal breaks load; coupling still unfound |

**Tree grammar 100% SOLVED** (emitter reproduces Moke's tree
byte-identically): `folder := hdr32 NULL name\0-blk bare-u32(2) attrs36
stor95 blk4(nwin) {NULL blk8(0,ordinal) NULL}×nwin blk4(nsub)
{folder}×nsub`; no root closer; the leading `blk4` scalar = byte length
from the note-list-terminating NULL through tree end (= 37 + len(tree));
the `blk16` ids have no cross-references (safe to clone). Windows are
referenced by ordinal but NOT validated.

**Epilogue = exactly 8 indexed records** (`\n 00 10 00 00 <idx:u32>
<len:u32> <zeros> \n <len bytes>`), idx 0..7, consuming flush to EOF (no
trailing nulls in a project; the `.otp` carries two): idx0 LAYMANAGE XML,
idx1 style holders, idx2/idx3 binary state, idx4 empty, idx5 `3E`-rec,
idx6 4B, idx7 `5D`-rec.

**Synthesized minimal files still fail** (stream yields books=1, tail with
correct tree + required note + otp epilogue → load=False), and so does
every deletion-derived reduction — consistent with the single-window-
removal failure: an unfound per-window coupling (not tree, not offsets —
the ONLY absolute anchor in the whole file is the size u32 @ fh+115;
window headers' post-name fields look like geometry, no obvious
linked-list ids). **Next session**: (a) pairwise slot-emptying to find the
required combination; (b) hunt the window coupling — diff the fh's seven
unexplained u32s (25530/5428/8344/16354/31444/10240/19749) against
window/section statistics, and dump the 133B '#' + 72B sub-block fields
per window for chain candidates; (c) try removing a window AND emptying
all slots together (composition of the two known failure axes).

## How to re-run

`tools/origin_trial/export_ground_truth.py` (skips completed stems);
`tools/origin_trial/generate_specimens.py` (+`generate_specimens2/3.py`);
`tools/origin_trial/export_plot_refs.py` (per-plot oracle, delete
plots.json to re-run); `tools/origin_trial/probe_opj_loader.py` (item-34
loader probes); `tools/origin_trial/score_curve_bindings.py` (item-35
scorer). One COM script at a time; kill zombie `Origin64.exe` before
starting; never run two concurrently.
