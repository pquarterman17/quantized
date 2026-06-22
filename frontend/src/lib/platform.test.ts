import { describe, expect, it } from "vitest";

import { fuzzy } from "./fuzzy";
import { coerceParams, type ParamField } from "./params";
import { mergeCommands, type Action } from "../store/commands";

describe("fuzzy", () => {
  it("returns null when not a subsequence", () => {
    expect(fuzzy("xyz", "gaussian")).toBeNull();
  });
  it("matches a subsequence and reports hit indices", () => {
    const r = fuzzy("gs", "gaussian");
    expect(r).not.toBeNull();
    expect(r!.hits[0]).toBe(0);
  });
  it("ranks a word-start match above a mid-word one", () => {
    const start = fuzzy("f", "fit data")!.score;
    const mid = fuzzy("f", "add demo")!; // no 'f' → null guard
    expect(mid).toBeNull();
    expect(start).toBeGreaterThan(0);
  });
  it("empty needle scores zero with no hits", () => {
    expect(fuzzy("", "anything")).toEqual({ score: 0, hits: [] });
  });
});

describe("coerceParams", () => {
  const fields: ParamField[] = [
    { key: "n", label: "N", type: "number", default: 5 },
    { key: "name", label: "Name", type: "text", default: "x" },
  ];
  it("coerces numeric strings to numbers", () => {
    expect(coerceParams({ n: "12", name: "abc" }, fields)).toEqual({ n: 12, name: "abc" });
  });
  it("preserves a valid typed 0 (not falsy-replaced)", () => {
    expect(coerceParams({ n: "0", name: "x" }, fields).n).toBe(0);
  });
  it("falls back to default for a non-finite entry", () => {
    expect(coerceParams({ n: "abc", name: "x" }, fields).n).toBe(5);
  });
});

describe("mergeCommands", () => {
  const a = (id: string, label: string): Action => ({ id, group: "g", label, run: () => {} });
  it("drops menu commands duplicating a curated label (curated wins)", () => {
    const merged = mergeCommands([a("c1", "Toggle theme")], [a("m1", "toggle theme"), a("m2", "Other")]);
    expect(merged.map((x) => x.id)).toEqual(["c1", "m2"]);
  });
});
