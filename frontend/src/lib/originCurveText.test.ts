import { describe, expect, it } from "vitest";
import { curveDisplayName, curveLegendLabel, undedupedLabel } from "./originCurveText";
import type { Dataset } from "./types";

describe("undedupedLabel", () => {
  // XMCD.opj's Signaltonois book: two columns long-named "Co" import as "Co" / "Co (2)".
  const labels = ["Mn L3", "Co", "Fe", "Mn", "Co (2)", "Fe (2)", "Run (2)"];
  it("strips a DataStruct dedupe suffix, as Origin's legend shows the column name", () => {
    expect(undedupedLabel(labels, 4)).toBe("Co");
    expect(undedupedLabel(labels, 5)).toBe("Fe");
  });
  it("keeps a name that merely ends in a number in brackets", () => {
    expect(undedupedLabel(labels, 6)).toBe("Run (2)");
    expect(undedupedLabel(["Co (2)", "Co"], 0)).toBe("Co (2)"); // no EARLIER bare name
    expect(undedupedLabel(labels, 1)).toBe("Co");
  });
  it("gives a bound curve its caption, else its undeduped name, else nothing", () => {
    expect(curveLegendLabel("\\l(1) %(1)", ["Mn"], labels, 4)).toBe("Mn");
    expect(curveLegendLabel(undefined, [], labels, 4)).toBe("Co");
    expect(curveLegendLabel(undefined, [], labels, 1)).toBeUndefined(); // already its own name
    expect(curveLegendLabel("%(7,@LG)", [], labels, 4)).toBe("Co"); // unresolvable code: no caption
  });
  it("feeds the %(n) display name, a Comment still winning", () => {
    const ds = { data: { labels, metadata: { column_comments: { F: "Fe comment" } } } } as unknown as Dataset;
    expect(curveDisplayName(ds, "E", 4)).toBe("Co");
    expect(curveDisplayName(ds, "F", 5)).toBe("Fe comment");
  });
});
