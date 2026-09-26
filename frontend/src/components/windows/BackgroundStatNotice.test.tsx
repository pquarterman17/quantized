// P2.6 box 2, review round 2: a BACKGROUND stat window draws the same
// decorated category axis as the focused stage (empty slots, n captions), so
// it must carry the same notice — small or unbalanced groups never appear
// without their caveat just because the window is not focused.

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox } from "../../lib/api";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { BackgroundStatWindow } from "./BackgroundAltModes";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
}));
vi.mock("../Stage/statRender", () => ({ draw: () => {} }));
// BackgroundAltModes also hosts the polar/stack cores, which import uPlot.
vi.mock("uplot", () => ({ default: class {} }));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

// grp declares A B C: A has 12 rows, B 2 (small + unbalanced), C none.
const DS: Dataset = {
  id: "bg",
  name: "bg.csv",
  data: {
    time: Array.from({ length: 14 }, (_, i) => i),
    values: [...Array.from({ length: 12 }, (_, i) => [0, i]), [1, 50], [1, 51]],
    labels: ["grp", "y"],
    units: ["", ""],
    metadata: {},
    cat_levels: { 0: ["A", "B", "C"] },
  },
};
const VIEW = { ...defaultPlotView(), statMode: true };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(statsBox).mockRejectedValue(new Error("offline"));
});

describe("BackgroundStatWindow — the group notice", () => {
  it("shows the caveat and the empty level, with the per-level breakdown on hover", async () => {
    render(<BackgroundStatWindow dataset={DS} view={VIEW} />);
    const notice = await screen.findByTestId("bg-stat-group-notice");
    await waitFor(() => expect(notice).toHaveTextContent("n < 3 in 1 group"));
    expect(notice).toHaveTextContent("unbalanced groups (n 2-12)");
    expect(notice).toHaveTextContent("1 empty level (n=0)");
    expect(notice).toHaveAttribute("title", expect.stringContaining("grp = C: n=0 (never occurs)"));
  });

  it("follows the window's own persisted 'hide empty levels'", async () => {
    render(<BackgroundStatWindow dataset={DS} view={{ ...VIEW, statHideEmptyLevels: true }} />);
    const notice = await screen.findByTestId("bg-stat-group-notice");
    await waitFor(() => expect(notice).toHaveTextContent("1 empty level hidden"));
  });
});
