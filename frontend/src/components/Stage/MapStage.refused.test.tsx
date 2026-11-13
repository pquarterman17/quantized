// The reader lane's live check: the Map tab of an Origin book whose columns
// cannot be gridded (a constant axis, or no row with finite x, y and z) got
// HTTP 422 from /api/plot/map and then painted an "offline grid" of the same
// data under "backend unavailable" -- a misleading map and the wrong reason.
// A refusal now shows the backend's own message on the Map tab, leaves the
// toolbar usable to pick other columns, and paints no grid.

import { render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import MapStage from "./MapStage";

const REASON = "cannot build a 2-D grid: the y axis has no range (min == max == 0); it is constant or single-valued";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const book: Dataset = {
  id: "b1",
  name: "PARTICLE SIZE:Book1",
  data: {
    time: [0, 1, 2],
    values: [
      [1, 0, 5],
      [2, 0, 6],
      [3, 0, 7],
    ],
    labels: ["Size", "Flat", "Count"],
    units: ["", "", ""],
    metadata: {},
  },
};

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(JSON.stringify({ detail: REASON }), { status: 422, statusText: "Unprocessable Entity", headers: { "Content-Type": "application/json" } }),
    ),
  );
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  useApp.getState().loadWorkspace({ datasets: [book], activeId: "b1" });
  useApp.setState({ status: "" });
});

describe("Map tab: columns the backend refuses to grid", () => {
  it("says why, keeps the toolbar, and paints no offline grid", async () => {
    render(<MapStage />);
    await waitFor(() => expect(useApp.getState().status).toBe(`Map: ${REASON}`));
    expect(screen.getByText("These columns can't be mapped:")).toBeInTheDocument();
    expect(screen.getByText(REASON)).toBeInTheDocument();
    expect(useApp.getState().status).not.toMatch(/backend unavailable|offline grid/);
    // The x / y / z pickers stay reachable to choose other columns.
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(3);
  });
});
