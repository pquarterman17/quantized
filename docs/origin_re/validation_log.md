# Origin license-window validation log (plan item 31)

Manual/COM checks that need a real Origin install; run whenever a license is
present. Origin 2026b trial window: ~2026-07-03 → early July 2026; since
2026-07-04 a persistent student license (page-limited — tiny projects only).

## The repeatable checklist (run per license window)

One COM script at a time; kill zombie `Origin64.exe` first. Record results
as dated entries below.

1. **Import parity oracles** — `tools/origin_trial/export_ground_truth.py`
   (worksheets; skips stems with index.json) +
   `tools/origin_trial/export_plot_refs.py` (per-plot refs; delete
   plots.json to refresh). Then `uv run pytest -m "" tests/test_io_origin_ground_truth.py
   tests/test_io_origin_figures_opju.py -q` — realdata suites must pass.
2. **Curve-binding score** — `uv run python tools/origin_trial/score_curve_bindings.py`;
   compare against the recall floors in the oracle test (raise only upward).
3. **`.ogs` export runs clean** — export a dataset via
   `POST /api/export/origin`, run the `.ogs` in Origin, confirm books/labels.
4. **COM Send-to-Origin live** — `QZ_ORIGIN_COM=1`, send a dataset via the
   GUI action or `POST /api/export/origin-com`; verify labels/units/values
   land (watch the nrows-vs-filled trap).
5. **Native `.opj` writer** (item 34, while open) —
   `tools/origin_trial/probe_opj_loader.py build` + `run`; record the
   probe matrix deltas.
6. **New-specimen needs** — generate any specimens the open RE items call
   for (`generate_specimens*.py` are the models; keep projects tiny).

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

## 2026-07-05 (overlay + per-layer round — out-of-sample verification)

- **Graphs-only oracles exported** for the two never-validated `.opj`
  projects (`range -w` recipe): MnN_Diffusion_PNR 40 graphs / 392 plot
  refs, SuperlatticeFits 32 / 152 → `ground_truth/<stem>/graphs.json`.
- **Out-of-sample decoder score** (files the curve/flag decoders were
  never tuned on): MnN 102/108 pairs (94.4%), Superlattice 47/53 (88.7%),
  **0 wrong in both**; y-scale flags 80/80 + 38/38 on range-matched
  layers. Precision holds at 100% beyond the development corpus.
- **Live COM overlay roundtrip**: an overlay-shaped dataset (segment
  blocks + NaN gaps) through `send_to_origin` — finite cells land
  row-exact, **NaN cells become Origin missing values (`--`)**, labels
  carry. The GUI's cross-book overlay datasets are COM-exportable as-is.
