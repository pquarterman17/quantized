// Channel statistics over a channel with gaps. A QD VSM loop carries a blank
// Moment on a failed point (NaN), and a "Plot selected together" overlay pads
// every curve with NaN outside its own block. JSON has no NaN: it reaches the
// backend as `null`, which `/api/stats/descriptive` rejects (422), so the card
// claimed "unavailable offline" for an online, ordinary dataset. The stub
// below rejects a non-finite input the way the route does.

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setFormatOpts } from "../../lib/format";

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

afterEach(() => setFormatOpts(6, "auto"));

describe("StatsCard", () => {
  it("summarises the finite values of a channel with NaN gaps", async () => {
    render(<StatsCard active={gappy} />);
    expect(await screen.findByText("3")).toBeTruthy(); // N: the three finite values
    expect(screen.queryByText("unavailable offline")).toBeNull();
  });

  it("shows N as a plain integer under Scientific / 3 sf (P0-2)", async () => {
    setFormatOpts(3, "scientific");
    const ramp: Dataset = {
      id: "d2",
      name: "ramp",
      data: { time: Array.from({ length: 201 }, (_, i) => i), values: Array.from({ length: 201 }, (_, i) => [i]), labels: ["Y"], units: [""], metadata: {} },
    };
    render(<StatsCard active={ramp} />);
    expect(await screen.findByText("201")).toBeTruthy();
    expect(screen.queryByText("2.01e+2")).toBeNull();
    expect(screen.getByText("2.00e+0")).toBeTruthy(); // median stays a real value on fmtNum
  });
});
