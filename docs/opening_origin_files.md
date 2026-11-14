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
- **Where it lands in the Library.** The project arrives as one folder
  holding its books and graphs, placed below the items already in the
  Library, so nothing you were about to click moves. (At the Library's top
  level, items that hold data are listed in the order they arrived; inside
  a folder, folders come first.) The Origin fidelity summary and the book
  families follow the tree's rows.
- **Notes and the results log.** Free-form notes pages and Origin's
  analysis log (the record of every fit/subtract/smooth operation you ran,
  with parameters) are attached as import metadata, visible in the
  Inspector's Metadata card.
- **Every column type, in projects as old as Origin 7** (`.opj`).
  Numeric columns stored as double, float, short, long, byte or complex,
  Text columns, and the default Text & Numeric columns are each read as
  Origin stored them. Only the rows you actually used come in — not the
  blank rows Origin pre-allocates. Text cells are kept beside the numbers
  (the worksheet's text columns), and a complex column's imaginary part is
  kept in the dataset's metadata.
- **Matrix books** (`.opj`) open in the Map view, with Origin's X/Y
  coordinate mapping.
- **Extra sheets** in a multi-sheet workbook come in as separate
  `"Book@N (sheet N)"` pseudo-datasets so their data isn't lost, even
  though quantized doesn't (yet) show a nested Book→Sheet tree.

## Known limitations

Import is thorough but not lossless. In particular:

- **Anything quantized cannot read is named, never guessed.** A dataset in
  an unrecognised format (and Origin's function plots, which have no
  worksheet data) is left out, and the Library's Origin fidelity summary
  says so — e.g. "1 matrix book(s) not imported".
- **Date and Time columns come in as Origin's day numbers**, not as
  formatted dates. The dataset records which columns they are and how to
  convert them, but the worksheet does not format them yet.
- **Text in a non-Western code page** (e.g. a project saved on a Chinese
  Windows) may show garbled characters in text cells and labels.
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
  compares the file's length with the size its own header records and,
  when the file is shorter, says so in the import toast and the Origin
  fidelity panel ("file appears incomplete or truncated"). The check runs
  only for the `.opj` header versions it was measured on (CPYA 4.3295,
  4.3380, 4.3386, 4.3445, 4.3478, 4.3522, 4.3551 and 4.3778 — 52 real
  files, every one matching its recorded size exactly). Any other
  version, and every `.opju`, is not checked: a truncated file of those
  kinds still imports without a warning.
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

## Where an opened project is kept (the upload cache)

A multi-book project opened from the file picker or by drag-and-drop loads
its non-primary books on demand, so quantized keeps **a copy of the
project file on disk** until those books are needed — including after you
quit and restart the app. You should know it is there:

- **Location.** `origin-uploads` inside quantized's per-user cache
  directory: `~/.cache/quantized/origin-uploads` on Linux,
  `~/Library/Caches/quantized/origin-uploads` on macOS,
  `%LOCALAPPDATA%\quantized\Cache\origin-uploads` on Windows. Set the
  `QZ_UPLOAD_CACHE_DIR` environment variable to keep it elsewhere; the
  copies then live in an `origin-uploads` subfolder of that directory, and
  nothing else in the directory is touched.
- **What is stored.** The uploaded `.opj`/`.opju` files themselves, byte
  for byte (one folder per file, named by the file's SHA-256), plus a small
  index. The folder and files are readable only by your user account
  (`0700`/`0600` on Linux and macOS).
- **How long.** Until the cache passes **2 GiB**, when the least recently
  used copies are removed first — there is no time limit. If a project's
  copy has been removed, its unloaded books show one notice offering
  Re-import.
- **Clearing it.** *Preferences ▸ Interaction ▸ Origin upload cache ▸
  Clear…* deletes every copy after a confirmation that names the folder,
  the number of files and their size; so does
  `qz upload-cache clear` from a terminal (`qz upload-cache` shows the
  location and size). Deleting the `origin-uploads` folder by hand while
  the app is closed is also safe.

Projects opened by path in the desktop app are read in place and are not
copied.

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
  directly. Books of one X column plus Y columns **open in real
  OriginPro** (verified live on Origin 2026b, 2026-07-07: single- and
  multi-book files load and re-export value-exact data, names, and units
  — plan item 34). The file also carries column designations (Y-error,
  X-error, label, disregard, Z, further X columns), column comments, and
  text outside Latin-1 (as Origin's `\(xHHHH)` escapes, which is also how
  an accented book title is written). Those parts are **not yet verified
  in Origin**: they round-trip through quantized's own reader, and the
  column-association bytes agree with real Origin-written files, but no
  such file has been opened in Origin since they were added — if Origin
  shows a column role or a title differently, use the `.ogs` path.
  Because Origin
  ≥2023 still *reads* the classic `.opj` format even though it no longer
  writes it, one file reaches every Origin version. The Origin-ASCII +
  `.ogs` path remains the belt-and-braces alternative (it re-runs the
  import inside Origin itself).

A live "Send to Origin" (pushing data directly into a running Origin
session via COM) also exists as a Windows-only optional feature for users
who have Origin installed locally; it is not part of the cross-platform
export path above.
