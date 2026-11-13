# Rich-text labels: the rendering contract

Every figure text slot — title, axis titles, legend entries, annotations,
text boxes — accepts the same markup, and it renders the same on screen (the
uPlot canvas and the DOM legend) and in every export (PDF / SVG / PNG / TIFF,
Copy figure, the Publication preview). This page is the contract a toolbar or
dialog that *inserts* markup must follow; the renderers own the rest.

## 1. Origin-style escapes

Typed the way Origin users already type them. A run is a backslash, a control
character and a parenthesised body; runs nest, and parentheses inside a body
balance.

| Escape       | Meaning                               | Example            | Renders as     |
|--------------|---------------------------------------|--------------------|----------------|
| `\+(text)`   | superscript                           | `cm\+(-3)`         | cm⁻³           |
| `\-(text)`   | subscript                             | `T\-(c)`           | T, subscript c  |
| `\g(text)`   | Greek, Origin's Symbol-font letters   | `2\g(q) (deg)`     | 2θ (deg)       |
| `\b(text)`   | bold                                  | `\b(Sample A)`     | **Sample A**   |
| `\i(text)`   | italic                                | `\i(x)`            | *x*            |

Nesting: `\b(\g(m)\+(2))` is a bold μ². The `\g` letter map is Origin's
Symbol font (a→α, b→β, g→γ, d→δ, e→ε, q→θ, l→λ, m→μ, p→π, r→ρ, s→σ, t→τ,
f→φ, c→χ, y→ψ, w→ω; capitals likewise, e.g. D→Δ, W→Ω).

Rules a toolbar must respect:

* Wrap the **selected text** in the run (`\+(` … `)`); with no selection,
  insert the empty run and place the caret inside it.
* Escapes are only interpreted **outside** `$...$` math regions.
* A run whose text holds a character outside the math subset below (letters,
  digits, spaces, `+ = / ( ) [ ] | . , : ; ! * < > - '`, the Greek letters and
  `° Å µ × ± ⋅ ∘ ′ ″ −`) — e.g. `$ % # & ~ ^ _ { } \ @ ? " é` — an
  unterminated run, or an unknown control (`\x(...)`) is **left literally as
  typed**, the whole run including any runs nested in it — never
  half-converted, on screen and in the export alike. `\\+(` (an escaped
  backslash) is a literal backslash, not an escape. A label with an odd
  number of `$` is rendered literally as a whole, and a label the export
  cannot draw as math falls back to the text as typed. A run left as typed
  keeps its backslash, so a label that also converts another run (e.g.
  `\g(\+(2)) and M\+(2)`) is drawn literally as a whole — any backslash
  outside a math region makes a math-bearing label literal, on screen and in
  the export.
* Spaces inside a run are preserved.

Implementation: both halves rewrite the escapes into the mathtext subset
below before rendering — `frontend/src/lib/originEscapes.ts` (screen) and
`src/quantized/calc/figure_origin_escapes.py` (export) — and the shared
fixture `tests/fixtures/wire/origin_escapes.json` pins them to identical
output (`originEscapes.test.ts`, `tests/test_figure_origin_escapes.py`).
A decoded Origin project's labels are a separate path: on import,
`io/origin_project/origin_richtext.py` flattens them to plain Unicode.

## 2. `$...$` math (the mathtext subset)

Inside `$...$`: `_x` `_{...}` `^x` `^{...}`, `{...}` grouping, `\frac{a}{b}`,
`\sqrt{x}` / `\sqrt[n]{x}`, `\sum \prod \int \oint`, the Greek commands
(`\alpha` … `\omega`, `\Gamma` … `\Omega`), the symbols in
`frontend/src/lib/richtext.ts` (`\AA \circ \times \cdot \pm \leq \approx
\infty \rightarrow` …), `\mathrm{}` / `\mathit{}` / `\mathbf{}`, `\,` (thin
space) and `\ ` (word space). Outside `$...$`, text is literal and `\$` is a
dollar sign. Anything outside the subset renders literally on both sides
(`calc/figure_labels.safe_mathtext_label` enforces the same set on export).
