# Quantized — Design System

The design system for **Quantized**, a modern, open-source, free alternative to
OriginPro for **materials-characterization data**: magnetometry (VSM / PPMS /
MPMS), X-ray & neutron diffraction (XRD / XRR / reflectometry), and generic lab
data. Quantized is a Python (FastAPI) + React/TypeScript port of the
`quantized_matlab` toolbox, with a **ground-up revamped GUI** that intentionally
shares the look, tokens, and component conventions of its sibling EM app,
**fermiviewer** — so code and design move freely between the two.

The vibe: a **dense, calm, dark-first desktop instrument**. Origin's power
without Origin's 1998 chrome. Every number is monospace and aligned; color is
rationed; the plot canvas is the hero.

---

## Sources

This system was authored from the user's own repositories. You are encouraged to
explore them to build more faithful designs:

| Source | Role | URL |
|--------|------|-----|
| **quantized** | The product — Python+React port; behavioural & domain reference (private) | https://github.com/pquarterman17/quantized |
| **fermiviewer** | Structural & visual reference — the sibling EM app whose theme + shell this reuses | https://github.com/pquarterman17/fermiviewer |
| **Quantized_matlab** | The original MATLAB toolbox being ported (authoritative behaviour) | https://github.com/pquarterman17/Quantized_matlab |
| **fermi-viewer** | Original MATLAB EM toolbox | https://github.com/pquarterman17/fermi-viewer |

Visual foundations (tokens, fonts, shell layout, the `Card`/inspector pattern)
were lifted verbatim from fermiviewer's `frontend/src/theme.css` +
`theme-web.css`. Domain, copy, and feature naming come from quantized's
`CLAUDE.md` and `plans/PORT_PLAN.md`.

> **Font note:** the bundled face is **JetBrains Mono** (SIL OFL, vendored from
> fermiviewer — see `assets/fonts/OFL.txt`). The UI face is the native
> `system-ui` stack (no webfont). No substitutions were needed.

---

## Content fundamentals

How Quantized writes.

- **Voice:** terse, technical, instrument-operator register. Labels are nouns or
  noun phrases (*Subtract background*, *Coercivity Hᶜ*, *Field-cooled M(T)*),
  never marketing sentences. The user is a scientist; respect their time.
- **Person:** effectively impersonal — neither "you" nor "we". Commands are bare
  imperatives (*Run fit*, *Add to worksheet*, *Export figure…*). No
  encouragement, no exclamation marks.
- **Casing:** **Sentence case** for actions, menus, buttons (*Import data…*,
  *Send to Origin*). **UPPERCASE + tracked** (`--tracking-label`) for card and
  section labels only (*CORRECTIONS*, *SCAN METADATA*). Units keep their
  scientific casing exactly (`kOe`, `µ_B/f.u.`, `Å⁻¹`, `2θ`).
- **Numbers are sacred:** every value is monospace, right-aligned in columns,
  with explicit units and sensible sig-figs. Scientific notation for very large
  / small magnitudes (`1.83×10⁻⁴`, `2e-7`). Greek and sub/superscripts are used
  literally (χ²ᵣ, R², θ, λ, Q_z).
- **Trailing ellipsis** marks an action that opens a dialog (*Import data…*,
  *Column formula…*); actions that happen immediately do not (*Run fit*).
- **Emoji:** never. This is a scientific instrument.
- **Status copy:** one word or a short clause — *converged · 18 iter*, *backend
  ready*, *parser: unknown column*. Never a paragraph.

---

## Visual foundations

- **Theme:** **dark-first**, authored in **oklch** so the neutral ramp is
  perceptually even and near-zero chroma keeps surfaces genuinely neutral. A
  light theme exists (full token parity) but dark is the default and the
  identity. The **plot/axes canvas stays dark in both themes** (dark-adaptation
  — you stare at data for hours).
- **Surfaces climb in lightness:** `surface-0` (app bg) → `-1` (panels) → `-2`
  (cards) → `-3` (controls / hover). Elevation is lightness, not big shadows.
- **Color is rationed.** Neutrals do the work; a single **violet accent** marks
  selection, primary actions and the active state. **Amber (`--capture`)** means
  *exactly one thing*: a pick/zoom/fit-region mode is armed. Status (green ok /
  red danger / amber warn) appears only as a single dot or one word. The accent
  is swappable (violet · teal · ocean · amber · rose) — a tint, never a reskin;
  surfaces/text/borders never move.
- **Plot series palette:** 8 categorical, color-blind-aware trace colors;
  `series-1` mirrors the accent so a single-trace plot reads on-brand.
- **Type:** two families only. **`system-ui`** for all chrome (zero load,
  matches the host OS); **JetBrains Mono** for every number, axis tick, readout,
  code and keyboard shortcut. The split is semantic — *prose is UI, data is
  mono*.
