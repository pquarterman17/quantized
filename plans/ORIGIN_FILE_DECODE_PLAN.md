# Origin Interop Plan (import .opj/.opju + export to Origin)

Open OriginPro project files in quantized without owning Origin: every
workbook's data (not just the largest), real column names/units, the
newer `.opju` format, and the saved figures. All clean-room reverse
engineering (Apache-2.0; the GPL `liborigin` is a format *reference
only*, never a dependency, never copied — this supersedes
ORIGIN_GAP_PLAN #44's external-converter idea). M1 (`.opj` numeric
worksheet data, largest book) shipped 2026-07-03. Scope now covers BOTH
directions — importing Origin projects AND exporting quantized work back
to Origin users (W6) — plus the testing hardening that makes either
trustworthy (W7). Gap analysis: see Context.

**Status:** Active
**Created:** 2026-07-03
**Updated:** 2026-07-04 (W4 frontend: figures section + book-family filter, items 17/18)

---

## Context

### How the pieces fit together

- `src/quantized/io/origin_project/` — the shipped decoder package
  (container/opj/opju/windows; item 15 done):
  CPY block walker → column pairing → 10-byte record decode →
  `DataStruct` (largest book; full book inventory in metadata).
  Registered for `.opj`/`.opju` in `io/registry.py` (one registry).
- `docs/origin_project_format.md` — the format knowledge base. New RE
  findings land as separate reports in `docs/origin_re/` and get
  consolidated back into the main doc (item 20).
- Corpus: `../test-data/origin/` — 17 real files, **local only, never
  pushed to any remote**. Inventory: 6 `.opj` (Moke 1 MB, XRD 1.3 MB,
  XMCD 20 MB, MnN_Diffusion_PNR 7.8 MB, SuperlatticeFits 10 MB,
  hc2convert 32 MB, PNR **127 MB** — the stress test), 5 `.opju`
  (XAS 173 KB, RockingCurve 196 KB, UnpolPlots 442 KB, Fixed Lambdas
  SI 812 KB, Hc2 data 16 MB), 5 templates (`.otp`/`.otpu`), 1 `.emf`.
- Tests: synthetic CPY fixtures built in-test (run in CI, zero private
  data) + `realdata`-marked anchors against the corpus (auto-skip when
  absent). Committed fixtures go in gitignored `tests/realdata/origin/`.
- Frontend import flow is single-DataStruct-per-file today; an Origin
  project is inherently many datasets + figures, so W4 changes that
  contract (needs owner UX decisions).
- Clean-room rule: published format *facts* (wiki notes, liborigin
  docs) may be consulted and cited; GPL *source code* is never read
  into an implementation and never copied. User data never leaves the
  machine (no file bytes in web queries, no uploads).

### Data / control flow

```
.opj  → CPYA header → datasets section (blocks)   [DECODED — M1]
                    → windows section              [UNDECODED: names/units,
                       (worksheets, notes, graphs)  sheets, FIGURES]
.opju → CPYUA header → PrvwOPJU preview → different framing +
                       compressed payloads         [UNDECODED — M2]
decoded columns → DataStruct(s) → import route → library → plots
decoded graphs  → plot-spec mapping → restored figures (W3 + W4)
```

### Dependency map

- ~~Items 1, 7, 11 (wave-1 RE)~~ — 1 and 11 done; 7's codec cracked,
  mode schedule + framing remain (feeds 8).
- 2 needs 1 · 5 needs 1 · 8 needs 7 · 9 needs 8 · 10 needs 1+8 ·
  12 needs 11 · 13 needs 12+16 · 14 needs 7+11 ·
  19 needs the matching RE item · 21 needs 1/11.
- **15 (package split) precedes every new decoder** (2, 8, 13) — the
  500-line module ceiling forces the split before code lands.
