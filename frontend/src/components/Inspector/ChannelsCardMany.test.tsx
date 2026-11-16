// UX-D: a many-column file (a 38-column MPMS export) gets a searchable,
// one-line-per-channel Channels card instead of a wall of dropdowns.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import ChannelsCard from "./ChannelsCard";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

const labels = [
  "Moment", "Field A", "Field B", "Temp A", "Temp B",
  ...Array.from({ length: 20 }, (_, i) => `Status ${i}`),
  "Motor Current", "Chamber", "Evercool", "Range", "Phase", "Err", "Aux1", "Aux2",
];
const rows = 3;
const dataset: Dataset = {
  id: "d1",
  name: "mpms",
  data: {
    time: [0, 1, 2],
    values: Array.from({ length: rows }, (_, r) => labels.map((_, c) => r + c)),
    labels,
    units: labels.map(() => ""),
    metadata: {},
  },
};

beforeEach(() => {
  useApp.setState({ xKey: null, yKeys: [0, 1, 2, 3, 4], y2Keys: null, errKeys: {}, history: [] });
});

describe("ChannelsCard with many columns", () => {
  it("filters rows by name and keeps per-row dropdowns behind a disclosure", () => {
    const { container } = render(<ChannelsCard active={dataset} />);
    expect(container.querySelectorAll(".qzk-channel-row")).toHaveLength(labels.length);
    expect(screen.queryByLabelText("Field A modeling type")).toBeNull();

    fireEvent.change(screen.getByLabelText("Filter channels"), { target: { value: "field" } });
    const shown = Array.from(container.querySelectorAll(".qzk-channel-row .qz-check")).map((el) => el.textContent);
    expect(shown).toEqual(["Field A", "Field B"]);

    fireEvent.click(screen.getByLabelText("Field A more options"));
    expect(screen.getByLabelText("Field A modeling type")).toBeInTheDocument();
    expect(screen.getByLabelText("Field A Y axis")).toBeInTheDocument();
  });

  it("Select all / none act on the filtered rows and never empty the plot", () => {
    render(<ChannelsCard active={dataset} />);
    fireEvent.change(screen.getByLabelText("Filter channels"), { target: { value: "status" } });
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(useApp.getState().yKeys).toEqual([0, 1, 2, 3, 4, ...Array.from({ length: 20 }, (_, i) => 5 + i)]);
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(useApp.getState().yKeys).toEqual([0, 1, 2, 3, 4]);
    fireEvent.change(screen.getByLabelText("Filter channels"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(useApp.getState().yKeys).toEqual([0]);
  });
});
