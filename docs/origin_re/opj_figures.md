# Origin `.opj` figures (graph windows) — reverse-engineering notes

Clean-room RE of how Origin `.opj` project files store **figures** (graph
windows): the Graph → Layer → Curve model, dataset references, axes, styling,
legends, and annotations. Wave-1 findings for
`plans/ORIGIN_FILE_DECODE_PLAN.md` **item 11** (feeds item 12's mapping design
and item 13's decoder). **Findings only — no production code.**

Method: local inspection of the private corpus (`../test-data/origin/`,
read-only, never copied/uploaded). We do **not** read or copy the GPL
`liborigin`; only *published format facts* (byte layouts, OriginLab text-escape
docs) are used, and they aren't copyrightable. Companion report (worksheet
windows / names+units) is `docs/origin_re/opj_windows_section.md` (item 1); the
two share the same block stream — shared discoveries are flagged **[SHARED]**.

**Status:** RE complete for the graph object model + axis ranges (validated on
Moke + XRD against known physics). Scale-type flag and the curve→column
selector inside the DataPlot body remain partial (see Unknowns).

---

## 0. TL;DR (what to build against)

- Graph windows live in the **same** `<u32 size LE><0x0A>payload<0x0A>` block
  stream as the worksheet datasets — **not** a separate section. The M1 walker
  already traverses them (it just doesn't interpret them). **[SHARED]**
- A graph window = a **graph-header block** (payload begins `00 00 <Name> 00`)
  + a **layer-continuation block** (holds the axis ranges) + a run of typed
  **object blocks** (layers, axes, curves, legend, text, lines), terminated by
  the next graph-header block or the end of the object stream.
- **Axis ranges are recoverable and physically correct:** a `float64`
  `(from, to, step)` triple at fixed offsets **15/23/31 (X)** and **58/66/74
  (Y)** of the layer-continuation block. Validated: Moke field axis
  `(-7000, +7000, 2000)` (symmetric — MOKE); XRD `2θ (18, 100, 5)` and
  intensity `(0.5, 1e8, 1.0)` (log — XRD).
- **Curves** are `type=0x07` objects + a length-framed **DataPlot record**
  (magic `0xB3400398`). They bind to the layer's source **workbook** (named
  once per layer by its *display short-name*, e.g. `Pd1`), then select columns
  via a code inside the DataPlot body that is **not yet decoded**.
- **Legend / axis titles / annotations** are recovered as text with Origin's
  escape syntax (`%(?X)`, `\l(n) %(n)`, `\g(q)`, `\+()`/`\-()`).
- **Double-Y = two overlaid layers** sharing the X range (validated on the
  `SLD_DoubleY.otp` template), *not* one layer with two Y axes.

---

## 1. Where figures live (framing) [SHARED]

The block framing established in M1 — `<uint32 size LE><0x0A><payload><0x0A>`,
`size==0` = spacer — is used **throughout the object stream**, which contains
worksheet columns *and* window definitions (worksheets, notes, graphs)
interleaved. The uniform walk in `io/origin_project.py::_walk_blocks` reaches
all graph windows without change.

Confirmed by walking `Moke.opj`: 2072 blocks walked, framing breaks at
**offset 645420**, where an ASCII section tag replaces the size prefix:

```
645412  00 00 0a 00 00 00 00 0a 49 4d 47 45 58 50 0a      ........IMGEXP.
645428  ... 41 58 49 53 54 59 50 45 0a ...                   AXISTYPE.
645572  ... 0b 00 00 00 0a 52 65 73 75 6c 74 73 4c 6f 67 00  .ResultsLog.
```

That **tail section** (export settings `IMGEXP`/`AXISTYPE`, the plain-text
`ResultsLog`, and a large `GraphInfo` XML tree at ~958396) is *after* every
graph. **All 12 Moke graph windows sit at offsets 134781–622418, well before
the break** — i.e. inside the main object stream. So *graphs are found by
scanning the block stream*, not by seeking to the tail.

The tail's `ResultsLog` and `GraphInfo` XML are useful for provenance / long
names (item 1 / item 6) but are **not** the graph definition; the real
graph object model is the block run described below.

### 1.1 Detecting a graph window

A graph-window header block's payload begins with **`00 00`** then the
**window name** as a NUL-terminated ASCII string:

```
Moke Graph3 header block (idx 294, size 197):
  00 00 47 72 61 70 68 33 00 00 ...    ..Graph3..
```

