// Plan item 24: a graph template keeps a series' per-point text SOURCE, not only the literal `marker_text`.
// Letters, row numbers and a text column by NAME travel in the export styles a template is saved from; a worksheet
// column INDEX is bound to one sheet's layout and does not.

import { describe, expect, it } from "vitest";

import { buildExportStyles } from "./exportStyles";
import { seriesStyleFromExport } from "./graphFormat";
import { textSourceOf } from "./markerTextRows";
import { sanitizeExportSeriesStyles } from "./publicationStyles";

const FROM = ["letters", "rows", { name: "Tag" }] as const;

describe("a graph template carries the per-point text source", () => {
  it.each(FROM)("%j: style -> export style -> stored -> restored style", (from) => {
    const exported = buildExportStyles([3], { 3: { color: "#112233", markerTextFrom: from } }, [0], false, false);
    expect(exported?.[0]).toMatchObject({ marker_text_from: from });
    const stored = sanitizeExportSeriesStyles(JSON.parse(JSON.stringify(exported)));
    expect(stored?.[0]).toMatchObject({ marker_text_from: from });
    expect(seriesStyleFromExport(stored![0])).toMatchObject({ markerTextFrom: from });
  });

  it("a column index is not exported to a template", () => {
    const exported = buildExportStyles([3], { 3: { color: "#112233", markerTextFrom: 2 } }, [0], false, false);
    expect(exported?.[0]).not.toHaveProperty("marker_text_from");
  });

  it("a stored source that is not a source draws no per-point text", () => {
    const restored = seriesStyleFromExport({ color: "#000000", marker_text_from: "bogus" } as never);
    expect(textSourceOf(restored ?? undefined)).toBeNull();
  });
});
