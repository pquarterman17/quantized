import { describe, expect, it } from "vitest";

import type { RefLine } from "../../../lib/types";
import {
  appendRefLine,
  deriveRefLineRows,
  patchRefLineList,
  removeRefLineFromList,
} from "./canonicalRefLines";

const line = (id: string, axis: RefLine["axis"], value: number): RefLine => ({ id, axis, value });

describe("deriveRefLineRows", () => {
  it("numbers labels per AXIS, not per draw order", () => {
    const rows = deriveRefLineRows([
      line("a", "x", 1),
      line("b", "y", 2),
      line("c", "x", 3),
    ]);
    expect(rows.map((row) => row.label)).toEqual([
      "X reference 1",
      "Y reference 1",
      "X reference 2",
    ]);
  });

  it("keeps the draft's own array order and carries id + axis through", () => {
    expect(deriveRefLineRows([line("z", "y", 9), line("a", "x", 1)])).toEqual([
      { id: "z", axis: "y", label: "Y reference 1", short: "Y 1" },
      { id: "a", axis: "x", label: "X reference 1", short: "X 1" },
    ]);
  });

  it("pairs each accessible label with a compact visible one", () => {
    // The panel is ~210px wide: the full phrase wraps mid-label there, and
    // "reference" is already said by the group title above every row.
    expect(deriveRefLineRows([line("a", "x", 1), line("b", "x", 2)]).map((r) => r.short))
      .toEqual(["X 1", "X 2"]);
  });

  it("is empty for an empty draft", () => {
    expect(deriveRefLineRows([])).toEqual([]);
  });
});

describe("patchRefLineList", () => {
  it("merges into only the matching line", () => {
    const lines = [line("a", "x", 1), line("b", "y", 2)];
    expect(patchRefLineList(lines, "b", { value: 42 })).toEqual([
      { id: "a", axis: "x", value: 1 },
      { id: "b", axis: "y", value: 42 },
    ]);
  });

  it("returns every non-matching line by reference (no needless re-render churn)", () => {
    const untouched = line("a", "x", 1);
    const next = patchRefLineList([untouched, line("b", "y", 2)], "b", { value: 3 });
    expect(next[0]).toBe(untouched);
  });

  it("is a no-op for an unknown id", () => {
    const lines = [line("a", "x", 1)];
    expect(patchRefLineList(lines, "nope", { value: 99 })).toEqual(lines);
  });
});

describe("removeRefLineFromList", () => {
  it("drops only the matching line", () => {
    expect(removeRefLineFromList([line("a", "x", 1), line("b", "y", 2)], "a")).toEqual([
      { id: "b", axis: "y", value: 2 },
    ]);
  });

  it("is a no-op for an unknown id", () => {
    const lines = [line("a", "x", 1)];
    expect(removeRefLineFromList(lines, "nope")).toEqual(lines);
  });
});

describe("appendRefLine", () => {
  it("mints a draft-namespaced id that cannot collide with the store's ref- ids", () => {
    // The store's own counter is independent and unaware of a detached draft;
    // a shared prefix would let a later Stage "Add" re-mint an applied id.
    expect(appendRefLine([line("ref-1", "x", 0)], "y", 5)).toEqual([
      { id: "ref-1", axis: "x", value: 0 },
      { id: "pref-1", axis: "y", value: 5 },
    ]);
  });

  it("continues past the highest existing draft id, so remove-then-add never reuses one", () => {
    const after = removeRefLineFromList(
      appendRefLine(appendRefLine([], "x", 1), "x", 2),
      "pref-1",
    );
    expect(appendRefLine(after, "x", 3).map((l) => l.id)).toEqual(["pref-2", "pref-3"]);
  });

  it("ignores a malformed draft-prefixed id instead of producing NaN", () => {
    expect(appendRefLine([line("pref-oops", "x", 0)], "x", 1).at(-1)?.id).toBe("pref-1");
  });

  it("rejects a non-finite value rather than appending an unrenderable line", () => {
    // Inf/NaN render nowhere and serialize as `null` over the export wire.
    expect(appendRefLine([], "x", Number.NaN)).toEqual([]);
    expect(appendRefLine([], "x", Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it("does not mutate the input list", () => {
    const lines: RefLine[] = [line("a", "x", 1)];
    appendRefLine(lines, "y", 2);
    expect(lines).toHaveLength(1);
  });
});
