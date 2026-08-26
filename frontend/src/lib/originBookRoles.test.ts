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

  // Round 7 (adversarial review, BLOCKER 1): io/origin_project/opj.py:257
  // sets `col_meta = {}` for every sheet-2+ pseudo-book (`Book1@2`, `base_book
  // not in books_meta`) -- so `column_designations` comes back an EMPTY
  // object while `origin_column_names` is still the book's real, non-empty
  // column list (we're past opj.py's `if not cols` early return). That is
  // structurally different from "no designation info at all": `columnMetaList`
  // returns one entry per name with `designation: undefined` on every one of
  // them, so the OLD `list.length === 0` guard did not fire and this function
  // fell through to the loop, matched nothing, and returned the AUTHORITATIVE
  // `{ errorRoles: [] }` -- silently suppressing the label-guess fallback for
  // an R/dR-shaped book that never had a chance to be designated at all.
  it("returns null (not the authoritative empty-array marker) when column_designations is empty but origin_column_names is populated -- a sheet-2+ pseudo-book", () => {
    const roles = originBookErrorRoles({
      metadata: {
        origin_book: "Book1@2",
        origin_column_names: ["B", "C"],
        column_designations: {},
      },
    });
    expect(roles).toBeNull();
  });

  // O1 (round 5): the distinguishable-empty-array marker is not nullish, so
  // it must never trip a `??` fallback anywhere it flows.
  it("O1: `{ errorRoles: [] }` is not nullish -- a `?? inferErrorBindings(...)` reader never falls back on it", () => {
    const roles = originBookErrorRoles(meta("Y", "Y", "Y"));
    expect(roles?.errorRoles ?? "FELL BACK").toEqual([]);
  });

  // Round 7 (adversarial review, item 5): a multi-X (Moke-style) book stores
  // several hysteresis loops as X,Y,X,Y -- `lib/errorbars.ts`'s
  // `originHiddenChannels` doc names this exact shape. Only the FIRST X
  // survives as `.time`; every later "X" designation is a genuine SECOND
  // loop's own axis column, present in `.values` as an ordinary (hidden)
  // channel. An "X-error" that comes AFTER that secondary "X" is that
  // second loop's own x uncertainty -- not the shared plot axis's -- and
  // every render consumer (`buildErrorSpans`, `plotDecimate`'s eligibility
  // check) treats ANY `axis: "x"` binding as applying to the ONE shared
  // axis regardless of `target`, so there is no way to attach it correctly
  // to just that loop. Binding it to `target: -1` anyway would draw the
  // wrong loop's error magnitude on every plotted series' abscissa -- worse
  // than leaving it unbound.
  it("Round 7 item 5: an X-error AFTER a secondary X (multi-loop Moke shape) is left unbound, not misattributed to the shared axis", () => {
    const roles = originBookErrorRoles({
      metadata: {
        origin_book: "Moke",
        // B: loop 1's Y; C: loop 1's Y-error (correctly binds to B).
        // D: loop 2's OWN X column (secondary X, not the plot's shared axis).
        // E: loop 2's Y; F: loop 2's OWN X-error -- must NOT bind to -1.
        origin_column_names: ["B", "C", "D", "E", "F"],
        column_designations: {
          A: "X",
          B: "Y",
          C: "Y-error",
          D: "X",
          E: "Y",
          F: "X-error",
        },
      },
    });
    expect(roles?.errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });

  // Control: an X-error that precedes any secondary "X" is unambiguous --
  // nothing else has claimed to be an X yet -- and keeps binding to the
  // shared axis exactly as before (same case the earlier "binds an X-error
  // designation to the dataset's x axis" test covers with the 3-column
  // helper; restated here alongside its Round 7 counterpart for contrast).
  it("Round 7 item 5, control: an X-error with NO secondary X ahead of it still binds to the shared axis", () => {
    const roles = originBookErrorRoles({
      metadata: {
        origin_book: "SingleX",
        origin_column_names: ["B", "C", "D"],
        column_designations: { A: "X", B: "X-error", C: "Y", D: "Y" },
      },
    });
    expect(roles?.errorRoles).toEqual([{ channel: 0, target: -1, axis: "x", side: "both" }]);
  });
});
