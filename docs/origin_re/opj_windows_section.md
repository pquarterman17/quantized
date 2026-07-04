# `.opj` windows section — column long-names, units, plot designations, book/sheet names

Clean-room reverse-engineering report (wave-1, item 1 of
`plans/ORIGIN_FILE_DECODE_PLAN.md`). **Findings only — no production code.**
Derived by inspecting the private corpus (`../test-data/origin/`, read-only,
never copied/uploaded) with the M1 block walker
(`src/quantized/io/origin_project.py::_walk_blocks`). Published Origin
format *facts* (plot-designation enum) are cited; no GPL source was read.

**Primary sample:** `Moke.opj` (`CPYA 4.3380 188 W64 #`, 1 071 289 bytes).
**Secondary:** `XRD.opj` (`CPYA 4.3227 380`), `XMCD.opj` (`CPYA 4.3227 380`).

---

## 0. TL;DR — the correction to the prior recon

The prior note (`docs/origin_project_format.md` "Column long-names / units")
said the names/units live "in the windows section … the part **after** the
datasets section, which the M1 walker stops before." **That is imprecise.**
The worksheet **window definitions that carry Long Name / Unit / Comment /
plot-designation are INSIDE the M1-walkable, size-prefixed region** — they sit
after the raw column data but *before* the point (`0x9d92c` in Moke) where
`_walk_blocks` framing breaks. What lies *after* that break is the trailing
**global-storage / analysis-log / project-tree** area (tokens `IMGEXP`,
`AXISTYPE`, `ResultsLog`, and the `[Book5]Sheet1!(E"H",N"Kerr Signal")`
analysis-log text). The analysis log is the *unreliable* source; the reliable
structured source (this report) is the window column-property records, which
the M1 walker already reaches but ignores.

---

## 1. Whole-file section layout (`.opj`, `CPYA`)

Everything up to the framing break uses the same CPY primitive the M1 walker
already knows:

```
block = <uint32 size LE> <0x0A> <payload (size bytes)> <0x0A>
        (size==0 → a 5-byte spacer "00 00 00 00 0A", no payload, no trailer)
```

For `Moke.opj` (offsets are file-absolute; block indices are as emitted by
`_walk_blocks`):

| Region | Blocks | Byte range | Content |
|--------|--------|-----------|---------|
| Header line | — | `0x00`–`0x15` | `CPYA 4.3380 188 W64 #\n` |
| File-header block | idx 0 | `0x16` | fixed 123-byte project header |
| **DATASETS subsection** | idx 2 – 291 | `0x9c` – `0x20e73` | per-column *data* (see §2) |
| **WINDOWS subsection** | idx 294 – 2071 | `0x20e7d` – `0x9d92c` | worksheet + graph window defs (see §3–5) |
| Framing break | — | **`0x9d92c`** (60.2 %) | trailing global storage begins |
| Trailing global storage | (not size-framed) | `0x9d92c` – EOF | `IMGEXP`/`AXISTYPE`/`ResultsLog`, analysis-log text, project tree |

**Hex evidence — the framing break at `0x9d92c`:** a run of size-0 spacers
ends and a *named* (not size-prefixed) storage entry begins:

```
0009d91c  0a 00 00 00 00 0a 00 00 00 00 0a 00 00 00 00 0a   ................
0009d92c  49 4d 47 45 58 50 0a 00 00 00 00 00 00 00 00 0a   IMGEXP..........
0009d93c  41 58 49 53 54 59 50 45 0a ...                    AXISTYPE.
```

`_walk_blocks` reads `49 4d 47 45` ("IMGE") as a 4-byte size and finds the
next byte is `X` (`0x58`), not `0x0A` → it returns. **That is the
datasets+windows / trailing-storage boundary, not the datasets/windows
boundary.**

### 1.1 Datasets subsection (recap, for the join)

Repeating triple, one per column:

```
[147-byte column-storage header]  →  internal name "<Book>_<Col>\0" + binary
                                       column formatting (value type / count /
                                       mask). NO long-name / unit / comment here.
[size-0 spacer]
[data block]                       →  size/10 records of <u16 mask><f64> (M1).
```

97 named columns in `Moke.opj` (`Book1_A` … `Book5_O`, `Table1_A`, `Table1_B1`).
Extra sheets append a suffixed variant: `Book4_A@3`, `Book4_B@3`, … (see §6).
These `@N` names fail M1's `_NAME_RE` and are silently skipped today.

---

## 2. Windows subsection top-level structure