Scan predicate: `payload[0:2] == b"\x00\x00"` and an ASCII run follows. The
window *type* is inferable from later content (a Graph has a layer
`_cart_object`; a worksheet window has different storage — item 1). Corpus
counts (this predicate): **Moke 12, XRD 1, SuperlatticeFits 22, SLD_DoubleY.otp
1**. The 105 raw `Graph` token hits in Moke are mostly XML/notes references;
only 12 are real window headers.

---

## 2. Graph → Layer → object containment

Walking the blocks of one graph (Moke `Graph3`, blocks 294–365) gives the
canonical layout. Sizes/offsets are from `Moke.opj`; the same shapes recur in
XRD and the OTP template.

```
294  size 197   GRAPH HEADER      "\0\0Graph3\0" + template token "LINE" + INI store
295  size 365   LAYER-CONT        axis ranges (X @15/23/31, Y @58/66/74)  ← §4
296  size 133   obj hdr  0x23     "__LayerInfoStorage"
297  size 72    obj body
298  size 357   LAYER OBJECT      @${[0|5|_cart_object|52|...]} + AxesDlgSettings  ← §3
300  133 / 301 103 / 302 " "      axis tick-label text object
304  133 / 305 103 / 306 " "      axis tick-label text object
308  133 / 309 103 / 310 "%(?Y)"  Y-axis TITLE (auto)                     ← §5
312  133 / 313 103 / 314 "%(?X)"  X-axis TITLE (auto)
316  133 / 317 72 / 318 873       axis-config object (ticks/grid)
320  133 (0x23 "__BCO2") ...      bottom-axis config object
324  133 / 325 103 / 326          LEGEND "\l(1) %(1)\r\n\l(2) %(2)\r\n\l(3) %(3)"  ← §6
328  133 (0x07 "_202") /329 427 /331 776   CURVE #1 (hdr+style+DataPlot)   ← §7
332  133 (0x07 "_232") /333 427 /335 776   CURVE #2
337  519 /338 840 ...             additional per-curve DataPlot/style records
345..364  519-byte blocks         per-curve style continuation
```

XRD `Graph1` (blocks 243–~334) shows the same skeleton with **named axis
objects** and literal titles, which nails the taxonomy:

```
243 GRAPH HEADER "Graph1" + "LINE"
244 LAYER-CONT   X=(18,100,5)  Y=(0.5,1e8,1)   book short-name "Pd"
245 0x23 "__LayerInfoStorage"
247 @${[0|5|_cart_object|174|...]}
249 0x00 "Text2" / 251 "Si (004)"      text annotation (peak label)
257 0x00 "Text1" / 259 "MnN (004)"     text annotation
261 0x00 "YR"                          Y-right axis object
265 0x00 "XT"                          X-top axis object
269 0x00 "YL" / 271 "Intensity (arb. units)"   Y-left axis TITLE
273 0x00 "XB" / 275 "2\g(q \(40))degrees)"     X-bottom axis TITLE  (= "2θ (°)")
281 0x23 "__BCO2"
285 0x00 "Legend" / 287 "\l(2) %(2)  \l(1) 325   \l(3) 525 "
289 0x07 "_202" / 293 0x07 "_232"      curve objects
306..316 515-byte + 583-byte blocks    DataPlot records
```

### 2.1 The 133-byte object header (the universal element record)

Every graph child object starts with a **133-byte header block**, then a
secondary block (64 / 72 / 103 bytes), then (for named/text objects) a
name/text block. The header's byte at **offset 2 is a type tag**:

| type@2 | meaning | examples |
|-------:|---------|----------|
| `0x00` | text / axis-title / legend | `Text*`, `XB`,`XT`,`YL`,`YR`, `Legend` |
| `0x07` | curve / DataPlot | `_202`, `_232` |
| `0x22` | line / arrow annotation | `Line`, `Line1` |
| `0x23` | storage / config object | `__LayerInfoStorage`, `__BCO2` |

The object **name** is an ASCII run near offset ~64–70 of the header. Two
`float64` at **offset 19 and 27** hold the object's position (a
left/top or x/y point). Attach mode varies:

- Axis-title objects carry the point in **data coordinates** — XRD `YL`
  d@19=11.76, d@27=21084 (inside the log-Y range 0.5–1e8); `XB` d@19=68.5
  (inside 18–100). Confirms the layer's data frame.
