import { renderHook, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";

import type { PlotPayload } from "../../lib/plotdata";
import { useApp } from "../../store/useApp";
import { useLogAxisNotice } from "./useLogAxisNotice";

const payload: PlotPayload = { data: [[1, 2, 3], [4, -1, 6]], series: [{ label: "A", unit: "" }], xLabel: "x", xUnit: "" };

it("posts a status note when a log Y axis hides a point, and stays quiet on linear", async () => {
  // Load the lazy note module up front. The hook's own `import()` then resolves from the module
  // cache, so the result no longer depends on how long a cold transform takes under a loaded
  // full-suite run (the old fixed 20/50 ms sleeps failed there three times on 2026-11-25).
  await import("../../lib/logAxisNotice");
  useApp.getState().setStatus("");
  // Linear axes return before any import: nothing is scheduled, so the check is synchronous.
  renderHook(() => useLogAxisNotice(payload, [0], { xScale: "linear", yScale: "linear", y2Scale: null, y2Keys: null }));
  expect(useApp.getState().status).toBe("");
  renderHook(() => useLogAxisNotice(payload, [0], { xScale: "linear", yScale: "log", y2Scale: null, y2Keys: null }));
  await waitFor(() => expect(useApp.getState().status).toBe("1 non-positive point hidden on the log axis"));
});