- **Live `.ogs` export verification (item 23 + item 26)** — running the
  generated LabTalk in real OriginPro caught bugs that text-parity vs
  MATLAB never could (the MATLAB `exportOriginScript.m` was never live-run
  in this Origin build):
  - `impASC ... options.SkipRows.Count:=2` is **invalid LabTalk here and
    aborts the whole import** (faithfully ported from MATLAB line 115).
    Bare `impASC fname:=...` auto-detects the 2-row name/unit header
    correctly; the explicit `wks.col*.lname$/unit$` designations still
    re-assert names/units. This silently broke *all* `.ogs` exports.
  - A successful `impASC` **renames the destination book + sheet to the
    source filename** — so `wks.name$` must be set AFTER import, and the
    post-import short name captured (`string qzbk$ = page.name$;`) for any
    later cross-window plot reference.
  - Double-Y (item 26): the secondary `plotxy` runs while the GRAPH is the
    active window, so it needs an explicit `[%(qzbk$)]<sheet>!(x,y)` range
    (a bare `(x,y)` won't resolve); `layer -nr` + `plotxy ... ogl:=2!`
    then lands the curve in layer 2 (confirmed: layer-2 y-axis rescales to
    the y2 data). A `layer -nr` layer has **no pre-made axis-title
    object**, so its right-Y title needs `label -yr` (`yr.text$` fails).
  - Final corrected `.ogs` runs with **zero failed lines**; 2 layers,
    correct per-layer limits + titles.
- Live import fan-out test caught + fixed a real gap: XRD Book6's
  2-theta column (4 stray denormals) was gate-dropped; `salvage_column`
  now masks ≤4/≤0.5% wrecked cells AFTER the text/report decoders pass
  (hc2convert 407 report + 58 text verified unchanged).
- Full-book GT export for MnN timed out mid-stem (14 book CSVs written,
  no index.json) — column enumeration is the slow path (~37 s/sheet);
  graphs-only export is the fast oracle route for big projects.

## 2026-07-07 (item 34 CLOSED — writer loads + re-exports value-exact)

The PN/PJ/PK/PT/PU/PW probe series completed the loader model; the writer
(`writer.py` + new `writer_blocks.py`) now emits the full requirement set.
Key discriminations (all COM `app.Load` on Origin 2026b):

- **PN1** (1-book stream + minimal tail: params, projrec, `ResultsLog`
  stub note, 1-window tree, storage = count-8 with idx0..4 EMPTY +
  constant idx5/6/7) → **True**. The old "all-slots-empty fails" /
  "real epilogue on 1-window stream aborts" results were confounds of
  the full-Moke stream / a miscut — storage content is LAX (PN3: even
  dialog XML naming nonexistent windows loads). **PN4**: removing the
  `ResultsLog` note → False even on the minimal file (presence required,
  content free).
- **PJ1/PK1**: a window section with ZERO `133B/72B/content` record
  groups is refused; ANY one group suffices — the writer ships the
  byte-invariant `__LayerInfoStorage` group.
- **PU5 → field hunt**: with everything else real, synthesized 519B
  property blocks silently UNBIND the data (load ok, columns empty).
  Measured across all 61 corpus workbook columns: binding = u16 @4
  serial ↔ dataset's 1-based stream ordinal; @30 = constant 9; @35 =
  the X column's serial (0 on X/disregard); @38 = 0x51 X / 0x61 Y /
  0x41 disregard; @51 = X-group index. (The old writer's @30=serial
  "worked" only for the column whose serial happened to be 9 — the
  Book2_A coincidence that also fooled the byte-diff.)
- **PW1**: worksheet window sections must be separated by SIX null
  blocks — with two, the loader folds the next book into the previous
  one (books=1). Graph sections in the corpus use two.
- **Acceptance**: PQ3 (corpus 12-col book), PQ5 (two books), PQ6
  (synthetic with NaN) all load with correct book counts and expASC
  re-export **value-exact** data, names, units (NaN → `--`).
  `probe_opj_loader.py verify` now deletes the CSV before exporting —
  a silent expASC failure must not read stale bytes (a trap hit twice
  this session).

## 2026-11-13 (`.opj` reader handoff — header-driven decode, public oracle corpus)

No Origin license involved: this entry records a validation against
**independent open readers' test suites** instead of COM. The owner handed
the `.opj` reader over for repair (OriginPro no longer available at work),
after an audit of 49 public `.opj` projects found 13 that would not import
and wrong values in several that did.

**Oracles** (all in the public specimen corpus,
`../test-data/origin/public/`; third-party, never committed; expected
VALUES read from tests, no reader code consulted):

- Altaxo LibOriginCSharp — 14 `.opj` specimens + `OriginAnyParserTest.cs`
  (cell values, strings, long names, units, comments, begin/end rows,
  designations, matrix shapes / coordinates / cells);
- liborigin — `*.dat.orig` ASCII exports and `*.out.orig` summaries
  (5 books; window `Label:`);
- LabPlot — `ProjectImportTest.cpp` (Origin 8 workbook cell by cell).

**What was proven** (details + tables: `docs/origin_project_format.md`
§3.1, §3.1.1, §3.2, §4.1):

1. **The dataset header states the cell type.** Kind = low nibble of
   `0x17` (+ `0x20` of `0x16` for Text), bytes per row at `0x3D`, unsigned
   at `0x3F & 8`. double 8 / float 4 / int 1-2-4 / complex 16 / Text N /
   Text & Numeric 10+ with a `<u16 tag>` (0 number, 1 string). The standing
   doc claim that no header byte discriminates the type was wrong; it had
   compared columns that were all Text & Numeric.
2. **Allocation is not data.** u32 allocated / first-used / used-end rows
   at `0x19` / `0x1D` / `0x21`. Corpus: of ~88,000 cells past a used-row
   end, none holds a value. The reader returned the whole allocation
   (blank tag-1 cells as `0.0`). The used range is applied as a claim that
   can only remove blank cells, so a wrong one cannot cost a value.
3. **Older headers** (115 bytes at CPYA 4.2656, 123 at 4.2673, 140 at
   4.2878-4.2946 — the Origin 7 and Origin 8 eras) use the same offsets.
   The 140-byte one is a multiple of 10 and was read as data: none of the
   corpus's seven Origin 8 projects imported at all.
4. **Window label** starts where the header's 195-byte fixed region ends.
   The old "last printable run" fallback returned `"BA"` — the tail bytes
   of the header's float64 timestamps — for 37 of the 64 books the old
   reader imported.
5. **Column-property blocks**: 482-519 bytes by version; `0x25`-`0x26`
   are the column's type bytes, not a marker. The old detector knew only
   Text & Numeric columns of CPYA ≥ 4.3116 files, so Numeric / Date / Time
   columns lost designation, long name, unit and comment. Designation
   codes 7 (Group) and 8 (Subject) confirmed. Sheet sub-header size varies
   255-409 bytes; only `Pd` at `0xD0` is constant.
6. **Matrix sheets**: dataset named after the window, row-major;
   `0x80` in sub-header byte 2, u16 columns at `0x2B`, u32 rows at `0x52`;
   `X1/X2/Y1/Y2` records. Decoded into the map point cloud.

**Controls.** Positive: `len(data) == rows × bytes_per_row` holds for all
1338 worksheet/matrix datasets (48 files, 14 CPYA versions). Negative: the
8 function datasets fail it and are omitted + named; all 38 same-sized
look-alikes of a property block (graph curve records) are rejected, all
1297 accepted blocks sit under a worksheet sheet and 1295 name an existing
dataset; a kind outside the table (`SBin_`, kind nibble 4) is omitted.

**Whole-corpus before / after** (323 files; before = `main` 9da2bb6e):

| | before | after |
|---|---:|---:|
| `.opj` files importing (of 49) | 36 | 48 |
| `.opj` books | 64 | 103 |
| `.opj` numeric columns (1284 worksheet columns + the X column of each of the 16 matrix books) | 1050 | 1300 |
| `.opj` text columns | 1 | 47 |
| `.opj` matrix books | 0 | 16 |
| `.opj` books titled `"BA"` | 37 | 0 |
| `.opju` files with byte-identical reader output (of 274) | — | 274 |

Of the 1050 columns the old reader produced: 120 identical; 845 identical
over the used rows and shorter (the dropped tail was all `0`/NaN); 70
additionally have blank cells that were `0.0` and are now NaN; 15 changed
value — all 15 in Altaxo specimens where the oracle proves the old value
was a wrong-stride reinterpretation; 0 lost. No file that imported before
fails now. One file's primary book changed, on purpose: liborigin's
`crash.opj`, whose sheet-1 book is allocated but empty (30 blank rows
before, 0 used rows now) — the primary is now the sheet that holds the
data. The one `.opj` still not importing is a third-party synthetic stub
(`CPYA` magic, no blocks). Decode time on an 80 MB synthetic project
(8M cells) is unchanged within noise (0.79 s vs 0.78 s).

**Not proven / left open** (also in the format doc):

- The owner's own `.opj` corpus (Moke, XRD, XMCD, PNR, hc2convert,
  SuperlatticeFits) was **not available** on the machine this was done on.
  The legacy `hc2convert` "NaN" cell shape and the report-sheet bucket are
  preserved by construction, but the realdata pins in
  `tests/test_io_origin_project.py` / `test_io_origin_ground_truth.py` /
  `test_io_origin_fuzz.py` have not been re-run against the new reader.
  Run them first; expect row counts to shrink to used rows and blank
  cells to turn from `0.0` to NaN.
