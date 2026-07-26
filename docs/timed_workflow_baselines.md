# Timed workflow baselines (P0.3)

Reusable, non-sensitive fixtures and step-by-step checklists for timing the
eight representative data-analysis journeys named in
`plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P0.3 ("make usability changes
measurable across weeks"). This is a protocol, not an essay — run it, fill
in the results table at the bottom, commit the numbers.

Regenerate fixtures any time with:

```bash
uv run python tools/baselines/make_fixtures.py
```

(deterministic — fixed numpy seeds, no timestamps/hostnames — so this is a
no-op against the committed set; `tests/test_baseline_fixtures.py` enforces
that). P0.4-scale fixtures (1M-row CSV, 1000x1000 map, dense multi-series)
are `--large`-only and never committed — see that flag's `--help`.

## How to run a journey

1. Start from a fresh session (no prior state for that fixture).
2. Follow the numbered steps below for the journey.
3. Record a row in the [Results log](#results-log) for every run.
4. Any deviation, confusion, or workaround gets its own line under Notes,
   tagged with a classification (see below).

## Fields to record (every journey)

- **Elapsed time** — wall clock, split at the two checkpoints named per
  journey (first plausible plot / production-ready figure; journey 8 has
  its own checkpoints).
- **Gesture count** — clicks + keystrokes + menu selections to reach each
  checkpoint (rough count is fine; the point is relative comparison across
  sessions, not precision).
- **Confusing labels** — any control whose name did not predict its effect.
- **Failures** — crashes, wrong results, silently-dropped data.
- **Discoverability misses** — "I knew what I wanted but couldn't find it."
- **Workaround used** — what you did instead (export to Excel, hand-edit
  the file, gave up on a feature).
- **Classification** — one of: `defect`, `missing feature`,
  `discoverability`, `performance`, `visual taste`, `scientific trust`
  (matches the taxonomy in `PRIMARY_SOFTWARE_AUDIT_PLAN.md` P0.1).

---

## Journey 1 — CSV/TSV with pre-header metadata

**Fixtures:** `tests/fixtures/baselines/csv_preamble_multichannel.csv`,
`tests/fixtures/baselines/tsv_preamble_multichannel.tsv`
(8-line `#`-prefixed instrument preamble, then Time/Channel A/Channel
B/Temperature, 300 rows).

**Preconditions:** fresh session, no other datasets loaded.

1. Open/import the CSV fixture.
2. Confirm the preamble did not get misread as data (check row count = 300).
3. Confirm the 8 preamble lines are visible somewhere (metadata panel,
   comments, provenance) — not silently discarded.
4. Plot Channel A and Channel B vs Time on one axis.
5. Add axis labels/units if not auto-populated correctly.
6. Repeat steps 1-5 for the TSV fixture (delimiter should auto-detect).

**Time:** import -> first plausible plot; then -> production-ready figure
(labeled axes, legend, exportable).

---

## Journey 2 — magnetometry parametric series (M vs H at 3 temperatures)

**Fixture:** `tests/fixtures/baselines/qd_mvsh_parametric_series.dat`
(QD-style plain-CSV `.dat`, hysteresis loops at 100 K / 200 K / 300 K,
603 rows).

**Preconditions:** fresh session.

1. Import the fixture (auto-detect should route to the QD/PPMS parser).
2. Confirm Moment vs Field is the default plot.
3. Split or filter into the 3 temperature series (e.g. by Temperature).
4. Overlay all 3 loops on one axis with a legend identifying each
   temperature.
5. Extract or eyeball coercivity/saturation for at least one loop.
6. Produce a labeled, legended, publication-ready figure.

**Time:** import -> first plausible plot (single loop or all-overlaid);
then -> production-ready figure (3 loops, legend, labels).

---

## Journey 3 — XRD peak/phase work