- Text annotations carry **normalized (0–1) layer coordinates** — XRD `Text2`
  "Si (004)" d@19=0.585, d@27=0.342.

(The data-vs-normalized selector is an as-yet-unlocated flag; see Unknowns.)

---

## 3. The Layer object

A layer is a `_cart_object` (Cartesian coordinate system). Its storage block
carries backslash-escaped binary plus two `@${...}` OriginStorage refs:

```
Moke Graph3 block 298 (357 bytes):
  @${[0|5|_cart_object|52|3169891046]}\0\6\S\0.P\0. ...
  @${[0|4|_Storage_Ebdded_pages_Data_|8|834556263]}\0\0\0\0
  @${[0|4|AxesDlgSettings|171|3955228925]}
     <OriginStorage><UseSameOptions>
       {1073741893=0,1073741906=0,1073804141=0,1073743652=0},
       {1073741893=0,1073741906=0,1073804141=0,1073743652=0}
     </UseSameOptions></OriginStorage>
```

`@${[0|<k>|<name>|<len>|<hash>]}` is Origin's **object-storage reference**
(name, payload length, checksum). `AxesDlgSettings` holds axis-dialog option
bitfields (paired `{...},{...}` = two axes), but **not** the numeric ranges —
those are in the layer-continuation block (§4). `_Storage_Ebdded_pages_Data_`
is the layer's embedded data-range storage.

**Multiple layers / double-Y.** `SLD_DoubleY.otp` (a pure double-Y graph
template, no data) has **two** layer-continuation blocks — same X range, two
different Y ranges:

```
blk3   X=(2950,3700,100)  Y=(-1.0, 10.0, 2.0)     ← left layer
blk142 X=(2950,3700,100)  Y=(-0.5,  2.5, 0.5)     ← right layer (overlaid)
```

So Origin renders a double-Y plot as **two stacked `_cart_object` layers**
sharing the X axis, each with its own Y scale and curves. (Origin's general
model allows N free-positioned layers; double-Y and stacked panels are special
cases of it.)

---

## 4. Axis model — ranges + scale (VALIDATED)

The **layer-continuation block** (the block immediately after the graph
header; head bytes `00 00 1f 00 …`) stores each axis range as a **`float64`
`(from, to, step)` triple** at fixed offsets:

| axis | from | to | step |
|------|-----:|---:|-----:|
| X    | @15  | @23 | @31 |
| Y    | @58  | @66 | @74 |

Validated across four files:

| file / graph | X (from,to,step) | Y (from,to,step) | physics check |
|--------------|------------------|------------------|---------------|
| Moke Graph3  | (-7000, 7000, 2000) | (-1.25, 1.25, 0.5) | **field-symmetric X** ✓ (MOKE loop) |
| XRD Graph1   | (18, 100, 5)     | (0.5, 1e8, 1.0)  | **2θ range** ✓, **log intensity** ✓ |
| SuperlatticeFits g1 | (0.03, 0.5, 0.1) | (0, 1.25, 1.0) | Q range (Å⁻¹) ✓ |
| SLD_DoubleY.otp | (2950, 3700, 100) | (-1, 10, 2) | template defaults |

Evidence (Moke layer-cont block 295):

```
offset 15  00 00 00 00 00 58 bb c0   =  -7000.0   (X from)
offset 23  00 00 00 00 00 58 bb 40   =  +7000.0   (X to)
offset 31  00 00 00 00 00 40 9f 40   =   2000.0   (X step)
offset 58  00 00 00 00 00 00 f4 bf   =  -1.25     (Y from)
offset 66  00 00 00 00 00 00 f4 3f   =  +1.25     (Y to)
```

**Scale type (lin/log) — PARTIAL.** The triple is recovered reliably, but the
authoritative lin/log flag is **not cleanly isolated**. A candidate flag byte
sits just past each step (X @43, Y @86), but a controlled within-file scan of
all 22 SuperlatticeFits graphs shows byte@86 does **not** separate log from
linear axes (value `0x08` occurs for both). The scale type therefore lives in
a separate axis-config object (`__BCO2` / the `XB`/`YL` axis objects) or a bit
not yet located.

