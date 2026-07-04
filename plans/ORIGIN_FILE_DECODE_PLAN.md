# Origin File Full-Decode Plan (.opj / .opju → quantized)

Open OriginPro project files in quantized without owning Origin: every
workbook's data (not just the largest), real column names/units, the
newer `.opju` format, and the saved figures. All clean-room reverse
engineering (Apache-2.0; the GPL `liborigin` is a format *reference
only*, never a dependency, never copied — this supersedes
ORIGIN_GAP_PLAN #44's external-converter idea). M1 (`.opj` numeric
worksheet data, largest book) shipped 2026-07-03; this plan covers
everything remaining.

**Status:** Active
**Created:** 2026-07-03
**Updated:** 2026-07-03

---

## Context

### How the pieces fit together

- `src/quantized/io/origin_project.py` — the shipped M1 decoder:
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

- **Items 1, 7, 11 (the three RE items) are independent — wave 1,
  run in parallel as subagents.**
- 2 needs 1 · 5 needs 1 · 8 needs 7 · 9 needs 8 · 10 needs 1+8 ·
  12 needs 11 · 13 needs 12+16 · 14 needs 7+11 · 17 needs 16 ·
  18 needs 13+16 · 19 needs the matching RE item · 21 needs 1/11.
- **15 (package split) precedes every new decoder** (2, 8, 13) — the
  500-line module ceiling forces the split before code lands.
- 3 and 16 are independent of all RE and can start any time; 16/17
  need owner UX decisions (AskUserQuestion at design time).
- 12 should coordinate with ORIGIN_GAP_PLAN #12 (FigureDoc entity) —
  imported Origin figures should land as the same document type.

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

---

## Cross-cutting priorities

| # | Item | Workstream | Why first |
|---|------|------------|-----------|
| 7 | `.opju` container RE | W2 | the only path to the newer half of the corpus; hardest unknown → fable |
| 1 | windows-section RE | W1 | unlocks real names/units + book/sheet structure for everything downstream |
| 11 | figure-model RE | W3 | figures are the stated goal ("I really don't want to lose the figures") |
| 15 | split `io/origin/` package | W4 | ceiling headroom before any new decoder can land |

---

## W1 — `.opj` data completion

### Tier 1 — High Impact