- Matrix sheets with more than one matrix object; matrix values in the
  one CPYA 4.2673 file that has a matrix (shape-exact, no oracle).
- Which Origin release each CPYA build number is. The corpus names two
  (a file called `…-7.0.opj` is 4.2656; LabPlot's `origin8_…` files are
  4.2878); the rest is left as build numbers on purpose.
- Text code page (latin-1 assumed). Date/Time columns keep their raw
  numbers; a follow-up the same day added a per-column format hint
  (`origin_column_formats`, epoch proven against Altaxo's date-time
  assertions — format doc §4.1 "Column format"). No UI renders it yet.
- Group / Subject designations: surfaced in a follow-up the same day
  (`"group"` / `"subject"` in the shared vocabulary); the native writer's
  designation table still lacks them.
- **Native `.opj` writer:** `writer_blocks.col_header` never set the
  used-row end (`0x21` stayed at the template's 161); Origin loaded the
  files regardless. Fixed in a follow-up the same day — it now writes
  allocated / first / used-end rows at `0x19` / `0x1D` / `0x21` as real
  files carry them, and the reader still never drops a value past a
  used-row end (for files already written). **Re-run checklist step 5**
  (`probe_opj_loader.py`) at the next license window: the new header has
  not been loaded in real Origin.
- `0x3F` values `0x10`/`0x20`/`0x30` and the other `0x16` bits.

**How to re-run:** `uv run pytest -m realdata tests/test_io_origin_opj_corpus.py`
(needs the public corpus; it replays 147 Altaxo assertions, 5 liborigin
exports, LabPlot's workbook test and four corpus-wide invariants).

### 2026-11-13 (later) — review round on the header-driven `.opj` reader

An independent review of the entry above found the decode right against
every oracle and eleven places where the reader was not yet fail-closed.
What changed, and on what evidence:

1. **`@N` is a sheet id, not a position.** Three public specimens: a
   one-sheet book whose datasets are all `@3`; a two-sheet book with ids
   6 and 7; a 24-sheet book with ids 1-23 (gaps) whose window lists id 20
   first. Binding is by column object id (property block u16 `0x04` ↔
   dataset header u16 `0x52`): 1058 references resolve over the corpus,
   none splits a sheet id over two sheets, the named column belongs to the
   same id every time, and all 56 bindings on books with ids 1..n agree
   with position (the Altaxo / LabPlot multi-sheet oracles). Ids that no
   rule binds get no column metadata and a diagnostics line; matrices
   (no column reference) bind only when dense or single. Effect on the
   corpus: 4 files gain correct column names / units / designations
   (17 sheets of the 24-sheet book — whose first-created sheet previously
   carried ANOTHER sheet's names — a fit book's second sheet, the id-3 book, and the id-6/7 book's
   Y-error designations and comments); no value changes.
2. **The datasets section is positional** (block 2 onwards,
   `[header][data|NULL][NULL]`, in all 48 real files). An unrecognised
   header is reported and stepped over; the walk no longer stops at it or
   skips it silently. No corpus file has one — synthetic tests only.
3. **A lost first column never promotes the next one to X.**
4. **Report sheets are identified by a `cell://` cell**, not by "wide and
   all text": 26 of 26 corpus report columns have one, 0 other columns do.
5. **Implausible float64 cells are blanked per cell**; the column stays.
6. **Notices**: the legacy content-sniffing walk and a matrix whose
   coordinates were not found (4 of 16) each put a line in the fidelity
   manifest. `origin_complex_imaginary` joined the row-indexed sidecars
   (Python and TypeScript). An all-blank matrix no longer counts as a
   populated Library book. A window label typed over several lines is
   one title (it was rejected for its line break).
7. **A book down to one sheet is the book.** Datasets that all carry one
   id N, in a window with one sheet, are imported as `<Book>` (metadata
   `origin_sheet_id = N`), not as `<Book>@N`. Graph curves name the book
   without a sheet, so the one public specimen of this shape now opens its
   graph with data (live-checked); its values are unchanged.

Re-measured after the round: corpus table above unchanged (48 / 103 /
1300 / 47 / 16 / 0; 274 of 274 `.opju` byte-identical; 0 columns lost or
changed against the first pass); `extract_figures` output byte-identical
to `main` on every `.opj` and `.opju` in the corpus.

**Owner-corpus pins this round can move (not available here, not
re-run):** the `hc2convert` report-sheet count (a wide all-text column
with no `cell://` cell would now be a text column); any book whose
datasets are `@N` with N ≠ position (labels, designations, hence which
column is X); any book with an undecodable column ahead of its first
decoded one (row-index X); a column the old plausibility gate dropped
whole (now kept, cells blanked).

### 2026-11-13 (follow-up) — graph curves on a book whose data is on sheets N > 1

**Question.** `DO.opj`'s two graphs name curve book `Book1`, but its data
imports only as `Book1@6` and `Book1@7` (sheet ids, §5 of the format doc).
Can a curve be bound to the right sheet?

**What the file shows.** A curve anchor carries the u16 column object id
it plots (`opj_curves.column_id_map`); a column-property block carries the
same id at `0x04`, and `opj_sheets` already binds those ids to sheets for
datasets. Over the 49 unique public `.opj` files, 150 curve anchors: 112
land on a single-sheet book, 25 resolve to no column, 12 (all `DO.opj`) land
on sheet position 0 of `Book1`'s window, which the dataset binding gives to
one of `Book1@6` / `Book1@7`, and 1 (`strings_testing.opj`) lands on
position 1 of `NLFit1`'s window, which is `NLFit1@2`.

**Why it is not implemented.** No independent oracle states which sheet a
curve plots: Altaxo and liborigin have no multi-sheet graph test, LabPlot's
`testImportOriginStrings` asserts the curve COUNT and axis titles of
`strings_testing.opj` but no column path, and its column-path assertions
(`2graphs`, `2folder-with-graphs`) are all single-sheet books. One file of
12 curves with both candidate sheets having the same column letters is not
a corpus distribution. Under the graph-recovery safety rule this stays
unbound. `extract_figures` is unchanged.

**What changed instead (frontend).** When a curve's book is not imported
but `<book>@N` sheets are, the Recover window says so once per workbook:
"The graph names workbook Book1, but not which of its sheets. This file has
Book1 sheets 6, 7: choose one below", and lists those sheets as candidates
(binding reason `sheet_not_recorded`; `originSources.test.ts`).

**Decided (owner, 2026-11-13): report, do not re-bind.** The
`strings_testing.opj` curve above is bound to `NLFit1` column B (sheet 1)
while its column id is on sheet 2: the reverse failure, which looked
resolved. The binding is kept (re-pointing it would move owner figure pins
that cannot be re-measured here), but it is no longer silent:
`opj_curve_sheets` compares each curve's recorded sheet with the one its
binding uses, the figure gains `curve_sheet_notes` (`{book, x, y,
recorded}`) and its fidelity an omission `curve_sheet_mismatch`. The
sentence is the frontend's (`lib/originCurveSheets.ts`), because only it
knows whether the bound book reached the import: one line per graph layer,
book and recorded sheet ("6 curves of Graph1 (Book1 columns B, D, F, C, E,
G) are recorded on Book1@6; the sheet the graph would otherwise use (Book1)
is not in this import; use Recover to choose the sheet", or "... but plotted
from NLFit1; check it, ..." when it did). Such a curve is never also listed
as "sheet not recorded", and Recover opens with the recorded sheet first.
Public corpus: 3 figures gain notes — `DO.opj`
Graph1 and Graph6 (6 curves each, recorded on `Book1@6`) and
`strings_testing.opj` Graph1 (1 curve). Every other field of every figure is
byte-identical to `main` (`tests/test_io_origin_curve_sheets.py`).

## 2026-11-13 — `.opju` structural worksheet reader (no Origin install; third-party oracle)

Owner handoff: Origin is no longer available, so reading existing `.opju`
files has to stand on evidence that does not need a licence window. This
entry records what was proven, by which oracle, and what was not. Grammar:
`docs/origin_project_format.md` §3.5 (records) and §3.6 (matrix books).

**Oracles used (all independent of this reader):**

1. *Paired containers.* 14 third-party test projects that exist as both
   `X.opj` and `X.opju` (`test-data/origin/public/gh_Altaxo_LibOriginCSharp`).
   The `.opj` side is read by a ~40-line fixed-width cell reader written for
   the test (it does not use the shipped `.opj` reader), so the `.opju`
   decode is compared against cells whose encoding needs no codec.
2. *Published expectations.* The same project's test source states matrix
   shapes and X/Y ranges; the test parses them at run time.
3. *The record's own length field.* Builds from 4.33 store each
   Text&Numeric / double / complex body's byte length; a decode that does
   not end exactly there is rejected. This is what extends the proof from
   the 14 specimens to the corpus.

No GPL reader source was read; no specimen and no value read from one is
committed (the tests compute every expectation at run time).

**Results — paired specimens:**

- 127 / 127 `.opju` column headers run-length-expand to 147 bytes and equal
  the paired `.opj` header in every byte the reader uses.
- 127 / 127 records decode, and every used cell (number, missing value,
  text) equals the paired `.opj` cell. Storage classes covered:
  Text&Numeric (numeric, mixed, text-only, empty), double, float32,
  int8/16/32, uint8/16/32, complex, Text.
- 12 / 12 matrix objects: shape, row-major cells and (where published) the
  X/Y ranges match.
- All 14 import through the public reader; 13 of the 14 raised "no worksheet
  columns" before.

**Results — 274-file public corpus (before → after):**

| | before | after |
|---|---|---|
| files that import | 199 | 258 |
| files that fail | 75 | 16 (59 of the 75 now import) |
| books | 2,509 | 3,457 |
| book columns | 25,356 | 33,413 |
| value columns carrying a decoded long name | 2,901 | 4,454 |

Per-build table, per-column outcomes and the residual census:
`docs/origin_project_format.md` §3.5 "Corpus distribution" and "Still unknown".

**Controls.** Positive: every storage class and every value tag has at
least one length-checked instance (tags n = 3..7: 2,660 values, all
in length-checked records). Negative: a body with a wrong declared length,
an unknown cell kind, an unknown cell-run kind, an unknown value tag, a
missing `ce fa` terminator, a count other than −1 before a literal row, and
a matrix layer that does not multiply out are each rejected and reported
(`tests/test_io_origin_opju_records.py`).

**Corrections to previously shipped output** (each a case where the old
value is shown wrong by the header's used-row extent, which the paired
oracle pins 127 / 127):

- Trailing allocated rows are no longer data: 140 previously returned
  columns lose 2,394 cells that lie beyond the used-row extent (e.g. 29
  rows of `0.0` after a 301-row ramp; 15 stale values behind one live one).
- Leading and interior empty cells stay in place: 97 previously returned
  columns gain the rows after their first numeric run (2,714,766 cells in
  all — the old scan stopped at the first run).
- Dataset names come from the header: 40 columns that were filed under a
  truncated or duplicated name are now under their real one.
- A designated-X column that is text is no longer replaced by the first
  numeric column: 27 previously returned books now carry a row-index axis
  with `x_column_recovered: false` and keep that numeric column as a value
  series, with the text X in `origin_text_columns`.
- The primary book differs in 33 of the 199 previously importing files: 24
  because "largest book" is now computed on complete books, 9 because a
  book with no value series is no longer chosen while one with a value
  series exists (primaries with no value series: 24 files before, 1 after).

**Not verified here — must be re-run where the files exist:**

- The owner's own oracle suite (`specimens/ground_truth`: XAS, Hc2 data,
  RockingCurve, UnpolPlots, Fixed Lambdas SI and the trial specimens) is not
  on the machine this was built on. `uv run pytest -m realdata
  tests/test_io_origin_ground_truth.py tests/test_io_origin_project.py
  tests/test_io_origin_figures_opju.py` is the acceptance run. Expected
  effect of this change on that suite: decoded columns can only gain rows
  the old scan skipped (cells after the first numeric run) or lose
  allocated-but-unused tail rows; the soundness matcher compares finite
  runs, so both are within what it already tolerates — but that is a
  prediction, not a result.
- Pre-4.33 builds (4.3268, 17 corpus files) have no length field and no
  value oracle. They are decoded on grammar alone (exact row count + `ce
  fa` terminator + magnitude gate) and labelled `grammar_only`.
- Curve→column binding was deliberately left on the old marker-scan column
  universe (see §3.5 "What did NOT change").

## 2026-11-13 (review fixes to the `.opju` structural reader)

Seven review findings, each fixed with a synthetic regression test that
fails on the reviewed commit (`tests/test_io_origin_opju_safety.py`).
Rules: `docs/origin_project_format.md` §3.5 "Fail-closed rules added by the
2026-11-13 review". Corpus: the 274 unique public `.opju` files.

- **No regression.** Against the reviewed reader: 0 files lost, 32,953/32,953
  column comparisons identical, primary book unchanged in every file, raw
  `extract_figures_opju` output identical in all 274 files (1,587 actionable
  figures, 5,980 curves). Against the pre-structural reader the picture is
  the one the reviewed reader already had (199 → 258 importing files, no file
  regressed). The frozen marker scan's output (`scan_columns` names and
  values) and `tail_start` are identical to the pre-structural reader on all
  274 files, so curve→column binding cannot have moved.
