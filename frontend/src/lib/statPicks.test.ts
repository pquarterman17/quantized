// The X-as-group allowance (`withPickedXGroup`) that an Origin grouped /
// stacked column chart's saved pick relies on: off unless the pick names X,
// and the pick survives a save/reopen.
import { describe, expect, it } from "vitest";

import { sanitizeStatPicks } from "./plotviewSanitize";
import { resolveStatCols, statColRefs, withPickedXGroup } from "./statPicks";
import { maskStaleCategoricalPicks } from "./statstage";
import type { Dataset } from "./types";

const ds: Dataset = {
  id: "d1",
  name: "Book1",
  data: { time: [1, 2, 3], values: [[5, 1], [6, 2], [7, 3]], labels: ["Height", "Width"], units: ["", ""], metadata: {} },
} as unknown as Dataset;

describe("withPickedXGroup", () => {
  const cats = [{ index: 1, label: "Width" }];

  it("leaves the categorical list alone unless a saved pick groups by X", () => {
    expect(withPickedXGroup(cats, false)).toBe(cats);
    // without the allowance an X group is a stale pick and is masked, as before
    expect(maskStaleCategoricalPicks(-1, null, withPickedXGroup(cats, false)).groupCol).toBeNull();
  });

  it("offers X first while the pick names it, so the mask keeps it", () => {
    const list = withPickedXGroup(cats, true);
    expect(list.map((c) => c.index)).toEqual([-1, 1]);
    expect(maskStaleCategoricalPicks(-1, null, list).groupCol).toBe(-1);
  });

  it("an X group pick round-trips through save / reopen", () => {
    const cols = { group: -1, group2: null, value: 0, facet: null, color: null };
    const saved = { mode: "bar" as const, barStack: true, cols: statColRefs(ds, cols) };
    const reopened = sanitizeStatPicks(JSON.parse(JSON.stringify(saved)));
    expect(reopened).toEqual(saved);
    expect(reopened.cols?.group?.[0]).toBe(-1);
    expect(resolveStatCols(ds, reopened.cols)).toEqual(cols);
  });
});
