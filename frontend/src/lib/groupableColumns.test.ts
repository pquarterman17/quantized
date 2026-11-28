import { describe, expect, it } from "vitest";

import { TEXT_GROUP_DS } from "../components/workshops/textGroupFixture";
import { analysisData } from "./rowstate";
import { textGroupColumns, withTextGroupChannels, withTextGroupData } from "./groupableColumns";

describe("withTextGroupChannels", () => {
  it("appends each groupable text column after the real channels, codes in first-appearance order", () => {
    const g = withTextGroupChannels(TEXT_GROUP_DS);
    expect(g.data.labels).toEqual(["val", "id", "grp", "sub"]);
    expect(g.data.cat_levels?.[2]).toEqual(["A", "B"]);
    expect(g.data.values.map((r) => r[2])).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
    expect(g.id).toBe(TEXT_GROUP_DS.id);
  });

  it("is idempotent and returns the same objects for the same input", () => {
    const g = withTextGroupChannels(TEXT_GROUP_DS);
    expect(withTextGroupChannels(TEXT_GROUP_DS)).toBe(g);
    expect(withTextGroupChannels(g)).toBe(g);
    expect(withTextGroupData(g.data)).toBe(g.data);
  });

  it("is the sheet itself when there is no text column to add", () => {
    const plain = { ...TEXT_GROUP_DS, data: { ...TEXT_GROUP_DS.data, metadata: {} } };
    expect(withTextGroupChannels(plain)).toBe(plain);
    expect(textGroupColumns(plain.data)).toEqual([]);
  });

  it("keeps the codes aligned with the rows of the analysis view (an excluded row)", () => {
    // Appended BEFORE the view is cut, so the codes follow their rows: with row 0 excluded, grp A has 5 rows.
    const g = { ...withTextGroupChannels(TEXT_GROUP_DS), excludedRows: [0] };
    const view = analysisData(g)!;
    expect(view.values.map((r) => r[2])).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
    // And cutting a view of the plain sheet, then appending, agrees (the sidecar is sliced with the rows).
    const cut = analysisData({ ...TEXT_GROUP_DS, excludedRows: [0] })!;
    expect(withTextGroupData(cut).values.map((r) => r[2])).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
  });
});