**Fixture:** `tests/fixtures/baselines/xrd_two_phase_pattern.csv`
(2-theta 10-90 deg, 4000 points, 5 "phase A" + 4 "phase B" Gaussian peaks
on a decaying background, Poisson counting noise).

**Preconditions:** fresh session.

1. Import the fixture.
2. Plot 2-Theta vs Intensity.
3. Identify/mark peaks (manual or automatic peak finding).
4. Fit at least 2 peaks (one from each apparent phase) and record
   position/FWHM/height.
5. Distinguish the two phases visually (color, annotation, or table).
6. Produce a labeled figure with peak markers or a fit overlay.

**Time:** import -> first plausible plot; then -> production-ready figure
(peaks marked/fit, phases distinguished).

---

## Journey 4 — XRR/PNR layered curves

**Fixtures:** `tests/fixtures/baselines/xrr_bilayer_kiessig.refl` (NCNR
`.refl`-style bilayer reflectivity, Kiessig fringes, ~7 decades dynamic
range), `tests/fixtures/baselines/pnr_bilayer_spin_pair.pnr` (spin-up/down
R++/R-- pair with a magnetic splitting).

**Preconditions:** fresh session.

1. Import the XRR fixture; plot R vs Q on log-Y.
2. Confirm dR error bars render.
3. Import the PNR fixture; plot R++ and R-- together on one log-Y axis.
4. Confirm both spin channels are distinguishable (color/legend) and the
   splitting between them is visible.
5. (If a fit workbench exists) attempt a bilayer model fit to the XRR
   curve and record whether it converges to something reasonable.
6. Produce a labeled, log-scale, publication-ready figure for each.

**Time:** import -> first plausible plot (per file); then -> production
-ready figure (log axes, legend, error bars visible).

---

## Journey 5 — SIMS depth profiles

**Fixture:** `tests/fixtures/baselines/sims_four_species_profile.csv`
(paired depth/concentration columns, species B/P/As/Sb, erf step
interfaces + exponential tails, several decades of dynamic range).

**Preconditions:** fresh session.

