// FU-1 round 2 (E1): `originBookErrorRoles` derives error roles from an
// Origin book's own authoritative `column_designations` metadata, never a
// label-name guess. See the module doc for why the guess is unsafe on
// Origin data (a genuine "Depth" column reads as an error series).

import { describe, expect, it } from "vitest";

import { originBookErrorRoles } from "./originBookRoles";

/** `metadata` for a 3-value-column book (short names B/C/D; A is the X
 *  column, as real Origin books reserve it) with the given designations. */
const meta = (b: string, c: string, d: string) => ({
  origin_column_names: ["B", "C", "D"],
  column_designations: { A: "X", B: b, C: c, D: d },
});

describe("originBookErrorRoles", () => {
  it("does NOT bind a genuine 'Depth' measurement column, even though its name would trip the label guesser", () => {
    // Every column plainly designated Y -- none is an error.
    const roles = originBookErrorRoles(meta("Y", "Y", "Y"), ["Refl", "Depth", "Temp"]);
    expect(roles.errorRoles).toBeUndefined();
  });

  it("binds a genuine Y-error designation to the nearest preceding Y column", () => {
    const roles = originBookErrorRoles(meta("Y", "Y-error", "Y"), ["Refl", "Refl_err", "Depth"]);
    expect(roles.errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });

  it("binds an X-error designation to the dataset's x axis (target -1)", () => {
    const roles = originBookErrorRoles(meta("X-error", "Y", "Y"), ["X_err", "Refl", "Depth"]);
    expect(roles.errorRoles).toEqual([{ channel: 0, target: -1, axis: "x", side: "both" }]);
  });

  it("leaves a Y-error with no preceding Y column unbound (nothing defensible to pair it with)", () => {
    const roles = originBookErrorRoles(meta("Y-error", "Y", "Y"), ["Err", "Refl", "Depth"]);
    expect(roles.errorRoles).toBeUndefined();
  });

  it("returns no roles (not a guess) when column_designations is entirely missing", () => {
    const roles = originBookErrorRoles({ origin_book: "X" }, ["R", "dR"]);
    expect(roles.errorRoles).toBeUndefined();
  });

  it("returns no roles when origin_column_names is missing", () => {
    const roles = originBookErrorRoles({ column_designations: { A: "X", B: "Y", C: "Y-error" } }, ["R", "dR"]);
    expect(roles.errorRoles).toBeUndefined();
  });

  it("returns no roles when origin_column_names doesn't line up with labels (length mismatch)", () => {
    const roles = originBookErrorRoles(
      { origin_column_names: ["B"], column_designations: { A: "X", B: "Y" } },
      ["R", "dR"],
    );
    expect(roles.errorRoles).toBeUndefined();
  });
});