The windows subsection is a flat list of **window definitions**, each opened by
a **window-header block** whose payload begins `00 00 <Name> 00`. A window runs
until the next window-header block. `Moke.opj` window headers:

| idx | off | size | name | kind |
|----:|-----|-----:|------|------|
| 294 | 0x20e7d | 197 | `Graph3` | graph |
| 367 | 0x25f55 | 206 | `Graph1` | graph |
| 440 | 0x2af63 | 348 | `Book3` | **worksheet** |
| 475 | 0x2d0be | 195 | `Graph6` | graph |
| 550 | 0x31d81 | 195 | `Graph5` | graph |
| 621 | 0x3693b | 352 | `Book1` | **worksheet** |
| 682 | 0x39c5d | 359 | `Book4` | **worksheet** (3 sheets) |
| 863 | 0x503f7 | 348 | `Book2` | **worksheet** |
| 924 | 0x5370c | 355 | `Book5` | **worksheet** |
| 991 | 0x57140 | 202 | `Table1` | **worksheet** |
| 1024… | | 195–216 | `Graph2`,`Graph8`,`Graph9`,`Graph4`,`Graph7`,`Graph10`,`Graph11`,`Graph12` | graph |

**Discriminating worksheet vs graph:** a worksheet window contains one or more
**column-property blocks** (§4); a graph window does not. That structural test is
version-robust. (The window-header also embeds a template name — worksheets
`ORIGIN`/`Fit…`, graphs `LINE…` — but the column-block presence test is
simpler and reliable.)

---

## 3. Window-header block (book short + long name)

`Moke.opj` Book5, idx 924 (`0x5370c`, size 355), first bytes and tail:

```
0000  00 00 42 6f 6f 6b 35 00 00 00 00 00 00 00 00 00   ..Book5.........   ← short name @0x02
0010  00 00 ... 12 00 1a 00 43 08 fb 04 80 07 38 04 ...                     fixed geometry/format
0043  ... 02 11 11 4f 52 49 47 49 4e 00 ...             .....ORIGIN.       ← template name
00c3  42 6f 6f 6b 32 20 2d 20 43 6f 70 79 40 24 7b 5b   Book2 - Copy@${[   ← LONG name, then @${…}
00cf  ... <OriginStorage><Script></Script><History>...</OriginStorage>
```

- **Book short name** — NUL-terminated string at **offset 0x02** of the
  window-header payload (`Book5`). This is the name used for dataset naming
  (`Book5_A`).
- **Book long name (display title)** — a readable NUL-terminated run in the
  header tail, immediately followed by the embedded-storage marker
  `@${[0|…]}<OriginStorage>…`. Extract the string ending at `@${` (or at NUL if
  no storage). Examples: Moke Book5 → `"Book2 - Copy"`; XRD Book1 →
  `"MD180412b_II_Theta2Theta.txt"`; XMCD → `"T106670001e"` (= short name when
  never renamed). Its exact offset is *not* fixed (depends on the variable
  fields before it); the `@${` anchor is the reliable delimiter.

---

## 4. Per-column metadata record (the core result)

Inside a worksheet window, after a per-sheet layer header (§5) and some
sheet-level format/storage blocks, comes the **column-property list**: for each
column, two consecutive blocks —

```
[column-property block]   fixed size per file version: 519 B (v4.3380) / 515 B (v4.3227)
[label-text block]        variable; LongName\r\nUnit\r\nComment[\r\n extra…]\0
```

They **strictly alternate** (`[prop][label][prop][label]…`); when a column has
no labels at all, its label block may be absent — the next block is then the
following property block (detect structurally, do not assume fixed stride).

### 4.1 Column-property block layout (offsets into the payload)

`Moke.opj` Book5 column **A** (idx 955, `0x54f64`, size 519):

```
0000  10 00 00 00 29 00 0b 00 00 00 00 a1 00 00 00 00
0010  00 03 41 00 00 00 00 00 00 00 00 00 00 00 09 00
      ^^ ^^  ^^ = designation(0x11)=0x03(X)  short-name(0x12)='A'
0020  00 00 00 00 00 21 51 00 ...
            ^^ (0x23)=X-ptr  ^^ ^^ (0x25)=0x21 '!'  (0x26)=0x51 'Q'
```

Book5 column **B** (idx 957, size 519):

```
0000  10 00 00 00 2a 00 0b 00 00 00 00 a1 00 00 00 00
0010  00 00 42 00 ...                 desig(0x11)=0x00(Y)  short(0x12)='B'
0020  00 00 00 29 00 21 61 00 ...     (0x23)=0x29 → X-ptr to col A's id  (0x26)=0x61 'a'
```

