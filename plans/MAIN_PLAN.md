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
**Updated:** 2026-07-25 (ChatGPT-Sol follow-up audit added items 31–38,
each problem statement verified against the code before booking; the
earlier same-day plan-tree consolidation absorbed the two orphan Sol
audit docs and booked their prior residue as items 29–30)

---

## Context

### The plan tree

| Sub-plan | Scope | Why it earns a separate file |
|----------|-------|------------------------------|
| `PORT_PLAN.md` (+ appendix `PORT_CHECKLIST.md`) | MATLAB parity, packaging (W8), CI/verification (W9) | Founding doc; W0–W9 history + the exhaustive per-feature parity inventory |
| `GOTO_PLAN.md` | The go-to capability push vs Origin (10 owner-decided items + switch-trigger protocol) | Active build campaign, own decision log |
| `GUI_INTERACTION_PLAN.md` | Origin-parity interaction/UX campaign: undoable visual edits, unified object editing, gesture discoverability, scientific-selection correctness traps | Standing multi-tier campaign from the 2026-07-12 ChatGPT-Sol GUI audit; own owner-gate/decision log |
| `ORIGIN_FILE_DECODE_PLAN.md` | `.opj`/`.opju` reverse-engineering + decode gaps | Large RE reference (format findings, §13 gap register) |

Six residue plans were folded up into this doc and archived on
2026-07-10 (fold-up rule): MULTI_PLOT, WORKSHEET, PROJECT_ORGANIZATION,
GAP_TIER3, GAP_ECOSYSTEM, ORIGIN_GAP — each was ≤3 open items. Their
`## Completed` histories live in `plans/archive/`. Provenance is kept on
every folded item below.

Two orphan audit docs were absorbed and **deleted** on 2026-07-25:
`SOL_FEATURE_GUI_INTERACTION_AUDIT.md` (924 lines) and
`SOL_ORIGINPRO_REPLACEMENT_AUDIT.md` (261 lines). Neither declared a
parent or appeared in the BACKLOG dashboard, and the first carried 257
permanently-unchecked boxes that were *not* current status — so
`GUI_INTERACTION_PLAN.md` had to keep a standing disclaimer warning
readers off them. That is the plan-consolidation rule's warning sign
exactly (an interim artifact alive next to the plan it spawned). Before
deleting, every finding was checked against the code: the analysis-
selection contract, convergence diagnostics and autosave findings are
shipped; the pipeline residual is shipped (`executeSteps.ts` replays a
typed per-step fit spec); the Origin-migration and owner-decision
findings are already tracked as gates or blocked rows. The only residue
booked nowhere became items 29–30.

### Cross-plan dependencies
- GOTO #4 (fig composer) + #5 (rich text) gate the PNR half of the
  switch-trigger project (GOTO protocol).
- The WebGL 3-D deferral (below) shares its gate with GOTO Q4 — one
  answer resolves both.
- BACKLOG.md stays the derived cross-plan dashboard (plan-hygiene truth
  order unchanged: code > plan Completed sections > BACKLOG).

### Origin-parity surface audit (2026-07-11)
An independent 19-area enumeration of OriginPro's daily-driver surface
(analysis-software-expert, this-user profile) diffed against the live
command/route/workshop inventory. Conclusion: analysis + plotting
coverage is genuinely complete or owner-gated, but the prior gap
campaigns under-weighted **editor ergonomics** — items #9–#16 below are
the found gaps (none previously booked anywhere). Also caught + fixed:
GOTO #11 drift (implemented but listed open).

---

## Tier 1 — High Impact

