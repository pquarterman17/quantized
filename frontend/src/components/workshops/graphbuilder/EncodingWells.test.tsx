// P1.4 Graph Builder encoding pickers (EncodingWells): real ZoneWells over a
// stub builder state, so the test reads exactly what a user can pick. The
// rules behind `encodingOptions` are pinned in useGraphBuilder.test.ts and
// encodingWellModel.test.ts; this pins that each picker OFFERS its own
// options and each pick is routed to its own zone.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { emptySpec, type PlotSpec, type ZoneName } from "../../../lib/plotspec";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import EncodingWells from "./EncodingWells";
import type { GraphBuilderState } from "./useGraphBuilder";
import type { WellChip } from "./ZoneWell";

const OPTIONS = [
  { index: 0, label: "Rxy" },
  { index: 1, label: "sample" },
  { index: 2, label: "field" },
  { index: 3, label: "T" },
];

// ch1 lot and ch2 field are categorical; ch0 Rxy the value.
const DS: Dataset = {
  id: "d1",
  name: "d1.csv",
  data: {
    time: [0, 1, 2, 3], values: [[1, 0, 0, 5], [2, 0, 1, 5], [3, 1, 0, 6], [4, 1, 1, 6]],
    labels: ["Rxy", "sample", "field", "T"], units: ["", "", "", ""], metadata: {},
    cat_levels: { 1: ["S1", "S2"], 2: ["F1", "F2"] },
  },
};
const ref = (channel: number) => ({ datasetId: "d1", channel });

function stub(over: Partial<GraphBuilderState> = {}, chips: Partial<Record<ZoneName, WellChip[]>> = {}) {
  return {
    datasetId: "d1",
    options: OPTIONS,
    encodingOptions: { color: OPTIONS, symbol: [OPTIONS[1], OPTIONS[2]], label: OPTIONS },
    chips: (zone: ZoneName) => chips[zone] ?? [],
    assign: vi.fn(),
    remove: vi.fn(),
    encoded: null,
    spec: emptySpec(),
    ...over,
  } as unknown as GraphBuilderState;
}

const optionLabels = (select: HTMLElement): string[] =>
  within(select)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");

describe("EncodingWells", () => {
  it("Symbol offers only the categorical factors; Color and Label offer every column", () => {
    render(<EncodingWells g={stub()} />);
    const factorList = ["+ assign channel…", "sample", "field"];
    expect(optionLabels(screen.getByLabelText("Assign a channel to Color"))).toEqual(["+ assign channel…", "Rxy", "sample", "field", "T"]);
    expect(optionLabels(screen.getByLabelText("Assign a channel to Symbol"))).toEqual(factorList);
    expect(optionLabels(screen.getByLabelText("Assign a channel to Label"))).toEqual([
      "+ assign channel…",
      "Rxy",
      "sample",
      "field",
      "T",
    ]);
  });

  it("routes each pick to its own zone", () => {
    const g = stub();
    render(<EncodingWells g={g} />);
    fireEvent.change(screen.getByLabelText("Assign a channel to Color"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Assign a channel to Symbol"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Assign a channel to Label"), { target: { value: "3" } });
    expect(vi.mocked(g.assign).mock.calls).toEqual([
      ["color", 1],
      ["symbol", 2],
      ["label", 3],
    ]);
  });

  it("an assigned encoding shows as a removable chip, and removing it clears that zone", () => {
    const g = stub({}, { color: [{ channel: 1, label: "sample" }] });
    render(<EncodingWells g={g} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove sample" }));
    expect(g.remove).toHaveBeenCalledWith("color", 1);
  });

  it("a live encoding needs no note, faceted too (residual 3); a faceted gradient says why it is ignored", () => {
    useApp.setState({ datasets: [DS] });
    const xy = (zones: Partial<PlotSpec["zones"]>): PlotSpec => ({
      version: 1,
      zones: { x: ref(3), y: [ref(0)], group: null, facet: ref(1), yErr: [], xErr: null, ...zones },
      mark: "scatter",
    });
    const live = stub({ spec: xy({ symbol: ref(2) }) }, { symbol: [{ channel: 2, label: "field" }], facet: [{ channel: 1, label: "sample" }] });
    const { rerender } = render(<EncodingWells g={live} />);
    expect(screen.queryByRole("note")).toBeNull();
    rerender(<EncodingWells g={stub({ spec: xy({ color: ref(0) }) }, { color: [{ channel: 0, label: "Rxy (ignored)" }] })} />);
    expect(screen.getByRole("note")).toHaveTextContent("A gradient colours single points, so it does not apply while faceted.");
  });

  it("shows no note while nothing is assigned", () => {
    render(<EncodingWells g={stub()} />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("box/violin/bar show the wells; a pick their mark cannot draw says why, in one sentence, and can be removed", () => {
    useApp.setState({ datasets: [DS] });
    const box = (zones: Partial<PlotSpec["zones"]>): PlotSpec => ({
      version: 1,
      zones: { x: ref(1), y: [ref(0)], group: null, facet: null, yErr: [], xErr: null, ...zones },
      mark: "box",
    });
    const { rerender } = render(<EncodingWells g={stub({ family: "categorical", spec: box({}) })} />);
    expect(screen.getByLabelText("Assign a channel to Color")).toBeTruthy();
    // Color on a categorical column applies (the preview and the Stat Stage draw it): no note.
    rerender(<EncodingWells g={stub({ family: "categorical", spec: box({ color: ref(2) }) }, { color: [{ channel: 2, label: "field" }] })} />);
    expect(screen.queryByRole("note")).toBeNull();
    const g = stub({ family: "categorical", spec: box({ symbol: ref(2) }) }, { symbol: [{ channel: 2, label: "field (ignored)" }] });
    rerender(<EncodingWells g={g} />);
    expect(screen.getByRole("note")).toHaveTextContent(
      "Box, violin and bar draw no per-series marker, so Symbol does not apply.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove field (ignored)" }));
    expect(g.remove).toHaveBeenCalledWith("symbol", 2);
  });
});
