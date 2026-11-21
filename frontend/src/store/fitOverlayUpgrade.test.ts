// P4 phase 2: before an export or a snapshot the fit slot's display curve is
// swapped for its full-resolution copy (store/fitOverlayUpgrade.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { postJSON } from "../lib/api/http";
import type { FitOverlay } from "../lib/types";
import { isCurveFitOverlay, ownCurveFitOverlay, rememberCurveFitOverlay } from "./curveFitOverlay";
import { upgradeFitOverlay } from "./fitOverlayUpgrade";
import { useApp } from "./useApp";

vi.mock("../lib/api/http", async (orig) => ({ ...(await orig<typeof import("../lib/api/http")>()), postJSON: vi.fn() }));

const display = (): FitOverlay => ({
  datasetId: "d1", binding: { yKey: 0, xKey: null }, curveFit: true,
  y: [1, undefined, 5] as unknown as (number | null)[],
  full: { resultId: "rid", model: "Linear", params: [2, 1], rows: [0, 1, 2], x: [0, 1, 2] },
});

beforeEach(() => {
  vi.mocked(postJSON).mockReset();
  useApp.setState({ fitOverlay: null });
});

describe("upgradeFitOverlay", () => {
  it("swaps the display curve for the full one, and the Curve Fit still owns it", async () => {
    vi.mocked(postJSON).mockResolvedValue({ yFit: [1, 3, 5] });
    const cur = display();
    rememberCurveFitOverlay(cur);
    useApp.setState({ fitOverlay: cur });
    await expect(upgradeFitOverlay()).resolves.toBe(true);
    const now = useApp.getState().fitOverlay!;
    expect(now.y).toEqual([1, 3, 5]);
    expect(now.full).toBeUndefined();
    expect(isCurveFitOverlay(now)).toBe(true);
    expect(ownCurveFitOverlay("d1")).toBe(now);
  });

  it("never overwrites a curve drawn while it was fetching", async () => {
    let release: (v: unknown) => void = () => {};
    vi.mocked(postJSON).mockReturnValue(new Promise((r) => { release = r; }));
    useApp.setState({ fitOverlay: display() });
    const pending = upgradeFitOverlay();
    const other: FitOverlay = { datasetId: "d1", binding: { yKey: 0, xKey: null }, y: [9, 9, 9] };
    useApp.setState({ fitOverlay: other });
    release({ yFit: [1, 3, 5] });
    await expect(pending).resolves.toBe(true);
    expect(useApp.getState().fitOverlay).toBe(other);
  });

  it("does nothing for a full curve", async () => {
    const full: FitOverlay = { datasetId: "d1", binding: { yKey: 0, xKey: null }, y: [1, 3, 5] };
    useApp.setState({ fitOverlay: full });
    await expect(upgradeFitOverlay()).resolves.toBe(true);
    expect(useApp.getState().fitOverlay).toBe(full);
    expect(postJSON).not.toHaveBeenCalled();
  });
});
