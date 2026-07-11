# MAIN PLAN — quantized

The root of the plan tree (per the global plan-consolidation rule: one
main plan; sub-plans only where scale demands; small residues fold up
here). Mission: **quantized replaces OriginPro as the owner's daily
plotting & analysis tool** — MATLAB-toolbox backend parity (done,
golden-verified) plus a ground-up GUI that wins on reproducibility,
linked exploration, and domain depth. "Go-to" is achieved empirically
via the switch-trigger protocol (GOTO_PLAN).

**Status:** Active
**Created:** 2026-07-10
**Updated:** 2026-07-10

---

## Context

### The plan tree

| Sub-plan | Scope | Why it earns a separate file |
|----------|-------|------------------------------|
| `PORT_PLAN.md` (+ appendix `PORT_CHECKLIST.md`) | MATLAB parity, packaging (W8), CI/verification (W9) | Founding doc; W0–W9 history + the exhaustive per-feature parity inventory |
| `GOTO_PLAN.md` | The go-to capability push vs Origin (10 owner-decided items + switch-trigger protocol) | Active build campaign, own decision log |
| `ORIGIN_FILE_DECODE_PLAN.md` | `.opj`/`.opju` reverse-engineering + decode gaps | Large RE reference (format findings, §13 gap register) |

Six residue plans were folded up into this doc and archived on
2026-07-10 (fold-up rule): MULTI_PLOT, WORKSHEET, PROJECT_ORGANIZATION,
GAP_TIER3, GAP_ECOSYSTEM, ORIGIN_GAP — each was ≤3 open items. Their
`## Completed` histories live in `plans/archive/`. Provenance is kept on
every folded item below.

### Cross-plan dependencies
- GOTO #4 (fig composer) + #5 (rich text) gate the PNR half of the
  switch-trigger project (GOTO protocol).
- The WebGL 3-D deferral (below) shares its gate with GOTO Q4 — one
  answer resolves both.
- BACKLOG.md stays the derived cross-plan dashboard (plan-hygiene truth
  order unchanged: code > plan Completed sections > BACKLOG).

---

## Tier 1 — High Impact

