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
**Parent:** MAIN_PLAN.md
**Created:** 2026-07-03
**Updated:** 2026-07-12 (#48–#51 completed in PRs #25–#28; #52 curve and axis
fidelity in progress). Prior:
booked the owner-prioritized **Plot Fidelity +
Workbook Fallback campaign**, items #48–#56. Governing outcome: recover an
Origin graph as an editable Quantized plot as exactly as the file and proven
format knowledge allow; when any property cannot be reconstructed, preserve
the original graph preview when available, disclose the loss explicitly, and
offer a one-action path to the exact source workbook/columns or a pre-seeded
Graph Builder. Plot recovery and workbook-backed remake are now higher
priority than matrix books, reports, attachments, standalone Origin window
formats, and `.opju` writing. Item #47 is promoted into this campaign now
that MAIN #25/#27 provide its native target model.) Prior:
2026-07-12 (booked #47: recover Origin drawn graphic objects + richer
annotations on import — originally LOW PRIORITY, W3 Tier 3). Prior:
2026-07-09 (a single-day campaign from the owner's PNR.opj
import testing: the four triage fix batches — perf quick wins, zero-tail
wrap-around prune, log tick steps, y2/legend/multi-panel fidelity — all
MERGED and recorded in Completed; **#38 lazy per-book transport CLOSED**
(84.72 MB → 3.84 MB import response, see Completed — its own deferred
compute/export-on-preview edge was closed same day, see Completed);
**#40 CLOSED** — the
`#39` gallery run's 6 invisible merge-window graphs were a 3rd,
previously-unrecognized layer head byte (`0x5f`), now decoded; #42
investigated, root cause narrowed for both halves (an undecoded per-curve
hidden flag; a real but unprovable-by-byte axis-unit-conversion gap),
neither fixed — see item text + `docs/origin_project_format.md`; #39
gallery tooling merged, oracle re-export in progress; **#43 CLOSED** — the
owner's two live-testing annotation-placement repros (PNR/Book15 label
over a tick, PNR/Book14 Graph11 multi-panel labels clipped on the y axis)
were ONE frontend `ctx.textAlign` inheritance bug, not a decode fault; **#44
CLOSED** — the owner's rich-text-escape axis-label repro (same session)
traced to column Long Name/Unit/Comment + book titles never running
through `clean_richtext` (axis titles themselves were already correct);
fixed at `opj._build_book`, the one chokepoint shared by `.opj`/`.opju`;
**#45 CLOSED** — the multi-panel path never applied Origin's
error-column pairing/hidden-channel suppression at all (PNR/Book14
Graph11's `dSA` rendered as a spurious series), now fixed at the
`figureChannelSelection`/`useMultiPanelStage` chokepoint for both the
spatial and plain-stack modes; **#46 CLOSED** — the owner's "lack of
bounding walls" request: shared-x stacked panels (same repro, Graph11) now
render flush with per-panel walls and bottom-only x labels, plus an
Origin layer's explicitly-blank title no longer gets a synthesized
fallback — see Completed)
Previous: 2026-07-07 (item 34 CLOSED — the native `.opj` writer now
loads in real Origin and re-exports value-exact, see Completed; item 35's
stale W3 body text reconciled — the item was already CLOSED 2026-07-04 at
100%/100% per this header + Completed + the format doc, but its open-item
narrative was never condensed (re-scored today: 36/36, 0 wrong; realdata
suite green); items
36–37 booked into W4 from the gap-register deferrals §13.2 #17/#6;
previous update 2026-07-04: item 35's `.opj`-side
sub-question — item 11's
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
36/36 (100%), up from 30.6% — moved to Completed. Same day, **item 26
(Figure export) CLOSED**: the `.ogs` GRAPH block now exports the current
plot state (channels/x-source/log axes/limits/y2 split), descoping the
`needs 12` FigureDoc dependency by reading the live plot-store fields
directly instead — see Completed for detail.

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
| ~~34~~ / ~~25~~ / ~~33~~ / ~~4~~ / ~~10 / 16 / 32~~ / ~~1 / 7 / 8 / 9 / 11 / 14 / 15 / 17 / 18 / 19 / 20 / 22~~ | `.opj` writer (CLOSED 2026-07-07) + Send-to-Origin + all decode + import flow + W4 UI + docs + log parsing + fixture audit | — | done, see Completed |

---

## Plot Fidelity + Workbook Fallback campaign (owner priority, 2026-07-12)

### Product outcome

For every graph page in an imported `.opj`/`.opju` project, Quantized must
provide the strongest available result in this order:

1. **Editable reconstruction** — restore the correct workbooks, X/Y/error
   columns, layers, axes, styles, legends, annotations, and layout into native
   Quantized plot state.
2. **Original visual reference** — when the project contains a saved graph
   preview, preserve it beside the editable reconstruction so the user can
   compare against what Origin saved rather than trust an approximate decode.
3. **Fast remake fallback** — if reconstruction is incomplete, one action
   opens the correct source workbook(s) and exact columns, or launches Graph
   Builder pre-seeded with those bindings and the decoded portion of the plot.
4. **No silent loss** — every graph receives a fidelity status and a concrete
   list of decoded, approximated, and unsupported properties. Missing graph
   objects never disappear without a visible warning.

"Exact" therefore means pixel-referenceable plus natively editable wherever
the binary semantics are proven. It does **not** authorize guessing proprietary
fields from one project. A saved preview may be stale or low-resolution; label
it as the file's saved reference, never as guaranteed-current ground truth.

### Acceptance criteria

- Importing any project in `../test-data/origin/` produces a graph inventory:
  total graph pages/layers, editable graphs, preview-backed graphs, disabled
  graphs, and per-graph omissions.
- Applying a graph never reads a lazy/downsampled book when full source data is
  required. Cross-book overlays contain the full source row counts and remain
  reproducible after re-apply, workspace save/reload, and export.
- Every curve with a proven binding opens the exact Origin book/sheet and
  X/Y/error columns. Cross-book figures open all participating sources.
- A graph with an incomplete reconstruction offers **Remake in Graph Builder**
  with resolved datasets, channel roles, layer grouping, axis state, and
  decoded styles already populated.
- Original saved previews, where present and attributable to a graph, are
  viewable next to or toggled against the editable reconstruction.
- Corpus comparison reports regressions structurally and visually; no item is
  closed from synthetic fixtures alone when a real-corpus oracle exists.
- Unsupported data is reported, not silently omitted. Precision remains the
  decoder invariant: omit an unproven property rather than attach it wrongly.

### Codex model routing (cost-aware, verified 2026-07-12)

Use the least-expensive model that can satisfy the task **correctly**, and
escalate by evidence rather than task size. Current official guidance describes
`gpt-5.4-mini` as the strongest mini model for coding and subagents, and
`gpt-5.3-codex` as the most capable agentic coding model. Model availability in
the Codex app can differ by account/rollout; if these exact names are absent,
use the current mini coding model for **Mini** and the current strongest Codex
coding model for **Codex**. Do not fall back to deprecated Codex models merely
to preserve the literal names below.

| Routing label | Model / effort | Use for | Do not use for |
|---|---|---|---|
| **Mini** | `gpt-5.4-mini`, medium by default; high for multi-file implementation | Mechanical refactors, schema plumbing from a written contract, fixtures, test expansion, corpus sweeps, report generation, docs, and straightforward UI components | Open-ended binary RE, ambiguous graph attribution, cross-store concurrency design, or deciding a new architecture |
| **Codex** | `gpt-5.3-codex`, medium/high | Normal feature ownership across backend + frontend, async correctness, API/store integration, renderer changes with a clear target, and review of Mini work | Exhaustive RE by default; raise effort only when an ambiguity is demonstrated |
| **Codex RE** | `gpt-5.3-codex`, xhigh | Proprietary binary-format inference, competing byte-layout hypotheses, cross-corpus attribution, high-risk architecture, and final scientific-fidelity adjudication | Boilerplate, routine tests, formatting, documentation, or running known comparison scripts |

**Escalation rule:** start at the item's default below. Escalate Mini → Codex
only after a failing test, ambiguous contract, or cross-layer design decision
shows Mini cannot proceed safely. Escalate Codex → Codex RE only after recording
at least two plausible interpretations, or when a wrong interpretation could
silently attach the wrong data/graph property. Once RE produces a written byte
contract and fixtures, route implementation and bulk tests back down to Mini.
Do not repeat an already-negative RE hypothesis at higher effort without new
ground truth. A Codex/Codex RE reviewer may audit Mini output without rewriting
it when the gates are green.

Per-item routing summary:

| Item | Default owner | Split / escalation |
|---|---|---|
| **#48 Full-data figure apply** | **Codex (high)** | Async/store correctness stays Codex; Mini adds matrix tests and mechanical call-site updates after the concurrency contract is fixed. Escalate to Codex RE only if source-revision semantics require a new workspace architecture. |
| **#49 Fidelity manifest** | **Codex (medium)** for contract, then **Mini (high)** | Codex defines project/graph diagnostics and retention semantics; Mini implements serializers, UI lists, `.opj` gate parity, corpus counts, and docs. |
| **#50 Workbook/remake actions** | **Codex (high)** | Cross-book identity, pending resolution, and Graph Builder seeding span stores; Mini may implement isolated buttons/tests once the action payload is specified. |
| **#51 Saved graph previews** | **Codex RE (xhigh)** for attribution, then **Mini (high)** | RE only for record boundaries and graph attribution. Image extraction, hashing, API transport, UI toggle, and fixtures return to Mini after the format contract is written. |
| **#52 Curve/axis fidelity** | **Codex RE (xhigh)** per unknown field | Use RE only for visibility/style/axis byte inference and oracle adjudication. Each proven field becomes a small Mini implementation + test task; renderer integration needing new axis semantics uses Codex high. |
| **#53 Graphic objects** | **Codex RE (xhigh)** for object records, then **Codex (high)** | RE establishes class/geometry/style records; Codex maps them across plot surfaces and `.dwk`; Mini expands fixtures and corpus sweeps. |
| **#54 Layer/page layout** | **Codex RE (xhigh)** for target architecture, then **Codex (high)** | The FigureDoc/page-layer decision and ambiguous Origin geometry need the strongest model; bounded renderer components and tests can be delegated to Mini after interfaces freeze. |
| **#55 Acceptance matrix** | **Mini (high)** | Mostly tooling, deterministic reports, corpus execution, and docs. Codex high reviews surprising diffs; Codex RE adjudicates only a disputed `exact` label or unexplained byte/visual mismatch. |
| **#56 Campaign close** | **Codex (high)** | End-to-end audit and scientific-fidelity sign-off. Owner performs the visual acceptance gate. Codex RE is reserved for a specific remaining mismatch that blocks closure. |

Official model references used for this routing:
`https://developers.openai.com/api/docs/models/gpt-5.4-mini` and
`https://developers.openai.com/api/docs/models/gpt-5.3-codex`.

### Tier 1 — correctness and fallback first

48. ~~**Resolve full source books before applying an Origin figure**~~
    **COMPLETE 2026-07-12 (PR #25; derived-overlay rebuild/version follow-up
    in PR #40).**
    (**P0 correctness bug**). `applyOriginFigure` currently builds a cross-book
    overlay synchronously from sibling datasets; lazy books may still contain
    only the 256-point import preview. The later source fetch replaces the
    books but never rebuilds the synthetic overlay, leaving a plausible-looking
    permanently downsampled dataset.
    - Make figure application await every referenced pending dataset before
      channel selection, panel resolution, or `buildOverlayDataset`.
    - Keep the UI responsive with a busy state and a cancel/staleness guard if
      the user applies a different figure while resolution is in flight.
    - Never cache/reuse an overlay whose source revision or full-data state no
      longer matches its provenance.
    - Tests: pending cross-book books with previews shorter than full data;
      re-apply; new-window apply; export/analysis sees full rows; fetch failure
      leaves no partial overlay and offers the workbook fallback.

49. ~~**Per-graph fidelity manifest + consistent actionable-figure gate.**~~
    **COMPLETE 2026-07-12 (PR #26).**
    Build a project/graph inventory at the import boundary instead of passing
    only successful figure dicts. Each page/layer records decoded curves,
    source resolution, preview availability, recovered property groups, known
    omissions, and confidence (`exact`, `best_effort`, `reference_only`,
    `unresolved`).
    - Apply `drop_nonactionable_figures` consistently to `.opj` and `.opju`
      presentation lists while retaining omitted/internal records in diagnostics.
      Pin the real `XMCD.opj` regression (61 currently disabled/dead rows).
    - Surface an **Imported with omissions** summary plus per-figure details;
      do not flood the Library with dead system/storage anchors.
    - Keep raw/project inventory in a project-level artifact so filtering the
      Library never destroys provenance needed by later decoders.

50. ~~**Exact source-workbook and remake actions.**~~ **COMPLETE 2026-07-12
    (PR #27; multi-X remake follow-up on
    `codex/origin-multix-remake`).** Add first-class actions on
    every Origin figure: **Open source workbook(s)** and **Remake in Graph
    Builder**.
    - Resolve pending books before opening; focus the actual sheet pseudo-book
      and select the bound X/Y/Y-error columns.
    - For cross-book figures, preserve curve order and expose all participating
      books without resolving against same-named books from another import.
    - Seed Graph Builder with decoded curve bindings, layer/panel grouping,
      axes/limits/scales/titles, series styles/labels, annotations, and regions.
    - Unresolved bindings remain visible with their raw Origin hint/id and a
      manual source picker; never choose a similarly named book silently.

51. ~~**Recover and attribute saved graph previews.**~~ **COMPLETE 2026-07-12
    (PR #28).** Inventory the embedded PNG/
    bitmap/EMF preview records already observed in both containers and attach
    them to graph pages by proven page/window boundaries or ids.
    - Reuse `preview.py` where the record family matches; split graph-preview
      extraction into a bounded pure module if it does not.
    - Preserve original bytes when safe, plus dimensions/format/hash and an
      attribution confidence. Never recompress the reference asset.
    - UI: original/editable toggle or side-by-side comparison, with explicit
      `saved Origin preview` labeling and stale/low-resolution caveat.
    - If attribution is ambiguous, keep the image in diagnostics rather than
      attach it to the wrong graph.

### Tier 2 — close corpus-visible plot mismatches

52. **Curve and axis fidelity campaign.** **IN PROGRESS: line/scatter/
    line+symbol and verified dimensions merged in PR #29. The speculative
    byte-17 segment-connect work in PRs #30/#31 was reverted by PR #32; do not
    restore it without the independent evidence required by `AGENTS.md`.**
    Drive this item from the existing
    Origin↔Quantized gallery and structural report, ordered by how many real
    graphs visibly differ.
    - Per-curve visibility/hidden state, using new independent ground truth;
      do not reopen #42 from the currently confounded PNR bytes alone.
    - Worksheet-unit→axis-unit conversion with a typed, tested dimensional
      conversion model (including the evidenced Å↔nm cases), applied to data,
      limits, ticks, annotations, and regions together—never title-only.
    - Oracle-verified line width, symbol size/shape, line+symbol combinations,
      connect mode (straight/step/spline where representable), dash, edge/fill,
      and curve order/grouping.
    - Axis direction, top/right axes, tick direction/format, breaks, and
      non-log scale types only where the Quantized renderer has a truthful
      native equivalent; otherwise record the omission and retain the preview.

53. **Graphic objects and rich annotations** — this campaign's promoted form
    of item #47. Decode Origin arrows, arbitrary lines, standalone rectangles/
    ellipses, framed text, and callouts onto the native `Shape`/annotation
    models. Preserve coordinate space (data/layer/page), z-order, line/fill,
    arrowheads, and frame style where proven. Apply on single, double-Y, and
    spatial-panel paths and round-trip through `.dwk`. Item #47 closes only
    when this item closes; its older W3 text remains as the RE detail record.

54. **Layer/page layout fidelity.** Extend the current tiled-panel + double-Y
    recovery to free-positioned/overlapping layers, insets, independent axes,
    and more than two Y axes without flattening the source composition.
    - Prefer a generalized FigureDoc/page-layer model over more singleton plot
      state branches.
    - Preserve exact page/frame geometry for publication export.
    - When the target cannot express a layout, show the original preview and
      seed Graph Builder with one editable panel per recovered layer.

### Tier 3 — acceptance and handoff

55. **Corpus-wide plot-fidelity acceptance matrix.** **IN PROGRESS: durable
    per-graph JSON/CSV aggregation and review import/export in PR #41.**
    Extend the existing
    comparison tooling to emit one durable row per Origin graph: source books,
    curves, layers, preview, fidelity status, omissions, structural diff, and
    screenshot-review status.
    - Run all 12 real `.opj`/`.opju` projects plus controlled specimens.
    - Pin counts and representative screenshots without committing private
      project bytes or exports.
    - Owner eyeball remains required for graphs labeled `exact`; record every
      mismatch as a numbered item rather than weakening the label.

56. **Campaign close / deferred-secondary handoff.** Close only when the owner
    can import a real project, identify the intended graph, compare it to the
    saved Origin preview, edit/export the reconstruction, and remake it from
    preselected source columns without reopening Origin. At close, re-rank the
    explicitly secondary work: matrix books, report/analysis artifacts,
    attachments/internal Excel/layout preservation not needed by graph pages,
    standalone `.ogw(u)`/`.ogg(u)`/`.ogm(u)`, worksheet/matrix templates, and
    `.opju` writing.

### Delivery slices and estimate

- **PR 1 (complete):** #48 + #49 correctness, diagnostics, corpus regressions
  shipped as PRs #25 and #26.
- **PR 2 (complete):** #50 workbook/Graph Builder fallback shipped as PR #27.
- **PR 3 (1–2 days):** #51 original-preview preservation and comparison UI.
- **PR 4 (2–4 days):** #52 + #53 highest-frequency visual mismatches.
- **PR 5 (as evidence requires):** #54 layout generalization + #55 acceptance.

Expected focused campaign: **6–10 working days** for a strong corpus-validated
result. Unknown proprietary records or missing independent oracles can extend
individual fidelity items; they do not block the fallback contract or justify
silent loss. Use stacked/reviewable PRs rather than one unreviewable change.

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

(items 40-42 booked 2026-07-09 from the first #39 gallery run on PNR.opj;
item 40 CLOSED same day, see Completed)

~~41. **Layer-region shading + composite title objects**~~ COMPLETED
    2026-07-11 -- Rect* object class decoded (new header type tag 0x31 +
    130-byte body: fraction quad + two-type ocolor fill) in new
    io/origin_project/opj_shapes.py; composite multi-layer legends
    (case-insensitive legend routing, dotted layer.plot entries
    distributed + re-indexed) + comment-first legend text (PNG-oracle
    validated). Rendered as data via regionShadePlugin (drawClear,
    behind data) on all 3 surfaces + .dwk round-trip. Corpus sweep: 323
    shades decode with fill, zero failures; 49 figures gained legend
    labels; zero unrelated field changes. Transparency byte undecoded ->
    fixed 0.25 alpha, documented.

~~42. **Graph25 anomalies**~~ CLOSED as DOCUMENTED GAPS 2026-07-11
    (second dedicated RE pass; the not-fixing outcome per the
    samples-not-standards rule). Hidden T++/T-- curves: PNG oracles
    confirm legend-only; exhaustive 1096-anchor byte scan (0-518) finds
    NO flag separating hidden from both visible groups -- the
    book/visibility confound is total with this corpus. x10 x-range:
    layer doubles + __BCO2 axis-config byte-diff (rescaled vs not) are
    byte-identical -- Origin derives the x10 from the axis UNIT STRING,
    a project-wide convention (also Graph1's /10). Evidence:
    docs/origin_project_format.md section 6.3. Reopen ONLY with a
    specimen where visibility and book membership decouple.

### Tier 3 — Nice-to-Have

47. **Recover Origin drawn graphic objects + richer annotation types on
    import** (LOW PRIORITY, booked 2026-07-12 from the owner's shapes/
    annotations work). *Use:* an imported Origin figure that carries
    drawn markup — arrow pointing at Tc, a line, a standalone rect/
    ellipse circling a feature, a framed callout text box — currently
    drops that markup (the decode recovers curves, styles, legends,
    plain-text annotations, and Rect *fill*-shades [#41], but not
    graphic OBJECTS or rich/framed annotation variants). Recovering them
    means an imported figure lands complete, then editable with the
    pointer tool. *Passive* (happens on import; no UI to discover).
    - Newly unblocked: only worth doing now that quantized has a NATIVE
      target model to decode onto — the `Shape` model (MAIN #27:
      arrow/line/rect/ellipse) + rich-text/framed annotations (MAIN
      #25/#27). Depends on both landing.
    - Scope: decode Origin's graphic-object records (arrow/line/rect/
      ellipse as OBJECTS, distinct from the region-fill Rect* class
      already in `opj_shapes.py`) → map to `Shape`; decode richer text-
      annotation variants (framed/callout) → the annotation `frame`
      model. Apply through the SAME `applyOriginFigure` path all three
      surfaces share.
    - Discipline: obey `origin-import-fixes` (decode the object-record
      CLASS, never a per-figure special case) and `samples-not-
      standards` (a synthetic unit test for the record shape + a
      `realdata` anchor; document object types that can't be proven from
      the corpus as honest gaps in `docs/origin_project_format.md`,
      don't guess). Corpus-sweep the gallery (`tools/visual/
      origin_figures.mjs`) and report which OTHER figures gain objects.

(all prior W3 items shipped — see Completed)
~~35. **Figure curve→dataset binding**~~ **CLOSED 2026-07-04** — see
Completed. (The multi-day decode trail — anchor-record discovery, oracle
rework, near-miss exclusions, and the 0x01-subtype close — lives in
`docs/origin_project_format.md` §6.1.1/§6.2.1/§11 and the module
docstrings of `opj_curves.py`/`opju_curves.py`/`opju_curves_allcols.py`.)

(other W3 items shipped — see Completed)

---

## W4 — Import flow & UX

(earlier W4 items shipped — see Completed; the full Book→Sheet nesting UI
was deliberately descoped in #5, pseudo-books "`Book@N` (sheet N)" are
the shipped contract)

### Tier 2 — Medium Impact

~~36. **Multi-panel spatial apply (frontend)**~~ **CLOSED 2026-07-07** —
    booked from gap register §13.2 #17, shipped as
    `plans/GAP_ECOSYSTEM_PLAN.md` Tier 2 item 4 (same item — this repo's
    frontend work lives there, not here): `OriginFigure` gained the
    already-decoded `frame`/`page` fields, a new `lib/originPanels.ts`
    clusters frame quads into a rows×cols grid (ordinal-stack fallback when
    geometry is missing/degenerate/overlapping), and `applyOriginFigure`
    arranges resolved ≥2-layer windows into a new spatial multi-panel view
    (`MultiPanelStage.tsx`) while the existing 2-layer Y/Y2 `doubleYPartner`
    path stays first. Geometry verified against the real "Fixed Lambdas
    SI"!Graph6 file (2 contiguous stacked frames) via a direct decode +
    dedicated unit test; the full click-through + canvas screenshot
    (`tools/visual` harness) pass was not run — see that plan's
    `## Completed` entry for the full writeup and the eyeball caveat.

~~37. **y2 axis label from layer 2's decoded title**~~ **CLOSED
2026-07-07** — see Completed.

~~38. **Lazy per-book data transport**~~ **CLOSED 2026-07-09** — see
    Completed.

---

## W5 — Hardening & docs

### Tier 2 — Medium Impact

### Tier 3 — Nice-to-Have

21. **Templates (`.otp`/`.otpu`)** — same CPY family; a graph template
    could import as a quantized style preset
    *Model: sonnet · needs 1 + 11.*
    **BACKEND SHIPPED 2026-07-07** via `plans/GAP_ECOSYSTEM_PLAN.md`
    item 5 (`io/origin_project/templates.py` + `routes/import_template.py`,
    21+10 tests). Remaining (tracked THERE, not here): the frontend
    hook-in — `api.ts` client method + an "Import Origin template…"
    open-file branch landing the result in the saved graph-templates
    store.

---

## W6 — Export to Origin (quantized → Origin)

### Tier 1 — High Impact

(item 34 shipped — see Completed)

### Tier 2 — Medium Impact

### Tier 3 — Nice-to-Have

27. **`.opju` writer** — only if 24 ever proves insufficient; needs the
    outer-framing RE tail and confirmation Origin accepts all-literal
    codec streams (probe during a trial window)
    *Model: defer.*

---

## W7 — Testing hardening (both directions)

### Tier 1 — High Impact

~~39. **Side-by-side Origin↔quantized figure comparison campaign**~~
    **CLOSED 2026-07-09** — see Completed. Tooling shipped
    (`tools/origin_compare/export_origin_graphs.py` + `tools/visual/
    origin_figures.mjs`/`gallery.mjs`); final gallery + structural report
    in `../test-data/origin/_exports/PNR/`. Owner eyeball of the gallery
    remains the standing human step; new mismatches get booked here.

### Tier 2 — Medium Impact

(all W7 items shipped — see Completed)


## Completed

- ~~**#50 Exact source-workbook and Graph Builder fallback**~~ (2026-07-12,
  PR #27) — every decoded figure exposes its exact import-scoped source books
  and X/Y/error columns, resolves lazy data before opening, supports explicit
  manual binding, and seeds single-/cross-book remakes through the existing
  provenance-stamped overlay path.

- ~~**#49 Per-graph fidelity manifest + actionable-figure gate**~~
  (2026-07-12, PR #26) — added versioned project/figure fidelity diagnostics,
  omission reporting, persistent Library status, `.dwk` round-trip support,
  consistent `.opj`/`.opju` filtering, and the real XMCD regression that keeps
  stale hint-only records out of the actionable figure list.
- ~~**#48 Full-data Origin figure apply**~~ (2026-07-12, PR #25) — figure
  application now resolves every lazy source workbook before selecting
  channels or building cross-book overlays, with latest-request-wins safety,
  failure atomicity, exact-import sibling scoping, and full-row regression
  coverage.

- ~~**39. Side-by-side Origin↔quantized figure comparison campaign**~~
  (2026-07-09) — the full loop shipped and ran end-to-end the same day it
  was booked. Origin side: `tools/origin_compare/export_origin_graphs.py`
  (COM, watchdog-guarded, manifest-checkpointed, resumable, `--skip` for
  reliable hangers) exported **50 of the 52 graph pages the licensed
  Origin loads** from PNR.opj (2 honest skips: `Graph18` reliably hangs
  Origin's own exporter — quantized renders it fine — and `spark`, an
  auto-generated per-column sparkline page, not a user figure).
  KEY FINDING: the student-license page limit caps what Origin loads at
  52 pages — the raw file contains **101 graph windows, all decoded by
  quantized** (post-#40 0x5f fix); the clean-room reader recovers more of
  the owner's own project than the licensed vendor app will show. The
  ~49 quantized-only figures (incl. the whole /PNR/S11 subtree) are
  therefore *unverifiable against a COM oracle*, not unpaired bugs.
  quantized side: `tools/visual/origin_figures.mjs` (imports via the real
  backend, applies each Library figure family, screenshots the stage) +
  `gallery.mjs` (side-by-side HTML gallery with persisted per-figure
  eyeball-checklist chips) + `structural_report.json` (decoded axis
  range/log/step vs applied store state). FINAL RUN (after the day's full
  fix set — #43-46, walls, error bars, legends, fonts): 101 figures, 99
  resolved (2 dangling "Pd" refs, correct), **91 fully consistent**, 8
  known harness panel-count artifacts from the y2-merge feature;
  **paired=50, originOnly=0** — every Origin-exportable graph has a
  quantized twin. Deliverable: `../test-data/origin/_exports/PNR/
  gallery.html` (sample-derived — NEVER commit). Owner eyeball = the
  standing human step; each finding it produced today was booked and
  fixed same-day (#40-46 trail).

- ~~**44. Rich-text escapes leaking into axis labels (owner PNR.opj repro,
  Book14/Graph11 + elsewhere)**~~ (2026-07-09) — the owner's live-testing
  report ("the x-axis label is weird — some have `(A(A-1)` and others have
  `(Q(nm-1)`, also the superscript is broken on ALL") from the same PNR.opj
  session as #43. Two separate findings, both corpus-swept:
  - **Graph titles/legends/annotations were already correct.** Direct
    extraction (`figures.extract_figures` against `PNR.opj`, byte-hex
    verified) shows the existing `origin_richtext.clean_richtext`
    (2026-07-05) already decodes every axis title in the corpus correctly —
    e.g. `Q (nm\+(-1))` → `"Q (nm⁻¹)"`, nesting (`\g(\i(m))\-(0)\i(H) (T)` →
    `"μ₀H (T)"`) already resolves inside-out. The owner's report likely
    predates that fix or reflects the sibling gap below, seen "elsewhere" in
    the same file.
  - **The real, corpus-confirmed gap: column Long Name/Unit/Comment and book
    display titles were NEVER translated.** `opj._label_for`/`_book_long_name`
    /the `.units`/`x_unit`/`x_column_unit`/`column_comments` fields read the
    windows-section metadata verbatim — no `clean_richtext` call. Confirmed
    live: `MnN_Diffusion_PNR.opj`'s "Nuclear SLD" books carry a column Unit
    of literal `10\+(-6) A\+(-2)` (20 leaking strings across the file, 0
    exceptions). This leaked straight into the frontend's
    `${label} (${unit})` axis/legend composition (`uplotOpts.ts`,
    `PlotLegend.tsx`, `PlotContextMenu.tsx`, `clipboard.ts`) whenever a
    graph's own axis title is blank (Origin's "Auto" title, which falls back
    to the bound column's Long Name + Unit — several `PNR.opj` `Graph11`
    panels have exactly this blank-title shape) — the likely actual
    mechanism behind the report.
  - **Fix, one chokepoint:** `opj.py`'s `_build_book`/`_label_for`/
    `_book_long_name`/`_inventory` now run every column/book label field
    through `clean_richtext` — shared verbatim by `.opju` (`opju.py` reuses
    `_build_book`), so both containers fix at once. Zero frontend changes
    (translation happens backend-side, at extraction).
  - **Corpus sweep** (all 12 real `.opj`/`.opju` files, figures +
    column/book metadata, 84,075 display strings post-fix): 0 leaked
    backslashes anywhere (`sup \+(...)` 291, `bold \b(...)` 125,
    `greek \g(...)` 93, `char-code hex \(xHHHH)` 78, `sub \-(...)` 65,
    `italic \i(...)` 10, `char-code decimal \(NNN)` 6 — all resolved
    cleanly); 10 strings with genuine control-inside-control nesting
    (`Hc2 data.opju`/`hc2convert.opj`'s `\g(\i(m))\-(0)\i(H)...`), all
    correct; exactly 1 unrecognized control form seen (`\ad(A)`,
    `MnN_Diffusion_PNR.opj`), degrading safely to its inner text via the
    existing unknown-control fallback (no raise, no leaked escape) — logged
    in `docs/origin_project_format.md` as an honest undecoded-meaning gap,
    not guessed.
  - **Two authoring inconsistencies found, deliberately NOT "fixed"**
    (byte-hex confirmed, not decode bugs — see docs for the hex dump): (1)
    `MnN_Diffusion_PNR.opj` spells its Nuclear-SLD unit as a literal ASCII
    `A` in most books, the proper `\(197)` Å escape in a few, and plain
    unescaped `"A-1"` text in others — genuine hand-typing drift across
    duplicated graphs in the source project, decoded faithfully either way.
    (2) same file's `Q`/`dQ` units mix escaped `A\+(-1)` and literal `A-1` —
    same story. Per the Graph25-heuristic-rejected precedent, no guessing.
  - **Tests:** `test_io_origin_project.py` — 6 new `test_clean_richtext`
    parametrize cases (nested `\g(\i(...))`, the real `\ad(` unknown-control
    form, a numbered-colour control); `test_build_book_translates_column_richtext`
    (synthetic `_build_book` with escaped `ColumnMeta`/`BookMeta`, asserts
    `.labels`/`.units`/`x_column_long`/`x_unit`/`x_column_unit`/
    `origin_book_long`/`column_comments` all decoded); `test_inventory_translates_book_long_name`
    (the `_inventory` listing, both branches); `realdata`-marked
    `test_realdata_mnn_diffusion_column_unit_richtext_translated` anchoring
    the exact owner-adjacent corpus strings. `test_io_origin_ground_truth.py`
    updated: the live-Origin COM oracle CSV (`expASC`) exports the RAW
    LabTalk label (Origin's ASCII export doesn't render rich text either),
    so the long-name/unit membership checks now `clean_richtext` the oracle
    side too — a fair "do we match Origin" comparison now that our reader
    intentionally decodes instead of leaking.
  - **Gates:** `ruff check src tests && mypy src && pytest -q` — 460 origin
    tests green (was 453; +7 net after dedup), full suite green. No frontend
    changes (translation is backend-only, at extraction) — no frontend gate
    needed. Golden tests untouched (figure/label text isn't golden-frozen).

- ~~**46. Shared-x stacked panels sit flush with per-panel walls (owner
  "bounding walls" request)**~~ (2026-07-09) — owner: "the bigger issue is
  the lack of bounding walls around the plot to enable shared axis plots
  that are not directly overlaid" (PNR.opj Book14 `Graph11`, the same
  8-panel spin-asymmetry repro as #43/#45). Fixed generally, not keyed to
  Graph11:
  - New pure `frontend/src/lib/panelLayout.ts`: `sharesXWithPanelBelow` /
    `rowBoundaryGaps` detect which row boundaries in a spatial grid COLUMN
    are flush (both panels' `xLim` match within tolerance) — scoped to
    vertical adjacency only, so side-by-side columns that happen to share
    an x-range are never fused; `suppressedXIndices` marks every panel
    with a flush neighbor below it (reusing the existing "blank x tick
    values/title" idiom the plain per-channel stack mode already had);
    `columnWidths`/`rowHeights`/`cumulativeOffsets` replace CSS Grid's
    `1fr` + one uniform `gap` (which can't express a flush 0px boundary
    next to a normal one) with explicit pixel placement.
  - `useMultiPanelStage.ts`'s spatial branch switched from CSS Grid to
    this pixel placement; every panel stays fully boxed (`showAxisBox`,
    already defaulted on) — the shared edge reads as one "wall".
  - Faithful per-layer x title: `fig.x_title === ""` (the owner
    hand-deleted a redundant per-panel label in Origin) now maps to
    `xAxisLabel: null`, which `buildOpts` renders as NO title — distinct
    from an undecoded title (`undefined`, which still auto-derives
    "channel (unit)"). Scoped to x only (y axes untouched, matching the
    single per-panel `y_title`/legend-swatch convention already in place).
  - Verified against the live COM oracle PNG
    (`test-data/origin/_exports/PNR/Graph11.png`): quantized's re-render
    now matches — flush 2×4 grid, only the bottom row shows x ticks/title,
    every panel boxed. Re-ran `tools/visual/origin_figures.mjs` over the
    full PNR.opj corpus (101 graph-window families): totals unchanged
    (99 resolved / 91 fully consistent / 8 with mismatches) — the 8 are a
    PRE-EXISTING `panel_count`-vs-raw-layer-count harness limitation from
    the earlier same-day y2-merge feature (item #S7/`b59edb1`), not a
    regression (confirmed: none of the 8 mismatch reasons mention
    error-bars/hidden-channels/x-titles/flush-stacking, and this fix never
    touches row/col/range/log/step computation). Spot-checked several
    other shared-x figures (`PNRDWMerge`) render flush too, generalizing
    beyond Graph11; a genuinely different-axis 2-panel figure (`Graph24`,
    Reflectivity above a real-space SLD profile) correctly stays
    un-fused.
  - Tests: new `lib/panelLayout.test.ts` (pure math — tolerance matching,
    conservative ragged-grid boundary handling, gap/offset arithmetic);
    `uplotOpts.test.ts` + `originFigures.test.ts` cases for the
    null-vs-undefined title fidelity; `MultiPanelStage.test.tsx` cases for
    end-to-end suppression wiring. Frontend 2217 passed + `npm run build`
    green.

- ~~**45. Origin "Y-error" columns render as spurious series in
  multi-panel views**~~ (2026-07-09) — owner repro: PNR.opj Book14
  `Graph11` (8-panel spin asymmetry) showed `dSA` (worksheet-designated
  "Y-error") as its own yellow point+line series instead of whiskers on
  its paired `SA` channel. Root cause (the mechanism, not the instance):
  the single-plot path already had error-column pairing + hidden-channel
  suppression (`errorbars.originErrKeys`/`originHiddenChannels`, store
  `errKeys`/`hiddenChannels`), but the multi-panel path (both the spatial
  Origin-figure grid AND the plain per-channel stack mode) never applied
  either.
  - `originFigures.figureChannelSelection` now also returns
    `errKeys`/`hiddenChannels` for the book, threaded through
    `SpatialPanel` by `resolveFigurePanels`.
  - `useMultiPanelStage.ts`: the spatial branch drops hidden channels from
    what's fetched/plotted (`multipanel.spatialPlottedChannels` — no
    per-panel legend exists to toggle them back on, unlike the
    single-plot view) and builds whiskers via `errorbars.buildErrorColumns`;
    the plain per-channel stack mode gets the identical treatment reading
    the store's existing `errKeys`/`hiddenChannels` fields (any
    Origin-imported book manually stacked hit the same bug, not just an
    applied multi-layer figure).
  - Verified against the live COM oracle PNG: quantized's re-render of
    Graph11 now shows teal SA points with whiskers and the black theory
    line, no yellow series — matching Origin's own render. Full-corpus
    sweep (see item #46's entry — the two fixes were verified together)
    shows zero regressions.
  - Tests: `originFigures.test.ts` (errKeys/hiddenChannels threading
    through `figureChannelSelection`/`resolveFigurePanels`),
    `multipanel.test.ts` (`spatialPlottedChannels`), `MultiPanelStage.test.tsx`
    (end-to-end error-bar wiring + a no-op regression case). Frontend
    2217 passed + `npm run build` green.

- ~~**43. Annotation text-label placement (owner PNR.opj repros)**~~
  (2026-07-09) — both live-testing repros traced to ONE frontend rendering
  bug, NOT a backend decode fault:
  - Root cause: `uplotOverlays.annotationPlugin`'s draw hook never set
    `ctx.textAlign` explicitly, so it silently inherited whatever uPlot's own
    last axis-label draw left on the shared canvas context — `setFontStyle`
    in `uPlot.esm.js` writes `textAlign`/`textBaseline` straight onto `ctx`
    with no save/restore and never resets before firing "draw" hooks; the
    left Y-axis right-aligns its own tick labels, so `ctx.textAlign` was
    `"right"` by the time our overlay ran. `fillText(text, px + 6, …)` then
    anchored the label's RIGHT edge at `px + 6` instead of its left — every
    label grew BACKWARD (behind its dot) instead of forward.
  - Repro 1 (Book15/`1p5mT`, "15 G from 40 G" "weirdly in the bottom-left
    over a label"): the DECODED POSITION is correct — cross-checked against
    the live-COM oracle PNG (`1p5mT.png`/`700mT.png`), Origin itself pins
    this label at that exact bottom-left spot, deliberately overlapping its
    own x-tick row (confirmed on multiple figures, not a one-off). The
    backward-grown label additionally overlapped the Y-axis title/tick
    gutter to its left; fixed by the textAlign correction (before/after
    screenshots: session record).
  - Repro 2 (Book14/`Graph11`, 8-panel spin-asymmetry spread, "labels
    randomly appear clipped on the y axis"): every panel's mark sits near
    ITS OWN left axis (Origin's habitual bottom-left curve label, e.g. "40
    Oe from 7 kOe"), and each spatial panel is a separately-canvased `uPlot`
    instance (`useMultiPanelStage.ts`) — a label growing backward from a
    point 1-2% in from the left ran clean off that panel's OWN canvas
    (invisible, not merely crowded), leaving only its tail visible (e.g.
    "from 7 kOe" with "40 Oe " gone). Confirmed before/after via
    `tools/visual/origin_figures.mjs`: all 8 panels now show their full
    label text.
  - Fix (`frontend/src/lib/uplotOverlays.ts`): `annotationPlugin` sets
    `ctx.textAlign` explicitly on every draw; a new pure
    `clampAnnotationLabelX` helper flips the label to a mirrored
    right-anchor when a left-anchor would overflow the panel's right edge,
    clamping inward as a last resort for a label wider than the panel; a
    small vertical clamp keeps a near-top mark's label from poking above the
    plot area.
  - No backend change: `annotation_marks.py`'s fraction→data decode was
    re-verified against both repros' actual figures (`PNR.opj` via a
    scratchpad probe against `extract_figures`) and is correct — the
    module's documented "non-zero attach mode" gap remains an open,
    unencountered residual, not the cause here.
  - Tests: 10 new cases in `uplotOverlays.test.ts` — a regression stub whose
    fake canvas starts `textAlign: "right"` (mirroring uPlot's real leaked
    state) catches any future regression back to implicit inheritance, plus
    near-left/near-right/near-top clamp behavior; 4 new pure-math cases for
    `clampAnnotationLabelX` covering the fits/flips/both-overflow/boundary
    cases. Full re-render of the live PNR.opj corpus (208 figure entries,
    101 graph-window families) through `origin_figures.mjs` before/after:
    identical structural totals (101/99/91/8), confirming zero regression to
    apply-routing — only the label pixels changed.
  - Gates: frontend `npm test` (2138 passed) + `npm run build` green.
    Backend untouched, no backend gate needed.

- ~~**Origin legend `%(n)` template resolution (owner repro, follow-up to the
  plot-fidelity batch below)**~~ (2026-07-09) — from the owner's PNR.opj live
  import testing: "The legends... show '%(1)' '%(2)' which I know is the raw
  text Origin uses... that is Origin shorthand to link to the column." The
  PNR-triage plot-fidelity batch (below) wired decoded `legend_labels` into
  `seriesLabels` LITERALLY, so an untouched Origin auto-template showed its
  raw code instead of the column name. Cataloged every code form actually in
  the corpus (`figures.py::extract_figures` against `PNR.opj` + a full
  `.opj`/`.opju` sweep): plain `%(n)` (by far the common case, e.g. PNR.opj's
  `Graph2`-`Graph49`), hand-typed literal text (`"Nb"`, `"R↑↑"`, PUA glyph
  pairs), blank slots (`""`, a skipped error/secondary-X column), and one
  `@`-modifier form seen live, `%(7,@LG)` (`Hc2 data.opju` Graph40) — NOT
  implemented (no oracle for what the modifier changes; left as literal
  per-instructions rather than guessed, and the digit-only match regex
  naturally excludes it). No literal `\l(n)` swatch code reaches the frontend
  today (the backend's `_parse_legend_labels` already strips it per-curve),
  but the resolver strips a leading `\l(n)` (+ trailing whitespace) anyway for
  robustness/generality. New pure function `resolveLegendTemplate(template,
  curveNames)` in `frontend/src/lib/originFigures.ts`, wired at both existing
  application sites: `figureChannelSelection` (single-book) and
  `buildOverlayDataset` (cross-book overlay, resolved at build time so
  `overlayCurveLabels`'s read-back needs no change). `curveNames[n-1]` = the
  nth curve's column long name (`data.labels`), falling back to the column
  short name, then leaving the raw code if that curve never resolved a
  channel — a wrong guess is worse than a raw code. Example:
  `"%(1)"` + curve 1 bound to column `B` (long name "R++") -> `"R++"`;
  `"%(7,@LG)"` -> unchanged; `"Nb/Al"` -> unchanged. Verified live (not just
  unit tests): scripted the real `uv run qz` backend + a headless-Chrome
  `?harness=1` page (same seam `tools/visual/origin_figures.mjs` uses) to
  import the actual `PNR.opj` and apply `Graph2` — real `seriesLabels` came
  back `{1: "R++", 3: "R--", 5: "Theory ++", 6: "Theory --"}` from raw
  `legend_labels: ["%(1)","%(2)","%(3)","%(4)"]`, matching the dataset's own
  decoded column labels exactly. New unit tests: grammar coverage in
  `originFigures.test.ts` (every corpus form + out-of-range index + the
  `@LG` passthrough) and integration tests in both `originFigures.test.ts`
  (`figureChannelSelection`) and `originOverlay.test.ts`
  (`buildOverlayDataset`/`overlayCurveLabels`, incl. a cross-curve reference
  to a curve that never bound). Frontend 2140 tests + build green.

- ~~**40. Unresolved figure families**~~ (2026-07-09) — one root cause,
  fully diagnosed and fixed for the decodable half: `PNR.opj`'s 6
  "missing" graphs (`Graph30`-`Graph33`/`PNRDWMerge`/`PNRmerge_Jan16`) are
  Origin "Merge Graph Windows" results whose layer-continuation blocks
  carry head byte `0x5f` (not `0x1f`/`0x17`), which `extract_figures`'s
  window-vs-worksheet gate didn't recognize — the whole window produced
  zero figures. Fixed: `_LAYER_HEAD_BYTES` now accepts `0x5f`
  (`src/quantized/io/origin_project/figures.py`); all 6 now decode with
  sane per-layer axis ranges/frames and curves that bind to real,
  currently-imported books (verified via the independent `extract_curves`
  anchor scan, not just axis-shaped numbers). The `"Pd"` unmatched-hint
  half (`0p023`/`Graph46`) is NOT a decode bug: a full raw-file window
  scan (223 headers) confirms no book named `"Pd"` exists anywhere in the
  project — these two graphs' source workbook was deleted after they
  were created, a genuine dangling Origin reference our decoder
  correctly surfaces as unresolved rather than guesses at. See
  `docs/origin_project_format.md` §6.1 (the `0x5f` finding) and §6.3 (the
  `"Pd"` stale-reference finding) for the full evidence trail. New tests:
  `test_synthetic_opj_merge_window_layer_head_byte_recognized` +
  `test_realdata_pnr_merge_windows_recovered`
  (`tests/test_io_origin_project.py`). Backend/origin suite green
  (439 passed, 3 skipped). Frontend unaffected (generic figure-family
  code, no changes needed).

- ~~**#38 Lazy per-book data transport**~~ (2026-07-09) — import returns the
  PRIMARY book's data in full plus a lightweight inventory (name/metadata/
  folder path/labels/units/true row+col counts) + a ~200-point min/max-
  decimated preview series (`io/origin_project/preview.decimate_datastruct`,
  row-picked so every channel of a kept row moves together) for every OTHER
  book; each book's full data fetches on demand via a new
  `POST /api/parsers/books/data` (`routes/books.py`) the first time it's
  actually shown. Measured on PNR.opj (122 books): import response
  84.72 MB → 3.84 MB (22×) and 1.60 s → 0.80 s; a lazily-activated book's
  first fetch is ~21 ms (the import route primes a small path+mtime-keyed
  LRU cache — `routes/_bookcache.py`, bound 4 projects — with the SAME parse
  it already did, so the common case never re-reads the file). Upload-
  sourced projects stage their bytes persistently (bounded LRU, 8 uploads —
  `routes/_uploadcache.py`) instead of the ephemeral per-request temp dir,
  so a later book fetch still has bytes to re-parse if the cache misses.
  Trimmed the (pre-existing, unrelated-to-#38) `origin_books` per-project
  inventory metadata key from every wire payload — write-only/unconsumed,
  but duplicated ~10-15 KB per book — since without it the response
  couldn't get anywhere near the target. Escape hatch: `full_books=true`
  (query/body param on both `/import` and `/upload`) reproduces the
  pre-#38 shape byte-for-byte, for tooling with no fetch-on-activate flow;
  `tools/visual/origin_figures.mjs` (which injects `payload.books[i].data`
  straight into the store, bypassing the frontend's fetch machinery) opts
  into it and was re-run live against the real PNR.opj through a full
  backend + headless-Chrome pass: 122 datasets, 85 graph windows, 83/85
  fully resolved, 0 mismatches — unchanged from before this landed.
  Frontend: `Dataset.pending` (a `BookSource` ref) marks a lazy dataset;
  `data` holds the small preview meanwhile (a real DataStruct, so nothing
  crashes — worksheet/plot/Library all render it as-is until the fetch
  lands). `useApp.ensureBookData` (single-flight, module-level in-flight
  map) fetches + swaps in the full data on success, clears stale
  `excludedRows`/`filter` (row indices meant the preview rows, not the real
  ones), and toasts + leaves `pending` set on failure (retryable — the same
  render-side trigger fires again next time that dataset is shown). Wired
  at every place that actually READS a dataset's data: `PlotStage`,
  `WindowCanvas` (every visible MDI window), `useMultiPanelStage` (each
  spatial panel owns its own dataset), and `WorksheetPane` (+ a "loading
  full data (N rows × M channels)" banner); `DatasetRow` shows the TRUE
  row/channel counts from `pending` rather than the preview's. `.dwk`
  policy: an explicit "Save workspace…" resolves every pending dataset
  FIRST (`resolvePendingDatasets`, awaited by the new `saveWorkspaceToFile`
  store action) so an exported file is always self-contained; autosave
  (localStorage, same serializer) is the one path that legitimately still
  persists a `pending` ref, since a reload just re-triggers the fetch when
  that dataset is next shown (an upload-sourced token won't survive a
  server restart — degrades to an error toast + re-import, not a crash).
  Deferred/known edges (CLOSED 2026-07-09): export and the corrections
  pipeline did NOT guard against running on a still-pending (preview-sized)
  dataset — they'd silently compute on the small preview rather than
  erring. Closed via two new store actions in `useApp.ts` —
  `resolveDataset(id)` (single dataset; no-op unless `pending`, toasts only
  on a slow fetch, rejects on failure so the caller's existing error
  handling aborts) and `resolveDatasets(ids)` (bounded-concurrency batch
  version, 6 in flight at once, for the "many never-activated datasets"
  case) — that every compute/export entry point now awaits before touching
  `.data`. Guarded: `applyCorrections` (+ its bg-dataset reference, so
  `applyCorrectionsToMany`/folder bulk-corrections and the pipeline's
  `correction`/`reset` steps inherit it for free), `executeSteps` (the
  shared macro/pipeline/template-batch/folder-batch replay core — resolves
  once up front, marks every step failed rather than partially executing on
  wrong data if the fetch fails), `mergeSelected`, `duplicateDataset`
  (a pending source's clone previously got silently and PERMANENTLY stuck
  on the preview, since `pending` isn't copied), the dataset-math workshop
  (both picks), the App.tsx export commands (CSV/HDF5/figure/Origin/.ogs —
  extracted to `lib/exportActive.ts` to stay under the App.tsx line
  ceiling), Send-to-Origin and Export-consolidated-CSV (batch), the folder
  bulk ops' CSV export, the fitting/baseline/peak/hysteresis/magtools/rsm/
  peak-wizard workshops (both the auto-run effects and the manual
  fit/subtract actions), Tabulate/Stats-chooser (abort-and-retry on a click
  mid-fetch, since their derived rows/groups self-correct on the NEXT
  render but a click before that would export/report the incomplete
  summary), the worksheet's Extract and Copy-rows/Copy-row actions (same
  abort-and-retry — a pending dataset's rows are a min/max-DECIMATED
  SAMPLE, not a prefix, so a row index computed against the preview matches
  no real row once the full data lands), the Waterfall stack (a render path
  this plan's original audit missed entirely — now triggers
  `ensureBookData` per included dataset like the other Stage consumers,
  plus resolves the whole stack before CSV export), and the Figure Builder's
  live (non-frozen) export. No backend change was needed or made — pending
  is a purely frontend/Zustand construct; every backend route always
  serves/receives full data. Still deferred (cosmetic, fine to leave): the
  worksheet's kept/total row-count footer briefly reflects the preview's
  count during the loading window (self-corrects once the fetch lands);
  `useReflView`'s two-frame pairing is a pure render derivation with no
  export button, so it wasn't wired to `ensureBookData` (self-corrects
  reactively, same as the footer).
  Tests: backend `test_io_origin_preview.py` (8) + `test_api_books.py` (16);
  frontend `useApp.test.ts` (+16), `workspace.test.ts` (+5),
  `DatasetRow.test.tsx` (+2), `WorksheetPane.test.tsx` (new, 2),
  `WindowCanvas.test.tsx` (+1). Backend 1930 (+177 realdata) + frontend
  2008 + build green. Closure batch added frontend `useApp.test.ts` (+8:
  resolveDataset/resolveDatasets + mergeSelected pending/failure paths),
  `useCurveFit.test.ts` (+2), `usePeaks.test.ts` (+2),
  `useBaseline.test.ts` (+1), `useWaterfall.test.ts` (+1),
  `useFigureBuilder.test.ts` (+1) — frontend 2024 tests + build green.
  **Known-edge fix (2026-07-09):** the owner's live PNR.opj testing found a
  Library thumbnail that "looks NOTHING like the plot it holds"
  (`PNR:Book15`) — the Sparkline path reads a dataset's raw `.time`/
  `.values` directly, bypassing every fix already made to the main-plot
  path (`dropTrailingEmptyRows`), so it inherited #38's preview padding
  uncaught. Root cause on the real file (Book15: 180 rows, 19 trailing
  Origin over-allocated-storage rows — `.time` AND every channel exactly
  0.0): (1) the padding was never pruned, in either
  `decimate_datastruct` (the #38 preview) or the sparkline itself; (2) the
  density heuristic (`primaryChannel`) can't tell an Origin Y-error/X-error
  column from real Y data once padding makes every channel equally
  "dense" — Book15's sparkline drew `dQ` (X-error, near-flat) instead of
  `R++` (the real reflectivity curve). Fixed: `decimate_datastruct` gained
  `_trim_trailing_padding` (prune before decimating);
  `Sparkline.tsx` now picks the first Origin Y-designated channel
  (`lib/columnmeta.columnMetaList`, falling back to `primaryChannel` for
  non-Origin data), prunes via a new `lib/downsample.trimTrailingPadding`
  twin of `dropTrailingEmptyRows`, and sorts sampled points by x (defensive;
  a no-op on Book15's own already-ascending data, but needed generally for
  an unsorted X column). Verified against the real PNR.opj: Book15 raw is
  180 rows (Q range `[0.0, 0.140]`, padding included); the fixed preview is
  161 rows (Q range `[0.00503, 0.140]`, monotonic ascending, no zero-row
  left). Both the pending-preview and full-fetch states render through the
  same fixed Sparkline code, so the thumbnail no longer jumps when the full
  data replaces the preview. Tests: `test_io_origin_preview.py` (+6),
  `downsample.test.ts` (+7), new `Sparkline.test.tsx` (7). Backend 2115 +
  frontend 2144/178 files + build green.

- ~~**PNR-triage import-perf batch (unbooked side-work)**~~ (2026-07-09)
  — merged to main as `917802a` (commits `16080ad`/`09e1ac1`/`d097c39`):
  parse-once import (`read_origin_project_all` — the route previously
  parsed the whole project twice and read the file 5×), provenance regex
  scans tail-restricted for `.opj` via `tree._find_tail_start` − 2 MiB
  margin (structurally derived, `.opju` deliberately kept full-scan — no
  verifiable boundary), Library sparklines min/max-bucket downsampled
  (`lib/downsample.ts`, 43k→~360 points per thumbnail). Measured on
  PNR.opj: upload round-trip ~4.0 s → ~2.1 s. Old-vs-new provenance
  outputs byte-identical across all 104 corpus files. Remaining known
  cost: ~1.5 s JSON serialization of the ~85 MB payload → #38 (lazy
  per-book transport). Backend 2083 + frontend 1772 + build green
  post-merge.

- ~~**PNR-triage plot-fidelity batch (unbooked side-work)**~~ (2026-07-09)
  — from the owner's PNR.opj import testing; merged to main as `7b5aa50`
  (commits `3928965`/`25d746b`/`bf6512f`): trailing all-zero-padding row
  prune in `dropTrailingEmptyRows` (over-allocated Origin storage drew a
  wrap-around line via the hysteresis loop-path); decade/step-snapped tick
  splits for fixed log ranges (the decoded `x_step`/`y_step` — oracle-exact
  — were being dropped at the `OriginFigure` type boundary; now threaded
  through all apply paths, verified Graph50 → 0.8..1.2 by 0.1); y2-layer
  annotation marks routed to the y2 scale (`Annotation.axis`); Origin
  `legend_labels` wired into `seriesLabels` in all four apply paths incl.
  cross-book overlay; multi-panel figures now carry annotations / labels /
  steps per panel. `PlotStage.tsx` 491→441 via `usePlotStageActions`
  extraction. Frontend 1761 tests + build green post-merge.

- ~~**PNR-triage multi-panel y2-in-panel pairing fix (unbooked side-work,
  item 36 residual)**~~ (2026-07-09) — another bug from the SAME owner
  PNR.opj testing session as the plot-fidelity batch above, reported
  separately: folder `S7`, curves bound to `Book33` (`Graph24`, a 3-layer
  window) rendered as a bogus 1x3 ordinal column instead of a 2-panel
  layout with a right-Y overlay on the bottom panel — "I think this was
  probably meant to be a right y axis on the middle plot but is instead a
  1 by 3 column plot." Root cause: layers 2/3 decode BYTE-IDENTICAL frame
  quads (a double-Y overlay pair), which tripped `computePanelLayout`'s own
  "frames overlap rather than tile the page" guard for the WHOLE figure.
  Fixed generally (frame-coincidence → y2 pairing inside the spatial
  clusterer, gated by the same heuristics `doubleYPartner` uses to decide
  y2-ness PLUS a distinct-y-range/matching-x-range guard against false
  positives) — applies to 7 other real families in this same corpus, not
  special-cased to Graph24. Full writeup + numbers in
  `plans/GAP_ECOSYSTEM_PLAN.md`'s item 4 Completed entry (same
  cross-reference convention as item 36 itself, above). Frontend 173 files
  / 2042 tests green; `npm run build` green.

- ~~**#37 y2 axis label from layer 2's decoded title**~~ (2026-07-07) —
  `applyOriginFigure`'s double-Y path sets a new `y2AxisLabel` store
  override from `upper.figure.y_title`; consumed by `uplotOpts.soloLabel`
  for the right axis, editable via a TitlesCard "Y2 label" row (shown when
  y2 channels are assigned), reset wherever the y2 assignment resets.
  Closes gap-register §13.2 #6's follow-up. Test: the double-Y apply spec
  asserts the override.

- ~~**gap-register §13.2 #13 label-record residual**~~ (2026-07-07) — the
  `.opju` column label record is a chunked string (`<LEB128 length>
  <chunks: <len:1><data>>`, 127-byte chunks); `_parse_label_record`
  replaces the fixed single-byte read, so a column carrying a >127-byte
  comment keeps its own long-name + full comment (`long_comment.opju`
  test-pinned; synthetic fixtures updated to the true grammar).

- ~~**#34 `.opj` writer real-Origin compatibility**~~ (2026-07-07) — the
  writer's output now LOADS in real Origin (2026b) and expASC re-exports
  are value-exact (names/units/NaN included), single- and multi-book. The
  loader requirement set was pinned by a COM probe series (PN/PJ/PK/PT/
  PU/PW, `docs/origin_re/validation_log.md`): minimal consistent tail
  (the old all-slots-empty/over-full "consistency" results were probe
  confounds — storage content is lax; the `ResultsLog` note presence is
  required), ≥1 record group per window section (`__LayerInfoStorage`),
  column↔dataset binding via 519B serial @4 = dataset stream ordinal
  (+@30=9, @35=X-serial, @38 designation flag — wrong values silently
  blank the data), and 6-null worksheet-section separators. New
  `writer_blocks.py` (sanitized templates + field model); format doc §8
  rewritten; user-facing `opening_origin_files.md` updated.

- ~~**.ogs export live-verified in real Origin**~~ (2026-07-04) — running
  the generated LabTalk through installed OriginPro (COM) exposed two
  faithful-port bugs from MATLAB `exportOriginScript.m` that text-parity
  could never catch, both now fixed in `io/origin.py`:
  (1) `impASC ... options.SkipRows.Count:=2` is INVALID LabTalk in this
  Origin build and aborts the whole import — bare `impASC` auto-detects
  the 2-row header and the explicit `wks.col*` designations re-assert
  names/units; this had silently broken *every* `.ogs` export (item 23).
  (2) A successful `impASC` renames the book+sheet to the source file, so
  names are restored AFTER import and the post-import short name captured
  (`string qzbk$ = page.name$;`). The double-Y block was rewritten and
  verified live: secondary `plotxy` uses an explicit `[%(qzbk$)]<sheet>!`
  range (the graph, not the book, is active), `layer -nr` + `ogl:=2!`
  lands the y2 curve in layer 2, and `label -yr` titles its right axis
  (`yr.text$` fails on a bare `layer -nr` layer). Final corrected `.ogs`
  runs with ZERO failed lines. Golden re-frozen to the intended output;
  divergence documented in `docs/origin_re/validation_log.md`.
- ~~**Book4 designation mismap fixed**~~ (2026-07-04) — the
  `windows.window_metadata` bug noted (not fixed) during item 11/35:
  `_is_column_block` required byte 0x06==0x0B, but real sheets store 0x09
  for plain columns (0x0B only for formula/report columns), so Moke.opj
  Book4 Sheet1's 14 plain columns were invisible and `FitLinear1` report
  columns leaked into the mapping. Fixed by accepting 0x06∈{0x09,0x0B}
  and a real sheet-boundary signal — a 365-byte `Pd<Name>` sub-header at
  offset 0xD0 — closing collection at the 2nd marker per window. Book1–5
  now recover all columns vs ground truth. `src/quantized/io/origin_project/
  windows.py`; +2 tests.
- ~~**#26 Figure export**~~ (2026-07-04) — the `.ogs` GRAPH block now
  recreates the CURRENT PLOT STATE (selected channels, x source, log
  axes, limits, y2 split) instead of just the single-column default:
  `io/origin.py` gains `GraphSpec` + `_plot_state_graph` (one grouped
  `plotxy iy:=(x,y1):(x,y2):…` call for the primary set; a secondary
  right-Y layer via `layer -nr` + a second `plotxy … ogl:=2!` for
  `y2_keys` — live-verified in OriginPro, see the entry above).
  `/api/export/origin` gained an optional `graph` field
  (`OriginGraphSpec`); the frontend's "Export Origin (.ogs)…" action now
  passes `yKeys/xKey/xLog/yLog/xLim/yLim/y2Keys` straight off the plot
  store. This descopes the `needs 12` dependency — no `FigureDoc` entity
  required, since the export reads the live/transient plot-state fields
  directly rather than a persisted document. The `.opj`-writer graph-window
  half of this item (binary project graphs, the inverse of item 12's
  mapping) remains out of scope. 9 new unit tests in `tests/test_io_origin.py`
  (default view, single-channel axis label, log axes, custom lims, x_key on
  a value channel, y2 split, all-y2 fallback, `make_graph=False`, quoting).
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
