// Item 22: "Curves per step" in the Graph browser, through the real panel and store.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { visibleCurves } from "../../../lib/browseGraph";
import type { Dataset } from "../../../lib/types";
import { useBrowseSettings } from "../../../store/browseSettings";
import { useApp } from "../../../store/useApp";
import GraphBrowserPanel from "./GraphBrowserPanel";

const labels = ["A", "B", "C", "D", "E", "F"];
const sheet: Dataset = { id: "a", name: "Sa", data: { time: [0, 1], values: [labels.map((_, c) => c), labels.map((_, c) => 10 + c)], labels, units: labels.map(() => ""), metadata: {} } };

beforeEach(() => {
  useApp.setState({
    datasets: [sheet], activeId: "a", selectedIds: [], history: [], future: [], xKey: null, yKeys: [0], y2Keys: null,
    hiddenChannels: [], seriesOrder: [], seriesStyles: {}, seriesLabels: {}, workbooks: [],
  });
  useBrowseSettings.setState({ perStep: 1, group: null });
});

describe("Curves per step", () => {
  it("defaults to 1, today's behaviour: one curve steps by one column", async () => {
    render(<GraphBrowserPanel />);
    expect((screen.getByLabelText("Curves per step") as HTMLInputElement).value).toBe("1");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Next column" })));
    expect(visibleCurves(useApp.getState())).toHaveLength(1);
    expect(useApp.getState().datasets.find((d) => d.linkedCurves)?.linkedCurves?.[0].yKey).toBe(1);
  });

  it("shows N curves together, steps by N, and says which columns are next", async () => {
    render(<GraphBrowserPanel />);
    fireEvent.change(screen.getByLabelText("Curves per step"), { target: { value: "3" } });
    expect(screen.getByText(/Columns 4 to 6 of 6 are next/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Next column" })));
    const g = useApp.getState().datasets.find((d) => d.linkedCurves)!;
    expect(g.linkedCurves!.map((c) => c.yKey)).toEqual([3, 4, 5]);
    expect(visibleCurves(useApp.getState())).toHaveLength(3);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Next column" }))); // wraps to the first three
    expect(useApp.getState().datasets.find((d) => d.linkedCurves)!.linkedCurves!.map((c) => c.yKey)).toEqual([0, 1, 2]);
  });

  it("clamps a nonsense value to a whole number of at least 1", () => {
    render(<GraphBrowserPanel />);
    fireEvent.change(screen.getByLabelText("Curves per step"), { target: { value: "0" } });
    expect(useBrowseSettings.getState().perStep).toBe(1);
    fireEvent.change(screen.getByLabelText("Curves per step"), { target: { value: "2.6" } });
    expect(useBrowseSettings.getState().perStep).toBe(3);
  });
});
