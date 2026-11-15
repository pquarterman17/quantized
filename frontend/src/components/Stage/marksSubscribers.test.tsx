// Every renderer that builds a plot from series styles must learn when the lazy marks chunk
// arrives (a series that asks for a mark is hidden until then): through `useLazyPlotParts` /
// `plotDecorNeeds` (plot viewports, the multi-panel stage), or `useMarksVersion` (the inset, the
// colour-column memo) -- or be a render helper those call. This list is checked against the source
// so a new renderer cannot forget.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { marks } from "../../lib/marksLoader";
import { plotDecorNeeds, useLazyPlotParts } from "./useLazyPlotParts";

const SRC = join(__dirname, "..", "..");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** Files that call buildOpts, and why each is covered. */
const COVERED: Record<string, RegExp> = {
  "components/Stage/PlotViewport.tsx": /useLazyPlotParts/, // plotDecorNeeds(...) carries `marks`
  "components/Stage/useMultiPanelStage.ts": /plotDecorNeeds\([^\n]*Object\.values\(seriesStyles\)/, // the lazy epoch rebuilds every panel (stack mode has no flat payload: its styles come from the store)
  "components/Stage/InsetPlot.tsx": /useMarksVersion/,
};
/** Pure render helpers: only ever called from a covered file above, or without store styles. */
const HELPERS = new Set([
  "components/Stage/facetGridRender.ts", // strips the marks
  "components/Stage/stackPanelRender.ts", // called by useMultiPanelStage
  "components/Stage/breakPanelRender.ts", // strips the marks
  "components/workshops/reflview/ReflPanel.tsx", // own series, no marks
  "components/workshops/SmallUPlot.tsx",
  "components/workshops/waterfall/WaterfallView.tsx",
  "lib/uplotOpts.ts", // buildOpts itself
]);

describe("who learns that the marks chunk arrived", () => {
  const callers = walk(SRC)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test(kit)?\./.test(f))
    .filter((f) => /\bbuildOpts\(/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(SRC.length + 1).replaceAll("\\", "/"));

  it("every buildOpts caller is subscribed or a known helper", () => {
    const unknown = callers.filter((f) => !COVERED[f] && !HELPERS.has(f));
    expect(unknown, `new buildOpts caller(s) need a marks subscription: ${unknown.join(", ")}`).toEqual([]);
    for (const [file, re] of Object.entries(COVERED)) {
      expect(readFileSync(join(SRC, file), "utf8"), file).toMatch(re);
    }
  });

  it("both decimation gates (the server request and the client draw) consult blocksDecimation", () => {
    for (const f of ["components/Stage/usePlotPayload.ts", "components/Stage/PlotViewport.tsx"]) {
      expect(readFileSync(join(SRC, f), "utf8"), f).toMatch(/blocksDecimation\(/);
    }
  });

  it("the stack panels ride the multi-panel stage's lazy epoch", () => {
    expect(readFileSync(join(SRC, "components/Stage/useMultiPanelStage.ts"), "utf8")).toMatch(/useLazyPlotEpoch/);
  });
});

describe("useLazyPlotParts loads the marks chunk and asks for a rebuild", () => {
  it("plotDecorNeeds flags a series that uses a mark; the rebuild callback fires once it settles", async () => {
    const needs = plotDecorNeeds([], null, null, 0, [{ connect: "spline" }]);
    expect(needs.marks).toBe(true);
    expect(plotDecorNeeds([], null, null, 0, [{ color: "#f00" }]).marks).toBeUndefined();
    let ready = 0;
    renderHook(() => useLazyPlotParts([], "zoom", () => { ready++; }, needs));
    await vi.waitFor(() => expect(ready).toBeGreaterThan(0));
    expect(marks()).not.toBeNull();
  });
});
