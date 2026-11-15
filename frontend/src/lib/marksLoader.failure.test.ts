// A chunk that will not load must not leave a series hidden: two attempts, then the plain series
// and a visible notice (lib/marksLoader.ts).
import { describe, expect, it, vi } from "vitest";

describe("marks chunk failure", () => {
  it("retries once, then draws the plain series and sets a status notice", async () => {
    vi.resetModules();
    let attempts = 0;
    vi.doMock("./marksImpl", () => {
      attempts++;
      throw new Error("chunk load failed");
    });
    const loader = await import("./marksLoader");
    const { useApp } = await import("../store/useApp");
    const { buildOpts } = await import("./uplotOpts");
    const style = { connect: "spline", dropLines: "x", sizeBy: 1, width: 2 } as const;
    const build = () =>
      buildOpts(
        { data: [[1, 2, 3], [4, 5, 6]], series: [{ label: "M", unit: "" }], xLabel: "x", xUnit: "" },
        { width: 300, height: 200, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(), plotted: [0], seriesStyles: [style] },
      ).series![1] as { width: number; paths?: unknown; points?: { show?: boolean } };

    expect(build().width).toBe(0); // pending: hidden
    expect(loader.marksPending()).toBe(true);
    await loader.loadMarks();
    expect(attempts).toBe(2);
    expect(loader.marksFailed()).toBe(true);
    expect(loader.marksPending()).toBe(false);
    const plain = build();
    expect(plain.width).toBe(2); // the plain series, not a hidden one
    expect(plain.paths).toBeUndefined(); // straight, not a spline
    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/could not load/));
    vi.doUnmock("./marksImpl");
  });
});
