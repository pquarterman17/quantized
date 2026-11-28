// OG23 / plan item 50 lane C: the Legend popup holds every per-legend control
// the right panel's LegendControls had (the corner), reached the way a user
// reaches it: a double-click on the legend box on the Stage. Plot-wide "show
// legend" is the panel's (E4); the popup's own checkbox predates this lane.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import PlotLegend from "../../Stage/PlotLegend";
import type { Dataset } from "../../../lib/types";
import { useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";
import FigureDialogs from "./FigureDialogs";

const ds: Dataset = {
  id: "d", name: "M(H)",
  data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["a", "b"], units: ["", ""], metadata: {} },
};
const st = () => useApp.getState();

beforeEach(() => {
  useFigureDialog.setState({ open: null });
  useApp.setState({
    datasets: [ds], activeId: "d", yKeys: null, xKey: null, seriesLabels: {}, showLegend: true,
    legendPos: "sw", legendXY: null, legendFrameXY: null, plotTool: "pointer", history: [], future: [],
  });
});

function openByDoubleClick() {
  const { container } = render(
    <>
      <PlotLegend series={[{ label: "a", unit: "" }, { label: "b", unit: "" }]} plotted={[0, 1]} hidden={[false, false]} />
      <FigureDialogs />
    </>,
  );
  fireEvent.doubleClick(container.querySelector(".qzk-legend") as HTMLElement);
}

describe("Legend popup, entered by double-clicking the legend box", () => {
  it("Legend position: the panel's corner control, applied as one undo step", async () => {
    openByDoubleClick();
    expect(await screen.findByRole("dialog", { name: "Legend" })).toBeInTheDocument();
    expect(screen.getByLabelText("Legend position")).toHaveValue("sw");
    fireEvent.change(screen.getByLabelText("Legend position"), { target: { value: "nw" } });
    expect(st().legendPos).toBe("sw"); // draft only until Apply
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(st().legendPos).toBe("nw");
    expect(st().history).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers every corner the panel offers", async () => {
    openByDoubleClick();
    const sel = (await screen.findByLabelText("Legend position")) as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(["auto", "ne", "nw", "se", "sw"]);
  });

  it("Cancel leaves the corner and history alone", async () => {
    openByDoubleClick();
    fireEvent.change(await screen.findByLabelText("Legend position"), { target: { value: "ne" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(st().legendPos).toBe("sw");
    expect(st().history).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Esc discards without asking", async () => {
    openByDoubleClick();
    fireEvent.change(await screen.findByLabelText("Legend position"), { target: { value: "ne" } });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(st().legendPos).toBe("sw");
    expect(screen.queryByText("Discard your changes?")).toBeNull();
  });
});