*(items 9–11 booked from the 2026-07-11 Origin-parity surface audit;
18–19 from the owner's first hands-on testing session, same day)*

~~18. **Pointer tool as the DEFAULT + direct-manipulation plot
    objects**~~ COMPLETED 2026-07-11 (see Completed).

~~19. **Multi-plot panel builder**~~ COMPLETED 2026-07-11 (see
    Completed — v1 + the drag-rearrange follow-up both shipped).

~~21. **Page-anchored annotations**~~ COMPLETED 2026-07-11 (see Completed).

~~22. **Standalone DiraCulator launcher**~~ COMPLETED 2026-07-11 (see
    Completed).

~~23. **DiraCulator Start Menu shortcut in the installer**~~ COMPLETED
    2026-07-11 (see Completed). ⚠ Installer-path verification pending
    the next real release build (noted in the Completed entry).

~~24. **Axis tick formats in publication export**~~ COMPLETED 2026-07-11
    (see Completed).

~~25. **Rich text in annotations**~~ COMPLETED 2026-07-11 (see
    Completed).

~~26. **Split dataset by column value**~~ COMPLETED 2026-07-11 (see
    Completed).

~~27. **Drawing shapes on plots**~~ COMPLETED 2026-07-12 (see Completed).

~~28. **Widen rich-text label support: fractions, roots, sums, etc.**~~
    COMPLETED 2026-07-12 (see Completed — 3 staged commits: relations/
    arrows/analysis glyphs, then real `\frac`/`\sqrt` canvas layout, then
    `\sum`/`\prod`/`\int`/`\oint` big operators; screen + export WYSIWYG).

~~9. **Undo/redo stack**~~ COMPLETED 2026-07-11 (see Completed).

~~20. **Axis tick-label precision + engineering notation**~~ COMPLETED
    2026-07-11 (see Completed).

~~10. **Re-import from source file**~~ COMPLETED 2026-07-11 (see Completed).

*(items 31–38 booked 2026-07-25 from a ChatGPT-"Sol" follow-up audit that
checked the CURRENT implementation against the owner's daily OriginPro
workflow. Every problem statement was verified against the code before
booking — see the verification notes on each. #31 and #32 sit in Tier 1
because they are default-tool blockers with a data-loss failure mode;
#33–#38 are Tier 2. The audit's per-item model-routing recommendations
were dropped: process detail does not belong in a plan doc, and they had
already gone stale.)*

31. **Native file/workspace handling that remembers real paths** — a
    browser `<input type=file>` yields no persistent path or handle, so a
    Recent entry cannot reopen by path; clicking one just reopens the
    import picker (`lib/recentFiles.ts` says so in its own header, and
    `RecentFile` stores only `name`/`size`/`at`). That makes repeat work,
    source relinking, and long network-drive paths markedly slower than
    Origin/MATLAB. Goal: make desktop use file-native while keeping a
    safe browser fallback, and treat an unavailable network drive as
    temporarily offline rather than proof a source was deleted.
    - [ ] Desktop imports retain a canonical source reference and can
          reimport without another picker
    - [ ] Working paths can be selected, pinned, renamed, removed
    - [ ] Recent file/workspace entries reopen their target; stale
          entries offer Locate, Remove, Retry
    - [ ] Offline/network-unavailable and genuinely missing files are
          distinct, non-destructive states
    - [ ] Browser mode degrades visibly to picker behaviour, with no
          false promise that a path was retained
    - [ ] Tests enforce allowed-root / path-validation rules
    - Foundation for #32 and #38. Reuse the existing source-linked
      reimport contract rather than creating a second one.

32. **Durable autosave, crash recovery, and bounded project trash** —
    autosave writes the whole workspace to one `localStorage` slot
    (`lib/autosave.ts`, key `qz.autosave`), whose own header notes large
    libraries "can exceed the ~5 MB quota". There is no durable
    generation history, so recovery is one slot deep. Verified nuance:
    quota failure is NOT silent — `useWorkspaceAutosave.ts` surfaces
    "autosave skipped (storage full or unavailable)" — but a transient
    status line is weaker than a persistent, actionable error for the
    default home of experimental work.
    **Slice 1 shipped 2026-07-25** (`6464498`) — the durable store, the
    generations, and the health readout. Slices 2 (startup recovery
    prompt) and 3 (project trash) remain.
    - [x] Durable backing store: IndexedDB where the engine has it
          (`lib/autosaveBackend.ts`), localStorage as a one-generation
          fallback so no browser is worse off than before, in-memory as
          the last resort. A native desktop store can slot in behind the
          same `AutosaveBackend` interface when #31 lands
    - [x] Multiple rotating recovery generations — 3 by default, capped
          by total bytes, written in ONE IndexedDB transaction so a crash
          mid-write leaves the previous set intact. A corrupt newest
          generation falls back to the newest good one
    - [x] UI shows last successful save, current health, and a persistent
          actionable error when saving fails (status bar, `role="alert"`,
          stays until the next SUCCESS)
    - [ ] Startup offers recovery only when the copy is newer or the
          prior session ended uncleanly — TODAY it still restores
          unconditionally, as it always has; needs a clean-shutdown marker
    - [ ] Deleted project objects enter a recoverable trash with age and
          size caps, visible cleanup rules, Restore / Delete Permanently
    - [x] Raw source files are never rewritten or placed in trash — the
          autosave layer only ever writes serialized workspace text to its
          own store; it has no path to a source file
    - Build on #31's storage/path boundary; integrate with the existing
      session undo and `.dwk` serialization instead of inventing a
      parallel state format.

## Tier 2 — Medium Impact

*(items 29–30 folded up 2026-07-25 from the two orphan ChatGPT-"Sol"
audit docs, which were absorbed and deleted the same day per the
plan-consolidation rule. Every OTHER Sol finding was verified either
shipped or already represented as an owner gate / blocked row before the
delete — these two were the only residue booked nowhere. Full audit text
in git history @ `e4f6590`.)*

~~29. **Frontend bundle code-splitting**~~ COMPLETED 2026-07-25 (see
    Completed).

30. **Fit-recipe residual fields** — `FitSpec` became a reproducible
    recipe (`xKey`/`yKey`/`weight`/`params`/`exitFlag`), closing the
    channel and weighting half of the audit's provenance finding. The
    remainder is genuinely open: explicit fit range, starting values,
    parameter bounds, covariance/uncertainty method, and preprocessing
    state — plus a UI distinction between a historical result and a
    recomputed one. Partly constrained by design: registry fits expose
    no user bounds, so those fields can only be captured as the
    weighted/equation fit paths surface them.

*(items 33–38 from the same 2026-07-25 ChatGPT-Sol follow-up audit as
#31/#32 above; each problem statement verified against the code.)*

33. **Complete import metadata, categorical columns, and column roles** —
    `DataStruct.values` is `number[][]`, so the canonical contract is
    numeric-only. Text columns DO survive, but only as metadata sidecars
    and only for two sources (Origin projects via `meta.origin_text_
    columns`/`columnmeta.originTextColumns`, and SQLite queries via
    `io/sqlite_query.py` — the sole backend emitter); generic delimited
    imports drop them. `TextColumn`'s own docstring notes text columns
    "have no channel index", which is exactly why they cannot yet drive
    legend, grouping, facet, or box-plot inputs. Goal: import an
    arbitrary lab file once, retain useful context, and choose later
    which metadata row or categorical column drives labels and grouping
    — without editing the source file.
    - [ ] Wizard previews and preserves multiple selectable label rows
          (sample ID, field, temperature)
    - [ ] Text/categorical columns retained as searchable data, hidden
          from numeric plotting until selected
    - [ ] Legend-label source is choosable, and changeable later from
          plot properties
    - [ ] Generic delimited imports preserve cleaned headers, units,
          comments, ignored instrument preamble, original metadata
    - [ ] X, Y, label, ignore, X-error, Y-error and asymmetric-error
          roles survive template save/reapply into canonical `DataStruct`
          metadata
    - [ ] Import decisions and any cleaned output carry provenance; the
          original file stays untouched
    - [ ] Tests cover mixed text+numeric files, repeated label rows,
          ambiguous error names, manual role override
    - Establish this contract BEFORE #36 and before deeper JMP-style
      grouped/box-plot work. Boundary note: this is import-time role
      assignment, NOT the standing "worksheet designation editing"
      deferral (read-only in v1) — keep them distinct so that deferral
      does not reopen by accident.

34. **Spreadsheet-style block editing for fast data cleanup** — single
    worksheet cells are editable, but there are no rectangular
    operations anywhere in `Stage/worksheet/`, `store/worksheetSelection`
    or `lib/worksheetTransforms` (verified: no clipboard/paste/fill
    handlers), so cleanup of a copied table means one cell at a time or
    a detour through Excel/Origin.
    **Core shipped 2026-07-25.** Copy/paste/clear/fill-down over a
    row×column selection, via a new `setCellBlock` store action.
    - [x] Rectangular copy/paste with tab-newline clipboard data and
          predictable shape mismatch — handles CRLF and Excel's trailing
          newline, and CLIPS rather than growing the sheet (growing would
          invalidate every row-indexed piece of state at once: exclusions,
          filters, fit overlays). Dropped cells are REPORTED, split into
          "outside the sheet" vs "read-only column"
    - [x] Paste-over-selection, clear block, fill down — toolbar, shown
          only when a block is selected. Cut and insert/delete rows or
          derived columns are NOT done; keyboard bindings are NOT done
    - [x] Every operation undoable in-session with a compact provenance
          entry — ONE undo entry and one macro line per block, not one per
          cell (a paste needing N presses of Ctrl+Z is not a usable model)
    - [x] Raw imported data stays immutable — writes go through the same
          `recompute` path single-cell editing already used; `raw` is
          untouched and corrections re-derive from it
    - [ ] Large pastes show progress — not done. Edits are indexed by row
          so the apply is O(rows + edits) rather than O(rows × edits), but
          there is no progress affordance for a very large paste
    - Build on the existing worksheet selection, edit, undo and
      corrected-data conventions.

35. **One-click publication-quality figure copy** — Copy currently
    composites the live uPlot canvas at screen resolution;
    `plotExport.plotPngBlob`'s own docstring calls it "a quick raster
    grab of exactly what's on screen". The expected workflow is seconds
    from finished plot to PowerPoint or Word.
    **Substantially shipped 2026-07-25** (see Completed); one sub-item
    remains (clipboard SVG).
    - [x] Copy Figure puts a 300-DPI transparent-or-white PNG (user
          preference) on the clipboard via the publication render path —
          `transparent=` now threads through BOTH render paths (the main
          one and figure_break's broken-axis renderer), the route schema,
          `FigureSpec`, and a Preferences ▸ Plot control. Opaque stays the
          default at every layer, with tests pinning that an omitted field
          still renders alpha=255
    - [ ] SVG offered where the platform clipboard supports it; Windows
          EMF stays separately scoped
    - [x] Copied output matches Figure Builder/export for limits, ticks,
          fonts, line widths, error bars, annotations, multi-panel layout
          — structural, not maintained by hand: both callers build the
          same spec through `lib/figureSpec.buildFigureSpec`
    - [x] Normal figures copy within seconds, with clear progress and
          failure feedback; capability is checked BEFORE rendering so an
          unsupported browser fails immediately instead of burning a
          render
    - [x] The screen-canvas grab survives only as an explicitly named
          quick option ("Copy image (screen)")
    - Reuses the server-side matplotlib publication renderer and its
      parity tests — no third rendering implementation was added.

36. **Complete symmetric and asymmetric X/Y error bars** — `errKeys` is
    `Record<number, number>`, i.e. exactly one error channel per series,
    so interactive support is symmetric vertical Y only. PORT_CHECKLIST
    confirms that much shipped (`buildErrorColumns` + `errorBarsPlugin`
    draw y±e whiskers); X error and asymmetric plus/minus are not a
    complete import-to-screen-to-export workflow.
    - [ ] Canonical mapping supports X±, Y±, X+/X−, Y+/Y−
    - [ ] Common names (`err`, `sigma`, `sd`, `se`, `xerr`, `yerr`,
          `err+`, `err-`) suggested, never silently forced when ambiguous
    - [ ] Import Wizard and plot Inspector expose pairing/override
    - [ ] Interactive, clipboard, PNG, SVG and PDF paths agree
    - [ ] Error data stay independent of raw X/Y and can be toggled or
          restyled without mutation
    - [ ] Tests cover asymmetric values, X error, missing values, log
          axes, clipped/off-scale bars
    - Implement AFTER #33 defines durable roles and `DataStruct` metadata.

~~37. **Arbitrary non-destructive X/Y rescaling**~~ COMPLETED 2026-07-25 —
    `CorrectionParams`
    carried `xOff`/`yOff` offsets but no scale factor, so multiplying or
    dividing a channel for inconvenient units or normalization was not
    possible without rewriting data. **Substantially shipped 2026-07-25**
    (see Completed for the design rationale); one sub-item remains.
    - [x] Corrections offer X and Y multiply/divide by a validated
          numeric factor — ×/÷ rows in the Corrections card, existing
          Apply / Reset serving as commit and revert
    - [x] Labels/units updatable in the same operation — X/Y label fields
          appear in the Corrections card as soon as a scale is entered
          (exactly when a unit string is about to stop matching the
          numbers) and apply with it. They set the axis-label overrides
          the screen, copy and export all already read. NOTE: per-channel
          `DataStruct.units` are deliberately NOT rewritten — a uniform
          yScale across channels with different units cannot produce one
          correct unit string, so the axis label the reader actually sees
          is the honest place to fix this
    - [x] Undoable, recorded in provenance, recomputable, round-trips
          through project/template save — all inherited, none re-built:
          `store/corrections.ts` already calls
          `recordHistory("apply corrections")`, and `lib/workspace.ts`
          serializes the whole `corrections` object generically, so the
          new fields persist with no per-field wiring
    - [x] Zero, non-finite and invalid factors fail clearly (both
          layers); error-channel behaviour tested. Log-axis behaviour
          needs no new rule — the frontend's existing `log && v <= 0`
          extent guard already drops non-positive values, so a
          sign-flipped series degrades exactly like any other
          non-positive data
    - Extends the existing non-destructive corrections pipeline; a
      uniform yScale means error channels scale with their y-channel for
      free.

38. **A useful home screen and project-wide navigation** — the empty
    Library offers essentially file drop ("Drop files here, or use ⊞ to
    import / ✚ for a demo"); recents and smart folders exist but do not
    add up to project-level navigation.
    - [ ] Home shows recent and pinned projects/files, working-path
          choices, drop/import, and recovery status without clutter
    - [ ] Entries expose Open, Locate, Unpin, Remove from Recent, Retry
    - [ ] Missing/offline sources are visible but never trigger automatic
          deletion, relinking or destructive cleanup
    - [ ] Later sub-phase: project-wide search across dataset names,
          column labels, metadata, notes, reports, figures, with Reveal
          in Library/Worksheet/Figure
    - [ ] Search stays deferred until the home/recent/path model is
          validated in real use
    - Compose #31's paths/recents and #32's recovery health; do not
      duplicate their state.

~~12. **Reciprocal (Arrhenius) axis scale**~~ COMPLETED 2026-07-11 (see
    Completed).

~~13. **Fill between / under curves**~~ COMPLETED 2026-07-11 (see Completed).

~~14. **Color-mapped scatter**~~ COMPLETED 2026-07-11 (see Completed).

~~17. **Rich-text formatting shortcuts**~~ COMPLETED 2026-07-11 (see Completed).

~~1. **Decompose App.tsx + ThinFilmTab.tsx**~~ COMPLETED 2026-07-11 (see Completed).
~~2. **Extract the useApp window slice**~~ COMPLETED 2026-07-11 (see Completed).
~~3. **Worksheet per-column widths + drag resize**~~ ✅ completed 2026-07-11 (see Completed).
~~4. **Worksheet selection → Graph Builder handoff**~~ ✅ completed 2026-07-11 (see Completed).
~~5. **`.otp`/`.otpu` template import, frontend half**~~ ✅ completed 2026-07-11 (see Completed).
~~6. **Defaults-audit residuals**~~ ✅ completed 2026-07-11 (see
   Completed).
~~7. **Register import_lake_shore**~~ COMPLETED 2026-07-11 (see Completed).

~~8. **Post-review consolidation batch**~~ COMPLETED 2026-07-11 (see
   Completed — all 9 sub-items shipped).

## Tier 3 — Nice-to-Have

~~15. **Find X from Y / Y from X on a fitted curve**~~ COMPLETED
    2026-07-11 (see Completed).

~~16. **Append/merge workspace**~~ COMPLETED 2026-07-11 (see Completed).

*(further candidates arrive via GOTO owner gates Q4/Q6/Q7/Q8)*

---

## Owner gates (folded from the archived plans)

- **Pop-out books/plots into windows** (was MULTI_PLOT #19) — PLAN WITH
  OWNER FIRST: gesture, "pop out a BOOK" semantics, bulk "window
  everything" command.
- **Worksheet view-state persistence** (was WORKSHEET #14) — decide
  once, with usage evidence, whether sort/widths/selection persist
  per-dataset in `.dwk` (default: no).
- **PyPI: fresh-machine acceptance run** (was ORIGIN_GAP #41) — the
  registration + first tagged publish are DONE (2026-07-12: trusted
  publisher registered for **`quantized-lab`** on pypi.org +
  test.pypi.org; TestPyPI dry run green; v0.8.1 live on PyPI + GitHub
  with correctly-named installers — v0.8.0 was cut with a
  pyproject-only bump, the version-consistency guard caught it, its GH
  release was deleted; the PyPI 0.8.0 wheel was correct and remains).
  REMAINING: the acceptance run — on a machine without dev tools,
  `pipx install quantized-lab` → import a CSV within 2 minutes.
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
- ~~**Database connectors**~~ (was ORIGIN_GAP #47) — **no longer deferred.** A
  read-only SQLite connector shipped 2026-07-19 (Codex PR #69) ahead of this
  gate, on a fabricated approval; the owner ratified it on 2026-07-20 after
  review, so it stays. Further connectors remain on user pull.
- **Worksheet designation editing** (was WORKSHEET D2) — read-only in
  v1 unless requested.
- **Graph Builder export button + `.dwk` plot-spec persistence** —
  booked debt from archived GAP_INTERACTION #51.
- **Stat-stage residuals** (archived GAP_PLOTTYPES, accepted) — bar
  orientation, in-canvas legend, `payloadToTSV` ordinals,
  `statRender.ts`/`useStatStage.ts` split candidates.

## Completed

- **#35 Publication-quality figure copy** (2026-07-25) — shipped in two
  commits (`70342fa` extraction, `e45cb48` feature); two sub-items left
  open above (clipboard SVG, and a transparent-background option that
  needs `transparent=` threaded through `savefig` first).
  - **The fix is structural, not cosmetic.** `runExportFigureCommand`
    built its spec inline, so the ~70 lines translating live view state
    into a request were reachable only by the download command. Those
    moved to `lib/figureSpec.buildFigureSpec`, and BOTH commands now
    build the same spec and post it to the same renderer — screen-vs-
    paste parity can no longer drift, and no third rendering path exists.
    The extraction landed as its own commit, verified behaviour-
    preserving against the 35 existing tests.
  - **Two details that decide whether it works at all.** (1) The
    clipboard gets the PENDING render, not an awaited Blob — awaiting a
    server round-trip can drop the transient user activation the
    Clipboard API requires, and the copy then fails invisibly; the spec
    permits a promise-valued `ClipboardItem`, with await-then-write as
    the fallback. (2) Capability is checked BEFORE rendering, so Firefox
    or an insecure context fails at once rather than burning a render.
  - **Routed through the existing `exportActive` chokepoint** instead of
    resolving the dataset independently — that chokepoint is what stops
    an export running on a lazy book's small preview (#38), so
    duplicating the resolve would have reopened exactly that bug. It
    gained optional verb/past labels for copy wording.
  - Verified: frontend 4273 / 304 files + build; bundle 913.0 kB eager
    (36.2 kB under budget).

- **#37 Arbitrary non-destructive X/Y rescaling** (2026-07-25) — shipped
  in two commits (backend `8754cbc`, frontend `54998e3`); one sub-item
  (labels/units in the same operation) deliberately left open above.
  - **`xScale`/`yScale` run FIRST, as step 0 before the trim** — the
    ordering IS the design, not an implementation detail. Trim bounds,
    `xOff`, bg slope/intercept and anchors are all picked by the user off
    the PLOT, so scaling later would silently redefine every one of them.
    And step 8's derivative then differentiates scaled y against scaled
    x, giving d(y·sy)/d(x·sx) = (sy/sx)·dy/dx for free; scaling at the
    END would multiply by sy alone and be wrong by a factor of sx. A
    regression test pins exactly that case (7.5, not 15).
  - **One stored representation.** The ×/÷ operator is input sugar; the
    stored value is always the literal multiplier (÷v stores 1/v), so no
    second field can drift. Consequence is deliberate and tested: "÷ 10"
    re-opens as "× 0.1".
  - **Error bars for free** — a uniform `yScale` over every value channel
    means a y-channel and its paired error channel scale together, so the
    y±e ratio is invariant. Same uniform treatment step 5's emu/g
    conversion already applies.
  - **Validated on both layers.** Zero/non-finite/non-numeric rejected in
    `lib/rescale.ts` (disables Apply, names the reason in a
    `role="alert"` note) and independently in calc, which raises
    `ValueError` that the route maps to 422 — not a 500 (the
    narrow-except class). Error strings ASCII-tested for Windows cp1252.
  - **Two wrong assumptions the tests caught** (code was right, my
    expectations weren't): `Number("1e-400")` underflows to exactly 0 in
    JS so it hits the zero guard, not the finite one — the reachable
    overflow is `÷ 5e-324`, whose reciprocal is Infinity; and the
    non-finite ROUTE guard is only reachable via a raw JSON body, since
    Python's encoder refuses to emit `inf` while its decoder accepts
    `1e400` from a JS client.
  - Verified: backend 3042→3044 + ruff + mypy; frontend 4266 / 303 files
    + build; bundle ratchet 911.9 kB eager (37.3 kB under);
    `CorrectionsCard.tsx` 369 of ~400.

- ~~**#29 Frontend bundle code-splitting**~~ (2026-07-25) — eager JS
  **1,120,960 B → 932,219 B (−16.8%)**; gzip 338.55 → 288.44 kB. The 25
  flag-gated workshop panels in `AppOverlays.tsx` became `lazyPanel(...)`
  dynamic imports, so opening one panel no longer downloads all 25; they
  now emit 25 on-demand chunks (0.28–24.22 kB).
  - **Per-panel Suspense boundaries, not one shared boundary.** A single
    boundary would suspend the whole subtree when a second panel opened,
    blanking an already-open panel while the new chunk loaded. Wrapping
    at the IMPORT site (`lazyPanel` returns a component that owns its own
    `<Suspense fallback={null}>`) isolates suspension per panel.
  - **The JSX block is byte-identical.** Three tests
    (SplitDatasetDialog / TextFormatHelp / ReductionsPanel) assert
    against this file's RAW SOURCE TEXT because the App tree is too heavy
    for jsdom. Wrapping at the import site rather than the render site
    meant the mount lines never changed and all three stayed green.
  - **Eager on purpose:** the always-mounted dialogs (they mount on load,
    so lazying only adds a fallback flash) and `SqliteQueryDialog`, which
    self-gates on a `SHOW_SQLITE_QUERY` window event registered in a
    `useEffect` — it must stay mounted to hear it at all.
  - **Ratchet:** `frontend/scripts/check-bundle-size.mjs`, wired into
    `npm run build` so CI enforces it for free. It budgets *eager* JS
    (entry + `modulepreload` chunks, parsed out of the built
    `index.html`) — a truer number than Vite's largest-single-chunk
    warning, because it measures what the browser fetches before it can
    paint. Pinned at 972,000 B with 40 kB slack; going over fails, and so
    does dropping well under (that demands the pin be lowered, which is
    what locks a gain in). Both failure branches were verified by
    planting violations — a gate that never fails is indistinguishable
    from a disabled one.
  - **Honest residual:** the entry chunk is still 702 kB, so Vite's
    generic 500 kB warning still prints. That warning was deliberately
    NOT silenced. Going below it would mean splitting the plot path,
    which is the app's primary view and on the startup critical path —
    deferring it would move cost around rather than remove it. Verified:
    frontend 4,248 tests / 302 files + build green; repo-integrity guard
    3 passed; `AppOverlays.tsx` 149 lines vs the ~400 ceiling.

- ~~**#28 Widen rich-text labels: fractions, roots, sums**~~ (2026-07-12,
  3 staged commits on `feat/richtext-widen`) — the `$...$` label subset
  grew from scripts+Greek+symbols to real structural math, WYSIWYG across
  the interactive uPlot canvas AND the matplotlib vector export. **Method:**
  every candidate command was first probed against matplotlib's own
  `MathTextParser` (the export gate) so the frontend never accepts anything
  export would render differently; the layout target was captured from a
  matplotlib REFERENCE render (`$\frac$`, `$\sqrt$`, `$\sum$`, `$\int$`
  inline) — which is where the one real design fork was resolved: matplotlib
  STACKS `\sum`/`\prod` limits inline but SIDE-scripts `\int`/`\oint`, so the
  renderer matches that, it doesn't guess. **(1)** relations/arrows/analysis
  glyphs (`\leq \geq \neq \approx \propto \infty \rightarrow \partial …`) —
  pure glyph passthrough, no renderer change. **(2)** `\frac{a}{b}`,
  `\sqrt{x}`, `\sqrt[n]{x}` — `richtextCanvas` gained a vertical BOX model
  (width+ascent+descent); fractions stack num/den across a stroked rule on a
  0.28-em math axis, radicals hand-stroke a √ + overline sized to the
  radicand with the index in the crook; DOM surfaces (legend, title, editor
  preview) get a CSS approximation. **(3)** `\sum \prod \int \oint` big
  operators (1.4× glyph straddling the axis; stacked vs side limits per the
  matplotlib rule). The frontend parser stays THE gate: `\frac \sqrt \sum
  \prod \int \oint` joined `SUPPORTED_MATHTEXT_COMMANDS` in lockstep, so an
  accepted label always renders identically on export (out-of-subset accents
  `\hat`/`\vec`/`\overline` remain literal-fallback). Palette gained
  Structures + Relations sections; help sheet gained live worked examples.
  VERIFIED on the real canvas via `tools/visual` (fractions/roots/bigops in
  titles + rotated y-axis labels, nested `1/√(2π)`, `χ²=1/N·∑(y−f)²`) — jsdom
  can't do canvas text metrics, so this is the load-bearing check. Full
  frontend suite 3232 green; backend labels + repo-integrity 30 green; ruff
  `src tests` + mypy `src` clean.

- ~~**#27 Drawing shapes on plots**~~ (2026-07-12, sonnet agent +
  post-merge bug-hunt batch) — arrow/line/rect/ellipse via
  `lib/uplotShapes.ts` + `store/shapes.ts`; dock flyout + a new Insert
  menu; draw-drag → auto-return to pointer; pointer-mode select/move/
  reshape via the shared gesture machinery; right-click swatch/opacity/
  width/dash menu + Inspector Shapes card; data/page anchor; "text box"
  = an annotation `frame` (one text system, rides #25); matplotlib
  export parity (FancyArrow/Rectangle/Ellipse + alpha; z-order by
  matplotlib zorder, not insertion). **A 2-agent adversarial bug hunt
  then found 9 confirmed defects the 3196-test suite missed** (none
  shipped) — the SEVERE ones: shape clicks silently reset the plot zoom
  (`stopPropagation` doesn't block a sibling plugin on the same DOM
  node → `stopImmediatePropagation`); data-anchored shapes had no
  off-canvas clamp (draggable into oblivion); split auto-tolerance
  (#26) merged distinct setpoints with sparse data (median×8 →
  elbow-detection on sorted gaps); split preview ≠ commit on invalid
  tolerance text; screen-vs-export mathtext divergence (`$\frac{}{}$`
  rendered on export but literal on screen → backend now gates on the
  frontend's command subset). Plus cursor-clobber, text-box-cancel
  orphan, dup-folder, export-width falsy-0. All fixed with fail-before/
  pass-after regression tests. useApp.ts sits AT its 3335 pin (zero
  headroom — next store feature MUST extract a slice). Known accepted
  limitation: no single-tolerance 1-D clustering is robust to every gap
  distribution (a periodic-jump ramp can still under-cap) — the elbow
  heuristic fixes the confirmed sparse-setpoint case; documented in
  `datasetsplit.ts`.

- ~~**#25 Rich text in annotations**~~ (2026-07-11, sonnet agent) — the
  annotation canvas draw + hit geometry ride the SAME richtextCanvas
  renderer as axis labels (measureRich width in annotationLayout, so
  hit box/outline/handle track the RENDERED runs, not raw markup;
  ASCENT/DESCENT constants promoted to the shared module); edit dialog
  = new AnnotationTextDialog embedding RichLabelInput (Ω palette + live
  preview — askParams has no custom-component slot); AnnotationsCard
  renders via RichText; export was ALREADY guarded (safe_mathtext_label
  covers page-anchor + size), +4 behavior tests proving mathtext
  engages. Frontend 3013 / backend 2813 green on its branch.
- ~~**#26 Split dataset by column value**~~ (2026-07-11, sonnet agent) —
  one imported multi-setpoint file (M-H loops at 5/10/50/100 K in a
  single PPMS export) → per-setpoint datasets. Pure model
  `lib/datasetsplit.ts`: numeric (continuous, per `lib/modeling.ts`'s
  inference) columns GAP-CLUSTER — sort, split where the gap exceeds a
  tolerance; auto tolerance = median NON-ZERO adjacent gap × 8 (a
  documented multiplier, empirically threading 5/10/50/100 K wobble vs.
  jump), so a perfectly uniform ramp collapses to ONE group under the
  auto default (median == every gap) while an explicit too-tight
  tolerance still explodes to one-group-per-row — caught by
  `tooManyGroups`/`SPLIT_GROUP_CAP` (50), which the dialog renders as a
  warning instead of a 300-row list. Categorical (nominal/ordinal)
  columns exact-group instead (no tolerance). NaN/Infinity rows land in
  a trailing "(other)" group rather than being dropped. Store action
  `store/split.ts`'s `splitDatasetByColumn` (own slice file — useApp.ts
  sat at 3327/3335 lines of ratchet, zero room for an inline action;
  matches store/reductions.ts's precedent): mints one child dataset per
  group (sliced `data`, ONE new `set()`, ONE `recordHistory` entry) into
  ONE new Library FOLDER named after the source (not the legacy
  `Dataset.group` field, which lib/foldertree.ts documents as retired/
  migration-only) nested under the source's own folder. Carries
  formulas/channelRoles/channelTypes (column-indexed, row-slice-safe);
  drops excludedRows/filter (row-indexed, meaningless post-slice),
  raw/corrections/bgRef (raw's row count can diverge from data's after
  an xTrim), and source/pending/notes/tags/fitSpec (re-import would
  silently undo the split; the rest is source-sweep-scoped, not
  per-setpoint). Resolves a still-pending Origin book before slicing.
  Undo restores the pre-split `datasets` in one step but — same as the
  existing "New folder with this…" entry — leaves the emptied folder
  behind, since folder-tree mutations sit outside the undo system
  everywhere in this store. Dialog `components/overlays/
  SplitDatasetDialog.tsx` (modal, ParamDialog/ConfirmDialog convention):
  column picker (x + every channel) with a "most setpoint-like" default
  (fewest groups > 1, cheap per-column score), tolerance field
  (continuous columns only, auto-seeded + editable), and a LIVE preview
  list (value → row count) recomputed via `useMemo` on every
  column/tolerance edit — the discoverability requirement. Entry points:
  DatasetRow context menu "Split by column value…" (Re-import's
  pattern) + an Analyze-menu/⌘K command on the active dataset
  (appCommands.ts, 673→674/684 lines of ratchet). 29 pure-model + 15
  store + 11 dialog + 1 menu-registration + 2 command-registry tests (58
  new); frontend 3054/3054, build + typecheck clean; useApp.ts 3334/3335,
  appCommands.ts 674/684, DatasetRow.tsx 399/400 — all ratchets held.

- ~~**#24 Axis tick formats in publication export**~~ (2026-07-11, sonnet
  agent) — matplotlib mirrors the screen's `AxisFormat` (fixed/sci/eng +
  the increment-aware precision floor + −0 normalization) via a new
  `calc/figure_ticks.py` (`Formatter` subclass reading
  `self.axis.get_majorticklocs()` lazily at DRAW time, since matplotlib's
  Formatter/Locator split has no `foundIncr`-equivalent argument);
  `auto` stays `None` (matplotlib's own default). Threaded through all 3
  drawing consumers: `figure.draw_series_axes` (single-figure + figure-
  page panels), `figure_break.render_breaks_impl` (broken-axis panels,
  applied per-panel — it draws its own axes, doesn't call
  `draw_series_axes`), and `figure_page.PagePanel` (per-panel own
  `x_fmt`/`y_fmt`, not one page-wide format). `figure.py` hit the
  500-line ceiling adding the params, so `_collect_map`/
  `_bbox_to_pixels`/`_artist_window_extent` were extracted to a new
  sibling `calc/figure_hitmap.py` first (416 lines after, was 496).
  Route wire model `TickFormatSpec` (routes/export_figures.py,
  `Literal["auto","fixed","sci","eng"]`) sent only when non-`auto`
  (`lib/types.ts`'s `axisFmtParam`) from `exportFigureCommand.ts`,
  `useFigureBuilder`, and `useFigurePage`'s per-panel window view (a
  saved Library-figure/FigureDoc panel has no persisted fmt to restore —
  documented gap, exports at auto). `y_fmt` documented as also covering
  the screen's y2 axis; the matplotlib backend has no y2/twinx rendering
  to mirror it onto. +23 backend unit tests (real `fig.canvas.draw()` +
  `ax.get_xticklabels()`, several ported 1:1 from
  `uplotOpts.test.ts`'s MAIN #20 cases) + 9 integration/route tests +
  9 frontend tests. Backend 2810 passed / frontend 2996 passed, ruff +
  mypy --strict clean.

- ~~**#23 DiraCulator Start Menu shortcut**~~ (2026-07-11, sonnet agent)
  — Tauri shell `--calc` mode (pure unit-tested `shell_mode`/
  `webview_url` helpers; retitles/resizes the config-defined "main"
  window to DiraCulator 520×680; sidecar logic byte-identical both
  modes; cargo check/test 7/7/clippy clean) + NSIS POSTINSTALL/
  POSTUNINSTALL hooks grounded in the TAG-PINNED tauri-bundler
  template source (tauri-cli-v2.11.2): `$SMPROGRAMS\DiraCulator.lnk` →
  `$INSTDIR\${MAINBINARYNAME}.exe --calc` (MAINBINARYNAME, not a
  hardcoded exe name — the binary is quantized-shell.exe), ambient
  SHCTX matches Tauri's own shortcut, uninstall gated on
  `$UpdateMode <> 1` + UnpinShortcut so upgrades never delete it.
  HONEST GAP: hooks verified by construction only — the full
  install/upgrade/uninstall path runs at the next real release build
  (pair it with the signing-cert owner gate's E2E).

- ~~**#22 Standalone DiraCulator launcher**~~ (2026-07-11, sonnet agent)
  — `qz --calc` + `diraculator` console-script alias (`cli.main_calc`);
  `?view=calc` mounts a 43-line `CalcOnlyApp` (titlebar + theme toggle
  + `CalculatorsContent`, extracted from CalculatorsPanel — no
  Library/Stage/menubar mounted); the one cross-workshop affordance
  (SLD → Reflectivity seed) degrades to a toast in calc-only mode.
  Port fallback went GLOBAL: a busy non-explicit port auto-falls-back
  to an OS-assigned free port with a printed note (explicit --port
  still errors); `--calc --desktop` = 520×680 pywebview "DiraCulator".
  End-to-end verified live: main app on 8000 + diraculator on a
  fallback port simultaneously, calc view 200. Honest tail: `--calc
  --dev` accepted but ignored (dev opens the plain Vite root).
  Frontend 2991 / backend 2779 green.

- ~~**#21 Page-anchored annotations**~~ (2026-07-11, sonnet agent) —
  `Annotation.anchor?: "data"|"page"` (page = canvas fractions, default
  data = full back-compat); right-click "Pin to page / Pin to data"
  toggle converts coords IN PLACE via `annotationAnchorConversions`
  (round-trip-exact, y2-scale aware; `canvasToOverCss` = the documented
  inverse of `overPointerToCanvas`); page drags move in fraction space
  with the same on-canvas clamp; sanitizeView gained real
  `sanitizeAnnotations` validation (was a bare cast); export renders
  page text via `ax.annotate(xycoords="figure fraction")` with the
  canvas-vs-matplotlib y-flip, verified against real matplotlib output.
  +~30 tests (frontend 2983 / backend 2766 green on its branch).

- ~~**#19 Multi-plot panel builder**~~ (2026-07-11, two sonnet agents;
  design decided with owner — Library-row selection, composite MDI
  window, quick picks, auto dual-Y) — v1 (`ccd91d8`): `panel` window
  kind + `store/panels.ts`; pure `lib/panelwindow.ts` (union-x overlay
  through the rowstate chokepoint, unit-family y2 assignment w/
  3+-family toast, grid tiling via facetGridSize); per-window x-sync
  group; DatasetRow quick picks (Side by side / Stack / Grid / Overlay)
  + ⌘K commands; removed datasets prune from panels
  (`pruneWindowDatasetRefs`); +68 tests, every ratchet held. Follow-up
  (`edac315`): drag the panel-cell HEADER (window furniture — works in
  any tool; canvas drag stays box-zoom) to splice-reorder
  `panel.datasetIds`, accent drop-target indicator, dragged cell dims,
  ✕ chip removes a dataset from the panel; header replaced uPlot's
  internal title so no canvas re-render on hover; +~30 tests.

- ~~**#18 Pointer tool default + direct-manipulation objects**~~
  (2026-07-11, sonnet agent) — `pointer` tool (glyph ➤, toolbar-first)
  is the NEW DEFAULT: no crosshair (`cursor:{x:false,y:false}`), arrow
  cursor, empty-drag still box-zooms; every other tool pixel-identical.
  Annotations: click-select / drag-move / corner-handle resize
  (`Annotation.size` 6–72px) / double-click edit (hand-rolled 400ms
  detector — uPlot owns native dblclick for autoscale) / right-click
  object menu / Escape deselect; hit-test = point-first then
  measureText rect (`lib/annotationHit.ts`), geometry shared with the
  draw pass so they can't drift. Ref-line drag gate extended to
  pointer. Legend: drag → `legendXY` fractions (rAF-throttled)
  overriding `legendPos`; double-click snaps to nearest corner. Export
  parity COMPLETE (annotations w/ size + legend loc/anchor through
  `liveViewOverrides` → the #14 bbox_to_anchor path; verified against
  real matplotlib hitmap output). New `store/pointerTool.ts` slice;
  all ratchets held (PlotStage 392/400 via useAnnotationEdit
  extraction; windows.ts untouched at 750/751 — the focus-reset was
  deliberately omitted, documented: annotation ids never recycle so a
  stale selection matches nothing). +~50 tests.

- ~~**#20 Axis tick-label precision + engineering notation**~~
  (2026-07-11, sonnet agent) — REPRODUCED first via `tools/visual`
  (new committed `dense_moment_axis_tick_repro` shot in
  `spec.example.json`): the mechanism is uPlot's OWN default axis
  `values` formatter (`numAxisVals` -> bare `Intl.NumberFormat` with no
  options -> spec-default 3-fraction-digit cap, `foundIncr` never
  consulted) — reproduced with `yFmt` untouched at `{mode:"auto"}`, no
  fixed/sci path involved (the fixed-mode `toFixed` duplicate was also
  independently proven, as a documented mechanism-class regression, but
  isn't what produced the owner's screenshot). Fix: `tickFormatter`
  (`lib/uplotOpts.ts`) no longer returns `undefined` for "auto" —
  `autoTickValues` overrides it with the same Intl locale-grouping
  behaviour but a `splitsIncrement`-derived (`lib/ticks.ts`'s
  `decimalsForIncrement`) precision floor instead of a hardcoded 3;
  `fixed`/`sci` modes get the same floor (`Math.max(digits, floor)`);
  a new `eng` `TickMode` (mantissa in [1,1000), exponent a multiple of
  3, sci-style `1.2e-3` suffix); `stripNegZero` normalizes any
  rounds-to-zero label (fixes the bare "−0"). Wired: Axes card's
  `TickFormat.tsx` Auto/Fixed/Sci/Eng segmented control; command
  palette "Cycle X/Y tick format" (`appCommands.ts`, `cycleTickMode` in
  `plotview.ts`); `.dwk` persistence rides the existing `AxisFormat`
  field for free (`isAxisFormat` only checks `mode` is a string).
  Export parity: audited — `xFmt`/`yFmt` don't flow to the matplotlib
  export path AT ALL today (only `x_scale`/`y_scale` do), a pre-existing
  gap, not a regression; left as an honest gap, not built new scope.
  Axis right-click menu deferred (owner directive: #18's pointer
  context-menu agent was actively editing `plotMenu.ts`/
  `PlotContextMenu.tsx` concurrently — untouched here). +139 new/changed
  frontend tests (uplotOpts/ticks/TickFormat/appCommands/
  MultiPanelStage), harness before/after screenshots prove the fix and
  no regression on a healthy large-integer axis (byte-identical
  Intl-grouped output). Frontend 216 files / 2799 tests green.
- ~~**#9 Undo/redo stack**~~ (2026-07-11, sonnet agent) — snapshot
  history slice `store/history.ts` (depth 50; Zustand structural
  sharing makes snapshots pointer copies), ~24 data-mutating actions
  record labeled entries (imports/remove/rename/merge, cell edits,
  corrections, formulas, exclusions, roles, tags, notes); Ctrl+Z /
  Ctrl+Shift+Z with a focus guard preserving native text undo;
  reactive "Undo <label>" Edit-menu entries (command registry now
  merges per-source). View/window state deliberately excluded. useApp
  pin 3292→3335 WITH written justification (24 non-compressible
  recorder lines — the documented escape). +28 tests. Known limits
  documented: no job-cancel on undo; window bindings don't participate.
- ~~**#13 Fill under/between curves**~~ (2026-07-11, sonnet agent) —
  `SeriesStyle.fill` none/under/{vs channel}; uPlot native series.fill
  + bands on screen, matplotlib fill_between at export via shared
  `calc/plotting.resolve_style_channels`; figure.py split
  (`figure_overrides.py`) to stay under the 500 ceiling.
- ~~**#14 Color-mapped scatter**~~ (2026-07-11, sonnet agent) —
  `SeriesStyle.colorBy` + colormap (lib/colormap reuse); draw-hook
  plugin paints per-point colors in the canvas-pixel frame; matplotlib
  scatter(c=z)+colorbar at export. Bonus: fixed a latent figure-hitmap
  misalignment (ax.lines indexing broke after any scatter series).
- ~~**#15 Find X↔Y on a fitted curve**~~ (2026-07-11, sonnet agent) —
  `calc/fit_findxy.py` (dense-grid bracketing + brentq, returns ALL
  crossings) + thin `POST /api/fitting/find-xy` covering registry
  models AND saved custom equations; FindXYSection in both fit panels.
- ~~**#17 Rich-text formatting shortcuts**~~ (2026-07-11, sonnet agent)
  — wrap-selection Ctrl/Cmd+I italic, Ctrl+= subscript (Ctrl-only;
  Cmd+= is the macOS zoom key), Ctrl+Shift+= superscript, Ctrl/Cmd+.
  opens the palette; emission grammar-verified (`$_{x}$` parses;
  whole-`$…$` selections bail to the safe fallback, regression-pinned);
  documented in TextFormatHelp.
- ~~**#16 Append/merge workspace**~~ (2026-07-11, sonnet agent) — pure
  `lib/workspace.mergeWorkspace` (two-pass id remap so forward bgRefs
  resolve; Origin-style " (2)" name suffixing via the dedupeWindowTitle
  convention; folder refs dropped-with-count — folders don't merge in
  v1) + `appendWorkspace` store action (never touches active/view/
  windows; undo-recorded) + File-menu "Append workspace (.dwk)…".
  Ratchets held by EXTRACTION not raise: saveWorkspaceToFile →
  store/workspaceIO.ts, Export-figure body → lib/exportFigureCommand.ts.
  +13 tests.
- ~~**#11 Reductions GUI**~~ (2026-07-11) — one workshop,
  `components/workshops/reductions/`: a method-picker ToolWindow
  (Williamson-Hall / FFT film thickness / Reflectivity FFT) over the
  already-golden `/api/reductions/*` routes, plus three Analyze-menu
  entries (`appCommands.ts`'s `openReductions`) that open it pre-set to
  a method via a new `store/reductions.ts` slice (kept the store-size
  and command-registry ratchets intact — two boolean-field pairs
  merged onto shared lines to hold `useApp.ts`/`appCommands.ts` at
  their pins). W-H peak entry is manual (2θ/FWHM editable rows,
  add/remove) — the Peaks workshop's fitted peaks live only in its own
  component state, never published to the store, so there is no
  durable prefill source without new cross-workshop plumbing (noted
  follow-up, not built). FFT thickness / reflectivity FFT read the
  active dataset through `lib/rowstate.analysisData` (#50/#53) and
  offer "→ Library" to save the FFT magnitude spectrum as a new
  dataset. Spin asymmetry stays OUT of the GUI — blocked on polarized
  (++/−−) metadata, same gap as the pair-discovery item above it.
  13 new tests (hooks + view + command registry); frontend 2657/2657,
  build clean; backend untouched (`test_api_reductions.py` +
  `test_calc_reductions.py` sanity-checked, still 28/28).
- ~~**#10 Re-import from source file**~~ (2026-07-11) — `Dataset.source?:
  {kind:"path", path}` (round-trips .dwk); honest matrix: real paths are
  knowable ONLY via the path-based `/api/parsers/import` route (`api.
  importFile`) and a lazy Origin book resolved from one — confirmed NEITHER
  the pywebview desktop shell (no `js_api` bridge) NOR the Tauri shell
  (`tauri-plugin-dialog` is Rust-only, never invoked from the frontend)
  currently surface a path from the browser file-picker/drag-drop
  (`uploadFile`/`DataTransfer.files`), so those never set `source` — matches
  the plan's own "browser uploads degrade gracefully" call. New composed
  slice `store/reimport.ts` (`reimportDataset`) + pure `lib/reimport.ts`
  (Origin book-matching, shape-change detection); corrections re-applied
  through the SAME `applyCorrectionsApi` chokepoint `useApp.applyCorrections`
  uses, inlined so the whole op is ONE `recordHistory` entry (single-step
  undo); row/column-indexed state (excludedRows/filter/channelRoles/
  channelTypes/formulas) cleared + toasted only on an actual shape change,
  kept otherwise. Library row context-menu entry + ⌘K command, both
  label-branching to a source-less "Re-import from file…" file-picker
  fallback. 13+8 new tests (store branches + pure helpers) green; store/
  appCommands/component-ceiling ratchets held (net small trims, no pin
  raised). No backend changes — reused the existing import/corrections/
  book-data routes.

- ~~**#12 Reciprocal (Arrhenius) axis scale**~~ (2026-07-11) — `xLog`/`yLog`
  booleans promoted to an `AxisScale` ("linear"/"log"/"reciprocal") enum
  across `PlotView`/store/`.dwk` (back-compat: `scaleFromLog` bridges old
  boolean saves; y2 nullable-inherit preserved). Screen: uPlot custom
  `distr: 100` + self-inverse `fwd`/`bwd` (`reciprocalTransform`), tick
  positions evenly spaced in 1/x with labels in the original units
  (`reciprocalAxisSplits`, always-supplied splits since uPlot has no native
  reciprocal locator). Export: matplotlib has no reciprocal scale either —
  `calc/figure_scale.py` (new, <500-line ceiling) applies it via
  `ax.set_xscale("function", functions=(f, f))` + a matching tick locator,
  wired through the shared `draw_series_axes` chokepoint so single-figure,
  paneled-break, and figure-page export all get it for free. Inspector Axes
  card: two checkboxes → `AxisScaleControls.tsx` (Linear/Log/Reciprocal
  `Select`s, extracted per the card's existing AxisLimits/TickFormat
  pattern). Command palette "Toggle log X/Y axis" → cycle
  linear→log→reciprocal→linear. Context menu axis submenu mirrors the
  3-way pick. Figure-hitmap preview-drag inversion (`lib/previewmap.ts`)
  also fixed for reciprocal (a real "missed consumer" caught by the sweep —
  the backend's `_collect_map` now reports the resolved scale name, not
  `ax.get_xscale()`, which reports a reciprocal axis as the generic
  `"function"`). Origin-decode paths (`SpatialPanel`, `OriginFigure`,
  Origin GRAPH/.ogs export) stay boolean-only by design — Origin has no
  reciprocal axis type; `scaleFromLog`/`=== "log"` bridges at each
  boundary. Backend 2757 tests green (+34), frontend 2706 green (+~60).
- ~~**#8 Post-review consolidation batch**~~ (2026-07-11) — all 9 sub-items,
  4 parallel workstreams (3 worktree agents + direct), zero merge conflicts:
  - Point-gesture core: `lib/pointGesture.ts` (pixel-frame conversion + hit
    test); `uplotAnchors`/`peakMarkerHit` both ride it — the cloned
    pixel-frame bug class is now un-clonable.
  - Anchor bridge identity-stable (`getAnchors` ref read): anchor edits no
    longer rebuild the uPlot instance twice per gesture; pixels cached per
    list-identity + scale window; plugin-level jsdom gesture tests added.
  - `api.ts`: private `ensureOk` + exported `unwrap`/`postForm` — SIX
    drifted error-extraction copies found (not 4), incl. `download.ts`
    (moved into api.ts to break a would-be cycle; download.ts is a DOM leaf).
  - `calc/_clipfit.py` shared Lieber loop; bit-identity vs HEAD proven by
    exact `==` over 50 trials × 18 configs (fit step + init parameterized,
    never harmonized).
  - Calculators card kit hoisted to `calculators/shared.tsx` (−547 lines,
    10 tabs + thinfilm migrated, SubstratesTab included; all ≤293 lines).
  - Legend parsers: forced delegation REJECTED (mixed dotted/plain input
    differs by design — regression-pinned); both parsers + the dotted probe
    now consume ONE `_iter_legend_entries` grammar walk.
  - Figure-page preview invalidation: `panelRenderInputs` store fingerprint
    (mirrors the export guard's reads) via `useShallow` effect dep; +3 tests.
  - `figures.py` 499 → 210 + `figure_layers.py` 333 (verbatim move, diffed).
  - `openInGraphBuilder` UX call: precedent REJECTED (contradicted the
    item-15 "books never move the plot" directive) — the builder now BINDS
    to its seed's dataset; `setActive` plot intent fires at sendToStage.

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