1. Import the fixture (should route to the SIMS parser via its "paired
   columns" layout, recovering species names B/P/As/Sb).
2. Plot all 4 species vs Depth on one log-Y axis.
3. Confirm species names are correct (not "Col1"/"Col2" placeholders).
4. Identify the interface depth for at least one species (where its
   concentration transitions).
5. Produce a labeled, log-scale, publication-ready figure.

**Time:** import -> first plausible plot; then -> production-ready figure.

---

## Journey 6 — large 2-D maps and slices

**Fixture (committed, small):**
`tests/fixtures/baselines/xrdml_rsm_small_map.xrdml` (12 Omega x 41
2-Theta mesh RSM, Gaussian peak blob + Poisson noise, 492 points).
**Fixture (large, P0.4-scale, `--large`-only, never committed):**
`large_rsm_map.xrdml` (1000x1000 mesh) — generate with
`uv run python tools/baselines/make_fixtures.py --large` when timing the
P0.4 performance envelope specifically; this journey's day-to-day checklist
uses the small committed map.

**Preconditions:** fresh session.

1. Import the small RSM fixture (should classify as a 2-D mesh map).
2. Render the 2-D intensity map (2Theta vs Omega, or Qx vs Qz if available).
3. Take a horizontal slice through the peak.
4. Take a vertical slice through the peak.
5. Adjust the color scale (limits, colormap) to see the peak clearly above
   background.
6. Produce a labeled, publication-ready figure with at least one slice
   overlay or side panel.

**Time:** import -> first plausible plot; then -> production-ready figure.
When timing P0.4 specifically, repeat steps 1-2 against the large map and
record import/render time separately (see `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md`
P0.4).

---

## Journey 7 — grouped box plot with multiple factors

**Fixture:** `tests/fixtures/baselines/grouped_factors_boxplot.csv`
(600 rows: `LotCode,WaferCode,TypeCode,Response`, 3 lots x 5 wafers x 2
types x 20 replicates; the lot/wafer/type NAME legend is recorded in the
`#`-preamble comments, not as text columns — see "Import friction" below).

**Preconditions:** fresh session.

1. Import the fixture.
2. Read the preamble/comments to find the lot/wafer/type code legend.
3. Build a box plot of Response grouped by LotCode.
4. Add a nested/secondary grouping by TypeCode (Center vs Edge).
5. Relabel the numeric codes with the real names from the legend (LotA/B/C,
   Center/Edge) if the UI allows renaming axis categories — record whether
   this was possible and how many steps it took.
6. Produce a labeled, production-ready grouped box plot.

**Time:** import -> first plausible plot; then -> production-ready figure.

### Import friction (evidence for Gate A / P1.4)

Before settling on the numeric-factor-code shape above, two text-column
CSV shapes were probed directly against `io/delimited.py` (`import_csv`):

| Shape tried | Result |
|---|---|
| `Lot,Wafer,Type,Response` (text columns first) | "Routes" with no error, but the default x-axis (`time`, column 0 = `Lot`, text) comes back **entirely NaN** — a silent, un-flagged empty axis. |
| `Response,Lot,Wafer,Type` (numeric column first, text after) | **Raises `ValueError: no valid data columns`** — every text column fails the >10% numeric-fraction test, so import fails outright. |
| `LotCode,WaferCode,TypeCode,Response` (small-integer codes, legend in the `#`-preamble) | Imports cleanly: `time` = LotCode, `values` = WaferCode/TypeCode/Response, no NaN, no crash. **This is the committed fixture's shape.** |

Neither of the first two is a valid import by this repo's own contract (a
silently-NaN x-axis, or an outright crash on a single-numeric-column-plus-
factors table — a completely ordinary shape for a DOE/QC dataset). This is
first-hand evidence for the P1.4 gap already tracked in
`PRIMARY_SOFTWARE_AUDIT_PLAN.md` ("first-class categorical and metadata
channels" — text columns are preserved as `metadata['text_columns']` but
are not first-class Group/Facet/X channels). Record this friction under
classification `missing feature` (P1.4) if it reproduces in the UI, or
`defect` if the all-NaN-axis case surfaces with no warning in the UI too.

---

## Journey 8 — save / close / reopen / relink / export / Office copy

Checklist-only journey; reuses any fixture above (Journey 2's QD series is
a good default — small, has metadata, has a meaningful default plot).

**Preconditions:** a saved project does not already exist for this fixture.

1. Import the fixture and build a simple labeled plot.
2. Save the project with a name.
3. Close the application (or the project) fully.
4. Reopen the saved project. Confirm the plot, labels, and data are intact.
5. Move or rename the source data file on disk, then relink it from the
   project. Confirm the relink flow finds/accepts the moved file.
6. Export the figure (vector — PDF or SVG — is the default per this repo's
   architecture contract).
7. Paste the exported figure into PowerPoint and Word. Confirm it appears
   at a normal scale, is not blurry, and (if vector) is editable.

**Time:** save -> close -> reopen (should be seconds); relink (time to
find + confirm the moved file); export -> paste-into-Office (should be
seconds per the P0.1 acceptance criteria).

---

## Results log

One row per run. `journey` is 1-8. `checkpoint` is `first-plot`,
`production-figure`, or (journey 8 only) `save`/`reopen`/`relink`/`export`/
`office-paste`. Add rows below the template row; do not delete history.

| date | commit | machine | journey | checkpoint | elapsed | gestures | notes |
|---|---|---|---|---|---|---|---|
| YYYY-MM-DD | `abcdef1` | e.g. "PC, Windows 11" | 1-8 | first-plot / production-figure / ... | Xm Ys | N | classification: defect/missing feature/discoverability/performance/visual taste/scientific trust — one line, link to a screenshot if useful |
