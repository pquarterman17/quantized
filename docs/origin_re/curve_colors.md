# Origin curve colours on restyled symbols (record byte 310)

Evidence record for the 2026-11-20 change to the colour gate in
`io/origin_project/curve_style_color.py` (`_color_fields_aligned`). Same
format as `curve_visibility.md`. Established without a live Origin session;
the COM check that would confirm it is at the end.

## The field

The 519-byte curve record (`.opj` anchor, `.opju` token) keeps its colour
group at offsets 302-310:

| offsets | field | values seen |
|---|---|---|
| 302-305 | symbol **fill** colour (ocolor u32) | `F7 FF FF FF` auto; `FC FF FF FF` (-4) on restyled symbols; an explicit RGB on e.g. bubble plots |
| 306-309 | symbol **edge** colour = the plot colour COM reports | palette index (0-based), `01 BB GG RR`, auto |
| 310 | one byte | `FF` on every Origin-default record; 25, 30, 40, 50, 60 on symbols the user restyled |

The old decoder read 310 as a terminator and gave no colour unless it was
`FF`. That left every restyled scatter on the default frontend palette
(fidelity `some_curve_colors`), e.g. the Book2/Book3 Hc2 graphs. What 310
encodes is not proven (its values look like a percentage, e.g. a symbol edge
thickness); the change does not read it. The new gate reads the colour when
310 is `FF` (unchanged) **or** the fill field holds one of the two sentinels
Origin writes (`auto`, `-4`) **and** the record is a symbol plot (byte 23 >
0, the only class the evidence covers; the corpus's one line-only record
that would otherwise pass -- Hc2 data, fill `-4`, 310 = 30, line `#1A6FDF` --
is not a drawn curve, so a line colour stays gated as before). A record with an
explicit fill and a non-`FF` 310 stays uncoloured (see the bubble control
below).

## Evidence

### 1. Natural controlled pairs (Hc2 data.opju)

| pair | plots | records differ at |
|---|---|---|
| Graph27 vs Graph29 | the same `Book3` C/D/E scatters | **310 only** (`1E` -> `28`), plus 386-387 / 482-483 (per-plot ids) |
| Graph1 vs Graph12 | lock-in E/G/I vs `Book2` C/D/E, same symbols | 302 (`F7`->`FC`), 310 (`FF`->`1E`), 25-27 (symbol size 9 -> 12 pt), 114/117/394, ids. 306-309 identical |

Graph1's colours are COM-verified (`specimens/ground_truth/Hc2 data/curve_style.json`:
`#515151`, `#F14040`, `#1A6FDF`); Graph12 carries the same 306-309 bytes, and
its saved preview draws the same colours (below).

### 2. Rendered oracle: Origin's saved previews

Origin's System Color List red/blue (`#F14040`, `#1A6FDF`) and the classic
palette red/blue (`#FF0000`, `#0000FF`) separate cleanly in anti-aliased
pixels: a blend of `#1A6FDF` with white keeps G-R > 0, one of `#0000FF` keeps
G = R. Pixel counts in the 200 px saved previews (blue is decisive; the red
count is contaminated by partly blended `#FF0000`):

| page | decoded scatter colours (new) | lines (already decoded) | blue `#1A6FDF`-like px | blue `#0000FF`-like px |
|---|---|---|---|---|
| Graph12 | 515151 / F14040 / 1A6FDF | none | 123 | 1 |
| Graph27 | 515151 / F14040 / 1A6FDF | none | 85 | 0 |
| Graph28 | 515151 / F14040 / 1A6FDF | 000000 / FF0000 / 0000FF | 112 | 83 |
| Graph29 | as Graph28 | as Graph28 | 93 | 89 |
| Graph36 | F14040 / 1A6FDF | FF0000 x2 / 0000FF | 49 | 139 |
| Graph37 | 515151 / F14040 / 1A6FDF | FF0000 x8 | 89 | 0 |
| Graph32 | 0000FF (palette 3) x2 | 0000FF x2 | **0** | 334 |
| Graph31 | FF0000 (palette 1) x2 | FF0000 x2 | 0 | 0 |
| Graph30 | 515151 / 000000 | 000000 x2 | 0 | 0 |
| Graph38-40 | 404040 (palette 23) x2 each | 009E73, 808000, 800000, 0000FF | 0-6 | 0 / 98 / 54 |
| Graph33 (control, no change) | none | FF0000 | 0 | 0 |

