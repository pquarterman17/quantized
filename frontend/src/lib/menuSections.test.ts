import { describe, expect, it } from "vitest";

import { hasSections, withSectionHeaders } from "./menuSections";
import type { Action } from "../store/commands";

const act = (id: string, section?: string): Action => ({
  id,
  group: "Analyze",
  label: id,
  section,
  run: () => {},
});

/** Compact a row list to strings so the expected shape reads at a glance. */
const shape = (rows: ReturnType<typeof withSectionHeaders>) =>
  rows.map((r) => (r.kind === "header" ? `# ${r.label}` : r.action.id));

describe("withSectionHeaders", () => {
  it("renders a flat list unchanged when nothing declares a section", () => {
    expect(shape(withSectionHeaders([act("a"), act("b"), act("c")]))).toEqual(["a", "b", "c"]);
  });

  it("emits one header per section, in first-appearance order", () => {
    const rows = withSectionHeaders([act("a", "Fit"), act("b", "Stats"), act("c", "Fit")]);
    expect(shape(rows)).toEqual(["# Fit", "a", "c", "# Stats", "b"]);
  });

  it("gathers a section's items under ONE header even when declared apart", () => {
    // The reason this groups stably instead of by contiguous run: a
    // contiguous implementation emits a duplicate header the first time a
    // command is added in the "wrong" place.
    const rows = withSectionHeaders([
      act("a", "Fit"),
      act("b", "Stats"),
      act("c", "Fit"),
      act("d", "Stats"),
      act("e", "Fit"),
    ]);
    expect(shape(rows).filter((r) => r === "# Fit")).toHaveLength(1);
    expect(shape(rows)).toEqual(["# Fit", "a", "c", "e", "# Stats", "b", "d"]);
  });

  it("puts unsectioned items first, header-less, preserving their order", () => {
    const rows = withSectionHeaders([act("plain1"), act("s", "Fit"), act("plain2")]);
    expect(shape(rows)).toEqual(["plain1", "plain2", "# Fit", "s"]);
  });

  it("preserves item order within a section", () => {
    const rows = withSectionHeaders([act("z", "S"), act("y", "S"), act("x", "S")]);
    expect(shape(rows)).toEqual(["# S", "z", "y", "x"]);
  });

  it("never drops or duplicates an action", () => {
    const input = [act("a", "X"), act("b"), act("c", "Y"), act("d", "X")];
    const ids = shape(withSectionHeaders(input)).filter((r) => !r.startsWith("# "));
    expect(ids.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("handles an empty list", () => {
    expect(withSectionHeaders([])).toEqual([]);
  });
});

describe("hasSections", () => {
  it("is false for a flat list and true once anything declares one", () => {
    expect(hasSections([act("a"), act("b")])).toBe(false);
    expect(hasSections([act("a"), act("b", "Fit")])).toBe(true);
    expect(hasSections([])).toBe(false);
  });
});
