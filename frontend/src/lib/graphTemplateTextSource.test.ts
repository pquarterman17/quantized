// Plan item 24: a graph template keeps a series' per-point text SOURCE, not only the literal `marker_text`.
// Letters, row numbers and a text column by NAME travel (the Publication preview's export styles and the in-app
// format both); a worksheet column INDEX is bound to one sheet's layout and does not.

import { describe, expect, it } from "vitest";

import { buildExportStyles } from "./exportStyles";
import { captureGraphFormat, graphFormatPatch, seriesStyleFromExport } from "./graphFormat";
import { defaultPlotView } from "./plotview";
import { sanitizeExportSeriesStyles } from "./publicationStyles";
import type { SeriesStyle } from "./types";

const FROM = ["letters", "rows", { name: "Tag" }] as const;

describe("a graph template carries the per-point text source", () => {
  it.each(FROM)("%j: style -> export style -> stored -> restored style", (from) => {
    const exported = buildExportStyles([3], { 3: { color: "#112233", markerTextFrom: from } }, [0], false, false);
    expect(exported?.[0]).toMatchObject({ marker_text_from: from });
    const stored = sanitizeExportSeriesStyles(JSON.parse(JSON.stringify(exported)));
    expect(stored?.[0]).toMatchObject({ marker_text_from: from });
    expect(seriesStyleFromExport(stored![0])).toMatchObject({ markerTextFrom: from });
  });

  it("an invalid stored source is dropped", () => {
    expect(sanitizeExportSeriesStyles([{ color: "#000000", marker_text_from: "bogus" }])?.[0]).toEqual({ color: "#000000" });
  });

  it("the in-app format keeps letters but not a column index", () => {
    const view = (markerTextFrom: SeriesStyle["markerTextFrom"]) => ({ ...defaultPlotView(), seriesStyles: { 3: { color: "#112233", markerTextFrom } } });
    expect(graphFormatPatch(captureGraphFormat(view("letters"), [3]), [0], {}).seriesStyles?.[0]).toEqual({ color: "#112233", markerTextFrom: "letters" });
    expect(graphFormatPatch(captureGraphFormat(view(2), [3]), [0], {}).seriesStyles?.[0]).toEqual({ color: "#112233" });
  });
});
