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

- **Report-sheet columns come in as text references, not computed
  numbers.** Origin's auto-generated FitLinear/NLFit "Notes"/"Summary"/
  ANOVA columns store variable-length reference strings (e.g.
  `"cell://Parameters.Slope.Value"`). quantized decodes those strings in
  both `.opj` and `.opju` and shows them in the Inspector's Origin card
  ("Report-sheet columns"; `origin_report_sheets` metadata), but they are
  kept OUT of the numeric worksheet/plot data, and the fit's own computed
  value behind each reference is not recovered. Everything else in the
  same workbook imports normally.
- **A truncated or incomplete `.opj` is flagged, not silently trusted.**
  An interrupted copy or download still parses up to the cut; quantized
  compares the file's length with the size its own header records
  (`.opj` files with a CPYA 4.3380 or newer header) and, when the file is
  shorter, says so in the import toast and the Origin fidelity panel
  ("file appears incomplete or truncated"). Older `.opj` versions and
  `.opju` carry no recorded size and are not checked.
- **Origin window and template files are not projects.** `.ogw`/`.ogwu`
  (workbook), `.ogg` (graph), `.ogm` (matrix) windows and `.otw`/`.otm`
  templates can't be opened directly — save the project as `.opj` in
  Origin, or export the worksheet to CSV from the free Origin Viewer.
  Graph templates (`.otp`/`.otpu`) are applied with File ▸ Import Origin
  template.
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

Apart from a truncated file (which is flagged), none of the above affects
the *primary* worksheet data most researchers care about — every one of
these is either a genuinely auto-generated Origin artifact (report-sheet
columns), a file type that is not a project, or a scoped, documented UI
simplification.

**Lazy books after a restart.** A multi-book project opened from the
browser's file picker loads its non-primary books on demand. The uploaded
file is kept in quantized's own cache directory (content-addressed, up to
2 GB, least-recently-used first), so those books still load after an app
restart; if the cache has since evicted it, one notice offers Re-import.

## Exporting back to Origin

quantized can hand data back to Origin colleagues two ways:

- **Recommended: Origin-ASCII + a LabTalk `.ogs` script.** Exports a CSV
  plus a small script that, when run inside Origin, imports the CSV and
  rebuilds column designations (X, Y, yErr, xErr, Label, Disregard, Z,
  and further X columns), long names, units, comments, and (optionally) a
  graph of every Y column against its nearest-preceding X with its error
  bars. This works with **every version of Origin** and is the
  well-tested, cross-platform path — use it by default.
- **Native `.opj` project file.** quantized can also write a `.opj` file
  directly. This **opens in real OriginPro** (verified live on Origin
  2026b, 2026-07-07: single- and multi-book files load and re-export
  value-exact data, names, and units — plan item 34). Column
  designations, comments, and non-Latin-1 text (as Origin's `\(xHHHH)`
  escapes) are written too and round-trip through quantized's reader;
  the live-Origin probe series covered X/Y books. Because Origin
  ≥2023 still *reads* the classic `.opj` format even though it no longer
  writes it, one file reaches every Origin version. The Origin-ASCII +
  `.ogs` path remains the belt-and-braces alternative (it re-runs the
  import inside Origin itself).

A live "Send to Origin" (pushing data directly into a running Origin
session via COM) also exists as a Windows-only optional feature for users
who have Origin installed locally; it is not part of the cross-platform
export path above.
