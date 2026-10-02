// Channel statistics over a channel with gaps. A QD VSM loop carries a blank
// Moment on a failed point (NaN), and a "Plot selected together" overlay pads
// every curve with NaN outside its own block. JSON has no NaN: it reaches the
// backend as `null`, which `/api/stats/descriptive` rejects (422), so the card
// claimed "unavailable offline" for an online, ordinary dataset. The stub
// below rejects a non-finite input the way the route does.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import StatsCard from "./StatsCard";
import type { Dataset } from "../../lib/types";

vi.mock("../../lib/api/statsDescriptive", () => ({
  statsDescriptive: (x: number[]) =>
    x.every(Number.isFinite)
      ? Promise.resolve({ N: x.length, mean: x.reduce((a, b) => a + b, 0) / x.length, std: 1, min: Math.min(...x), max: Math.max(...x), median: 2 })
      : Promise.reject(new Error("422")),
}));

const gappy: Dataset = {
  id: "d1",
  name: "loop",
  data: { time: [0, 1, 2, 3], values: [[2], [NaN], [4], [9]], labels: ["Moment"], units: ["emu"], metadata: {} },
};

describe("StatsCard", () => {
  it("summarises the finite values of a channel with NaN gaps", async () => {
    render(<StatsCard active={gappy} />);
    expect(await screen.findByText("3")).toBeTruthy(); // N: the three finite values
    expect(screen.queryByText("unavailable offline")).toBeNull();
  });
});