1. **Windows-section RE** — recover column long-names, units,
   designations (X/Y/Z/error), book/sheet display names, and the
   window↔dataset mapping rule from the `.opj` windows section
   *Model: opus · data-format-detective · WAVE 1.*
   - [ ] Map the windows-section layout (starts where the M1 block
         walker's framing breaks, ~60% into Moke.opj)
   - [ ] Correlate window column entries to `<Book>_<Col>` datasets
   - [ ] Validate: Moke.opj Book5 column N long-name "Kerr Signal",
         X column long-name "H" (evidence already in the file)
   - [ ] Report: `docs/origin_re/opj_windows_section.md`

2. **Names/units decode implementation** — wire the windows-section
   findings into the decoder so `DataStruct.labels`/`.units` carry the
   user-facing names; keep honest A/B/C fallback when absent
   *Model: sonnet · needs 1 + 15.*

3. **Multi-book extraction backend** — a `read_origin_books()`-style
   pure API returning every workbook as its own DataStruct, plus a
   listing call; `read_origin_project` keeps its current
   largest-book behaviour for the single-file contract
   *Model: sonnet · independent of RE; pairs with 16.*

### Tier 2 — Medium Impact

4. **Non-double column value types** — text, int, float32 columns
   (the 147-byte column header carries a type field M1 ignores);
   decode or skip-with-metadata, never garbage
   *Model: opus (RE mini-pass) then sonnet (impl) · needs corpus
   examples identified during 1.*

5. **Sheet hierarchy** — Book→Sheet→columns for multi-sheet books
   (evidence: `[Book5]Sheet1!` references) instead of the flat
   book_col model
   *Model: sonnet · needs 1.*

### Tier 3 — Nice-to-Have

6. **Notes windows + results-log text** — import as dataset metadata /
   a text attachment (the analysis log is plain text in the windows
   section and holds fit provenance)
   *Model: haiku.*

---

## W2 — `.opju` container (M2)

### Tier 1 — High Impact

7. **`.opju` datasets-section framing + compression RE** — crack how
   CPYUA stores worksheet columns: the type-tagged framing after the
   shared 123-byte file-header block, where the compressed payloads
   are (raw-deflate suspected — the visible zlib streams are preview
   images), and the record layout
   *Model: **sonnet** (was fable; the fable run died on the spend
   limit with no report, and the trial specimens changed the job:
   hunt known values `111.125, 222.25, …` + strings `Field`/`Moment`
   from `specimens/rosetta_min.opju`, diff `rosetta_lname.opju` for
   label storage, validate against `specimens/ground_truth/`).
   Escalate to opus only if a sonnet pass demonstrably stalls.*
   - [ ] Framing grammar with hex evidence + offsets
   - [ ] Locate + decompress column payloads; confirm record layout
   - [ ] Validate: decode one full known-physics column (RockingCurve
         angle scan or XAS energy scan) end-to-end
   - [ ] Report: `docs/origin_re/opju_container.md`

8. **`.opju` decoder implementation** — implement `_read_opju` from
   the RE spec; same DataStruct contract as `.opj`
   *Model: sonnet · needs 7 + 15.*

9. **`.opju` tests** — synthetic fixture (if the format permits a
   minimal one) + realdata anchors for all five corpus `.opju` files
   *Model: haiku/sonnet · test-writer · needs 8.*

### Tier 2 — Medium Impact

10. **`.opju` feature parity with W1** — names/units + multi-book on
    the `.opju` path once both sides exist
    *Model: sonnet · needs 1 + 8.*

---

## W3 — Figures (M3)

### Tier 1 — High Impact

11. **Figure-model RE** — map the `.opj` graph windows:
    Graph→Layer→Curve structure, how curves reference datasets by
    name, axis ranges/scales(log)/titles, curve type/color/symbol/
    line style, legend content, annotations
    *Model: opus · data-format-detective · WAVE 1. Known: Graph/
    Layer/Curve/Legend tokens present (Moke.opj ~105 Graph tokens);
    lives in the windows section alongside item 1's targets.*
    - [ ] Graph window layout + curve→dataset reference format
    - [ ] Axis model (range, scale, labels) + style attributes
    - [ ] Validate: Moke figures should reference Book4/Book5 H vs
          Kerr-signal columns; XRD graph likely log-intensity
    - [ ] Report: `docs/origin_re/opj_figures.md`

12. **Origin-graph → quantized plot-spec mapping design** — decide
    what an imported figure becomes (plot state / FigureDoc per
    ORIGIN_GAP_PLAN #12), which Origin properties map, and the
    documented gap list (what won't survive import)
    *Model: opus · code-architect · needs 11.*

13. **Figure decode + import implementation** — parse graph windows,
    emit the mapped spec, land imported figures in the library
    *Model: sonnet · needs 12 + 16.*

### Tier 2 — Medium Impact

14. **`.opju` figures** — the same pipeline on the CPYUA container
    *Model: sonnet · needs 7 + 11.*

---

## W4 — Import flow & UX

### Tier 1 — High Impact

15. **Split `io/origin_project.py` → `io/origin/` package** —
    `container.py` (walker/records), `opj.py`, `opju.py`,
    `windows.py`, `figures.py`; behaviour-preserving, tests green
    before/after — **do this before any new decoder lands**
    *Model: sonnet · independent; the 500-line ceiling makes it
    mandatory prep.*

16. **Multi-dataset import flow** — one file yielding many datasets:
    route shape, store handling, naming (`Moke:Book4` style?),
    default selection — **needs owner UX decision** (import-all vs
    picker vs primary+expand)
    *Model: sonnet · AskUserQuestion at design time; pairs with 3.*

17. **Workbook picker UI** — tree of books/sheets/columns with
    row/col counts; select which to import; "import all"
    *Model: sonnet · ux-frontend-expert · needs 16.*

### Tier 2 — Medium Impact

18. **Figure restore UX** — imported figures appear as restorable
    plot documents (per 12's mapping); owner decision on where they
    surface (Library "Figures" section per ORIGIN_GAP_PLAN #12)
    *Model: sonnet · needs 13 + 16.*

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

## Completed

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