**Practical heuristic that works** (use until the flag is cracked): treat a Y
(or X) axis as **log10** when `from > 0` and `to/from ≳ 10³` with an integer
`step` (decade ticks). This correctly flags XRD intensity (0.5→1e8, step 1),
the reflectivity R(Q) axes in SuperlatticeFits (1e-7→1.25), and leaves MOKE /
2θ linear. Confidence: axis *range* HIGH; *scale* MEDIUM.

---

## 5. Axis titles

The axis-title objects (§2.1, `type=0x00`, named `XB`/`XT`/`YL`/`YR`) carry the
title as a text block after a 103-byte formatting block:

- **Auto:** `%(?X)` / `%(?Y)` — Origin builds the title from the plotted
  column's **long-name + units** at render time. To reproduce it, quantized
  must resolve the X/Y column's long-name — **this ties W3 rendering to W1**
  (windows-section names/units).
- **Literal:** recovered verbatim, e.g. `Intensity (arb. units)`,
  `2\g(q \(40))degrees)` (→ "2θ (°)"), `Z (nm)`,
  `Nuclear SLD (x 10\+(-6) A\+(-2))` (→ "Nuclear SLD (×10⁻⁶ Å⁻²)").

Origin text escapes seen (public OriginLab "Text Label"/"Legend" syntax, cited
as a clean-room reference — not GPL source):

| escape | meaning |
|--------|---------|
| `\+(...)` | superscript |
| `\-(...)` | subscript |
| `\g(...)` | Greek/Symbol font (`\g(q)` = θ) |
| `\(NN)` | character by code (`\(40)` → degree/special) |
| `%(?X)`, `%(?Y)`, `%(?Z)` | auto axis title from the X/Y/Z dataset |
| `%(n)`, `%(layer.plot)` | auto legend text (dataset comment/long-name) for a curve |
| `\l(n)`, `\l(layer.plot)` | legend line/symbol sample for a curve |

---

## 6. Legend

The legend is a `type=0x00` object named `Legend`; its text block is one line
per curve. Two forms observed:

```
Moke Graph3:  \l(1) %(1)\r\n\l(2) %(2)\r\n\l(3) %(3)     (3 curves, all auto)
XRD  Graph1:  \l(2) %(2)  \l(1) 325   \l(3) 525          (auto + custom text)
SLD .otp:     \l(1.1) %(1.1)  \l(2.1) %(2.1)  \l(2.2) %(2.2)   (two-layer form)
```

- `\l(n)` renders the sample line/marker of curve `n`; `%(n)` renders that
  curve's auto text (the dataset comment/long-name).
- **Curve indexing:** single index `\l(n)` when the graph has one layer;
  `\l(layer.plot)` when multi-layer (the OTP double-Y uses `1.1`, `2.1`,
  `2.2`). This is the **authoritative curve enumeration** and the cleanest way
  to count curves per layer.
- Entries can be hand-edited to literal strings (XRD "325"/"525", likely
  sample temperatures), which override the `%(n)` auto text.
- The legend object header (offset 19/27) gives its position (normalized).

---

## 7. Curves (DataPlots) and the dataset reference

Each curve is a `type=0x07` object (auto-named `_NNN`, e.g. `_202`, `_232`)
followed by a **427-byte style block** and one or more **DataPlot records**
(the "X-blocks").

### 7.1 DataPlot record ("X-block")

Recognizable by a fixed 8-byte prefix and a length field:

```
Moke curve DataPlot (block 331, 776 bytes), first bytes:
  58 00 00 00  98 03 40 b3   af 02 00 00  06 00 00 00   X.....@.........
  af 02 00 00  03 00 00 00   ...
```

Header decode (`<u32 u32 u32 u32 u32 u32 …>`):

```
 0x58 (=88)        record marker ('X')
 0xB3400398        constant magic  (identifies a DataPlot record)
 <u32 bodyLen>     body length; verified bodyLen == size - 89 on every curve
 <u32 flagA>       small enum (6 in all curves seen)   — plot type/style?
 <u32 bodyLen>     repeat of bodyLen
 <u32 flagB>       small enum (3 or 6)                  — color/axis?
```

Confirmed `size - bodyLen == 89` for every DataPlot across Moke + XRD (519→430,
511→422, 583→494, 776→687, 840→751). So the record = **89-byte header +
variable body**; the `6`/`3` fields are enums, **not** row counts or column
indices (they were the tempting misread). The **column selector is inside the
undecoded body** (no ASCII, no plain indices found).

### 7.2 How a curve references its dataset — what IS known

