// The Inspector's per-series Y axis pick (gap audit 4 G11): Y1, Y2, every
// existing extra axis, and "+Y<next>" to make one -- one undo step each.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import ChannelsCard from "./ChannelsCard";
import { newExtraYAxis } from "../../lib/multiY";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

const dataset: Dataset = {
  id: "d1",
  name: "run",
  data: {
    time: [0, 1, 2],
    values: [[1, 10, 5], [2, 20, 6], [3, 30, 7]],
    labels: ["T", "R", "M"],
    units: ["K", "ohm", "emu"],
    metadata: {},
  },
};

beforeEach(() => {
  useApp.setState({ xKey: null, yKeys: null, y2Keys: null, yAxes: [], yAxisOf: {}, errKeys: {}, history: [], status: "" });
});

const pick = (name: string) => screen.getByRole("combobox", { name: `${name} Y axis` }) as HTMLSelectElement;

describe("ChannelsCard: Y axis per series", () => {
  it("offers Y1, Y2 and a new Y3, and +Y3 makes the axis", () => {
    render(<ChannelsCard active={dataset} />);
    expect([...pick("M").options].map((o) => o.text)).toEqual(["Y1", "Y2", "+Y3"]);
    fireEvent.change(pick("M"), { target: { value: "3" } });
    expect(useApp.getState().yAxisOf).toEqual({ 2: 3 });
    expect(useApp.getState().yAxes).toHaveLength(1);
    expect(pick("M").value).toBe("3");
    expect([...pick("R").options].map((o) => o.text)).toEqual(["Y1", "Y2", "Y3", "+Y4"]);
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("Y2 and back to Y1 go through the same pick", () => {
    render(<ChannelsCard active={dataset} />);
    fireEvent.change(pick("R"), { target: { value: "2" } });
    expect(useApp.getState().y2Keys).toEqual([1]);
    fireEvent.change(pick("R"), { target: { value: "1" } });
    expect(useApp.getState().y2Keys).toBeNull();
  });

  it("keeps one series on Y1 and says so", () => {
    useApp.setState({ yKeys: [0, 1], y2Keys: [1] });
    render(<ChannelsCard active={dataset} />);
    fireEvent.change(pick("T"), { target: { value: "3" } });
    expect(useApp.getState().yAxisOf).toEqual({});
    expect(useApp.getState().status).toBe("Keep at least one series on Y1");
  });

  it("an orphan assignment shows as Y1, where it draws", () => {
    useApp.setState({ yAxes: [newExtraYAxis()], yAxisOf: { 2: 5 } });
    render(<ChannelsCard active={dataset} />);
    expect(pick("M").value).toBe("1");
  });
});