| Offset | Field | Notes |
|-------:|-------|-------|
| 0x00 | uint32 | column display width / size (variable — e.g. `0x10`, or `0x110` for a wider col). **Not a fixed marker.** |
| 0x04 | byte | column **object id** (0x29 for A, 0x2a for B, …; sequential per book). Referenced by 0x23 of dependent columns. |
| 0x06 | `0b 00` | **invariant** (block-type tag). Good detector anchor. |
| 0x0b | byte | flags (`0xa1` v4.3380 / `0x81` v4.3227). |
| **0x11** | **byte = PLOT DESIGNATION** | 0=Y, 1=disregard, 2=Y-Err, 3=X (see §4.3). **Authoritative.** |
| **0x12** | **short name** | ASCII, **NUL-terminated, variable length** (1–4+ chars, e.g. `A`, `EY`, `c9`, `i0es`). Maps to the dataset (§6). |
| 0x23 | byte | **X-column pointer**: for Y/Y-Err columns, the object-id (0x04) of the X column they plot against; `0x00` for X columns. |
| 0x25 | `0x21` `!` | marker (invariant for normal columns; a Y-Err column shows `0x30` here instead — cross-check only). |
| 0x26 | byte | display code that co-varies with designation (X→`0x51 'Q'`, Y→`0x61 'a'`, disregard→`0x41 'A'`). Redundant with 0x11; don't rely on it. |

**Robust column-block detector** (version-independent):
`len ≥ 500  AND  payload[0x06] == 0x0B  AND  payload[0x25] == 0x21  AND
payload[0x12] is printable ASCII`. (Keying on `payload[0:4]==10 00 00 00`
**fails** — that's the width field; XRD col B is `10 01 00 00`.)

### 4.2 Label-text block layout

Immediately after the property block. Content = the column's **label rows**,
`\r\n`-separated (`0x0D 0x0A`), NUL-terminated:

```
LongName \r\n Unit \r\n Comment [\r\n <extra label rows…>] \0 [@${…embedded…}]
```

Evidence (Book5):

```
idx 956  "H\r\nOe\0"                                 → Long='H'  Unit='Oe'
idx 958  "Kerr Signal\r\n(mdeg)\r\nAs deposited\0"   → Long='Kerr Signal' Unit='(mdeg)' Comment='As deposited'
idx 960  "Kerr inverted\r\n\r\nAs deposited\0"       → Long='Kerr inverted' Unit='' Comment='As deposited'
```

Notes:
- Split on `\r\n`; index 0 = **Long Name**, 1 = **Unit**, 2 = **Comment**,
  3+ = extra label rows (user parameters, "Sparklines", etc.).
- Empty rows are preserved (`\r\n\r\n` → empty Unit).
- An `@${[0|…]}…<OriginStorage>…` suffix (embedded sparkline/object + extra
  `key="val"` label params) may follow the NUL — **cut at `@${`** before parsing
  the label rows.
- Non-ASCII bytes are Windows ANSI (latin-1): e.g. `325 \xb0C` = `325 °C`.

### 4.3 Plot-designation enum (offset 0x11)

Observed values in the corpus and the matching **published Origin worksheet
plot-designation enum** (format fact, not GPL code):

| 0x11 | Designation | Observed | Evidence |
|-----:|-------------|:--------:|----------|
| 0 | **Y** | yes | Book5 B/C/D…, all Kerr-signal cols |
| 1 | **disregard / None** | yes | Book4 FitLinear1 text cols (`Statistics`, `DF`, `Input X Data Source`) |
| 2 | **Y Error** | yes | Book4 FitLinear1 col J `Standard Error`, col O `Intercept` err — 0x23 points to its parent Y col |
| 3 | **X** | yes | Book5 A/E/I (`H`), all `2Theta` cols |
| 4 | **Label** | inferred | not present in corpus |
| 5 | **Z** | inferred | not present in corpus |
| 6 | **X Error** | inferred | not present in corpus |

---

## 5. Sheet (layer) structure

Books can hold **multiple sheets**; `Moke.opj` `Book4` has three. Each sheet is
opened by a **layer-header block** — 365 B (v4.3380) / 361 B (v4.3227), payload
begins `00 00 5e …` — followed by sheet-level storage/format blocks and then
that sheet's column-property list. Within `Book4` (idx 682–862):

| Layer hdr idx | Sheet name (see below) | Columns |
|--------------:|------------------------|---------|
| 683 | `Sheet1` | A,E,B,H,O,C,D,F,G,M,I,J,K,L,N (15) |
| 748 | `FitLinear1` | A…Y (25, stats results) |
| 817 | `FitLinearCurve1` | A…K (11, fit-curve results) |

**Sheet name** lives in the layer header at **payload offset ≈ 0xCE**, format
`… 50 64 <Name> 00`:

```
00ce  00 00 50 64 53 68 65 65 74 31 00 ...   ..PdSheet1.
```

The two bytes `50 64` ("Pd") precede every sheet name in these files
(`PdSheet1`, `PdFitLinear1`, `PdFitLinearCurve1`). Because `FitLinear1` /
`FitLinearCurve1` are **auto-generated** by Origin's linear fit (the user
cannot have typed a `Pd` prefix on them), `50 64` is almost certainly a
**separate 2-byte field**, not part of the name — i.e. the real sheet names are
`Sheet1`, `FitLinear1`, `FitLinearCurve1`. Treated as **medium confidence**;
the 2-byte prefix's meaning is an open question (§8).