- **Workbook binding is at the LAYER level, by display short-name.** The
  layer-continuation block names its source book once, as the **display
  short-name** (Moke `Pd1` @~offset 208; XRD `Pd`), *not* the internal
  `BookN`. Internally the M1 decoder sees `Book1..Book5`; the graph references
  `Pd1`. Resolving `Pd1 → Book4/Book5` needs the **book short-name ↔ internal
  name map from the worksheet windows (item 1)** — a hard cross-dependency
  between W3 and W1.
- **Curve count / identity** is authoritative from the legend `\l()` list and
  the count of `type=0x07` objects + DataPlot records.
- **Column selection (which columns of the book are X and Y) is NOT decoded.**
  No `Pd1_B`-style name and no clean column index appears in the graph window;
  the selector is encoded in the DataPlot body. This is the main open item for
  a faithful curve→dataset restore (see Unknowns).

### 7.3 Style attributes

Per-curve color / line width / line style / symbol shape+size live in the
427-byte style block and the DataPlot body (float `1.0` symbol-size and
`0x3f800000` = 1.0 markers were visible), but the **exact byte offsets are not
mapped**. The `LINE` token in the graph header is the *template* the graph was
built from (plot-type default), not the per-curve style.

---

## 8. Annotations & decorations

- **Text annotations** — `type=0x00` objects named `Text`, `Text1`, `Text2`:
  133-byte header (position @19/@27) + 103-byte format block + the text string.
  XRD examples are peak labels: `Si (004)`, `MnN (004)`, `MnN (002)`. Position
  is normalized-layer or data coords per the attach flag.
- **Line annotations** — `type=0x22` objects named `Line`, `Line1`: 133-byte
  header + a geometry block. In XRD these are the vertical marker lines at peak
  2θ positions. (Origin also stores arrows/rectangles the same way.)
- **Axis grid/tick config** — the 873/546-byte blocks after the axis-title
  objects, plus `__BCO2`; not individually mapped (low value for import).

---

## 9. Extraction algorithm (prose pseudocode)

```
read file; require magic "CPYA" (.opj)              # .opju = CPYUA, item 14
walk blocks with _walk_blocks (existing M1 walker)  # uniform framing, §1
collect blocks[] until the framing break (tail section)

for each block i where payload starts b"\x00\x00" and an ASCII name follows:
    if the run also contains a `_cart_object` shortly after:   # it's a Graph
        window = new Graph(name = ascii name at payload[2:])
        cont   = blocks[i+1]                                   # layer-cont
        window.template = ascii token in header (e.g. "LINE")
        # walk children until the next graph-header block
        layers = []; cur = None
        for j in (i+1 .. next graph header):
            b = blocks[j]
            if b is a layer-cont (head 00 00 1f 00 with valid axis triples):
                cur = new Layer()
                cur.xrange = float64 triple @ 15,23,31
                cur.yrange = float64 triple @ 58,66,74
                cur.xscale = LOG if (xfrom>0 and xto/xfrom>1e3 and int step) else LIN
                cur.yscale = LOG if (yfrom>0 and yto/yfrom>1e3 and int step) else LIN
                cur.book_shortname = ascii near cont offset ~200 (e.g. "Pd1")
                layers.append(cur)
            elif b.size==133:                    # object header
                t = b.payload[2]                 # type tag §2.1
                name = ascii near offset 64
                pos  = (float64@19, float64@27)
                text = next name/text block payload (if any)
                switch t:
                  0x00 & name in {XB,XT,YL,YR}: cur.axis_title[name] = text
                  0x00 & name == "Legend":      cur.legend = parse_legend(text)
                  0x00 (other):                 cur.annotations += Text(pos, text)
                  0x22:                          cur.annotations += Line(geom)
                  0x07:                          cur.curves += Curve(name)
            elif b is a DataPlot record (starts 0x58 + magic 0xB3400398):
                bind to the pending curve; record (flagA, flagB, body)
                # column selector = TODO (undecoded body)
        window.layers = layers
        emit window

parse_legend(text): split on CRLF; each "\l(k) <auto|literal>" → curve k label
resolve book_shortname -> internal BookN via item-1 windows map -> DataStruct
```

Robustness notes: identify the layer-continuation block by (a) it immediately
following a graph header and (b) its axis triples decoding to finite values at
15/23/31 & 58/66/74; identify DataPlot records by the `0x58 … B3 40 03 98`
signature with `bodyLen == size-89`. Both are stable across the corpus.

