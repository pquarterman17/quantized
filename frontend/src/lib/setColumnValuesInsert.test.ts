import { describe, expect, it } from "vitest";
import { insertAt } from "./setColumnValues";

describe("insertAt", () => {
  it("drops the caret marker and puts the cursor there", () => {
    expect(insertAt("A + ", 4, 4, { label: "erf", text: "erf(|)" })).toEqual({ text: "A + erf()", caret: 8 });
  });
  it("replaces the selection and keeps text after it", () => {
    expect(insertAt("x*B", 2, 3, { label: "C", text: "C" })).toEqual({ text: "x*C", caret: 3 });
  });
  it("only the first | is the marker; a later | stays as text", () => {
    expect(insertAt("", 0, 0, { label: "t", text: "a|b|c" })).toEqual({ text: "ab|c", caret: 1 });
  });
});
