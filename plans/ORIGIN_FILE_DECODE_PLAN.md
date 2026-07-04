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
**Updated:** 2026-07-04 (item 35's `.opj`-side sub-question — item 11's
original curve→column selector, long presumed permanently undecodable — is
now SOLVED: every curve carries a small anchor record holding the plotted
column's own global, project-wide serial id, independently confirmed
against that same id stamped in the column's own workbook-storage block;
book and column resolve together via this one id, no separate book selector
needed. Validated 45/45 correct (100% precision), 45/70 (64.3%) of the full
Moke+XRD oracle — the remaining 25 refs are two structurally distinct,
out-of-reach window kinds (FitLinear analysis report graphs; per-column
sparklines), not undecoded curves. Shipped in `opj_curves.py`, wired into
`figures.py`'s `"curves"` field. `.opju`'s recall (30.6%) is unaffected and
item 35 stays open for that half — see item text below; added items 34/35 —
the `.opj` writer real-Origin
load failure promoted to a Tier-1 item now that a persistent student
license enables the fix loop, and figure curve→dataset binding tracked
explicitly; items 6/10/14/17/18/19/20/22/33 shipped earlier today — notes
windows + combined X-axis log flag pinned from licensed specimens,
real-corpus figure records solved, structured results-log parsing, docs
consolidated into one authoritative reference, synthetic fixture audit
(figures.py + multi-book/multi-sheet gaps filled), W1 + W3 complete;
item 35's `.opju` curve→column selector decoded and shipped, gated on
designation for precision — stays open, see item text: the GT `plots`
oracle came back empty corpus-wide, a trial-script LabTalk bug now
fixable with the license; later same day, `export_plot_refs.py` found a
working `plots.json` oracle recipe and item 35 was reworked against it —
found + fixed a false positive (the `__BCO` per-book boilerplate
misattributed as a curve on `UnpolPlots`), reaching 100% precision on
every oracle-covered file; recall stays low (0-50% per file) so the item
stays open, see item text; same day, a third pass added two new
controlled specimens (`curves_multi`/`curves_2books`) confirming the
multi-curve-per-layer + cross-book layout was already solved (zero code
change), raising aggregate recall 19.4%→30.6%, and found + confirmed-
excluded a second near-miss shape (the per-book "column candidate list")
— item still stays open, see item text: 30.6% < the 50% bar to close it;
item 36 (new) closes both remaining "permanently heuristic" Y-scale gaps
— a real-form `.opju` Y flag (new `rf_*` oracle quad) and the `.opj`
flag (XRD-vs-Moke byte diff), both `01 00`/`08 01`;
item 4's report-sheet residue (the
FitLinear/NLFit `cell://...` reference-string family, previously an
honest drop) now decodes in BOTH containers — `.opj`'s
`decode_report_strings` (407/407 hc2convert columns recovered) and
`.opju`'s new `opju_reports.py` (pinned against a new `fitreport2.opju`
oracle, confirmed at scale against the real `Hc2 data.opju`, 1096
columns) — item 4 CLOSED, moved to Completed); item 35's "third encoding"
search (default-dialog single-curve column selector) ran three more
hypotheses (version-pair diff, window-local alternate encoding, legend/
`__FRAMESRCDATAINFOS` backrefs) — all negative, no code shipped, recall
stays 30.6% (see item text); later the same day, a follow-up pass re-
anchored lead #2 on its byte pattern instead of the book-name string that
made it look file-specific and found it corpus-wide — it was the real
encoding after all, rejected earlier only by a counting-convention bug
(FPC-decoded-only ordinal vs. the true all-columns-of-every-book ordinal).
**Item 35 CLOSED**: precision 100%, aggregate oracle-covered recall
36/36 (100%), up from 30.6% — moved to Completed.

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
- 2 needs 1 · 5 needs 1 · 8 needs 7 · 9 needs 8 · ~~10 needs 1+8~~ (done) ·
  12 needs 11 · 13 needs 12+16 · ~~14 needs 7+11~~ (done) ·
  ~~19 needs the matching RE item~~ (done) · 21 needs 1/11.
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
| **opus** | escalation only: RE that a sonnet pass genuinely stalls on; contract/mapping design if it grows past a template | 1 ✓(done), 11 ✓(done), 4 ✓(done — sonnet closed it without escalation), 12 |
| **haiku** | mechanical regression anchors, text extraction, docs consolidation | 6, 9, 20, 22 |
| **fable** | not planned — owner directive (2026-07-03): delegate to cheaper models when feasible; the original fable run on item 7 died on the spend limit without a report, and the trial-generated specimens have since converted item 7 from open-ended to hypothesis-driven work | — |

