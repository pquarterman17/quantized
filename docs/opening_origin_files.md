# Opening Origin files in quantized

quantized reads OriginPro project files (`.opj` and the newer `.opju`)
directly — no OriginPro license, no external converter, no GPL library.
This page describes what you get when you import one and what still
requires OriginPro itself. For the full byte-level format reference, see
[`docs/origin_project_format.md`](origin_project_format.md).

## Importing a `.opj` / `.opju` file

Drag the file onto quantized (or use the file picker) exactly like any
other supported format. Both extensions are recognized automatically —
you don't need to convert anything first.

**What you get:**

- **Every workbook**, not just the largest one. Origin projects routinely
  hold many books (measurement sheets, fit-result sheets, curve tables);
  quantized recovers all of them and offers an "import all books" flow
  rather than picking one for you.
- **Real column names, units, and comments** — the actual long names you
  gave your columns in Origin (e.g. "Kerr Signal", "(mdeg)"), not just the
  bare `A`/`B`/`C` designations. X/Y/Y-error roles are recovered too, so
  the correct column becomes your X axis automatically.
- **Book display titles** — the friendly name you gave the workbook (or
  the original imported filename), not just the internal `Book1`/`Book2`
  short names.
- **Figures.** Every graph window in the project is recovered as a
  restorable plot snapshot — axis ranges, linear/log scale, titles, and
  legend/annotation text — and listed in the Library's "Figures" section.
  Click one to apply it to its resolved dataset.
- **Notes and the results log.** Free-form notes pages and Origin's
  analysis log (the record of every fit/subtract/smooth operation you ran,
  with parameters) are attached as import metadata, visible in the
  Inspector's Metadata card.
- **Extra sheets** in a multi-sheet workbook come in as separate
  `"Book@N (sheet N)"` pseudo-datasets so their data isn't lost, even
  though quantized doesn't (yet) show a nested Book→Sheet tree.

## Known limitations

Import is thorough but not lossless. In particular:

- **Report-sheet reference columns are dropped, not guessed.** Origin's
  auto-generated FitLinear/NLFit "Notes"/"Summary"/ANOVA columns contain
  variable-length text (e.g. `"cell://Parameters.Slope.Value"`) that spans
  multiple internal records with no reliable row boundary. Rather than
  emit misaligned or garbled values, quantized drops these columns
  entirely — the source project is unaffected, and everything else in the
  same workbook still imports normally.
- **Log-scale axis detection is a heuristic when the exact flag isn't
  recoverable.** Where the on-disk lin/log bit is confirmed, quantized
  reports it exactly; otherwise it infers log scale from the axis range
  itself (a positive axis spanning about 3+ decades reads as log10). This
  is correct for the great majority of real plots (log intensity axes,
  reflectivity curves) but can occasionally mis-classify an unusual
  linear axis that happens to span a wide range.
- **A restored figure binds each curve to the exact columns it plotted.**
  quantized decodes Origin's per-curve column bindings in both containers
  (`.opj` and `.opju`), so a multi-curve graph restores each series against
  its precise book + X/Y columns — including cross-book overlays and the
  decoded line/scatter style and axis titles. A few structurally
  unreachable cases still fall back to a whole-book resolution: duplicate-
  window graphs that carry no binding token, and auto-generated
  FitLinear/NLFit report graphs that live outside the normal window stream.
- **Sheets show as flat pseudo-books, not a nested tree.** A workbook's
  second/third/etc. sheet appears as its own `"Book@2"`-style dataset
  rather than nested under the parent book, and only the first sheet
  carries real column names/units — extra sheets fall back to plain
  `A`/`B`/`C` designations.

None of the above affects the *primary* worksheet data most researchers
care about — every one of these is either a genuinely auto-generated
Origin artifact (report-sheet columns) or a scoped, documented UI
simplification.

## Exporting back to Origin

quantized can hand data back to Origin colleagues two ways:

- **Recommended: Origin-ASCII + a LabTalk `.ogs` script.** Exports a CSV
  plus a small script that, when run inside Origin, imports the CSV and
  rebuilds column designations, long names, units, and (optionally) a
  graph. This works with **every version of Origin** and is the
  well-tested, cross-platform path — use it by default.
- **Native `.opj` project file.** quantized can also write a `.opj` file
  directly. This **opens in real OriginPro** (verified live on Origin
  2026b, 2026-07-07: single- and multi-book files load and re-export
  value-exact data, names, and units — plan item 34). Because Origin
  ≥2023 still *reads* the classic `.opj` format even though it no longer
  writes it, one file reaches every Origin version. The Origin-ASCII +
  `.ogs` path remains the belt-and-braces alternative (it re-runs the
  import inside Origin itself).

A live "Send to Origin" (pushing data directly into a running Origin
session via COM) also exists as a Windows-only optional feature for users
who have Origin installed locally; it is not part of the cross-platform
export path above.
