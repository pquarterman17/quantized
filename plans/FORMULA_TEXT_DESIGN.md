# Text-valued formula columns: design note (gap audit 9, G16)

Status: **provisional, owner to confirm.** Written by lane gap9-fxtext,
2026-11-24. Nothing in this note is built.

## What shipped (no architecture change)

A formula column holds numbers: `FormulaFn` returns `number`
(`lib/formulaTypes.ts`) and a computed column is a float column in
`DataStruct.values`. The text functions therefore live INSIDE a numeric
result (`lib/formulaText.ts` header): text-consuming functions (`len`, `num`,
`contains`, `startswith`, `endswith`, `find`, `regex_match`, `parse_date`)
return numbers, and the text-producing ones (`upper`, `lower`, `trim`, `left`,
`right`, `mid`/`substr`, `concat`, `replace`, `regex_extract`, `str`,
`format_date`) are legal only as their arguments. A text-producing function at
the top of a column is refused with a message saying so. Date/time columns are
epoch seconds UTC (`metadata.time_is_datetime`), so the date functions are
plain numeric ones.

## What is missing: a column whose cells are text

The owner-visible case is "derive `300K` / a sample ID from a name"
(Origin's Flash Fill). Two ways, neither built:

1. **Categorical result.** The formula yields strings; the store interns
   them into `cat_levels` (levels in first-seen order) and writes integer
   codes. This reuses the shipped categorical write path (J1, `Dataset.
   data.cat_levels`, `lib/formula.ts` `catLevels`) and every consumer that
   already understands factor columns (group by, colour by, `A == "x"`).
   Needs: a `FormulaFn` variant returning `string | null`, the evaluator in
   `computeFormulas` (lib/formula.ts) choosing the column kind by the top
   node's type, level-order rules (the `levels-allowlist` guard in
   `architecture.test.ts` exists because level ORDER is easy to get wrong),
   and the recompute path (`formulaIncremental`, `recalc`) carrying levels.
   Preferred: it fits "general before specialized".
2. **A real text column** (`metadata.text_columns`, what `col("Name")`
   reads). Wider: nothing writes it from the grid today, and a computed text
   column needs its own storage and export (CSV / Origin) story.

Open questions for the owner: (a) option 1 or 2; (b) should numeric-looking
results (`"300"`) stay text or become numbers (this note's `num()` makes the
choice explicit and per formula); (c) Flash Fill by EXAMPLE (infer the
formula from typed examples) is a separate, search-based feature that would
emit `regex_extract`/`mid` formulas once (1) exists.

## Decisions taken in the shipped half (all provisional, owner to confirm)

- Characters are Unicode code points (Python `len`), positions 1-based (JMP
  `Substr`, Excel `MID`).
- `num()` is strict (plain decimals only); `inf`, `nan`, hex and `1,000` are
  missing, where pandas `to_numeric` is more lenient.
- `str(v, "%.2f")` rounds exact decimal ties away from zero (JavaScript);
  Python rounds them to even.
- `datediff` month/year = whole completed calendar months/years, day clamped
  to month end (dateutil `relativedelta`; JMP's "Actual" alignment is
  documented only as "count whole intervals", so the clamping rule is our
  reading).
- `weekday` is 1 = Sunday (JMP Day Of Week; Origin's `weekday()` believed the
  same, unverified).
- A date with a UTC offset is converted to UTC; no offset means UTC. There is
  no local-time or DST handling by design.
- Regular expressions are the JavaScript dialect, not Python `re`; the common
  subset agrees and is what the goldens pin.
- Headless (`qz run`, `add_formula_columns`) refuses all of these by name:
  they are evaluated only in the app.