**Cost note (2026-07-03, updated 2026-07-04):** an Origin 2026b trial
produced controlled specimens that de-risk the remaining RE: same-content
`.opju` Rosetta files with known values/names, single-variable diff pairs
(log flag, column selector — as `.opju`), and Origin-exported ground truth
(CSV + JSON: all books/sheets/columns/names/units + graph axis/curve
refs) under `../test-data/origin/specimens/`. Every remaining unknown
now has an oracle, so default RE tier drops to sonnet with escalation
only on demonstrated failure. NOTE: Origin ≥ 2023 cannot WRITE
old-format `.opj` (removed by OriginLab), so no trial-made `.opj`
specimens exist — `.opj` figure-flag probes must use within-corpus
diffing per the item-11 report instead. **License update (2026-07-04):
a persistent STUDENT license replaced the trial — page-limited, so COM
work is restricted to TINY projects (large multi-book files hang the
headless instance on the page-limit modal; the overnight big-file
ground-truth export was abandoned for exactly this). One COM instance
at a time, always.**

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
"Figures" and "Book families" sections), `.opju` figures (14 specimen form +
33 real-corpus form — 14/14 corpus anchors), AND `.opju` column names/units/
designations/comments (item 10 — the windows-section marker+label grammar,
151/151 names + 130/130 units + 17/17 comments across the oracle corpus).
`.opju` worksheet decode is COMPLETE (32 closed — 210/210 oracle columns;
segment grammar + canonical FPC widths). Non-double column *values* (item 4)
is now CLOSED in both containers: garbage-gated, int/float32 needed no work,
the inline-text sentinel shape decodes, and the FitLinear/NLFit report-sheet
reference-string family (the item's hardest residue) decodes too —
`origin_report_sheets` metadata in `.opj` (`decode_report_strings`) and
`.opju` (`opju_reports.py`, a different grammar, pinned against a new
`fitreport2.opju` oracle). Only the fit's *computed number* itself (not its
cell reference) and one unrelated still-undecoded shape
(`Moke.opj Book3_A`) remain, documented as open residues rather than a
reopened item. Remaining gaps: sheet hierarchy (5), notes/templates/log
(6/21/22).

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
| 34 | `.opj` writer real-Origin fix | W6 | the export lever is broken; loader model + tail grammar decoded 2026-07-04 (validation_log.md) — next: window-SECTION boundary re-cut |
| ~~25~~ / ~~33~~ / ~~4~~ / ~~10 / 16 / 32~~ / ~~1 / 7 / 8 / 9 / 11 / 14 / 15 / 17 / 18 / 19 / 20 / 22~~ | Send-to-Origin + all decode + import flow + W4 UI + docs + log parsing + fixture audit | — | done, see Completed |

---

## W1 — `.opj` data completion

### Tier 1 — High Impact

### Tier 2 — Medium Impact

### Tier 3 — Nice-to-Have

(all W1 items shipped — see Completed)

---

## W2 — `.opju` container (M2)

### Tier 2 — Medium Impact

(all W2 items shipped — see Completed)

---

## W3 — Figures (M3)

### Tier 1 — High Impact

### Tier 2 — Medium Impact

### Tier 3 — Nice-to-Have