Column-property **storage order** is the sheet's *display* order (Book5:
A,B,C,D,**M**,E,F,G,H,**N**,I,J,K,L,**O**), while the short-name field (0x12)
gives the true column short name — so mapping is by short name, not position.

---

## 6. Column ↔ dataset mapping rule (validated)

> **For each worksheet window (book short name `B` from header offset 0x02),
> and each column-property block in the primary sheet, the short-name string
> `S` (payload offset 0x12, NUL-terminated) identifies the dataset named
> `"<B>_<S>"`.** The block's designation (0x11) and its following label block
> (Long Name / Unit / Comment) attach to that dataset column.**

- Single-char (`Book5_A`) and multi-char (`T106670001e_EY`, `…_c9`,
  `…_i0es`) short names both resolve — the field is NUL-terminated variable
  length. **Confirmed** on XMCD: window short names `EY`/`c9` join to existing
  datasets `T106670001e_EY` / `T106670001e_c9` (found at `0x5ec1` / `0x8a5d`).
- **Additional sheets** (sheet index ≥ 2) use suffixed dataset names
  `"<B>_<S>@<N>"` (e.g. `Book4_A@3`). The property→dataset join for those uses
  the same short name plus the `@N` suffix. Suffix numbering vs sheet/layer
  index is **not yet pinned** (§8) — treat sheet-1 mapping as high confidence,
  extra-sheet mapping as provisional.

---

## 7. Extraction algorithm (prose pseudocode)

```
read file; require magic "CPYA"; note version token (4.3380 → colblock=519,
    layerhdr=365 ; 4.3227 → colblock=515, layerhdr=361).
BLOCKS = list(_walk_blocks(bytes))          # stops at the trailing-storage break

# 1. datasets (already M1): pair 147-B header (name "<Book>_<Col>") with data.

# 2. windows: split BLOCKS into windows at each window-header block
#    (payload starts 00 00 <printable name> 00, size > ~150).
for each window:
    book_short = C-string at payload[0x02]
    book_long  = readable run in header tail ending at "@${"  (fallback: book_short)
    columns = []
    sheet_index = 0
    i = first block after header
    while i in window:
        p = BLOCKS[i]
        if p starts a layer header (size == layerhdr and p[0x02:0x04]==b"\x00\x00"
                                    and matches the 00 00 5e… shape):
            sheet_index += 1
            sheet_name = C-string at p[~0xCE] (drop a possible 2-byte prefix)
        elif is_col(p):     # len>=500 and p[0x06]==0x0B and p[0x25]==0x21 and p[0x12] printable
            short   = C-string at p[0x12]
            desig   = DESIGNATION[p[0x11]]          # 0=Y 1=disregard 2=YErr 3=X 4=Label 5=Z 6=XErr
            xptr_id = p[0x23]                        # object-id of associated X column (0 if none)
            long, unit, comment = "", "", ""
            nxt = BLOCKS[i+1]
            if nxt exists and not is_col(nxt) and len(nxt) small:
                text = nxt up to first NUL, cut at "@${", decode latin-1
                rows = text.split("\r\n"); long,unit,comment = rows[0:3] (pad)
                i += 1                               # consume the label block
            dataset = f"{book_short}_{short}" + ("" if sheet_index<=1 else f"@{sheet_index}")
            columns.append(short, long, unit, comment, desig, xptr_id, dataset)
        i += 1
    attach columns' (long, unit, designation) onto the matching datasets.
```

