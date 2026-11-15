// The "drawn straight" notice reads the series' OWN X and the size cap; a failed marks load says so.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let own: number | null = null;
vi.mock("../../lib/perSeriesX", async (orig) => ({ ...(await orig<typeof import("../../lib/perSeriesX")>()), ownXKey: () => own }));
const flags = { failed: false };
vi.mock("../../lib/marksLoader", async (orig) => ({
  ...(await orig<typeof import("../../lib/marksLoader")>()),
  marksFailed: () => flags.failed,
}));

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import SeriesMarkMapControls from "./SeriesMarkMapControls";

const mk = (n: number, loopCol: boolean): Dataset => ({
  id: "d",
  name: "s.xy",
  data: {
    time: Array.from({ length: n }, (_, i) => i),
    // column 1 is a second X: a loop when asked
    values: Array.from({ length: n }, (_, i) => [i * 2, loopCol ? (i % 2 ? 0 : 1) : i]),
    labels: ["M", "H2"], units: ["", ""], metadata: {},
  },
});

function Host() {
  const style = useApp((s) => s.seriesStyles[0]) ?? {};
  const set = useApp((s) => s.setSeriesStyle);
  return <SeriesMarkMapControls channel={0} style={style} setSeriesStyle={set} />;
}

beforeEach(() => {
  own = null;
  flags.failed = false;
  useApp.setState({ datasets: [mk(5, true)], activeId: "d", xKey: null, seriesStyles: { 0: { connect: "spline" } } });
});

describe("spline notice", () => {
  it("uses the series' own X, not the plot's (a multi-X sheet)", () => {
    const { unmount } = render(<Host />);
    expect(screen.queryByRole("status")).toBeNull(); // the plot's X (time) is ascending
    unmount();
    own = 1; // this curve's own X is column 1, a loop
    render(<Host />);
    expect(screen.getByRole("status").textContent).toMatch(/not strictly ascending/);
  });

  it("names the 20,000-point cap for a long series", () => {
    useApp.setState({ datasets: [mk(20001, false)] });
    render(<Host />);
    expect(screen.getByRole("status").textContent).toMatch(/20,000 points/);
  });

  it("says the code could not be loaded when it failed", () => {
    flags.failed = true;
    render(<Host />);
    expect(screen.getByRole("status").textContent).toMatch(/could not be loaded/);
    fireEvent.change(screen.getByRole("combobox", { name: "Line connect" }), { target: { value: "straight" } });
    expect(screen.queryByRole("status")).toBeNull(); // nothing asked for: nothing to say
  });
});
