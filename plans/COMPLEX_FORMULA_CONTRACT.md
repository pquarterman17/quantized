# Complex numbers in worksheet formulas: contract (plan item 33)

**Parent:** `ORIGIN_FEATURE_GAP_PLAN.md`, item 33 (formula functions, wave 2).
**Status:** Active. Slice 1 (C1–C11) built in #1155 on 2026-11-27. The "Not in this slice" list is the open remainder, tracked as item 33's sub-task; the code cites decisions C1–C11 here, so the file stays until that remainder is built or dropped.

## The problem

A worksheet cell holds one real number. Lab data that is complex by nature arrives as two real columns:

- impedance as R and X, or as Z' and Z'';
- AC susceptibility as χ' and χ'';
- lock-in X and Y;
- the real and imaginary parts of an FFT.

The questions people ask of it are complex arithmetic:

- the magnitude and phase of `R + iX`;
- `1 / (1 + iωRC)`;
- the loss tangent `χ'' / χ'`;
- a model evaluated on the complex plane and reduced to a real number.

Origin's LabTalk has a complex type, with `real()`, `imag()`, `conj()`, `angle()` and `abs()`. numpy has `np.real`, `np.imag`, `np.angle` and `np.conj`.

## Decisions

**C1. Complex values live inside an expression, never in a cell.**
- A formula's intermediate values may be real or complex.
- What a formula writes to its cells is always real.
- No new column type, no new persisted field and no forward-compat rung.

**C2. Where a complex value comes from.** There are exactly three sources:
- `complex(re, im)`;
- `polar(r, theta)`, with theta in radians;
- an imaginary literal: a number immediately followed by `i` or `j`, such as `2i`, `0.5j` or `1e3i`. The suffix must not be followed by another identifier character, so `2in` stays a syntax error.

There is no bare `i` or `j` constant, because it would collide with column references and the row-index syntax. `1i` is the imaginary unit.

**C3. Every real formula keeps today's result, bit for bit.** Complex arithmetic happens only when an operand is already complex, so these stay NaN as they are today:
- `sqrt(-1)`;
- `log(-1)`;
- `(-8)^(1/3)`;
- `acos(2)`.

A value's type follows where it came from, not its numeric value:
- **Complex functions keep the complex branch.** `sqrt(complex(-1, 0))` is `i`, because the argument is complex even though its imaginary part is 0.
- **Real-only functions take the real part.** They accept a complex argument whose imaginary part is exactly 0.

**C4. Operators.**

| Operator | With a complex operand |
|---|---|
| `+ - * /`, unary minus | Complex arithmetic |
| `^` and `**` | The principal value `exp(w log z)`, except as listed below |
| `//`, `%` | Error |
| `== !=` | Compare both parts |
| `< <= > >=` | Error unless both operands are real-valued (imaginary part exactly 0) |
| `and or not`, a condition in `if` / `?:` | Real only |

Exceptions to the principal-value rule for `^` and `**`:
- A small integer exponent (up to 64 in magnitude) uses repeated multiplication, so `(1+2i)^2` is exact.
- `z^0` is 1, and `0^w` is 0 when the real part of w is positive.

Division by complex zero gives a blank (NaN) cell. It does not produce an infinity.

**C5. Functions.**

| Name | Meaning | Aliases |
|---|---|---|
| `re(z)` | Real part | `real` |
| `im(z)` | Imaginary part | `imag` |
| `abs(z)` | Modulus, computed with hypot. Unchanged for a real argument | |
| `arg(z)` | `atan2(im, re)`, in (-π, π] radians | `angle` |
| `conj(z)` | Conjugate | |
| `complex(a, b)`, `polar(r, t)` | The constructors (C2) | |
| `exp log sqrt sin cos tan sinh cosh tanh log10` | Principal-branch complex versions, used only when the argument is complex (C3) | |

The `np.` / `numpy.` prefixes work as they do today, so `np.real`, `np.imag`, `np.angle` and `np.conj` are accepted.

Any other function given a complex argument with a non-zero imaginary part is an error, worded as: "`<name>` takes a real number: use re(), im(), abs() or arg() first".

**C6. A formula's result must be real.** At each row:
- A real result is written as today.
- A complex result with imaginary part exactly 0 writes its real part.
- Any other complex result is an error for that formula: "the result is complex: wrap it in re(), im(), abs() or arg(), or write both parts as two columns". It surfaces through the existing per-formula error state, and the column is blank as for any failing formula.
- A blank (NaN) in either part gives a blank cell.

**C7. Writing both parts.**
- When Set Column Values evaluates an expression whose result is complex, it offers one action: "Write the real and imaginary parts as two columns".
- It adds two ordinary computed columns: `<name> (re)` = `re(<expr>)` and `<name> (im)` = `im(<expr>)`.
- It creates no pair metadata.
- A later contract may link such pairs for an Argand or Nyquist plot.
- This is the one UI addition in this slice. It is lazy, and it fails closed if the expression does not compile.

**C8. App-only in this slice.**
- `calc/column_formula.py` (headless, exported scripts) does not evaluate complex formulas.
- `lib/formulaHeadless.ts` must report every complex name and the imaginary literal as outside the headless subset. The exporter then keeps the step as "NOT REPRODUCED", as it already does for conditionals.
- The Python side's `ValueError` must name the construct.
- A test pins that the exported script never computes a different column than the app did.

**C9. Bundle.**
- The complex values, operators and functions live in a LAZY chunk, behind the existing formula extension seam (`lib/formulaExt.ts`), the way `formulaRefs.ts` does.
- A formula that uses complex syntax before the chunk arrives reports EXTENSION_PENDING and is recalculated when it loads.
- Real formulas take the existing fast path: the eager cost is a type check where an operator meets a non-number.
- The budget is at most 500 B eager.

**C10. Oracle.**
- One fixture, `frontend/src/lib/__fixtures__/formulaComplex.json`, holds expressions with inputs and expected real/imaginary parts, generated by a `tools/freeze_complex_fixture.py` that computes them with Python's `cmath` and numpy.
- The vitest checks within a relative 1e-12 and an absolute 1e-15.
- It covers every function in C5, the C4 exceptions, branch cuts (`sqrt` and `log` on the negative real axis, `arg(-1)` = π), C3's unchanged real results, and the C6 errors.

**C11. Help.**
- The formula help and the function picker list the functions under "Complex numbers". Run every registry test the picker and palette iterate.
- The help includes three worked examples:
  - `abs(complex(B, C))`, the impedance magnitude;
  - `degrees(arg(complex(B, C)))`, the phase in degrees;
  - `abs(1 / (1 + 2i*pi*x*1e-3))`, an RC low-pass magnitude over frequency `x`.

## Not in this slice

- A complex column type.
- Pair metadata for Argand / Nyquist plots.
- Complex formulas in the headless exporter.
- Complex fit models.
- Complex-valued aggregates (`mean` of a complex expression).