- **Y never promoted to X:** 212 books now carry the row-index axis with a
  stated reason instead of a guessed X (193 behind an earlier Text column, 6
  behind an earlier report-form record that was not read, 13 whose first
  decoded column is designated Y / Y-error); every one of their decoded
  columns stays a value series. 40 books whose designated X is a Text
  column now say so instead of "could not be decoded". Header byte `0x17`'s high nibble was measured against the
  windows-section designation (X: nibbles 4/5/6/7 = 110/1,457/90/10 columns;
  Y: 2/4/5/6 = 47/100/53/5,262) — it does not determine the designation and
  is not used.
- **Losses reported, not silent:** 37 files report worksheet data that was
  not imported (430 column records not decoded — 324 of them report-form
  records the report reader does not read, previously counted as read — 139
  other datasets, 66 complex columns real-part only, 76 columns with stale
  cells, 4 matrices of unknown shape); 21 more were read without a length
  check; 31 `Book_Col.Y2` dataset headers were previously skipped without a
  trace — both are now reported. 0 columns found without a header, 0
  records without a header in intact files. Text cells beyond the numeric
  rows: 38 lost before, 0 now.
- **Resources:** a 164-byte file declaring 2 × 20 M rows: refused in 0.0 s,
  30 MB RSS (was 1.6 GB; 20 such columns OOM-killed > 8 GB). 2 × 2 M text
  references: 153 MB; LZ4 200 kB bomb: 0.1 s (was 2 s). Fuzz (22 files ×
  160 truncations / bit flips / random bytes / fills): 3,493 imports + 27
  `OriginProjectError`, nothing else, none over 5 s. Truncation/flip probe
  (720 mutations): every truncation that changes the data is now diagnosed
  (38 were silent); 2 bit flips remain undiagnosable without the record
  checksum (a flipped residual byte inside an FPC stream changes values).
