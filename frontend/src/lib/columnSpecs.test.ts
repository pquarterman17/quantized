// Column spec limits and tags (GAP_AUDIT_9 G27): cleaning, the fill-blanks
// rule (typed always wins), and the project save/load round trip (an old
// project without the fields loads unchanged).

import { describe, expect, it } from "vitest";

import { patchColumnProps, sanitizeColumnProps } from "./columnProps";
import { cleanSpec, cleanTags, fillBlankSpec } from "./columnSpecs";
import type { Dataset } from "./types";
import { parseWorkspace } from "./workspace";
import { serializeWorkspace } from "./workspaceSerialize";

describe("spec limits and tags", () => {
  it("drops non-finite limits and de-duplicates tags", () => {
    expect(cleanSpec({ lsl: 1, usl: Number.NaN, target: "x" })).toEqual({ lsl: 1 });
    expect(cleanSpec({})).toBeUndefined();
    expect(cleanTags(" a, B ,a,, b ")).toEqual(["a", "B"]);
    expect(cleanTags([])).toBeUndefined();
  });

  it("an emptied spec / tag list removes the field, then the entry", () => {
    const p = patchColumnProps(undefined, 0, { spec: { lsl: 1 }, tags: ["x"] });
    expect(p).toEqual({ 0: { spec: { lsl: 1 }, tags: ["x"] } });
    expect(patchColumnProps(p, 0, { spec: undefined, tags: [] })).toBeUndefined();
  });

  it("fillBlankSpec fills only blanks; a typed value wins", () => {
    const r = fillBlankSpec({ lsl: 5, usl: null, target: null }, { lsl: 1, usl: 9, target: 4 });
    expect(r.params).toEqual({ lsl: 5, usl: 9, target: 4 });
    expect(r.filled).toEqual(["USL", "Target"]);
    expect(fillBlankSpec({ lsl: null, usl: null, target: null }, undefined).filled).toEqual([]);
  });

  it("sanitizes a loaded project's fields", () => {
    expect(sanitizeColumnProps({ 0: { spec: { lsl: 1, usl: "no" }, tags: ["a", 3] }, 7: { tags: ["x"] } }, 2)).toEqual({
      0: { spec: { lsl: 1 }, tags: ["a"] },
    });
  });

  it("round-trips through save / load; an old project loads unchanged", () => {
    const ds: Dataset = {
      id: "d", name: "n",
      data: { time: [1], values: [[1, 2]], labels: ["A", "B"], units: ["", ""], metadata: {} },
      columnProps: { 1: { comment: "c", spec: { lsl: 1, usl: 3, target: 2 }, tags: ["sheet", "xrd"] } },
    };
    const back = parseWorkspace(serializeWorkspace({ datasets: [ds] })).datasets[0];
    expect(back.columnProps).toEqual(ds.columnProps);
    const old = { ...ds, columnProps: { 1: { comment: "c" } } };
    expect(parseWorkspace(serializeWorkspace({ datasets: [old] })).datasets[0].columnProps).toEqual({ 1: { comment: "c" } });
  });
});
