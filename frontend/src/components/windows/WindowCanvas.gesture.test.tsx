import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import { useApp } from "../../store/useApp";
import WindowCanvas from "./WindowCanvas";

const renders = vi.hoisted(() => ({ focused: 0, background: 0 }));
vi.mock("../Stage/PlotStage", () => ({ default: () => {
  renders.focused++;
  return <div>focused plot</div>;
} }));
vi.mock("./BackgroundPlotWindow", () => ({ default: () => {
  renders.background++;
  return <div>background plot</div>;
} }));

afterEach(() => { vi.unstubAllGlobals(); });

it("keeps sibling plot renders flat through 25 painted moves in the real WindowCanvas", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const make = (id: string): PlotWindow => ({
    id, kind: "plot", title: id, datasetId: null,
    geometry: { x: 100, y: 80, w: 480, h: 360 }, z: 0,
    winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
  });
  useApp.setState({ plotWindows: [make("w1"), make("w2")], focusedWindowId: "w1", datasets: [] });
  const { container, getByText } = render(<WindowCanvas />);
  await waitFor(() => expect(getByText("background plot")).toBeInTheDocument());
  const before = { ...renders };
  fireEvent.pointerDown(container.querySelector(".qzk-plotwin.focused .qzk-plotwin-titlebar")!,
    { button: 0, clientX: 100, clientY: 80 });
  for (let i = 1; i <= 25; i++) {
    act(() => { fireEvent.pointerMove(window, { clientX: 100 + i, clientY: 80 + i, altKey: true }); });
  }
  expect(renders).toEqual(before);
  expect(container.querySelector<HTMLElement>(".qzk-plotwin.focused")!.style.left).toBe("125px");
  fireEvent.pointerUp(window);
  expect(useApp.getState().plotWindows[0].geometry.x).toBe(125);
  // Positive control: this harness really observes a global geometry write.
  expect(renders.background).toBeGreaterThan(before.background);
});