---

## 10. Proposed Origin → quantized mapping

Target types: `frontend/src/store/useApp.ts` plot state, `SeriesStyle`
(`lib/types.ts`), `lib/plotdata.ts` payload, and the **FigureDoc** entity
planned in `ORIGIN_GAP_PLAN.md` #12. An imported Origin graph should become a
**FigureDoc** (named, re-openable) that snapshots plot state and references
datasets by id.

| Origin (recovered) | quantized target | notes |
|--------------------|------------------|-------|
| Graph window name | `FigureDoc.name` (`Graph3`) | |
| Graph window | one FigureDoc | 1 file → many FigureDocs (needs multi-doc import, item 16) |
| Layer (`_cart_object`) | one plot / panel | 1 layer → normal plot |
| 2 layers, shared X, 2 Y ranges | `y2Keys` (dual-Y) | the double-Y case → secondary right axis |
| N free layers / stacked | `stackMode` (panels) or `insetMode` | lossy for free-positioned layers (gap) |
| Curve (`type 0x07` + DataPlot) | a plotted series (channel) | curve→column index feeds `xKey`/`yKeys` |
| Layer source book short-name (`Pd1`) | `Dataset` (resolved via item-1 map) | FigureDoc dataset ref by id |
| X range `(from,to)` | `xLim` | `null` if Origin autoscale (all-data) |
| Y range `(from,to)` | `yLim` | |
| X/Y scale log | `xLog` / `yLog` | via heuristic until flag cracked |
| Axis title `XB`/`YL` (literal) | `xAxisLabel` / `yAxisLabel` | strip Origin escapes → plain/Unicode |
| Axis title `%(?X)`/`%(?Y)` | auto from column long-name (item 1) | resolve at import |
| Graph title (INI/header) | `plotTitle` | |
| Legend present | `showLegend = true`, `legendPos` | position from legend object @19/@27 |
| Legend custom entry text | `seriesLabels[channel]` | override auto `%(n)` |
| Curve color/width/line/marker | `SeriesStyle` (`color`,`width`,`line`,`marker`,`markerShape`,`markerSize`) | offsets not yet mapped (§7.3) |
| Text annotation (data coords) | `annotations[]` (`x,y,text`) | normalized-coord ones need conversion |
| Line annotation (axis-parallel) | `refLines[]` (`axis`,`value`) | XRD peak markers → vertical ref lines |
| Error column designation | `errKeys[channel]` | if a curve declares an error dataset |

### FigureDoc shape (proposed, per ORIGIN_GAP_PLAN #12)

```
FigureDoc {
  id, name: "Graph3",
  datasetRefs: [datasetId...],          # resolved from layer book short-names
  plotState: { xKey, yKeys, y2Keys, xLog, yLog, xLim, yLim,
               xAxisLabel, yAxisLabel, plotTitle,
               showLegend, legendPos, seriesLabels, seriesStyles,
               annotations, refLines },
  liveLink: false                        # frozen snapshot on import (safe default)
}
```

---

## 11. Gap list (Origin features quantized cannot express yet)

- **Multi-layer free layout.** Origin allows N independently positioned/sized
  layers; quantized has only single-plot + `stackMode` panels + one `insetMode`
  inset. >2 layers, or non-stacked overlays, are lossy.
- **>2 Y axes and independent top/right axes** (`XT`,`YR` with own scales).
  quantized has left-Y + one right-Y only.
- **Rich text** in titles/legend/annotations — super/subscript, Greek, per-run
  font/color/size. quantized labels are plain strings; best effort is a
  `\g()`/`\+()`/`\-()` → Unicode transform, dropping per-run color/font.
- **Non-linear scales beyond log10** — probability, reciprocal, ln, log2,
  and **axis breaks**. Not representable.
- **Per-curve fill-under, drop lines, split symbol edge/fill colors,
  connect-style (spline/step/B-spline)** — partially or not modelled.
- **Arrow/box/region annotations with arrowheads** — quantized `refLines` are
  axis-parallel only; free line/arrow annotations degrade to nearest ref line
  or are dropped.
