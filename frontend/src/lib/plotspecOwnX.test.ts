// The X well's "dataset's own X" pick: the spec model's reserved negative
// channel (`OWN_X_CHANNEL`) must reach every renderer as the SAME null xKey an
// empty X well already sends — never as a column index (`row[-1]` is an
// all-empty X, and the backend would read x_key -1 as the LAST channel).

import { describe, expect, it } from "vitest";

import { encodedFigureSpec } from "./plotEncodingExport";
import { encodeSpec, encodedSpecRender } from "./plotEncoding";
import { plotSpecToFigureDoc, plotSpecToFigureDocument } from "./plotSpecFigure";
import {
  deserializePlotSpec,
  serializePlotSpec,
  specToRender,
  type ChannelRef,
  type PlotSpec,
} from "./plotspec";
import { OWN_X_CHANNEL, specGroupCol, specXKey } from "./plotspecGroupCol";
import type { DataStruct, Dataset } from "./types";

// ch0 a continuous y, ch1 a 2-level nominal column (12 rows → inferred nominal).
const DATA: DataStruct = {
  time: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],
  values: [
    [1, 0], [2, 1], [3, 0], [4, 1], [5, 0], [6, 1],
    [7, 0], [8, 1], [9, 0], [10, 1], [11, 0], [12, 1],
  ],
  labels: ["m", "sample"],
  units: ["emu", ""],
  metadata: { x_column_name: "Field", x_column_unit: "Oe" },
};
const DS: Dataset = { id: "d1", name: "loop.dat", data: DATA };
const r = (channel: number): ChannelRef => ({ datasetId: "d1", channel });
const ownX = r(OWN_X_CHANNEL);

function spec(zones: Partial<PlotSpec["zones"]>, mark: PlotSpec["mark"] = "line"): PlotSpec {
  return { version: 1, zones: { x: ownX, y: [r(0)], group: null, facet: null, yErr: [], xErr: null, ...zones }, mark };
}
const emptyX = (s: PlotSpec): PlotSpec => ({ ...s, zones: { ...s.zones, x: null } });

describe("specXKey — the one own-X mapping", () => {
  it("maps the reserved channel and an empty well to null; a value column passes through", () => {
    expect(OWN_X_CHANNEL).toBeLessThan(0);
    expect(specXKey(spec({}))).toBeNull();
    expect(specXKey(emptyX(spec({})))).toBeNull();
    expect(specXKey(spec({ x: r(1) }))).toBe(1);
  });

  it("own X is never a categorical group axis", () => {
    expect(specGroupCol(spec({}, "box"), DS)).toBeNull();
    expect(specGroupCol(spec({ x: r(1) }, "box"), DS)).toBe(1);
  });
});

describe("specToRender — own X plots against the dataset's X", () => {
  it("renders exactly what an empty X well renders", () => {
    const render = specToRender(spec({}), [DS]);
    expect(render.kind).toBe("xy");
    if (render.kind !== "xy") return;
    expect(render.payload.data[0]).toEqual(DATA.time);
    expect(render.payload.xLabel).toBe("Field");
    expect(render.payload.xUnit).toBe("Oe");
    expect(render).toEqual(specToRender(emptyX(spec({})), [DS]));
  });

  it("keeps the dataset's X under a group split too", () => {
    const render = specToRender(spec({ group: r(1) }), [DS]);
    expect(render.kind === "xy" && render.payload.data[0]).toEqual(DATA.time);
  });
});

describe("encodeSpec / encoded export — own X", () => {
  const encoded = spec({ color: r(1) });

  it("the encoded payload's X is the dataset's X and its xKey is null", () => {
    const e = encodeSpec(encoded, [DS]);
    expect(e?.xKey).toBeNull();
    expect(e?.payload.data[0]).toEqual(DATA.time);
    const { render } = encodedSpecRender(encoded, [DS]);
    expect(render.kind === "xy" && render.payload.data[0]).toEqual(DATA.time);
  });

  it("the export request omits x_key, as an empty X well's does", () => {
    const opts = { fmt: "svg", style: "default", dpi: 300, title: "" } as const;
    const wire = encodedFigureSpec(encodeSpec(encoded, [DS])!, encoded, "loop", opts);
    expect(wire).not.toHaveProperty("x_key");
    const empty = emptyX(encoded);
    expect(wire).toEqual(encodedFigureSpec(encodeSpec(empty, [DS])!, empty, "loop", opts));
  });
});

describe("Publication Preview — own X", () => {
  it("the FigureDoc and its promoted draft bind xKey null", () => {
    expect(plotSpecToFigureDoc(spec({}), "g", {})?.config.xKey).toBeNull();
    expect(plotSpecToFigureDocument(spec({}), "g", {}, null)?.bindings.xKey).toBeNull();
    const encoded = spec({ color: r(1) });
    const draft = plotSpecToFigureDocument(encoded, "g", {}, encodeSpec(encoded, [DS]));
    expect(draft?.bindings.xKey).toBeNull();
  });
});

describe("saved-spec round trip — own X", () => {
  it("survives serialize → deserialize and still renders against the dataset's X", () => {
    const back = deserializePlotSpec(serializePlotSpec(spec({})));
    expect(back?.zones.x).toEqual(ownX);
    const render = specToRender(back!, [DS]);
    expect(render.kind === "xy" && render.payload.data[0]).toEqual(DATA.time);
  });
});
