// `toWireSeriesStyles` rule 3: a marker with no size is sent at the canvas'
// `DEFAULT_MARKER_PX`, never left to the style preset's size. The end-to-end
// screen == export pin is `defaultTraceFixture.test.ts` (shared with the
// backend through `tests/fixtures/wire/default_trace.json`).

import { describe, expect, it } from "vitest";

import { buildExportStyles, toWireSeriesStyles } from "./exportStyles";
import { DEFAULT_MARKER_PX } from "./markers";
import type { ExportSeriesStyle } from "./publicationStyles";

describe("toWireSeriesStyles: a sizeless marker", () => {
  it("is named at the canvas' size, flat or grouped", () => {
    for (const grouped of [false, true]) {
      expect(toWireSeriesStyles([{ marker: true, width: 0 }], grouped)).toEqual([
        { marker: true, width: 0, marker_size: DEFAULT_MARKER_PX },
      ]);
    }
  });

  it("leaves an explicit size alone", () => {
    expect(toWireSeriesStyles([{ marker: true, marker_size: 9 }], false)).toEqual([{ marker: true, marker_size: 9 }]);
  });

  it("does so from a live Inspector style without storing it in the built array", () => {
    const built = buildExportStyles([0], { 0: { marker: true, markerShape: "square" } });
    expect(built[0]).not.toHaveProperty("marker_size");
    expect(toWireSeriesStyles(built, false)[0]).toMatchObject({ marker: true, marker_shape: "square", marker_size: 5 });
  });

  it("does not touch a colour-mapped entry, an unmarked one, or the caller's entry", () => {
    const mapped: ExportSeriesStyle = { marker: true, color_by: 2, colormap: "viridis" };
    const plain: ExportSeriesStyle = { width: 2 };
    const styles = [mapped, plain, null];
    expect(toWireSeriesStyles(styles, false)).toBe(styles);
    const entry: ExportSeriesStyle = { marker: true };
    toWireSeriesStyles([entry], false);
    expect(entry).toEqual({ marker: true });
  });
});