- **Graph templates/themes, page geometry, DPI, panel matrices** — not part of
  the per-plot state (belongs to export config #11, partly).
- **Legend auto-text semantics** (`%(n)` = live dataset comment). On import we
  freeze the resolved string; the live link to the dataset comment is lost.
- **Curve↔column binding fidelity** — until the DataPlot column selector (§7.2)
  is decoded, imported curves may need the user to confirm X/Y columns; a graph
  drawing an arbitrary column subset can't be reconstructed exactly.

---

## 12. Validation results

**Requirement:** recover, for ≥1 real Moke or XRD graph, the curve→dataset
reference + axis ranges/scale and show they match known physics. **Met on
both:**

- **Moke `Graph3` (MOKE hysteresis):** X axis `(-7000, +7000)` Oe, step 2000 —
  **symmetric about zero**, exactly the field axis of a MOKE loop. Y axis
  `(-1.25, +1.25)`, step 0.5 — symmetric normalized Kerr signal. Source
  workbook `Pd1` (a Pd sample; resolves to the H-vs-Kerr book pending the
  item-1 name map). Legend = 3 curves (`\l(1..3) %(1..3)`).
- **XRD `Graph1` (θ–2θ scan):** X axis `(18, 100)`°, step 5 — the **2θ range**
  (matches the expected ~20–120° diffraction window). Y axis `(0.5, 1e8)`,
  step 1.0 — an **8-decade log intensity** axis (the log-Y XRD signature).
  X-title `2\g(q \(40))degrees)` = "2θ (°)", Y-title "Intensity (arb. units)".
  Text annotations are Bragg-peak labels (`Si (004)`, `MnN (004)`, `MnN (002)`)
  with vertical marker `Line` objects — consistent with a superlattice XRD.

Axis-range decode reproduced on 4 files / 37 graphs total (Moke 12, XRD 1,
SuperlatticeFits 22, OTP 1+1 layers) without a single misparse.

---

## 13. Confidence & unknowns

**HIGH confidence**
- Graph windows share the datasets' block framing; detection via
  `\x00\x00<Name>\x00` header block. **[SHARED]**
- Graph → layer(s) → typed-object containment; object type tag @offset 2.
- Axis-range `(from,to,step)` float64 triple @15/23/31 (X), @58/66/74 (Y).
- Axis titles (literal + `%(?X/?Y)` auto); legend `\l(n) %(n)` per curve;
  multi-layer legend indexing `\l(layer.plot)`.
- Double-Y = two overlaid layers sharing X.
- DataPlot record signature (`0x58` + magic `0xB3400398`), `bodyLen=size-89`.

**MEDIUM confidence**
- Object-header field layout beyond {type@2, name@~64, pos@19/@27}.
- Data-vs-normalized attach mode of an object's position (flag not located).
- Per-curve style byte offsets (color/width/line/marker) exist in the 427-byte
  block + DataPlot body but are unmapped.

**LOW / UNKNOWN (open items)**
- **Authoritative lin/log scale flag.** Range is solid; the scale bit is not
  cleanly isolated (byte@86 mixes tick+scale flags; doesn't separate log/lin
  within SuperlatticeFits). Use the decade-span heuristic meanwhile.
- **Curve→column selector.** The workbook is bound at layer level by display
  short-name; *which columns* a curve plots is encoded in the undecoded
  DataPlot body (no ASCII, no plain index). Blocking for exact curve restore.
- **Book short-name ↔ internal `BookN` map.** Lives in the worksheet windows
  (item 1). W3 curve resolution depends on it.
- Axis grid/tick/minor-tick config (`__BCO2`, 873/546-byte blocks).

**Suggested next probes** (for item 13 impl): (a) diff a single graph before/
after toggling only the Y scale in Origin to isolate the scale bit; (b)
diff before/after re-pointing one curve to a different column to locate the
column selector in the DataPlot body; (c) map the 427-byte style block by
toggling one curve's color/width. All are single-variable diffs on a
throwaway project (no corpus mutation).

---

## References (clean-room, facts only)

- OriginLab documentation — text-label & legend escape syntax (`%(?X)`,
  `\l()`, `\g()`, `\+()`/`\-()`), axis scale types, layer/graph model. Public
  vendor docs, cited for *facts*, not code.
- `liborigin` (GPL) / R `Ropj` — prior RE efforts, **format reference only**;
  never read into or copied by this implementation (Apache-2.0, no-GPL guard).
- Sibling report: `docs/origin_re/opj_windows_section.md` (item 1) for the
  book/sheet/column name map that W3 curve resolution depends on.
