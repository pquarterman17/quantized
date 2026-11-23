// The Box buttons' tooltip must name the condition that actually disables them.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import BoxCard from "./BoxCard";
import { NO_BOX_REASON, NO_DATASET } from "./cutGuards";
import type { RoiCutsState } from "./useRoiCuts";

const base = { boxSpace: "angular", qAvailable: true, boxCollapse: "x", boxReduce: "sum", boxBins: 10, boxStats: null, busy: false, statsBusy: false } as unknown as RoiCutsState;

describe("BoxCard disabled reason", () => {
  it("not a map dataset: says to select a map, not to set bounds", () => {
    render(<BoxCard roi={{ ...base, isMap: false, boxRect: null } as RoiCutsState} />);
    expect(screen.getByRole("button", { name: "Run" })).toHaveAttribute("title", NO_DATASET);
  });
  it("map without a box: says to set the bounds", () => {
    render(<BoxCard roi={{ ...base, isMap: true, boxRect: null } as RoiCutsState} />);
    expect(screen.getByRole("button", { name: "Stats" })).toHaveAttribute("title", NO_BOX_REASON);
  });
  it("enabled: no tooltip", () => {
    render(<BoxCard roi={{ ...base, isMap: true, boxRect: { space: "angular", x0: 0, x1: 1, y0: 0, y1: 1 } } as unknown as RoiCutsState} />);
    expect(screen.getByRole("button", { name: "Run" })).not.toHaveAttribute("title");
  });
});
