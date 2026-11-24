// UX-D review: the Map grid gate is a LAZY chunk and `canRenderMap` fails
// closed until it has run. The plot-type gallery must not call Contour
// unavailable for a gridded dataset just because nothing warmed the gate yet:
// on first open it says it is checking, then settles on the real answer.

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import PlotTypeGallery from "./PlotTypeGallery";
import { MAP_GATE_CHECKING, mapGateResolved } from "../../../lib/mapdata";
import { plotTypeUnavailable } from "../../../lib/plotTypes";
import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

/** A fresh DataStruct per call: the gate memoises per object, so each test
 *  starts genuinely cold. */
function grid(): Dataset {
  // 3 x 3 long-form X/Y/Z grid (time is the X axis column)
  return {
    id: "g",
    name: "grid.csv",
    data: {
      time: [0, 0, 0, 1, 1, 1, 2, 2, 2],
      values: [[0, 1], [1, 2], [2, 3], [0, 4], [1, 5], [2, 6], [0, 7], [1, 8], [2, 9]],
      labels: ["Y", "Z"],
      units: ["", ""],
      metadata: {},
    },
  };
}

function sweep(): Dataset {
  return {
    id: "g",
    name: "sweep.csv",
    data: { time: [0, 1, 2, 3], values: [[1, 5], [2, 6], [3, 7], [4, 8]], labels: ["A", "B"], units: ["", ""], metadata: {} },
  };
}

const contour = () => screen.getByRole("button", { name: "Contour / Heatmap" });

function show(ds: Dataset) {
  useApp.setState({ ...defaultPlotView(), datasets: [ds], activeId: ds.id, stageTab: "plot" });
  render(<PlotTypeGallery onClose={() => {}} />);
}

beforeEach(() => {
  useApp.setState({ datasets: [], activeId: null });
});

describe("plot-type gallery on first open (lazy map gate)", () => {
  it("a cold gate reads as checking, never as 'needs a grid'", () => {
    const ds = grid();
    expect(mapGateResolved(ds.data)).toBe(false);
    expect(plotTypeUnavailable("contour", ds)).toBe(MAP_GATE_CHECKING);
  });

  it("offers Contour for a gridded dataset the gate had never seen", async () => {
    const ds = grid();
    show(ds);
    // Before the chunk lands it may be pending, but it must not claim the
    // data lacks a grid.
    expect(contour().getAttribute("title")).not.toMatch(/X, Y, Z on a grid/);
    await waitFor(() => expect(contour()).not.toHaveAttribute("aria-disabled"));
    expect(contour()).toHaveAttribute("title", expect.stringMatching(/Color map/));
    expect(mapGateResolved(ds.data)).toBe(true);
  });

  it("settles on the real refusal for a 1-D sweep", async () => {
    show(sweep());
    await waitFor(() => expect(contour()).toHaveAttribute("title", expect.stringMatching(/X, Y, Z on a grid/)));
    expect(contour()).toHaveAttribute("aria-disabled", "true");
  });
});
