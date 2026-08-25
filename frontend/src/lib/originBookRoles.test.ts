// FU-1 (E1/L3/L4/O1): `originBookErrorRoles` derives error roles from an
// Origin book's own authoritative `column_designations` metadata — read
// through `lib/columnmeta.ts`'s shared alignment, never a label-name guess.
// See the module doc for why the guess is unsafe on Origin data (a genuine
// "Depth" column reads as an error series), why `null` signals "no usable
// designation info at all" to a caller that wants to fall back, and why
// designations-with-zero-error-columns is `{ errorRoles: [] }` rather than
// `{}` (round 5, O1) -- other `dataset.errorRoles ?? inferErrorBindings(...)`
// readers must be able to tell that apart from "never determined".

import { describe, expect, it } from "vitest";

import { originBookErrorRoles } from "./originBookRoles";

/** `metadata` for a 3-value-column book (short names B/C/D; A is the X
 *  column, as real Origin books reserve it) with the given designations. */
const meta = (b: string, c: string, d: string, extra: Record<string, unknown> = {}) => ({
  metadata: {
    origin_column_names: ["B", "C", "D"],
    column_designations: { A: "X", B: b, C: c, D: d },
    ...extra,
  },
});

describe("originBookErrorRoles", () => {
  it("does NOT bind a genuine 'Depth' measurement column, even though its name would trip the label guesser", () => {
    // Every column plainly designated Y -- none is an error. O1: `[]`, not
    // `{}` -- this dataset WAS checked and has no error columns, which must
    // stay distinguishable from "never checked" for the five other readers
    // that do `dataset.errorRoles ?? inferErrorBindings(...)`.
    const roles = originBookErrorRoles(meta("Y", "Y", "Y"));
    expect(roles).toEqual({ errorRoles: [] });
  });

  it("binds a genuine Y-error designation to the nearest preceding Y column", () => {
    const roles = originBookErrorRoles(meta("Y", "Y-error", "Y"));
    expect(roles?.errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });

  it("binds an X-error designation to the dataset's x axis (target -1)", () => {
    const roles = originBookErrorRoles(meta("X-error", "Y", "Y"));
    expect(roles?.errorRoles).toEqual([{ channel: 0, target: -1, axis: "x", side: "both" }]);
  });

  it("leaves a Y-error with no preceding Y column unbound (nothing defensible to pair it with)", () => {
    const roles = originBookErrorRoles(meta("Y-error", "Y", "Y"));
    expect(roles).toEqual({ errorRoles: [] });
  });

  it("L4: skips an X-error binding when the designated X column was not recovered (synthetic row-index axis)", () => {
    const roles = originBookErrorRoles(meta("X-error", "Y", "Y", { x_column_recovered: false }));
    expect(roles).toEqual({ errorRoles: [] });
  });

  it("still binds X-error when x_column_recovered is true (or absent — the common, pre-existing case)", () => {
    const recoveredTrue = originBookErrorRoles(meta("X-error", "Y", "Y", { x_column_recovered: true }));
    expect(recoveredTrue?.errorRoles).toEqual([{ channel: 0, target: -1, axis: "x", side: "both" }]);
    const absent = originBookErrorRoles(meta("X-error", "Y", "Y"));
    expect(absent?.errorRoles).toEqual([{ channel: 0, target: -1, axis: "x", side: "both" }]);
  });

  it("returns null (no usable designation info) when origin_column_names is entirely absent", () => {
    expect(originBookErrorRoles({ metadata: { origin_book: "X" } })).toBeNull();
  });

  it("returns null for a plain non-Origin dataset (no Origin metadata at all)", () => {
    expect(originBookErrorRoles({ metadata: {} })).toBeNull();
  });

  // O1 (round 5): the distinguishable-empty-array marker is not nullish, so
  // it must never trip a `??` fallback anywhere it flows.
  it("O1: `{ errorRoles: [] }` is not nullish -- a `?? inferErrorBindings(...)` reader never falls back on it", () => {
    const roles = originBookErrorRoles(meta("Y", "Y", "Y"));
    expect(roles?.errorRoles ?? "FELL BACK").toEqual([]);
  });
});