- 3 and 16 are independent of all RE and can start any time; ~~16/17~~
  needed owner UX decisions (resolved: see #17 in Completed).
- 12 should coordinate with ORIGIN_GAP_PLAN #12 (FigureDoc entity) —
  imported Origin figures should land as the same document type.
- W6: 23 and 24 are independent; 26 needs 12; 27 deferred.
- W7: 28 is ready now (oracle files exist); 30 needs 24; 29/31 anytime.

### Who does what (model routing)

Extends ORIGIN_GAP_PLAN's routing; the difference here is that format
cracking is frontier-model work while spec-driven decoding is not.

| Tier | Good for | Items |
|------|----------|-------|
| **sonnet** | hypothesis-driven RE (now that Rosetta specimens + Origin-exported ground truth exist), spec-driven decoder implementation, refactors, frontend, synthetic fixtures | 7 (retry), 2, 3, 5, 8, 10, 13–19, 21 |
| **opus** | escalation only: RE that a sonnet pass genuinely stalls on; contract/mapping design if it grows past a template | 1 ✓(done), 11 ✓(done), 12, RE half of 4 |
| **haiku** | mechanical regression anchors, text extraction, docs consolidation | 6, 9, 20, 22 |
| **fable** | not planned — owner directive (2026-07-03): delegate to cheaper models when feasible; the original fable run on item 7 died on the spend limit without a report, and the trial-generated specimens have since converted item 7 from open-ended to hypothesis-driven work | — |

**Cost note (2026-07-03):** an Origin 2026b trial produced controlled
specimens that de-risk the remaining RE: same-content `.opju` Rosetta
files with known values/names, single-variable diff pairs (log flag,
column selector — as `.opju`), and Origin-exported ground truth
(CSV + JSON: all books/sheets/columns/names/units + graph axis/curve
refs) under `../test-data/origin/specimens/`. Every remaining unknown
now has an oracle, so default RE tier drops to sonnet with escalation
only on demonstrated failure. NOTE: Origin ≥ 2023 cannot WRITE
old-format `.opj` (removed by OriginLab), so no trial-made `.opj`
specimens exist — `.opj` figure-flag probes must use within-corpus
diffing per the item-11 report instead.

Agent types: `data-format-detective` (1, 7, 11), `code-architect` (12,
15 design), `code-implementer`/`quantized-porter` (decoders),
`test-writer` (9, 19), `ux-frontend-expert` (17, 18),
`guards-reviewer` (pre-merge on every implementation branch).

Every implementer must first read `docs/origin_project_format.md`, the
relevant `docs/origin_re/` report, and `src/quantized/io/origin_project.py`.

### Gap analysis — both directions (2026-07-04)

**Origin → quantized (import).** Shipped: `.opj` numeric data (all books via
`read_origin_books`), real column names/units/designations, book titles, AND
`.opju` worksheet data (item 8 — canonical Burtscher FPC codec, bit-exact vs
Origin's own export). Also shipped: the multi-dataset import-all flow (16),
figure restore + the post-import book-family filter (12/13/17/18 — the Library
"Figures" and "Book families" sections). `.opju` worksheet decode is COMPLETE
(32 closed — 210/210 oracle columns; segment grammar + canonical FPC widths).
Remaining gaps: `.opju` names/units (10 — Unicode windows decode), sheet
hierarchy (5), non-double column *values* (4 — garbage now gated, decode
open), `.opju` figures (14), notes/templates/log (6/21/22).

**quantized → Origin (export).** Shipped: `format_origin_script`
(`io/origin.py` — CSV + LabTalk `.ogs` that rebuilds designations, long
names, units, optional graph; route-exposed, MATLAB-parity tested). Gaps:
single-dataset only (no multi-book export), no figure export, the COM
"Send to Origin" optional is designed but not built (25), and there is no
native `.opj` writer (24) — newly feasible because the RE work documented
the container: a written `.opj` opens in EVERY Origin version (Origin ≥2023
still reads `.opj`, it only dropped *writing* it), making it the highest-value
export lever. A `.opju` writer (27) is low-value while `.opj` opens everywhere.

**Testing.** Exists: synthetic CI fixtures, realdata anchors, 1324-test gate.
Gaps: no oracle comparison against Origin's own ground-truth dumps (28), no
corpus-wide sweep/malformed-input/perf suite (29), no round-trip tests (30),
no documented real-Origin validation procedure for the trial window (31).

---

## Cross-cutting priorities

| # | Item | Workstream | Why first |
|---|------|------------|-----------|
| 10 | `.opju` names/units | W2 | Unicode windows decode; data already reads (item 8 done) |
| ~~16 / 32~~ / ~~1 / 7 / 8 / 9 / 11 / 15~~ | import flow + all `.opju` decode RE | — | done, see Completed |

---

## W1 — `.opj` data completion

### Tier 1 — High Impact

### Tier 2 — Medium Impact

4. **Non-double column value types** — text, int, float32 columns
   (the 147-byte column header carries a type field M1 ignores);
   decode or skip-with-metadata, never garbage
   *Model: opus (RE mini-pass) then sonnet (impl) · corpus examples
   confirmed: hc2convert.opj holds ~460 such columns.*
   - "Never garbage" half SHIPPED (2026-07-04, `e788c0d`+`7a4d25e`): a
     magnitude gate + text-shape check drops non-double columns instead
     of emitting reinterpreted float64 noise (hc2convert: 462 garbage
     columns gone, constant numeric columns preserved). Decoding the
     actual text/int values stays open (needs the type-field RE).

### Tier 3 — Nice-to-Have

6. **Notes windows + results-log text** — import as dataset metadata /
   a text attachment (the analysis log is plain text in the windows
   section and holds fit provenance)
   *Model: haiku.*

---

## W2 — `.opju` container (M2)

### Tier 2 — Medium Impact

10. **`.opju` names/units parity with W1** — the Unicode windows-section
    name/unit decode (multi-book already lands with item 8). `.opju` labels
    currently fall back to Origin designations (A/B/C).
    *Model: sonnet · needs 1 + 8.*
    - Head-start (verified 2026-07-04): the `.opj`-style label blocks DO
      survive in CPYUA — `Energy\r\neV`, `Intensity\r\narb. units` runs sit in
      the tail windows section (XAS.opju @28538/@29118), each preceded by a
      length byte. The `.opj` `window_metadata()` finds nothing (different
      CPYUA framing), so this needs the CPYUA windows-section grammar to
      associate each label block with its book + designation. Positional
      guessing is unsafe (PNG/`.dat`-filename blocks interleave) → decode the
      structure, don't scrape.


---

## W3 — Figures (M3)

### Tier 1 — High Impact

### Tier 2 — Medium Impact

14. **`.opju` figures** — the same pipeline on the CPYUA container
    *Model: sonnet · needs 7 + 11.*

---

## W4 — Import flow & UX

### Tier 1 — High Impact

### Tier 2 — Medium Impact

---

## W5 — Hardening & docs

### Tier 2 — Medium Impact

19. **Synthetic fixture builders** — extend the in-test CPY builder to
    windows/figure/opju sections so CI exercises every decoder with
    zero private data
    *Model: sonnet · test-writer · needs the matching RE item.*

20. **Format-doc consolidation** — fold each `docs/origin_re/` report
    into `docs/origin_project_format.md`; keep one authoritative
    format reference + a user-facing "opening Origin files" doc page
    *Model: haiku · ongoing, after each RE lands.*

### Tier 3 — Nice-to-Have

21. **Templates (`.otp`/`.otpu`)** — same CPY family; a graph template
    could import as a quantized style preset
    *Model: sonnet · needs 1 + 11.*

22. **Analysis-log recovery** — parse the results log's fit records
    (visible plain text) into structured metadata
    *Model: haiku.*

---

## W6 — Export to Origin (quantized → Origin)

### Tier 1 — High Impact

### Tier 2 — Medium Impact

25. **COM "Send to Origin" (Windows-only optional)** — pywin32 behind a
    feature flag pushing the active dataset(s) + labels into a running
    Origin (the LabTalk/COM surface proven in `tools/origin_trial/`);
    degrades to 23 everywhere else; mock-based tests only, never a CI
    requirement (architecture guard #10)
    *Model: sonnet.*

### Tier 3 — Nice-to-Have

26. **Figure export** — `.ogs` graph-building blocks from a FigureDoc,
    and/or graph windows inside the `.opj` writer (the inverse of item
    12's mapping)
    *Model: sonnet · needs 12.*

27. **`.opju` writer** — only if 24 ever proves insufficient; needs the
    outer-framing RE tail and confirmation Origin accepts all-literal
    codec streams (probe during a trial window)
    *Model: defer.*

---

## W7 — Testing hardening (both directions)

### Tier 1 — High Impact

### Tier 2 — Medium Impact

31. **Trial-window validation log** — a documented, repeatable manual
    checklist run whenever a real Origin license is present: our written
    `.opj` files open in Origin with correct data/names; `.ogs` scripts
    run clean; the COM path works; results recorded in
    `docs/origin_re/validation_log.md` (Origin cannot run in CI — this
    plus 28 is the honest substitute)
    *Model: haiku (docs) + owner (clicks).*


## Completed

- ~~**#18 Figure restore UX**~~ (2026-07-04, `2f367e3`) — a Library "Figures"
  section (`frontend/src/components/Library/FiguresSection.tsx`) lists every
  `figures.extract_figures` snapshot from an import; clicking one activates its
  resolved dataset and applies axis ranges + log flags
  (`useApp.applyOriginFigure`). Resolution against the imported books is a
  heuristic (`lib/originFigures.resolveFigureDataset` — source-hint vs.
  `origin_book`/`origin_book_long`/name, unambiguous when only one book
  exists); an unresolved figure shows disabled with the hint in its tooltip
  rather than guessing. Removing a dataset disables (not deletes) any figure
  pointing at it.
- ~~**#17 Workbook picker UI**~~ (2026-07-04, `2f367e3`) — owner UX decision:
  shipped as a lighter **post-import** bulk-manage filter instead of the
  originally-scoped pre-import tree picker, so Origin imports never pause for
  a dialog (`import-all` stays the only behavior at import time, per #16).
  `lib/grouping.originBookFamilies` detects multi-book families (shared
  `"<stem>:"` name prefix + `origin_book` metadata) and a "Book families"
  Library section (`BookFamiliesSection.tsx`) offers "Manage…" — a checkbox
  list (reusing the generic `ParamDialog`, all books checked by default);
  unchecking + confirming bulk-removes exactly those datasets
  (`useApp.removeDatasets`).
- ~~**#32 (closed) chunked staircase records**~~ (2026-07-04, `7ee46ff`) —
  segments interleave freely with inline per-segment streams and a FRESH
  predictor state per stream; new 0x11 top-byte value tag. Pinned by a
  truth-guided backtracking parse of Nb_B + A6221Lockin4_D against Origin's
  CSVs. **Census: 210/210 oracle columns decode — `.opju` worksheet data is
  complete.**
- ~~**#32 (core) width rule + RLE segment grammar**~~ (2026-07-04, `9d1728d`) —
  the "DFCM-collision gap" was a width-table bug: residual byte-counts follow
  canonical FPC bcodes (codes 0-3 → 0-3 bytes; 4 skipped), which coincide with
  the old `(c&7)+1` rule only for c ≥ 4 — exactly the codes clean data uses.
  Also decoded the record header's ZigZag segment grammar (repeat-runs for
  plateaus/zero/constant columns outside the FPC stream). Corpus census vs
  Origin's own dumps: 61 → 6 missing columns; XAS/RockingCurve axes,
  Theory±/T/F plateau curves, zero + constant columns all recover. Residue
  (chunked staircase records) stays as the narrowed item 32.
- ~~**#7 `.opju` container framing + codec RE**~~ (2026-07-04) — cracked the
  CPYUA record framing (LEB128-varint `0a 05 … ff ff <nrows> … 0c` records) and
  the column codec: it is **canonical Burtscher FPC** (FCM value-hash + DFCM
  stride-hash, 2^12 tables, per-value XOR residual), NOT the XOR-delta/PREV-PRED
  scheme first guessed. Params pinned via bit-flip probes + joint oracle-fit;
  full report in `docs/origin_re/opju_container.md`.
- ~~**#8 `.opju` decoder implementation**~~ (2026-07-04, `a72b7a2`) —
  `opju_codec.py` (FPC decode + varint record locator) + `read_opju`/
  `read_opju_books`; books grouped like `.opj`. A strict desync gate emits only
  bit-exact columns (no silent garbage). Residual DFCM-collision gap on long
  near-constant-stride axis columns → new item #32.
- ~~**#9 `.opju` tests**~~ (2026-07-04, `a72b7a2`) — the ground-truth oracle
  suite now checks `.opju` for soundness across all five corpus files (XAS
  243/243 values bit-exact; hundreds of columns via RockingCurve/UnpolPlots/
  Fixed Lambdas/Hc2), plus the probe/rosetta specimens.
- ~~**#16 Multi-dataset import flow**~~ (2026-07-04) — locked import-all UX:
  /api/parsers/* attach "books"; frontend fans out per book (`5eefca6`).
- ~~**#12/#13 Figures (core)**~~ (2026-07-04) — plot-state snapshot mapping
  decided (owner) + `figures.extract_figures` shipped in the import payload
  (`4eb8eef`). Open follow-up: a small frontend apply-snapshot action (morning
  UX review); log-scale uses the decade heuristic until the flag byte is
  isolated.
- ~~**#5 Sheet hierarchy (core)**~~ (2026-07-04) — `@N` datasets recovered as
  `Book@N` pseudo-books with "(sheet N)" titles; sheet-1 keeps the primary
  slot (`6631e03`). Full Book→Sheet nesting UI remains out of scope.

- ~~**#28 Ground-truth oracle suite**~~ (2026-07-04) — per-stem realdata tests
  vs Origin's own dumps; auto-activates per reader (`1181ac7`).
- ~~**#24 Native .opj writer**~~ (2026-07-04) — opj_bytes/write_opj (CPYA data
  + windows metadata, multi-book) + POST /api/export/opj; CI round-trips via
  our reader (`7a41f07`); real-Origin open check remains on item 31's list.
- ~~**#23 .ogs multi-book export**~~ (2026-07-04) —
  format_origin_project_script + POST /api/export/origin-project; book
  display titles round-trip (`cc8f5ed`).
- ~~**#29 Sweep/fuzz/perf suite**~~ (2026-07-04) — malformed-input matrix,
  corpus sweep, version anchors, 127 MB perf budget; caught+fixed a writer
  non-latin1 crash (`ac7b905`).
- ~~**#30 Round-trips (CI legs)**~~ (2026-07-04) — writer→reader equality +
  API round-trip shipped with #24; the real-Origin leg lives in item 31.

- ~~**#3 Multi-book extraction backend**~~ (2026-07-04) — `read_origin_books()` returns every workbook as a DataStruct (per-book
  names/units + shared inventory); single-file contract unchanged. Feeds item 16.

- ~~**#1 Windows-section RE**~~ (2026-07-03) — `docs/origin_re/opj_windows_section.md`
  (`1a6a740`): property/label block layout, designations, book/sheet names;
  validated on Moke/XRD/XMCD.
- ~~**#11 Figure-model RE**~~ (2026-07-03) — `docs/origin_re/opj_figures.md`
  (`087f6cf`): Graph→Layer→Curve object model, axis-range triples, double-Y;
  FigureDoc mapping proposed. Open sub-questions carried into item 12/13.
- ~~**#15 Split io/origin_project package**~~ (2026-07-04) — module → package
  (container/opj/opju/windows); import path unchanged (io/origin.py is the
  unrelated ASCII exporter). All modules well under the 500-line ceiling.
- ~~**#2 Names/units decode**~~ (2026-07-04) — windows-section metadata wired
  into DataStruct: real labels/units, designation-X becomes the x axis, book
  display titles in metadata; synthetic CI fixture + XRD realdata anchors.
  Multi-sheet books guard via repeated-short detection (full hierarchy = item 5).

- ~~**M1: `.opj` worksheet data → DataStruct**~~ (2026-07-03) —
  `e520298`; CPY walker + 10-byte record decode + missing-value
  sentinel → NaN; largest book, full inventory in metadata; validated
  on XRD/Moke/XMCD; synthetic CI fixture + realdata anchors.
- ~~**`.opju` recon**~~ (2026-07-03) — `73ebc85`; established it is NOT
  "CPYA + Unicode": different framing + compressed payloads; findings
  in docs/origin_project_format.md "M2 findings".
- ~~**Names/units located**~~ (2026-07-03) — `ee4a341`; confirmed NOT
  in the column header block; they live in the windows section
  (→ item 1).
- ~~**GPL guard + registry + recognition tests**~~ (2026-07-03) —
  liborigin/ropj added to GPL_PACKAGES; `.opj`/`.opju` registered with
  actionable fallback errors.
