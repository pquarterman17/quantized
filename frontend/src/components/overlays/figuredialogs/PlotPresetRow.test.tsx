// Plan item 39: variant tiles in the plot-type gallery render under their
// group, are keyboard-operable like the type tiles, and apply as one undo step.

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PLOT_PRESETS } from "../../../lib/plotTypePresets";
import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import PlotTypeGallery from "./PlotTypeGallery";

const ds = (): Dataset => ({
  id: "d", name: "d.csv",
  data: { time: [0, 1, 2], values: [[1, 2], [2, 3], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} },
});

beforeEach(() => {
  useApp.setState({ ...defaultPlotView(), datasets: [ds()], activeId: "d", history: [], future: [], status: "" });
});

describe("gallery variant tiles", () => {
  it("renders every preset in a Variants group inside its parent's section", () => {
    render(<PlotTypeGallery onClose={() => {}} />);
    for (const p of PLOT_PRESETS) expect(screen.getByRole("button", { name: p.label })).toBeInTheDocument();
    const statistical = screen.getByRole("group", { name: "Statistical" });
    const variants = within(statistical).getByRole("group", { name: "Variants" });
    expect(within(variants).getByRole("button", { name: "Violin + points" })).toBeInTheDocument();
    expect(within(statistical).getByRole("button", { name: "Violin" })).toBeInTheDocument(); // the type tile is untouched
  });

  it("applies on click as one undo step and closes", () => {
    const onClose = vi.fn();
    render(<PlotTypeGallery onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Box + data points" }));
    expect(useApp.getState().statMode).toBe(true);
    expect(useApp.getState().statPicks.mode).toBe("box");
    expect(useApp.getState().statMarks.box?.points).toBe("all");
    expect(useApp.getState().history).toHaveLength(1);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("is a focusable button that fires on Enter and Space", async () => {
    const user = userEvent.setup();
    render(<PlotTypeGallery onClose={() => {}} />);
    const tile = screen.getByRole("button", { name: "Step line" });
    tile.focus();
    expect(tile).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(useApp.getState().seriesStyles[0]?.step).toBe("post");
    useApp.setState({ seriesStyles: {} });
    tile.focus();
    await user.keyboard(" ");
    expect(useApp.getState().seriesStyles[0]?.step).toBe("post");
  });

  it("with no dataset a variant stays visible, aria-disabled, with its reason, and does nothing", () => {
    useApp.setState({ activeId: null });
    const onClose = vi.fn();
    render(<PlotTypeGallery onClose={onClose} />);
    const tile = screen.getByRole("button", { name: "Violin + points" });
    expect(tile).toHaveAttribute("aria-disabled", "true");
    expect(tile).toHaveAttribute("title", "Select a dataset first.");
    expect(tile).toHaveAccessibleDescription("Select a dataset first.");
    fireEvent.click(tile);
    expect(onClose).not.toHaveBeenCalled();
    expect(useApp.getState().history).toHaveLength(0);
  });
});