*(the current high-impact work lives in `GOTO_PLAN.md` #1–#10; this
plan's direct items are residue-sized by construction)*

## Tier 2 — Medium Impact

~~1. **Decompose App.tsx + ThinFilmTab.tsx**~~ COMPLETED 2026-07-11 (see Completed).
~~2. **Extract the useApp window slice**~~ COMPLETED 2026-07-11 (see Completed).
~~3. **Worksheet per-column widths + drag resize**~~ ✅ completed 2026-07-11 (see Completed).
~~4. **Worksheet selection → Graph Builder handoff**~~ ✅ completed 2026-07-11 (see Completed).
~~5. **`.otp`/`.otpu` template import, frontend half**~~ ✅ completed 2026-07-11 (see Completed).
~~6. **Defaults-audit residuals**~~ ✅ completed 2026-07-11 (see
   Completed).
~~7. **Register import_lake_shore**~~ COMPLETED 2026-07-11 (see Completed).

8. **Post-review consolidation batch** (booked from the 2026-07-11
   adversarial review — cleanup findings, deliberately NOT rushed
   pre-release):
   - [ ] Generic point-hit/drag gesture core: `uplotAnchors` +
     `peakMarkerHit` are near-clones (and shared the pixel-frame bug —
     one core would have needed the fix once)
   - [ ] Export `unwrap`/`postForm` from `lib/api.ts` (4 drifting copies
     of the error-detail extraction incl. `originTemplate.ts`)
   - [ ] Shared `_iterative_clip_fit` helper (`baseline_modpoly` +
     `xrd_low_angle_background` duplicate the Lieber loop)
   - [ ] Calculators-level card kit (9 tabs carry private Card/Field
     copies; `thinfilm/shared.tsx` was created one directory too deep)
   - [ ] `figure_text._parse_legend_labels` delegates to the layered
     parser (two parsers over one grammar)
   - [ ] Anchor-edit bridge via ref/getter so anchor add/move/remove
     stops rebuilding the uPlot instance twice per gesture (+ cache
     `anchorPixels` per scale in the cursor handler)
   - [ ] Figure-page preview invalidation when store state changes under
     an assigned slot (export guard shipped; preview can still stale)
   - [ ] `io/origin_project/figures.py` at 499/500 — split BEFORE the
     next edit
   - [ ] UX judgment: `openInGraphBuilder` rides `setActive`'s
     plot-intent path (can spawn a window + flip the stage tab as a
     side effect of opening an overlay) — decide if that precedent fits

## Tier 3 — Nice-to-Have

*(empty — candidates arrive via GOTO owner gates Q4/Q6/Q7/Q8)*

---

## Owner gates (folded from the archived plans)

- **Pop-out books/plots into windows** (was MULTI_PLOT #19) — PLAN WITH
  OWNER FIRST: gesture, "pop out a BOOK" semantics, bulk "window
  everything" command.
- **Worksheet view-state persistence** (was WORKSHEET #14) — decide
  once, with usage evidence, whether sort/widths/selection persist
  per-dataset in `.dwk` (default: no).
- **PyPI Trusted Publisher registration** + first tagged publish + the
  fresh-machine acceptance run (was ORIGIN_GAP #41; see RELEASE.md).
- **Corpus publish licensing sign-off** (was ORIGIN_GAP #45) —
  `../test-data` repo is `git init`-ed; gated on the licensing pass + 6
  flagged public files.
- **Defaults-audit eyeball** (was GAP_TIER3 #2) — rule on the taste
  calls in `plans/design/DEFAULTS_AUDIT.md`.
- **Apache-2.0 copyright holder line** for LICENSE/NOTICE (PORT_PLAN
  #1 residue — lives with its sub-plan, listed here for visibility).
- **Code-signing certificate + auto-update E2E** (PORT_PLAN #47/#49
  residue, reconciled 2026-07-11): obtain a cert, sign a release, then
  verify updater end-to-end across two consecutive signed releases.

## Deferrals (decision gates — revisit on demand)

- **Interactive WebGL 3-D** (was GAP_TIER3 #7 / ORIGIN_GAP #22) — gate
  now UNIFIED with GOTO Q4; one owner answer resolves it.
- **`.opju` writer** (was GAP_ECOSYSTEM #6; = ORIGIN_FILE_DECODE #27)
  — revisit only if a real Origin build refuses `.opj`.
- **`quantized-plugin-template` starter repo** (was ORIGIN_GAP #8
  residual) — separate repo, out of scope here.
- **Plugin pipeline-step route + frontend palette** (was GAP_ECOSYSTEM
  #2) — v1 registers steps server-side only.
- **Database connectors** (was ORIGIN_GAP #47) — paste/append shipped;
  connectors on user pull.
- **Worksheet designation editing** (was WORKSHEET D2) — read-only in
  v1 unless requested.
- **Graph Builder export button + `.dwk` plot-spec persistence** —
  booked debt from archived GAP_INTERACTION #51.
- **Stat-stage residuals** (archived GAP_PLOTTYPES, accepted) — bar
  orientation, in-canvas legend, `payloadToTSV` ordinals,
  `statRender.ts`/`useStatStage.ts` split candidates.

## Completed

- ~~**#7 Lake Shore registration**~~ (2026-07-11) — preamble sniffer
  (first 2KB contains "Lake Shore"), .csv chain after SIMS + .dat chain
  after QD/refl1d/PPMS; corpus sweep = exactly 1 claim (the fixture),
  parser matrix green, zero real-file routing changes.

- ~~**#1 Decompose App.tsx + ThinFilmTab.tsx**~~ (2026-07-11) — App.tsx
  960 -> 74 (appCommands.ts registry + useGlobalShortcuts + AppOverlays),
  ThinFilmTab 441 -> 40 (workshop split); GRANDFATHERED component pins
  ratcheted to ZERO (mechanism kept); verbatim-move diff proofs; the two
  ?raw source-scanning tests repointed with intent preserved.
- ~~**#2 useApp window slice**~~ (2026-07-11) — 22 window actions + MDI
  state -> store/windows.ts (750) as a composed Zustand slice, ONE store
  instance so every selector survives; useApp 3,960 -> ~3,290; NEW
  store-size ratchet added (pin recalibrated to the Wave-A-merged
  baseline 3287); #50 row-state allowlist untouched.

- ~~**#6 Defaults-audit residuals**~~ (2026-07-11) — DPI-preset sync
  verified ALREADY SHIPPED in `useFigureBuilder.ts` (audit-referencing
  comment; the new figure-page workshop carries the same convention).
  Interactive-side shots generated via `tools/visual/`
  (`spec-defaults-audit.json` → `out-defaults-audit/`: linear default,
  log decades, rich-text labels — the last also visually verified GOTO
  #5 on the real uPlot canvas). The EYEBALL on these + DEFAULTS_AUDIT.md
  taste calls remains the owner gate above.

- ~~**#3 Worksheet column widths**~~ (2026-07-11) — variable widths via
  gridwindow prefix-sum + binary search (uniform fast path kept),
  header-edge drag + double-click autofit; session-only state (the .dwk
  persistence owner gate respected); resize perf case added.
- ~~**#4 Selection → Graph Builder**~~ (2026-07-11) — designation-aware
  `selectionToSpec` + one-shot store seed; toolbar button + context
  menu; rows via the rowstate chokepoint (allowlist untouched).
- ~~**#5 .otp template import (frontend)**~~ (2026-07-11) —
  `lib/originTemplate.ts` upload client → tagged, never-clobber entries
  in the graph-templates store; File-menu command.

- ~~**Fold-up restructure**~~ (2026-07-10) — created this root plan;
  absorbed the open residue of MULTI_PLOT, WORKSHEET,
  PROJECT_ORGANIZATION, GAP_TIER3, GAP_ECOSYSTEM, ORIGIN_GAP (six plans,
  ≤3 open items each) and archived them; PORT_PLAN / PORT_CHECKLIST /
  GOTO_PLAN / ORIGIN_FILE_DECODE_PLAN became declared sub-plans.
