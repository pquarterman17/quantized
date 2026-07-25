// Arbitrary X/Y rescaling (MAIN_PLAN #37) — the pure UI-to-wire conversion.
//
// STORED REPRESENTATION: always the literal MULTIPLIER (`CorrectionParams
// .xScale` / `.yScale`). The card offers a ×/÷ operator purely as an input
// convenience and stores 1/v for a division, so there is exactly ONE stored
// representation and no second field that can drift out of sync with it. The
// visible consequence is that "÷ 10" reloads as "× 0.1" — mathematically
// identical, and honest about what is actually applied to the data.
//
// Validation lives here rather than in the card so it can be tested without
// rendering, and so the card can both disable Apply and show the reason. The
// backend re-validates independently (calc raises, the route maps it to 422) —
// this is the fast, local half of the same rule, never the only guard.

/** Input operator. The glyphs are what the user sees in the Select. */
export type ScaleOp = "×" | "÷";

export interface ScaleResult {
  /** The multiplier to send. Absent when the field is blank (= unset) or invalid. */
  multiplier?: number;
  /** Human-readable reason the entry is unusable; absent when fine or blank. */
  issue?: string;
}

/** Convert a (operator, typed text) pair into the stored multiplier.
 *
 *  Blank is "unset", not an error — the field is optional, and an empty box
 *  must not block Apply for the other corrections on the card. */
export function toMultiplier(op: ScaleOp, raw: string): ScaleResult {
  const text = raw.trim();
  if (text === "") return {};

  const value = Number(text);
  if (!Number.isFinite(value)) return { issue: "must be a finite number" };
  if (value === 0) {
    return { issue: op === "÷" ? "cannot divide by zero" : "factor cannot be zero" };
  }

  const multiplier = op === "÷" ? 1 / value : value;
  // A division by something enormous (or a multiply by a denormal) can still
  // underflow to 0, and 1/tiny can overflow to Infinity — both would ruin the
  // data as surely as typing 0, so they fail the same way.
  if (!Number.isFinite(multiplier) || multiplier === 0) {
    return { issue: "factor is out of range" };
  }
  return { multiplier };
}

/** Render a stored multiplier back into form text. Always the × branch: the
 *  multiplier IS the stored truth, so showing it verbatim is the honest
 *  round-trip (see the note at the top of this module). */
export function fromMultiplier(multiplier: number | undefined): string {
  return multiplier === undefined ? "" : String(multiplier);
}