- **Import time:** interleaved per file against the pre-structural reader on
  the same machine: 151.4 s → 147.4 s over all 274 files (was 186 → 294 s
  for the reviewed commit). The marker scan runs once, shares its FPC
  decodes with the structural pass and settles `tail_start` in the same
  walk; the two label lookups share each book's anchor search.

## 2026-11-13 (record checksum; sheet-2+ designations)

- **Record checksum identified.** The 8 bytes after a 4.33+ record's
  `body_len` are a Fletcher-style pair over the body as little-endian u32
  words (§3.5). Search: CRC32, CRC32C, Adler-32, xxHash32, xxHash64, XXH3-64
  / -128, MurmurHash3-32 / -128, FNV-1 / FNV-1a 32 / 64, over the body, the
  body with its `0a` lead, length field + body, block + body, header tokens
  + body and ±1-byte windows, compared as u64 LE/BE and either u32 half — no
  match on the first 7 records tried. A controlled pair inside one corpus
  project (bodies equal except four bytes +1 at all four word lanes; the
  checksum's first u32 differed by `0x01010101`, the checksum was equal for
  two columns with equal bodies and different headers) pointed to word
  sums; the pair (Σw, ΣΣw) mod 2^32 then matched 243/243 records of that
  file and **37,189/37,189** length-checked records of the 274-file corpus.
  The reader now verifies it: a mismatch is decoded anyway and reported as
  `checksum_failed`. The truncation/flip probe's two remaining silent
  mutations (a flipped byte inside an FPC stream) are now diagnosed.