Positive: 6 of 6 pages where a `#1A6FDF` scatter is decoded show it
(49-123 px); the 7 pages where none is decoded show 0 px (Graph38: 6 px, edge
pixels of its green `#009E73` line). Graph32's scatter stores
palette index 3 and the preview has only palette blue, so the 0-based palette
reading holds for this record class too. Graph38-40's dark scatter (palette
index 23 = `#404040`) matches the dark grey in those previews (`#404040`
40-70 px, black 0). The quantized screenshots after the change
(Graph12/27-32/36-40) match the previews' colours by eye.

### 3. Negative controls

* **Bubble specimens** (`generated/bubble/*`, 7 records): 310 = `00`, fill
  `#467DE8` at 302, edge palette black at 306. COM reports colour 1 (black),
  but Origin's render (`specimen.png`) shows blue bubbles with thin black
  edges. Reading 306 would draw them black: the gate leaves them uncoloured
  (unit test `test_style_fields_fail_closed_gates`).
* **Misaligned reconstructions** (embedded fit-report pages, XPS_in_situ,
  sm_token_time, sm_X2, Degree-of-impact Graph26, Figure-1, origin.opju
  Graph17/19; 27 drawn curves): 310 is not `FF` and 302 holds junk, not a sentinel -> still no
  colour.
* **Generated COM corpus** (`generated/*/oracle.json`, 231 Origin-built
  specimens, per-plot `color`): 236 decoded colours match, 59 mismatch, 41
  auto, 7 gated -- identical before and after (no record there has a
  non-`FF` 310 with a sentinel fill). The 59 mismatches are PRE-EXISTING:
  36 bar / column / stacked plots (plot types `0xcb/0xd5/0xd7/0xd8`; we draw
  `#FF0000` / `#0000FF` / `#00FF00` where COM reports the fill `#FDC897` or
  black) and 23 strip plots (`0xce`; COM reports -1). Booked as plan item 76;
  not touched here.
* Moke.opj and RockingCurve.opju render pixel-identical before/after.

### 4. Distribution and corpus diff

Corpus diff vs main `a92459d9` (590 `.opju` + 106 `.opj`, every drawn curve
compared field by field): **92 curves gain a colour, 0 change colour, 0 lose
one, 0 other field changes, 0 curves added/removed.**

| project | curves | oracle |
|---|---|---|
| Hc2 data.opju (and its copy `specimens/converted/Hc2 data.opju`) | 29 + 29 | previews (table above) |
| hc2convert.opj (older save of the same project) | 24 | same plots, same bytes; no oracle of its own for Graph12+ |
| Analiza-Spektroskopowa-Bialek / Protein_FTIR (Graph6) | 3 + 3 | saved preview: red x, orange +, olive + (`#F14040`, `#FF8000`, `#A67A13`) |
| SOP_meas fig_data_SOPvalid, 2020_cupcts Graph4, ResonatorData RawAndFit | 2 + 1 + 1 | saved previews: blue o / red x; dark grey squares; light orange o |

The 10 public curves are the same structural class (symbol plots, 310 in
{40, 50, 60, 25}) but with the `auto` fill (`F7`), not Hc2's `-4`; all 10
have a saved preview, and each preview draws the decoded colour (checked by
eye at 3-5x; an independent review, 2-3 px markers, so hue-level only).

## The COM check that would settle it

On a machine with Origin 2026b:

1. **Controlled specimen.** Plot one column as a scatter (symbol 2), save
   `edge_default.opju`; in Plot Details > Symbol change only the edge
   thickness (and, separately, only the fill to "none"), saving
   `edge_30.opju` / `fill_none.opju`. Expected: the records differ from the
   default at 310 (edge) / 302 (`F7`->`FC`, fill), and `style_fields` yields
   the same colour for all three.
2. **Sweep.** For every plot of `Hc2 data.opju` Graph12, 27-32, 36-40 and
   `hc2convert.opj` Graph12, 27-34 record `layer.plotN.color`,
   `layer.plotN.symbol.fillcolor` and the edge thickness into
   `specimens/ground_truth/<stem>/curve_style.json` (the existing
   `tools/origin_trial/export_curve_style_oracle.py` with those pages added
   -- the student build's page limit stopped the 2026-07-06 capture at
   Graph11). Expected: `color` equals the decoded colour on all 52 plots, and
   byte 310 tracks the edge-thickness value.
