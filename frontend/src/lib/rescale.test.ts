import { describe, expect, it } from "vitest";

import { fromMultiplier, toMultiplier } from "./rescale";

describe("toMultiplier", () => {
  it("treats blank as unset, not an error", () => {
    // The field is optional — an empty box must not block Apply for the
    // other corrections sharing the card.
    expect(toMultiplier("×", "")).toEqual({});
    expect(toMultiplier("÷", "   ")).toEqual({});
  });

  it("passes a multiply through unchanged", () => {
    expect(toMultiplier("×", "1000")).toEqual({ multiplier: 1000 });
    expect(toMultiplier("×", "0.1")).toEqual({ multiplier: 0.1 });
    expect(toMultiplier("×", "-2.5")).toEqual({ multiplier: -2.5 });
  });

  it("stores a division as the reciprocal", () => {
    expect(toMultiplier("÷", "10")).toEqual({ multiplier: 0.1 });
    expect(toMultiplier("÷", "4")).toEqual({ multiplier: 0.25 });
  });

  it("rejects zero, naming the operator the user actually chose", () => {
    expect(toMultiplier("÷", "0").issue).toBe("cannot divide by zero");
    expect(toMultiplier("×", "0").issue).toBe("factor cannot be zero");
  });

  it("rejects non-numeric and non-finite text", () => {
    expect(toMultiplier("×", "abc").issue).toBe("must be a finite number");
    expect(toMultiplier("×", "1e400").issue).toBe("must be a finite number");
    expect(toMultiplier("×", "NaN").issue).toBe("must be a finite number");
  });

  it("treats an underflowing factor as zero, because that is what it is", () => {
    // Number("1e-400") underflows to exactly 0 in JS, so this lands on the
    // zero guard rather than the finite one — and the message names the
    // operator, which is the more useful thing to tell the user.
    expect(toMultiplier("÷", "1e-400").issue).toBe("cannot divide by zero");
    expect(toMultiplier("×", "1e-400").issue).toBe("factor cannot be zero");
  });

  it("rejects a reciprocal that overflows to Infinity", () => {
    // 5e-324 is the smallest denormal: it parses finite and non-zero, so it
    // passes both earlier guards, but 1/5e-324 is Infinity. This is the case
    // the post-reciprocal range check exists for.
    expect(toMultiplier("÷", "5e-324").issue).toBe("factor is out of range");
  });

  it("never returns a multiplier alongside an issue", () => {
    for (const raw of ["0", "abc", "1e400", ""]) {
      for (const op of ["×", "÷"] as const) {
        const r = toMultiplier(op, raw);
        expect(r.multiplier === undefined || r.issue === undefined).toBe(true);
      }
    }
  });
});

describe("fromMultiplier", () => {
  it("round-trips a multiply", () => {
    expect(fromMultiplier(toMultiplier("×", "250").multiplier)).toBe("250");
  });

  it("shows a stored division as its equivalent multiplier", () => {
    // Documented, deliberate: the multiplier is the single stored truth, so
    // "÷ 10" comes back as "0.1" rather than resurrecting a second field.
    expect(fromMultiplier(toMultiplier("÷", "10").multiplier)).toBe("0.1");
  });

  it("renders unset as blank", () => {
    expect(fromMultiplier(undefined)).toBe("");
  });
});
