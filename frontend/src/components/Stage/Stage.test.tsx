// The Map tab is CONTEXTUAL (owner request 2026-07-25). A 1-D dataset can never
// produce a map, so a permanent Map tab was an invitation to a screen that only
// apologises.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Stage from "./Stage";
import { useApp } from "../../store/useApp";
import type { Dataset } from "../../lib/types";

// The stage hosts heavy canvas children; this file is about the TAB STRIP.
vi.mock("../windows/WindowCanvas", () => ({ default: () => <div>plot-canvas</div> }));
vi.mock("./MapStage", () => ({ default: () => <div>map-canvas</div> }));
vi.mock("./Worksheet", () => ({ default: () => <div>worksheet</div> }));
vi.mock("../windows/useWindowCommands", () => ({ useWindowCommands: () => {} }));
vi.mock("../history/useHistoryCommands", () => ({ useHistoryCommands: () => {} }));

const ds = (nChannels: number): Dataset => ({
  id: "d1",
  name: "d.dat",
  data: {
    time: [0, 1],
    values: [Array(nChannels).fill(1), Array(nChannels).fill(2)],
    labels: Array.from({ length: nChannels }, (_, i) => `c${i}`),
    units: Array(nChannels).fill(""),
    metadata: {},
  },
});

beforeEach(() => {
  useApp.setState({ datasets: [], activeId: null, stageTab: "plot" });
});

describe("Map tab visibility", () => {
  it("is hidden with no dataset at all", () => {
    render(<Stage />);
    expect(screen.queryByText("Map")).not.toBeInTheDocument();
    expect(screen.getByText("Plot")).toBeInTheDocument();
  });

  it("is hidden for an ordinary 1-D dataset (2 channels)", () => {
    useApp.setState({ datasets: [ds(2)], activeId: "d1" });
    render(<Stage />);
    expect(screen.queryByText("Map")).not.toBeInTheDocument();
  });

  it("APPEARS once the dataset has the three channels a map needs", () => {
    useApp.setState({ datasets: [ds(3)], activeId: "d1" });
    render(<Stage />);
    expect(screen.getByText("Map")).toBeInTheDocument();
  });

  it("Plot and Worksheet are always available", () => {
    useApp.setState({ datasets: [ds(2)], activeId: "d1" });
    render(<Stage />);
    expect(screen.getByText("Plot")).toBeInTheDocument();
    expect(screen.getByText("Worksheet")).toBeInTheDocument();
  });
});

describe("stranded-tab fallback", () => {
  // Map/Worksheet are dynamic imports (bundle-size headroom recovery) — even
  // with the module mocked, the first mount of either resolves through a
  // microtask, so these use findBy* (retries until resolved) rather than
  // getBy* for the panel content specifically.
  it("falls back to Plot when the Map tab is open and the data stops qualifying", async () => {
    // Without this, switching to a 1-D dataset strands the user on a tab that no
    // longer has a strip entry, with no visible way back.
    useApp.setState({ datasets: [ds(3)], activeId: "d1", stageTab: "map" });
    const { rerender } = render(<Stage />);
    expect(await screen.findByText("map-canvas")).toBeInTheDocument();
    useApp.setState({ datasets: [ds(2)], activeId: "d1" });
    rerender(<Stage />);
    expect(useApp.getState().stageTab).toBe("plot");
    expect(screen.getByText("plot-canvas")).toBeInTheDocument();
  });

  it("renders the map when the tab is open and the data does qualify", async () => {
    useApp.setState({ datasets: [ds(3)], activeId: "d1", stageTab: "map" });
    render(<Stage />);
    expect(await screen.findByText("map-canvas")).toBeInTheDocument();
  });
});
