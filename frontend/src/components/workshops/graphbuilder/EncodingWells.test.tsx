// P1.4 Graph Builder encoding pickers (EncodingWells): real ZoneWells over a
// stub builder state, so the test reads exactly what a user can pick. The
// gating rule behind `factorOptions` is pinned in useGraphBuilder.test.ts and
// lib/plotEncoding.test.ts; this pins that the Color/Symbol pickers OFFER only
// those options, the Label picker offers every column, and each pick is
// routed to its own zone.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ZoneName } from "../../../lib/plotspec";
import EncodingWells from "./EncodingWells";
import type { GraphBuilderState } from "./useGraphBuilder";
import type { WellChip } from "./ZoneWell";

const OPTIONS = [
  { index: 0, label: "Rxy" },
  { index: 1, label: "sample" },
  { index: 2, label: "field" },
  { index: 3, label: "T" },
];

function stub(over: Partial<GraphBuilderState> = {}, chips: Partial<Record<ZoneName, WellChip[]>> = {}) {
  return {
    datasetId: "d1",
    options: OPTIONS,
    factorOptions: [OPTIONS[1], OPTIONS[2]],
    chips: (zone: ZoneName) => chips[zone] ?? [],
    assign: vi.fn(),
    remove: vi.fn(),
    encoded: null,
    ...over,
  } as unknown as GraphBuilderState;
}

const optionLabels = (select: HTMLElement): string[] =>
  within(select)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");

describe("EncodingWells", () => {
  it("Color and Symbol offer only the categorical factors; Label offers every column", () => {
    render(<EncodingWells g={stub()} />);
    const factorList = ["+ assign channel…", "sample", "field"];
    expect(optionLabels(screen.getByLabelText("Assign a channel to Color"))).toEqual(factorList);
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

  it("says where encodings render once one is live, and that a facet overrides them", () => {
    const live = stub({ encoded: {} as GraphBuilderState["encoded"] }, { symbol: [{ channel: 2, label: "field" }] });
    const { rerender } = render(<EncodingWells g={live} />);
    expect(screen.getByRole("note")).toHaveTextContent("the editable plot does not draw encodings yet");
    rerender(
      <EncodingWells
        g={stub({}, { symbol: [{ channel: 2, label: "field" }], facet: [{ channel: 1, label: "sample" }] })}
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent("Ignored while faceted");
  });

  it("shows no note while nothing is assigned", () => {
    render(<EncodingWells g={stub()} />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("hides for box/violin/bar until something is assigned, then stays — saying so — so it can be removed", () => {
    const { container, rerender } = render(<EncodingWells g={stub({ family: "categorical" })} />);
    expect(container).toBeEmptyDOMElement();
    const g = stub({ family: "categorical" }, { color: [{ channel: 1, label: "sample" }] });
    rerender(<EncodingWells g={g} />);
    expect(screen.getByRole("note")).toHaveTextContent("Box, violin and bar ignore encodings.");
    fireEvent.click(screen.getByRole("button", { name: "Remove sample" }));
    expect(g.remove).toHaveBeenCalledWith("color", 1);
  });
});
