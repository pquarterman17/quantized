import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";

import type { PlotPayload } from "../../lib/plotdata";
import { useApp } from "../../store/useApp";
import { useLogAxisNotice } from "./useLogAxisNotice";

const payload: PlotPayload = { data: [[1, 2, 3], [4, -1, 6]], series: [{ label: "A", unit: "" }], xLabel: "x", xUnit: "" };

it("posts a status note when a log Y axis hides a point, and stays quiet on linear", async () => {
  useApp.getState().setStatus("");
  renderHook(() => useLogAxisNotice(payload, [0], { xScale: "linear", yScale: "linear", y2Scale: null, y2Keys: null }));
  await new Promise((r) => setTimeout(r, 20));
  expect(useApp.getState().status).toBe("");
  renderHook(() => useLogAxisNotice(payload, [0], { xScale: "linear", yScale: "log", y2Scale: null, y2Keys: null }));
  await new Promise((r) => setTimeout(r, 50));
  expect(useApp.getState().status).toBe("1 non-positive point hidden on the log axis");
});
