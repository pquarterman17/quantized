// P1.4: the Graph Builder preview's legend for an encoded render. The canvas
// itself is eyeball-verified (see ./previewCanvas); this pins that the legend
// entries `lib/plotEncoding.encodeSpec` builds reach the screen through the
// existing read-only legend (SpatialPanelLegend -> LegendSample), one row per
// series with its level's glyph, and that an unencoded render shows none.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { encodedSpecRender } from "../../../lib/plotEncoding";
import type { PlotSpec } from "../../../lib/plotspec";
import type { Dataset } from "../../../lib/types";
import GraphPreview from "./GraphPreview";

const DS: Dataset = {
  id: "p",
  name: "p.csv",
  data: {
    time: [0, 1, 2, 3],
    values: [
      [1, 0, 5],
      [2, 1, 5],
      [3, 0, 9],
      [4, 1, 9],
    ],
    labels: ["y", "sample", "T"],
    units: ["V", "", "K"],
    metadata: {},
    cat_levels: { 1: ["S1", "S2"] },
  },
};
const ref = (channel: number) => ({ datasetId: "p", channel });
const base: PlotSpec = {
  version: 1,
  zones: { x: null, y: [ref(0)], group: null, facet: null, yErr: [], xErr: null },
  mark: "scatter",
};

describe("GraphPreview — encoded legend", () => {
  it("lists one legend row per encoded series, with the symbol level's glyph", () => {
    const spec: PlotSpec = { ...base, zones: { ...base.zones, symbol: ref(1), label: ref(1) } };
    const { render: r, encoded } = encodedSpecRender(spec, [DS]);
    const { container } = render(<GraphPreview render={r} encoded={encoded} />);
    const legend = screen.getByLabelText("Plot legend");
    expect(legend).toHaveTextContent("S1");
    expect(legend).toHaveTextContent("S2");
    const glyphs = [...container.querySelectorAll(".qzk-legend-sample")].map((el) => el.getAttribute("data-marker"));
    expect(glyphs).toEqual(["circle", "square"]);
  });

  it("a gradient Color-by shows the Stage legend's colour-scale chip with its range", () => {
    const withT: Dataset = { ...DS, channelTypes: { 2: "continuous" } };
    const spec: PlotSpec = { ...base, zones: { ...base.zones, color: ref(2) } };
    const { render: r, encoded } = encodedSpecRender(spec, [withT]);
    render(<GraphPreview render={r} encoded={encoded} />);
    const chip = screen.getByTitle("colour = T (K)");
    expect(chip).toHaveTextContent("5");
    expect(chip).toHaveTextContent("9");
  });

  it("a categorical Color-by shows no colour scale", () => {
    const spec: PlotSpec = { ...base, zones: { ...base.zones, color: ref(1) } };
    const { render: r, encoded } = encodedSpecRender(spec, [DS]);
    render(<GraphPreview render={r} encoded={encoded} />);
    expect(screen.queryByTitle(/^colour = /)).toBeNull();
  });

  it("an unencoded render (Group only) shows no legend, as before", () => {
    const spec: PlotSpec = { ...base, zones: { ...base.zones, group: ref(1) } };
    const { render: r, encoded } = encodedSpecRender(spec, [DS]);
    render(<GraphPreview render={r} encoded={encoded} />);
    expect(screen.queryByLabelText("Plot legend")).toBeNull();
  });
});