- **Sheet-2+ designations: not implemented — no discriminating oracle.**
  The only paired `.opj`/`.opju` multi-sheet book (Altaxo
  `OneWorksheetWithTwoSheets`, sheet 2) carries the default designations
  (A = X, B = Y), which any rule — including "sheet N reuses sheet 1's" or
  "the N-th X-led marker run after the book anchor" — reproduces, so it
  cannot confirm one; the Altaxo C# tests assert no per-sheet designation,
  and in that `.opju` the marker scan decodes nothing, so `tail_start` is 0
  and the designation-marker search covers the data section too. Sheet books
  therefore stay "designations unknown", protected by the column-order X
  check. What would settle it: a paired project whose second sheet has a
  non-default designation (e.g. a Y-error or Label column).

## 2026-11-14 (`.opju` graphs not recovered; `.opju` matrices as maps)

- **Graph presence vs recovery.** Classifier: non-workbook page (column-id
  table) whose span holds `_cart_object`. Positive control: 979/980 pages
  the figure decoder recovers carry it (the miss is a layout page).
  Negative controls: 0 in the Altaxo worksheet/matrix projects and the
  synthetic fixtures; workbook pages are excluded by the column-id table
  however much graph content their span holds. Distribution (274 files):
  158 recovered ≥ 1 graph; 67 recovered none but have unrecovered graph
  pages; 52 have both; 17 hold graph objects no page isolates; 32 have no
  graph content. `fig03_bar_sem_tips` (Graph7) and `Figure_5` (Graph3)
  are now reported as present-not-recovered, each with Origin's saved
  image. Not attempted: decoding those graphs' layers (no oracle for their
  record forms here); curve binding untouched (raw `extract_figures_opju`
  output identical on all 274 files).
- **Matrices.** `.opju` matrices now use the `.opj` map builder; all 12
  paired Altaxo matrices are cell-for-cell identical to their `.opj` twins
  (labels, X, Y, Z, imaginary Z); the 23 corpus matrix books keep every
  cell. Matrix books open in the Map tab from the Library.

## How to re-run

`tools/origin_trial/export_ground_truth.py` (skips completed stems);
`tools/origin_trial/generate_specimens.py` (+`generate_specimens2/3.py`);
`tools/origin_trial/export_plot_refs.py` (per-plot oracle, delete
plots.json to re-run); `tools/origin_trial/probe_opj_loader.py` (item-34
loader probes); `tools/origin_trial/score_curve_bindings.py` (item-35
scorer). One COM script at a time; kill zombie `Origin64.exe` before
starting; never run two concurrently.