- **Density:** the UI is genuinely dense (a desktop analysis tool). Three density
  modes (compact / regular / comfy) scale live padding, row height and text via
  `--pad` / `--row-h` / `--font-size`; the fixed `--space-*` scale (2/4/6/8/12/
  16/24) is the gap vocabulary between atoms.
- **Corners:** tight — `--radius` 8px for cards/panels, `--radius-sm` 5px for
  controls, full-round pills for filters. Nothing is bubbly.
- **Borders over shadows:** 1px `--border-soft`/`--border` hairlines separate
  almost everything. The **only** shadow (`--shadow`) is reserved for *floating*
  chrome — menus, the command palette, floating tool docks — which also get
  **glass** (`--glass` + `backdrop-filter: blur(14px)` + `--glass-border`).
- **Cards:** `surface-2` fill, 1px `--border-soft`, 8px radius, **no** drop
  shadow. Collapsible inspector cards are native `<details>` with an UPPERCASE
  tracked title and a tiny chevron.
- **Motion:** minimal and functional. Short (~120ms) ease transitions on
  toggles/switches; the one looping animation is the pulsing dot on an armed
  capture banner. No decorative motion, no bounce, no parallax.
- **Interaction states:** hover lifts the surface one step (`surface-3`) and the
  text one step (dim → full) and/or strengthens the border; active/armed uses
  `accent-soft` text+bg (or `capture-soft` for a pick mode); press nudges 0.5px.
  **Cursors are `default`, not `pointer`** — this is a desktop tool, not a web
  page (the box-zoom reticle is the one custom cursor).
- **Backgrounds:** flat token surfaces only. **No gradients** (the sole
  exception is the small app-icon mark), no photographic imagery, no textures,
  no illustration. The product *is* the data on screen.

---

## Iconography

- Quantized uses **inline Unicode glyphs as icons**, exactly as fermiviewer does
  — no icon font, no SVG sprite, no PNG icon set in the source. Tool and menu
  glyphs are characters: `✥` pan, `⛶` box-zoom, `✛` data cursor, `⩓`/`⤳`/`⛌`
  analysis, `▤`/`▥` panel toggles, `⌕` search, `▾`/`▸` chevrons. They inherit
  `currentColor` and the surrounding font-size, so they restyle for free.
- **Emoji are never used** as icons or anywhere else.
- The **brand mark** (`assets/logos/quantized-mark.svg`) is a small geometric
  glyph — discrete "quantized" energy levels rising on an axis, with sampled
  data points — a deliberate sibling to fermiviewer's atom mark
  (`assets/logos/fermiviewer-mark.svg`, kept for reference). The app icon is the
  one place a subtle violet gradient is allowed.
- If a consuming design needs line icons beyond the Unicode set, substitute a
  CDN set with a **thin, ~1.5px stroke, rounded** weight (e.g. Lucide) to match
  the chrome — and flag the substitution. Do not introduce filled/duotone icons.

---

## What's in here (index)

**Foundations** — `styles.css` is the single entry point consumers link; it
`@import`s everything below.

```
styles.css                  entry point (@import list only)
tokens/colors.css           surfaces, text, borders, accent, status, series, glass, accent schemes
tokens/typography.css       font families, weights, fixed type roles, tracking
tokens/spacing.css          space scale, radii, density modes
tokens/fonts.css            @font-face — JetBrains Mono (WOFF2)
components/components.css    qz-* class layer for the primitives (shipped to consumers)
assets/fonts/               JetBrains Mono WOFF2 + OFL.txt
assets/logos/               quantized-mark.svg (brand) · fermiviewer-mark.svg (ref)
```

**Components** (`components/<group>/`) — reusable React primitives, exported on
`window.QuantizedDesignSystem_*` via the generated `_ds_bundle.js`:

- `buttons/` — `Button`, `IconButton`, `SegmentedControl`, `Pill`
- `forms/` — `NumberField`, `Select`, `Checkbox`, `Switch`, `SliderRow`
- `data/` — `Card`, `MetaRow`, `Badge`, `StatusDot`, `DataTable`

Each group has a `*.prompt.md` (what & when + usage) and a `*.card.html`
specimen rendered in the Design System tab.

**Foundation cards** (`guidelines/cards/`) — the specimen cards for the Design
System tab (Colors / Type / Spacing / Brand).

**UI kit** (`ui_kits/workbench/`) — the **Analysis Workbench** and
**DiraCulator** screens; see its `README.md`. The two `index`/`diraculator`
HTML files are also **Starting Points**.

**Other** — `SKILL.md` (Agent-Skill manifest), this `readme.md`.

---

## Using it

Consumers link one file:

```html
<link rel="stylesheet" href="styles.css">
<html data-theme="dark" data-accent="violet" data-density="regular">
```

…then read components from the namespace after loading the bundle:

```js
const { Button, Card, DataTable } = window.QuantizedDesignSystem_<hash>;
```

Run `check_design_system` to get the exact namespace hash.
