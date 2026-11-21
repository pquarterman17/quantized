import { describe, expect, it } from "vitest";
import { curveDisplayName, curveLegendLabel, undedupedLabel } from "./originCurveText";
import type { Dataset } from "./types";

describe("undedupedLabel", () => {
  // XMCD.opj's Signaltonois book: two columns long-named "Co" import as "Co" / "Co (2)".
  const labels = ["Mn L3", "Co", "Fe", "Mn", "Co (2)", "Fe (2)", "Run", "Run (2)"];
  // Origin's own names: the "(2)" of Co/Fe is quantized's dedupe; "Run (2)" is a genuine long name.
  const raw = ["Mn L3", "Co", "Fe", "Mn", "Co", "Fe", "Run", "Run (2)"];
  it("strips only the suffix quantized's dedupe added, as Origin's legend shows the column name", () => {
    expect(undedupedLabel(labels, 4, raw)).toBe("Co");
    expect(undedupedLabel(labels, 5, raw)).toBe("Fe");
  });
  it("keeps a genuine Origin name containing (2), even after a column named the bare name", () => {
    expect(undedupedLabel(labels, 7, raw)).toBe("Run (2)");
    expect(undedupedLabel(labels, 1, raw)).toBe("Co");
  });
  it("strips nothing without the raw-name record (never guess)", () => {
    expect(undedupedLabel(labels, 4)).toBe("Co (2)");
    expect(undedupedLabel(labels, 7)).toBe("Run (2)");
  });
  it("gives a bound curve its caption, else its undeduped name, else nothing", () => {
    expect(curveLegendLabel("\\l(1) %(1)", ["Mn"], labels, 4, raw)).toBe("Mn");
    expect(curveLegendLabel(undefined, [], labels, 4, raw)).toBe("Co");
    expect(curveLegendLabel(undefined, [], labels, 1, raw)).toBeUndefined(); // already its own name
    expect(curveLegendLabel("%(7,@LG)", [], labels, 4, raw)).toBe("Co"); // unresolvable code: no caption
  });
  it("leaves a genuine (2) legend label alone", () => {
    expect(curveLegendLabel(undefined, [], labels, 7, raw)).toBeUndefined();
  });
  it("feeds the %(n) display name, a Comment still winning", () => {
    const ds = { data: { labels, metadata: { origin_column_labels: raw, column_comments: { F: "Fe comment" } } } } as unknown as Dataset;
    expect(curveDisplayName(ds, "E", 4)).toBe("Co");
    expect(curveDisplayName(ds, "F", 5)).toBe("Fe comment");
  });
});