(all W3 items shipped — see Completed)
35. **Figure curve→dataset binding** — `.opju`'s curve/DataPlot column
    selector IS decoded (`opju_curves.py`, `docs/origin_project_
    format.md` §6.2.1): an 8-byte per-curve token gives the Y column's
    global ordinal, gated against an independently-validated column
    designation (X is a structural inference — the byte position a
    naive read would expect to hold it never varied across ~44 samples,
    so it isn't reported as decoded).
    **`.opj`'s selector SOLVED, 2026-07-04 (item 11's original sub-
    question, long presumed permanent) — a fresh, hypothesis-driven pass
    given a per-graph oracle now exists.** Designed experiment: byte-diff
    Moke's `Graph8`/`Graph9` (both plot `[Book4]Sheet1!B`, byte-identical
    block-size sequences) to isolate noise (every difference was a
    per-object/window creation-order counter, never column-shaped), then
    diff `Graph8`/`Graph2` (same book, different column) with the same
    alignment to isolate signal: the 519-byte "curve anchor" block
    immediately before each curve's DataPlot style+body pair. Its first
    differing byte looked like a per-book column ordinal at first
    (Book2/Book3 fit `letter_position + book_constant` cleanly) but Book4
    broke that model outright — no additive constant fit any of its 5
    tested columns. The values were still unique per (book, column)
    across 15 pairs / 8 graphs, though: cross-checking the same 16-bit
    value against each column's OWN storage block in the windows section
    (an unrelated part of the file, located via that column's
    `"<Book>_<Col>\0"` dataset-name string) found it verbatim, at the
    identical offset (4, u16 LE) — the id is a global, project-wide,
    monotonically-assigned column serial number, not a per-book ordinal.
    **Book and column resolve together via this one id — no separate
    book selector exists to find.** Anchor detection is content-based
    (`01 00 00 00` marker + immediately followed by the already-
    documented DataPlot magic `58 00 00 00 98 03 40 b3`), not size-based
    (519 B in `Moke.opj`, 515 B in `XRD.opj` — a per-file/build constant,
    confirmed not part of the encoding by testing both files). X is
    inferred structurally (the book's own designated-X column), exactly
    mirroring `.opju`'s unverified X inference — no oracle gives an
    expected X column in either container. **Validated 45/45 correct
    (100% precision), 45/70 (64.3%) of the combined Moke+XRD oracle**:
    Moke 39/46 (`FitLine`/`Residual`, the FitLinear analysis's own
    auto-generated report graphs, have no `00 00 <Name> 00` window header
    anywhere in the block stream — structurally unreachable, not a decode
    failure); XRD 6/6 on `Graph1` (all cross-book, one curve per book,
    confirming the "one id resolves book+column together" claim across 6
    different books in a single layer) — the 18 `sparkline*` refs are a
    structurally different feature (per-column inline mini-plots, no
    separate Graph window and no curve-anchor record anywhere in the
    file at all: a whole-file scan for the anchor pattern finds exactly
    6 hits total, all inside `Graph1`). Shipped in `opj_curves.py`,
    wired into `figures.py`'s `"curves"` field (same shape as `.opju`'s).
    Tests: `tests/test_io_origin_figures_opj_curves.py` (synthetic +
    realdata); standalone rescorer `tools/origin_trial/
    score_curve_bindings_opj.py`. Full trail in `opj_curves.py`'s module
    docstring and `docs/origin_project_format.md` §6.1. A pre-existing,
    unrelated bug was surfaced (not fixed) along the way:
    `windows.window_metadata`'s stricter column-block check silently
    mismaps `Moke.opj`'s `Book4` Sheet1 designations/long-names against
    its `FitLinear1` report sheet — noted in `opj_curves.py`'s docstring,
    left for a deliberate follow-up (out of scope for item 11/35).
    `.opju`'s recall (30.6%) is untouched by this pass; item 35 stays
    open for that half only.
    **Reworked 2026-07-04** against a real per-plot oracle
    (`export_plot_refs.py`'s `range -w` LabTalk recipe succeeded where
    `export_ground_truth.py`'s `range __rp`/`layer.nplots` came back
    empty; oracle now lives at `specimens/ground_truth/<stem>/
    plots.json` for `fig_pairs` + the real corpus). That oracle exposed
    a false positive: `UnpolPlots` decoded 2 *wrong* `(book, column)`
    pairs. Root cause: the whole-file regex also matches the tail of an
    unrelated, fixed ~365-byte per-book boilerplate record (starts at a
    `__BCO2` string, byte-identical across every book in every file
    checked) whose last 8 bytes coincidentally fit the curve-token shape
    and always resolve to local column 3 — undetected before because
    every `XAS` book happens to plot column C for real, making the
    artifact "correct" by luck. Fixed via `_is_bco_boilerplate` (requires
    both the local-column-3 match AND a `__BCO` marker at the confirmed
    340-380 byte distance — neither alone is safe, since `fig_pairs`' own
    A-C diff curve also resolves to local column 3, just far from any
    `__BCO` marker). **Precision is now 100% on every oracle-covered
    file** (`fig_pairs` 2/2, `XAS` 0/3, `RockingCurve` 2/4, `UnpolPlots`
    0/8, "Fixed Lambdas SI" 2/14 — 0 wrong everywhere, asserted by
    `test_realdata_curve_bindings_vs_plots_oracle`). Recall stays open:
    per-figure *attribution* (which curve belongs to which decoded
    figure) is still a lossy `[anchor, next_anchor)` window heuristic,
    and — now confirmed directly against the real oracle rather than
    inferred — most of a real graph's OWN curve tokens (not just
    misattributed ones) aren't locatable yet: "Fixed Lambdas SI"'s
    Graph1 genuinely plots 6 columns but only 1 (the first, "Theory SA")
    is recovered per window; `RockingCurve`'s multi-curve
    `NbAuRocking` layer (D+F) is the one case that decodes exactly.
    **Recall push, same day (two new specimens):** `curves_multi.opju`
    (one graph, one layer, 3 curves — MBook B/C/D vs A) and
    `curves_2books.opju` (`BookOne!B` + `BookTwo!C`) were built to pin
    the multi-curve-per-layer layout and the cross-book cumulative-
    ordinal base. Both decode at **100% precision AND recall with zero
    code change** — confirming the existing regex + `_global_column_map`
    already generalize correctly to both cases (each curve is a fully
    self-contained, back-to-back ~750-900-byte per-curve object; the
    ordinal base carries over a book boundary exactly as implemented).
    This raises **aggregate oracle-covered recall from 6/31 (19.4%) to
    11/36 (30.6%)** — see `test_realdata_curves_multi_bindings` /
    `test_realdata_curves_2books_bindings` and
    `tools/origin_trial/score_curve_bindings.py` (standalone corpus-wide
    scorer). The investigation also found and confirmed-excluded a
    **second near-miss shape** — a per-book "column candidate list"
    (`<flag> 01 <marker> 80 03 <ord> 00`, one byte shorter than the real
    token's double-`0x01`, enumerating every column of a referenced book
    with no independently-decodable "selected" marker; using its
    tail-heavy correctness pattern would be corpus-convention luck, not
    a decodable signal, so it was rejected — see
    `test_synthetic_column_enum_list_not_mistaken_for_curve_token` and
    `opju_curves.py`'s docstring). **Real-corpus recall itself did not
    move**: `RockingCurve`'s `Graph1`/`Graph2` and nearly all of XAS's/
    UnpolPlots's required curves have neither shape anywhere in the
    file — a third, still-undecoded encoding for ordinary single-curve
    default-dialog graphs. Item stays open (precision 100% everywhere,
    but aggregate recall 30.6% < the 50% bar to close it).
    **Third-encoding search, 2026-07-04 — negative result, no code
    shipped.** Three hypotheses chased, none validated (full byte-level
    trail in `opju_curves.py`'s docstring / `docs/origin_project_
    format.md` §6.2.1): (1) the `specimens/converted/*.opju` version-pair
    (same corpus projects re-saved by the 4.3811 trial-writer build) was
    hoped to be a Rosetta stone — it isn't; the apparent "new token" it
    surfaces is the same `__BCO` boilerplate coincidence at a version-
    shifted distance (383 vs. the pinned 357-360 bytes), and conversion
    introduces a further false-positive cluster, making it a noisier
    source, not a cleaner one. (2) A window-local alternate encoding WAS
    found — a look-alike byte sequence sharing the real token's first 5
    bytes, anchored on a length-prefixed workbook short-name string in
    `RockingCurve`'s curve objects — but it fails validation decisively:
    the 4.3811 re-save of the same project converts this exact slot into
    the canonical token shape while preserving the same numeric value,
    proving it's a real field, yet decoding that value through the
    already-validated ordinal map gives the *wrong* column (`Nb!C` not
    `Nb!B`) or an out-of-range one (`NbAl`) — a different, unidentified
    numbering rule governs default-dialog plots, and it isn't even a
    generally-locatable shape (the raw prefix recurs ~90x per file as a
    generic idiom; `XAS`'s own default graphs don't embed the anchor
    string at all). (3) `__FRAMESRCDATAINFOS` (found in `UnpolPlots`/
    "Fixed Lambdas SI" only) decodes as frame-layout geometry, not a
    curve backref; nearby slots carry generic `%(?X)`/`%(?Y)` auto-label
    macros, not literal dataset references. Recall/precision unchanged
    (30.6% / 100%); recorded as a confirmed negative so a future pass
    doesn't re-spend time on these three leads.
    *Model: sonnet · next step (still open) is byte-level RE on the third,
    single-curve-graph column-selector encoding (RockingCurve
    Graph1/Graph2, XAS, UnpolPlots) — three more leads eliminated, none of
    the shapes found so far account for it.*

(other W3 items shipped — see Completed)

---

## W4 — Import flow & UX

(all W4 items shipped — see Completed; the full Book→Sheet nesting UI
was deliberately descoped in #5, pseudo-books "`Book@N` (sheet N)" are
the shipped contract)

---

## W5 — Hardening & docs

### Tier 2 — Medium Impact

### Tier 3 — Nice-to-Have

21. **Templates (`.otp`/`.otpu`)** — same CPY family; a graph template
    could import as a quantized style preset
    *Model: sonnet · needs 1 + 11.*

---

## W6 — Export to Origin (quantized → Origin)

### Tier 1 — High Impact

34. **`.opj` writer real-Origin compatibility** — item 24's writer
    round-trips through our own reader but real Origin REJECTS the file
    (COM `app.Load` = False, 2026-07-04, see
    `docs/origin_re/validation_log.md`). The whole point of a native
    writer — "a written `.opj` opens in EVERY Origin version" — is unmet
    until this is fixed. The student license gives a tight oracle loop:
    write → COM `Load` → adjust → repeat, plus expASC re-export to verify
    data integrity once it loads. Likely gaps: mandatory file-header
    fields, project-tree/root-window records, windows-section
    completeness, or a trailer Origin's loader requires.
    *Model: fable/opus (RE debug loop, COM-serialized — main thread) ·
    the ONLY open item that needs the license besides 25/31.*
    - [ ] Reproduce the load failure; capture Origin's error surface
    - [ ] Structural diff: our output vs the smallest real corpus `.opj`
    - [ ] Iterate sections until `Load` = True
    - [ ] Verify loaded data/names/units via expASC re-export
    - [ ] Record the required-section findings in the format doc

### Tier 2 — Medium Impact

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

(all W7 items shipped — see Completed)


## Completed

- ~~**#35 Figure curve→dataset binding**~~ (2026-07-04) — CLOSED: the
  "third encoding" search from earlier the same day (version-pair diff,
  window-local alternate encoding, legend backrefs — all reported
  negative) turned out to have found the right shape on lead #2 and
  rejected it only because of a counting-convention bug, not a wrong
  shape. `.opju`'s curve/DataPlot column selector uses TWO token
  subtypes, both now decoded and merged in `opju_curves.py`: the shipped
  0x03 subtype (`<flag> 01 01 01 80 03 <y_ord> 00`, an FPC-decoded-only
  cumulative ordinal, gated on independently-validated `"Y"` designation)
  and a new 0x01 subtype (`<flag> 01 01 01 80 01 <val>`, no fixed
  terminator, no designation gate) used by ordinary single-curve
  default-dialog graphs (`RockingCurve Graph1/Graph2`, all of `XAS`, all
  of `UnpolPlots`, most of `"Fixed Lambdas SI"`) — exactly the graphs the
  0x03 path could never reach. `val` counts cumulatively over **every
  allocated column of every workbook, including empty/undecoded books and
  columns** (new `opju_curves_allcols.py`, split out to stay under the
  500-line ceiling): `_allocated_column_map` recovers this GT-free from
  name records alone (filtered to pure-letter, non-`@N` column suffixes,
  grouped by book, requiring a contiguous `A..N` run — validated to
  reproduce each stem's `index.json` book/column counts exactly, including
  empty default `Book1`s). The 0x03 path's designation gate is
  deliberately NOT applied to the 0x01 token: checking it against every
  oracle-confirmed 0x01 binding found 4 true positives
  (`UnpolPlots`/`"Fixed Lambdas SI"`'s "dR Fresnel"/"dSA" columns) that are
  independently designated `"Y-error"`, not `"Y"` — a legitimate Origin
  usage the gate can't distinguish from the `__BCO` artifact, so applying
  it would have silently dropped true positives; the raw 7-byte token is
  already 100% precise file-wide with no cross-check (zero hits in any
  `.opju` in the corpus except the four files that need it). Merged
  results dedup on `(book, y)`. **Final validation:**
  `tools/origin_trial/score_curve_bindings.py` — precision 100%, aggregate
  oracle-covered recall **36/36 (100%)**, up from 11/36 (30.6%): `XAS`
  0/3→3/3, `RockingCurve` 2/4→4/4, `UnpolPlots` 0/8→8/8, `"Fixed Lambdas
  SI"` 2/14→14/14. Per-figure *attribution* (which decoded figure a
  correctly-resolved pair is attached to) remains a best-effort
  `[anchor, next_anchor)` heuristic — a documented, narrower remaining
  gap, never a soundness one (every reported `(book, column)` pair is
  oracle-confirmed). See `docs/origin_project_format.md` §6.2.1 for the
  full byte-level trail and final table.

- ~~**#31 License-window validation checklist**~~ (2026-07-04) — the
  repeatable 6-step checklist now heads `docs/origin_re/validation_log.md`
  (oracle refresh, curve-binding score, `.ogs` clean-run, live COM
  Send-to-Origin, item-34 probe kit, new-specimen needs), with dated result
  entries below it covering codec probes, ground-truth exports, the item-25
  live verification, and both item-34 probe sessions. Origin still cannot
  run in CI — this plus item 28's oracle suite is the honest substitute.

- ~~**#36 Y-axis lin/log scale-flag byte (both containers)**~~ (2026-07-04)
  — closed both remaining "permanently heuristic" Y-scale gaps left open by
  item 33, using brand-new controlled oracles instead of the decade
  heuristic. **`.opju` real form:** a new 4-file by-construction oracle
  (`rf_linlin`/`rf_logx`/`rf_logy`/`rf_loglog.opju` — the SAME single-curve
  graph, identical custom ranges `x=[0.2,20]`/`y=[50,2000]`, differing only
  in `layer.x.type`/`layer.y.type`) isolated an exact Y flag: the 2 bytes
  right before a fixed `00 10 10 00` layer-style marker following the end
  separator are `01 00` (linear) / `08 01` (log10) — `opju_axis_real_form.py`'s
  new `_real_y_log_flag`. Byte-diffing the quad also surfaced (and fixed) a
  latent bug: these 4 specimens carry the specimen-form's `81 04 06 00 00 01
  c3 66` Y-transition marker even though their X values use real-form
  RLE/tagged encoding, so `_parse_specimen_record` was spuriously "succeeding"
  on 2 of the 4 with a **corrupted `x_from`** (0.1954... instead of 0.2) — a
  bare-raw8 candidate accidentally decoding a flag-token+RLE byte run as a
  plausible literal. Fixed with a guard in `_value_candidates` (reject a
  bare raw8 candidate whose leading byte is in the `0x81..0x8f` real-form
  flag range, mirroring `_real_bare8`'s identical existing guard) — all four
  now correctly route through the real-form parser. **`.opj`:** byte-diffing
  XRD's single log-Y `Graph1` layer-continuation block against all 15
  recovered linear-Y layers in `Moke.opj` found the SAME two byte values at
  payload offset 98/99 (a second candidate at offset 189 was ruled out
  against a wider scan — noise, uncorrelated) — `figures.py`'s new
  `_y_scale_flag`. Validated far beyond the initial pair: 111 log / 236
  linear layers across the *entire* `.opj` corpus (PNR, MnN_Diffusion_PNR,
  XMCD, hc2convert, SuperlatticeFits, Moke, XRD) show ONLY these two byte
  values, no third state, and several instances are flag-log but
  heuristic-linear (reflectivity R(Q) curves zoomed to a sub-decade log
  range, e.g. Y=(0.977, 1.292)) — cases the old heuristic got wrong that the
  flag resolves correctly. Both flags fall back to the decade heuristic when
  unrecognized/absent (X in both forms still has no isolated flag found —
  stays heuristic). `figures_opju.py` split into `opju_axis_real_form.py`
  (real-corpus-form value tokens + the new Y flag) to stay under the
  500-line ceiling after the addition. Also fixed the worktree-nesting path
  bug (`_CORPUS`/`_TD`/`TEST_DATA_CORPUS` resolving to a nonexistent
  location one level too high) in `test_io_origin_project.py`,
  `test_io_origin_fuzz.py`, `test_io_origin_ground_truth.py`, and
  `conftest.py`'s `corpus_dir` fixture — those realdata suites were
  silently skipping in any worktree agent; fixed with the same
  ancestor-walk `test_io_origin_figures_opju.py` already used.
- ~~**#4 Non-double column values — report-sheet residue**~~ (2026-07-04) —
  closed the item's last-open family: Origin's FitLinear/NLFit
  auto-generated report-sheet columns (`"cell://Parameters.Slope.Value"`-
  style reference strings), previously an honest drop in both containers.
  **`.opj`** (`container.decode_report_strings`): a genuinely wider,
  column-specific fixed record — `<u16 mask=0x0001><NUL-terminated
  string><zero padding>`, width constant within one column (sized to its
  longest cell) but varying column to column — recovered via width
  detection + full re-validation (never a coincidental short match).
  hc2convert.opj: **407/407** previously-still-dropped columns now decode
  (0 collisions with the 58 inline-text/1242 double columns); Moke.opj
  24/25, MnN_Diffusion_PNR.opj 12/18 (residue in both is unrelated
  content — sheet-header name-regex false matches, embedded-storage
  blobs, plus one genuinely different still-open shape, `Moke.opj
  Book3_A`, mixing text labels with numeric sentinels — documented, not
  solved, out of this item's scope). A report-only pseudo-book (zero
  plausible-numeric columns, e.g. hc2convert's `Table3`/`Table15`/
  `Table17`) now still surfaces via `opj._build_book`'s new empty-`cols`
  branch instead of being silently dropped. **`.opju`** (new
  `opju_reports.py`): a completely different grammar (CPYUA doesn't reuse
  `.opj`'s framing) — shares `opju_codec`'s `0a 05 <varint> ff ff
  <varint>` record header, discriminated by a `0x01` tag (vs. a numeric
  column's `0x00`) at the exact byte `opju_codec._decode_record` already
  checks, then a single ZigZag-varint segment count `-m` followed by `m`
  `<len:u8><string>` entries (`len=0` = a blank cell); a positive count
  (2 of `FitNL1`'s 28 columns) is an undecoded shape, honestly dropped.
  Pinned against a NEW known-content oracle, `specimens/fitreport2.opju`
  (a licensed-trial-generated linear fit, x=1..8, slope=-1.5,
  intercept=9.5, whose `FitNL1`/`FitNLCurve1` report sheets were the
  corpus's first multi-sheet `.opju` book) — recovers all 26 populated
  `FitNL1` columns exactly, matching the fit's own generator script.
  Exposed and fixed a real latent bug along the way: `opju_codec._NAME`
  lacked `.opj`'s `(?:@\d{1,2})?` sheet-suffix group, so every extra-sheet
  column (in BOTH the new report scan and the existing `scan_columns`)
  was silently mis-anchored to whichever sheet-1 name came last, landing
  every `FitNL1`/`FitNLCurve1` column in the wrong pseudo-book — fixed by
  adding the group (verified as a pure fix: no matches change for any
  single-sheet file in the corpus). Confirmed at scale against the real
  `Hc2 data.opju` (16 MB, no curated oracle): 1096 report columns, 2920
  non-empty strings, 100% `cell://`/`embedding:`-prefixed, 0 garbage.
  **What stays open (documented, not reopening the item):** the fit's
  actual *computed number* (e.g. Slope = -1.5) is not recoverable this
  way in either container — checked directly against `fitreport2.opju`'s
  byte range for both raw and FPC-compact float64 encodings of 9.5/-1.5,
  no match; the `cell://` string only names *which* statistic a cell
  represents. Both non-double families attach as
  `metadata["origin_report_sheets"]`, never `.values`/`.labels` (data
  contract intact). Synthetic CI fixtures (both containers, incl. the
  report-only pseudo-book case) + realdata anchors added; full writeup in
  `docs/origin_project_format.md` §3.2/§3.4.
- ~~**#19 Synthetic fixture builders**~~ (2026-07-04) — audited every
  `src/quantized/io/origin_project/` decoder against its test file (see
  table below); most already had synthetic in-test builders from earlier
  items, so only the real gaps were filled, following each file's
  existing builder style (`tests/test_io_origin_project.py`):
  `figures.py` (.opj graph-window decode: name/axis-range/log-heuristic/
  curve-count/annotations/source-hint, multi-graph + worksheet-closes-
  graph, legend-text curve-count fallback — it previously had ZERO
  positive-path synthetic coverage, only realdata anchors + a negative
  "absent" check), `windows.py`'s multi-sheet "closed" guard (repeated
  short column name signalling sheet 2+, previously only implicitly
  exercised via Moke.opj's fit-table sheets), and `windows.py` +
  `windows_opju.py`'s multi-book isolation (per-book anchor
  cursor/state, previously only single-book blobs tested). No corpus
  bytes committed. Audit table (decoder → synthetic-CI-covered? → gap):
  container.py block walker → yes (`_block`/`_zero`/`_header`/`_data`) →
  none; opj.py worksheet data/grouping/inline-text/garbage-gate → yes
  (multiple tests) → none; windows.py names/units/designations → yes,
  gaps filled (multi-sheet guard, multi-book); figures.py graph records
  → NO real coverage, gap filled; opju_codec.py FPC+RLE+chunked-
  staircase → yes (comprehensive, incl. low-width codes) → none;
  opju.py book assembly → yes (via `read_origin_books` wiring test) →
  none; windows_opju.py marker+label grammar → yes, gap filled
  (multi-book); figures_opju.py specimen + real-corpus forms → yes
  (extensive, `test_io_origin_figures_opju.py`) → none; notes.py
  results-log + notes-windows → yes → none; writer.py round-trip → yes
  (`test_io_origin_writer.py`) → none.
- ~~**#25 COM "Send to Origin"**~~ (2026-07-04) — `io/origin_com.py` behind
  the `QZ_ORIGIN_COM=1` env flag: `com_available()` (never raises, OS+flag+
  pywin32 gated) + `send_to_origin()` (one workbook per DataStruct via
  `newbook`/`PutWorksheet`/`range lname$/unit$`, time column first). Thin
  routes `GET /api/export/origin-com/status` + `POST /api/export/origin-com`
  (409 → points at the `.ogs` path). `origin-com` optional-dep group
  (`pywin32; sys_platform == 'win32'`), 16 mock-based tests (guard #10 —
  never a CI requirement). **LIVE-VERIFIED against real Origin 2026b**
  (student license): book created, values cell-exact, X labels from
  metadata, units land. Live run exposed + fixed two defects: LabTalk has
  NO backslash escape (embedded `"` now downgrades to `'`) and the
  writer-family `x_column_long`/`x_unit` metadata keys are now accepted.
- ~~**#22 Structured results-log parsing**~~ (2026-07-04) — `parse_results_log()`
  turns each timestamped `results_log()` record into
  `{"timestamp", "operation", "params"}` (params nested by `Input`/`Output`/etc.
  section headers; unparseable lines collect in `"extra"` rather than being
  dropped). `_with_provenance` attaches `metadata['origin_results_log_records']`
  alongside the raw text whenever at least one record parses. Moke-validated
  (`subtract_line` + `[Book4]Sheet1` params recovered structurally, matching
  the existing raw-text anchor).
- ~~**#20 Format-doc consolidation**~~ (2026-07-04) — folded all three
  `docs/origin_re/` reports (`opj_windows_section.md`, `opj_figures.md`,
  `opju_container.md`) into `docs/origin_project_format.md`, reorganized by
  topic (container → worksheet data → windows metadata → sheet hierarchy →
  figures → notes/results-log → export → testing → provenance → open
  items) instead of discovery order; cross-checked every byte-level claim
  against the current `src/quantized/io/origin_project/` source (found and
  folded in one fact that had drifted past the reports — the `.opju`
  figures' combined axis-scale byte `0x03`/`0x04`/`0x0d`, documented only in
  `figures_opju.py`'s module docstring — plus a `.opj` Y-error column
  marker refinement `0x30` and the real `../test-data/origin/` corpus path,
  both likewise code-only). Added the user-facing
  `docs/opening_origin_files.md` (what importing gets you, known
  limitations, export guidance). Each consolidated report now carries a
  short pointer stub; `docs/origin_re/validation_log.md` is untouched (a
  live log, not a report). Docs-only change, `src/`/`tests/` untouched.
- ~~**#6 Notes windows + results-log text**~~ (2026-07-04, `8cf0b42`) —
  BOTH halves now shipped. Results-log half (`20d54fa`): timestamped
  operation records → `metadata['origin_results_log']`, both containers,
  Moke-validated. Notes-windows half: a licensed-trial specimen
  (`notes_probe.opju`, planted "QZNOTE" text — `generate_specimens2.py`)
  unblocked a validated scraper for the contiguous CPYUA framing
  `93 <nl> <name> 00 0a <tl> <text> 00`; recovers the exact planted lines
  AND matches **zero** records across the whole real corpus (no speculative
  attach), landing in `metadata['origin_notes']` = `{window: text}`. Read
  once alongside the log in `_with_provenance`. `.opj` (CPYA) is scanned by
  the same byte-level pass (false-positive-clean on the corpus) but has no
  known-content oracle (Origin 2023+ can't write `.opj`).
- ~~**#33 X-axis lin/log flag upgrade**~~ (2026-07-04, `8cf0b42`) — the byte
  after `81 04 06 00 00 01 c3 66` is a **combined** axis-scale flag, not
  Y-only, pinned from four licensed-trial specimens toggling X, Y, and both
  (`fig_linx`/`fig_logx`/`fig_xylog`): `0x03` x-lin+y-lin, `0x04` x-log+y-lin,
  `0x0d` y-log (X unencoded once Y is log — the additive "`0x0e` both-log"
  guess was **measured false**). X-log is now recovered in the Y-linear case
  via a targeted `_scale_byte` read that survives the X-log record's shifted
  filler (the full specimen parse fails there); Y stays exact; the 14
  real-corpus anchors (no marker) are untouched. `fig_xylog`'s X honestly
  stays on the decade heuristic — a documented format limitation.
- ~~**#33 `.opju` figures — real-corpus record shape**~~ (2026-07-04) —
  solved the item-33 grammar and extended `figures_opju.py` with a
  real-corpus path (specimen path untouched; tried first). RLE count law:
  `c2` = run of exactly 5 repeated bytes, `c3` = exactly 6; the byte after
  the rep byte is a context/tag byte (NOT a count — 01/02/03/0a observed for
  identical structures), then literal suffix bytes complete the 8-byte LE
  double; lead-form (`<lead> c2/c3 …`) and run-first (`c3 …`, e.g. 1.4 =
  `c3 66 03 f6 3f`) alignments both occur. `85 02 f0 3f` resolved as a
  tagged `y_from=1.0` (whole-span exact-fill + GT) — the real form has NO
  isolated lin/log flag; the `.opj` decade heuristic is used and is correct
  for every corpus anchor. Optional X flag tokens (`89 01`/`89 18`/`97 03`/
  `91 09` 2-byte; bare `91` before run-first RLE 1-byte) skipped via a
  deterministic length rule; semantics open, no GT-type correlation.
  Validated **14/14 real anchors** (RockingCurve 3, XAS 3, UnpolPlots 4,
  "Fixed Lambdas SI" 4) at 1e-9 rel with correct lin/log + specimens 6/6
  (no regression). Composite windows (Graph3 families) reference existing
  layers — anchors < GT layers by design. Synthetic real-form CI tests +
  strict realdata anchor-count tests added.
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
- ~~**#14 `.opju` figures**~~ (2026-07-04) — `figures_opju.py::extract_figures_opju`,
  same payload shape as `.opj`'s `extract_figures`. RE: the layer axis record
  opens with marker `03 00 00 1f`, then X `(from,to)`, a step field, a fixed
  `81 04 06 00 00 01 c3 66` marker whose next byte is the isolated Y-axis
  linear/log10 flag (`0x03`/`0x0d`, pinned from the `fig_lin`/`fig_log`
  single-variable diff pair), a 3-byte filler, then Y `(from,to)` + step.
  Each value is a bare/tagged 8-byte literal, a tagged 1-3 significant-byte
  compact form, or elided when exactly 0.0; the 2-byte tag itself was never
  cracked, so a backtracking parser tries every admissible split and accepts
  only the unique one that both consumes the span exactly and yields two
  plausible values — ambiguous or unknown spans are dropped, never guessed.
  Validated 6/6 layers exact vs Origin's own ground truth (`fig_lin`,
  `fig_log`, `fig_pairs`'s 4-layer graph). X has no isolated log flag (no
  log-X specimen existed) so it reuses `.opj`'s decade heuristic. **Known
  gap (new item #33):** real corpus graphs (bound curves, custom axis
  dialogs) don't share this exact record shape — the decoder safely returns
  no figures for them rather than guessing (confirmed via the `specimens/
  converted/` re-saved corpus files, ruling out a version difference).
- ~~**#10 `.opju` column names/units**~~ (2026-07-04) — cracked the CPYUA
  windows-section marker+label grammar (`windows_opju.py`): a 2-byte
  designation marker (`21 51`=X, `21 61`=Y, `30 61`=Y-error, reusing `.opj`'s
  own marker-byte + display-code convention) precedes each column's
  `<len:u8><tag:u8><LongName\r\nUnit\r\nComment><NUL>` label record; books
  anchored via the embedded `ImportFile` filename (alnum-stripped, handles
  Origin dropping underscores) or a `<len=namelen+2>\x00\x00<name>`
  window-header reference; columns associated by ordinal position within a
  book's contiguous marker run (letters, not a parsed short-name field — none
  was pinned for CPYUA) because undecodable columns still emit a marker.
  Wired into `opju.py`/`_build_book` exactly like `.opj`'s `window_metadata`
  (designation-X → x axis, book titles from the import filename). Validated
  151/151 names, 130/130 units, 17/17 comments across every decodable column
  in the oracle corpus (XAS, RockingCurve, UnpolPlots, "Fixed Lambdas SI",
  rosetta_*); runs clean (no false positives) on the unlabeled probe/fig
  specimens and the 16 MB/1390-column `Hc2 data.opju` stress file. Full report
  in `docs/origin_re/opju_container.md` "SOLVED — item 10".
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