`is_col`, the designation enum, the `\r\n` label split, and the `@${` cut are
the load-bearing rules; everything else is framing already handled by
`_walk_blocks`.

---

## 8. Validation results

All extracted via the **structured window path** (property block + label
block), **not** by scraping the analysis log.

**`Moke.opj` Book5 (single sheet, 15 columns) — matches ground truth:**

| short | desig | Long Name | Unit | Comment | → dataset |
|------|-------|-----------|------|---------|-----------|
| A | **X** | **H** | Oe | | `Book5_A` |
| B | **Y** | **Kerr Signal** | (mdeg) | As deposited | `Book5_B` |
| C | Y | Kerr inverted | | As deposited | `Book5_C` |
| D | Y | Kerr Signal | (arb. units) | As deposited | `Book5_D` |
| E | X | H | Oe | | `Book5_E` |
| F/G | Y | kerr1 | mdeg / | 325 °C | `Book5_F/_G` |
| H,N | Y | Kerr Signal | (arb. units) | 325 °C | `Book5_H/_N` |
| I | X | H | Oe | | `Book5_I` |
| J,K | Y | Kerr 2 | | 525 °C | `Book5_J/_K` |
| L,O | Y | Kerr Signal | (arb. units) | 525 °C | `Book5_L/_O` |

→ The two named targets (**X col long-name `H`/`Oe`**, **Y col long-name
`Kerr Signal`/`(mdeg)`**) are recovered exactly.

**`XRD.opj` (v4.3227, long book names, 515-B property blocks) — spot check:**

- Book long names recovered: `MD180412b_II_Theta2Theta.txt`,
  `MD180412b_III_Theta2Theta.txt`, … (long-name-length handling works).
- Every book: col **A = X, Long `2Theta`, Unit `degrees`**; col **B = Y, Long
  `I`, Unit `arb. units`, Comment `325 C`**; col **C = Y, Long `dI`**. The θ–2θ
  and intensity columns decode correctly. (Col B was initially missed by a
  `10 00 00 00`-prefix test — fixed by the `payload[0x06]==0x0B` detector.)

**`XMCD.opj` (172 books, instrument channels) — mapping stress test:**

- Multi-char short names `EY`, `c9`, `i0es`, `c13` parse from offset 0x12
  (NUL-terminated). They join to real datasets
  `T106670001e_EY` / `_c9` / `_i0es` / `_c13`. The `<Book>_<short>` rule holds
  at scale.

---

## 9. Unknowns / confidence

**High confidence (validated on 3 files, both `.opj` versions):**
- Section layout & the true datasets/windows/trailing-storage boundaries (§1).
- Window framing & book short/long-name extraction (§3).
- Column-property block layout: designation @0x11, short name @0x12, X-pointer
  @0x23, the `0x06==0x0B` / `0x25==0x21` invariants (§4).
- Label-text `LongName\r\nUnit\r\nComment` format + `@${` cut (§4.2).
- Designation enum values 0–3 (§4.3).
- Sheet-1 mapping `<Book>_<short>` incl. multi-char names (§6).

**Medium / open:**
- **Sheet name** exact bytes: the `50 64` ("Pd") 2-byte prefix before the name
  in the layer header — separate field vs part of name (§5). Likely separate
  (auto-generated `FitLinear1` carries it too), but unproven.
- **Extra-sheet dataset suffix** `@N`: observed (`Book4_*@3`) but the exact
  numbering (sheet index vs layer index; where sheet-2 vs sheet-3 split) needs
  a dedicated pass — this is plan item 5 (sheet hierarchy).
- **Book long-name offset** is not fixed; extraction relies on the `@${`
  anchor. Fine in practice, but no closed-form offset yet.
- Designation codes **4 (Label) / 5 (Z) / 6 (X-Err)** are from the published
  enum, not observed in this corpus — verify when a matrix/label/contour
  project is available.
- Column value-**type** (text vs numeric vs date) is in the 147-B datasets
  header, not the window record — orthogonal to this report (plan item 4).
- All of the above is `.opj` (`CPYA`) only; `.opju` (`CPYUA`) uses different
  framing (plan item 7) and is out of scope here.

**Provenance:** `Moke.opj` block indices/offsets are reproducible with
`_walk_blocks`; every hex snippet above is copied from a live dump of the
private corpus (not committed). Published fact cited: the Origin worksheet
plot-designation enumeration (`Y, disregard, Y-Err, X, Label, Z, X-Err`).
