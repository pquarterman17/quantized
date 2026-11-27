// The pure half of a subset's source-row link (lib/sourceRowLink.ts) and the slicing rule that carries it with its rows.
import { describe, expect, it } from "vitest";

import { fitRowIdentities, installRowIdentities } from "./fitRowIdentity";
import { FIT_ROW_IDENTITIES, SOURCE_ROWS_KEY, sliceRowSidecars } from "./rowSidecars";
import { withoutRowSidecars } from "./rowSidecarsConcat";
import { goToSourceStatus, planSourceLink, readSourceRowLink, resolveSourceRows, sourceLinkId, stampSourceLink } from "./sourceRowLink";
import type { Dataset } from "./types";

const sheet = (n: number, metadata: Record<string, unknown> = {}): Dataset => ({
  id: "src", name: "run", data: { time: Array.from({ length: n }, (_, i) => i), values: Array.from({ length: n }, () => [0]), labels: ["y"], units: [""], metadata },
});

describe("installRowIdentities", () => {
  it("adds identities without disturbing the ones other rows already hold, and mints distinct random tokens", () => {
    const first = installRowIdentities({}, 6, [1, 3])!;
    const second = installRowIdentities(first.metadata, 6, [3, 5])!;
    expect(second.ids.get(3)).toBe(first.ids.get(3));
    const all = fitRowIdentities(second.metadata, 6)!;
    expect([...all.keys()]).toEqual([1, 3, 5]);
    expect(all.get(1)).toBe(first.ids.get(1)); // row 1 was not asked for again and keeps its token
    expect(new Set(all.values()).size).toBe(3);
    for (const id of all.values()) expect(id).toMatch(/^r1:[0-9a-z]{6,8}$/);
  });

  it("returns the same metadata when nothing is new, and null for a row outside the sheet", () => {
    const first = installRowIdentities({}, 4, [2])!;
    expect(installRowIdentities(first.metadata, 4, [2])!.metadata).toBe(first.metadata);
    expect(installRowIdentities({}, 4, [4])).toBeNull();
    expect(installRowIdentities({}, 4, [-1])).toBeNull();
  });
});

describe("readSourceRowLink", () => {
  const good = { source: "src", rows: { 0: "r1:abc", 1: "r1:def" } };
  it("reads a well-formed link and refuses anything else", () => {
    expect(readSourceRowLink({ [SOURCE_ROWS_KEY]: good })).toEqual({ source: "src", rows: { "0": "r1:abc", "1": "r1:def" } });
    for (const bad of [null, "x", [], { source: "", rows: { 0: "r1:a" } }, { source: "s", rows: [] }, { source: "s", rows: { 0: "nope" } }, { source: "s", rows: { x: "r1:a" } }, { source: "s", rows: {} }]) {
      expect(readSourceRowLink({ [SOURCE_ROWS_KEY]: bad })).toBeNull();
    }
    expect(sourceLinkId({ [SOURCE_ROWS_KEY]: good })).toBe("src");
    expect(sourceLinkId({})).toBeNull();
  });
});

describe("the link follows the child's rows", () => {
  const link = { source: "src", rows: { 0: "r1:a", 1: "r1:b", 3: "r1:d" } };
  it("slicing renumbers the kept links, drops the unlinked rows, and drops the key when none is left", () => {
    expect(sliceRowSidecars({ [SOURCE_ROWS_KEY]: link }, [3, 0, 2])[SOURCE_ROWS_KEY]).toEqual({ source: "src", rows: { 0: "r1:d", 1: "r1:a" } });
    expect(SOURCE_ROWS_KEY in sliceRowSidecars({ [SOURCE_ROWS_KEY]: link }, [2])).toBe(false);
    expect(SOURCE_ROWS_KEY in sliceRowSidecars({ [SOURCE_ROWS_KEY]: "junk" }, [0])).toBe(false);
  });
  it("a merge drops it (its rows have no single source)", () => {
    expect(SOURCE_ROWS_KEY in withoutRowSidecars({ [SOURCE_ROWS_KEY]: link })).toBe(false);
  });
});

describe("planSourceLink / resolveSourceRows", () => {
  it("links each child row to its source row's token, and resolves them after the source's rows moved", () => {
    const src = sheet(6);
    const plan = planSourceLink(src, [4, 1, 2]);
    if (plan.kind !== "linked") throw new Error("expected a link");
    expect(Object.keys(plan.link.rows)).toEqual(["0", "1", "2"]);
    const installed = { ...src, data: { ...src.data, metadata: plan.sourceMetadata } };
    expect(resolveSourceRows(plan.link, installed)).toEqual({ rows: [1, 2, 4], linked: 3, missing: 0 });
    // The source's rows 0-1 are deleted: identities slice with the rows (sliceRowSidecars is the real remap).
    const kept = [2, 3, 4, 5];
    const moved = { ...installed, data: { ...installed.data, time: kept, values: kept.map(() => [0]), metadata: sliceRowSidecars(installed.data.metadata, kept) } };
    expect(resolveSourceRows(plan.link, moved)).toEqual({ rows: [0, 2], linked: 3, missing: 1 }); // old 2 -> 0, old 4 -> 2, old 1 gone
  });

  it("unlinks above the cap and for a row outside the source", () => {
    expect(planSourceLink(sheet(3), [0, 7])).toMatchObject({ kind: "unlinked" });
    expect(planSourceLink(sheet(3), Array.from({ length: 100_001 }, (_, i) => i))).toEqual({ kind: "unlinked", reason: "row link not kept: more than 100,000 rows" });
  });

  it("stampSourceLink writes the key, and is the same object without a link", () => {
    const data = sheet(2).data;
    expect(stampSourceLink(data, null)).toBe(data);
    expect(stampSourceLink(data, { source: "s", rows: { 0: "r1:a" } }).metadata[SOURCE_ROWS_KEY]).toEqual({ source: "s", rows: { 0: "r1:a" } });
    expect(FIT_ROW_IDENTITIES in data.metadata).toBe(false);
  });

  it("the status names the rows that no longer exist", () => {
    expect(goToSourceStatus({ rows: [1], linked: 3, missing: 2 }, "run").text).toBe("selected 1 row of “run”; 2 of 3 rows no longer exist in the source");
    expect(goToSourceStatus({ rows: [], linked: 1, missing: 1 }, "run")).toMatchObject({ tone: "danger" });
  });
});
