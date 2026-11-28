// Plan item 39: variant tiles in the plot-type gallery render under their
// group, are keyboard-operable like the type tiles, and apply as one undo step.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FAMILY_VISIBLE, presetFamilies } from "../../../lib/plotPresetFamilies";
import { PLOT_PRESETS } from "../../../lib/plotTypePresets";
import { plotTypeGroups } from "../../../lib/plotTypes";
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
    for (const b of screen.queryAllByRole("button", { name: /^Show \d+ more / })) fireEvent.click(b);
    for (const p of PLOT_PRESETS) expect(screen.getByRole("button", { name: p.label })).toBeInTheDocument();
    const statistical = screen.getByRole("group", { name: "Statistical" });
    const variants = within(statistical).getByRole("group", { name: "Variants" });
    expect(within(variants).getByRole("button", { name: "Violin + points" })).toBeInTheDocument();
    expect(within(statistical).getByRole("button", { name: "Violin" })).toBeInTheDocument(); // the type tile is untouched
  });

  it("groups tiles by family under a heading, at most FAMILY_VISIBLE visible, the rest folded in order", () => {
    render(<PlotTypeGallery onClose={() => {}} />);
    let folds = 0;
    for (const g of plotTypeGroups()) {
      const section = screen.getByRole("group", { name: g.label });
      for (const f of presetFamilies(g.types.map((t) => t.id))) {
        const fam = within(section).getByRole("group", { name: `${f.label} variants` });
        expect(within(fam).getByRole("heading", { name: f.label })).toBeInTheDocument();
        const tiles = () => within(fam).getAllByRole("button").filter((b) => !b.hasAttribute("aria-expanded")).map((b) => b.getAttribute("aria-label"));
        expect(tiles(), f.label).toEqual(f.presets.slice(0, FAMILY_VISIBLE).map((p) => p.label));
        const fold = within(fam).queryByRole("button", { expanded: false });
        if (f.presets.length <= FAMILY_VISIBLE) { expect(fold, f.label).toBeNull(); continue; }
        folds++;
        expect(fold).toHaveAccessibleName(`Show ${f.presets.length - FAMILY_VISIBLE} more ${f.label} variants`);
        fireEvent.click(fold!);
        expect(tiles(), f.label).toEqual(f.presets.map((p) => p.label));
        expect(within(fam).getByRole("button", { expanded: true })).toHaveAccessibleName(`Show fewer ${f.label} variants`);
        fireEvent.click(within(fam).getByRole("button", { expanded: true }));
        expect(tiles(), f.label).toEqual(f.presets.slice(0, FAMILY_VISIBLE).map((p) => p.label));
      }
    }
    expect(folds).toBeGreaterThan(0); // the ridgeline family really folds
  });

  it("the fold is a keyboard button, collapsed by default, and toggling it changes no saved state", async () => {
    const user = userEvent.setup();
    render(<PlotTypeGallery onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Ridgeline, bandwidth 0.15" })).toBeNull();
    const before = JSON.stringify({ ...useApp.getState(), datasets: undefined });
    const fold = screen.getByRole("button", { name: "Show 1 more Ridgeline variants" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    fold.focus();
    await user.keyboard("{Enter}");
    expect(fold).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Ridgeline, bandwidth 0.15" })).toBeInTheDocument();
    await user.keyboard(" ");
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(JSON.stringify({ ...useApp.getState(), datasets: undefined })).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("each new tile, clicked in the gallery, opens the view its label says", () => {
    const open = (name: string) => {
      useApp.setState({ ...defaultPlotView(), datasets: [ds()], activeId: "d", history: [], future: [], status: "" });
      cleanup();
      render(<PlotTypeGallery onClose={() => {}} />);
      for (const b of screen.queryAllByRole("button", { name: /^Show \d+ more / })) fireEvent.click(b);
      fireEvent.click(screen.getByRole("button", { name }));
      return useApp.getState().statPicks;
    };
    expect(open("Half violin + marks")).toMatchObject({ mode: "sideviolin", violinSide: "half", violinMarks: "both" });
    expect(open("Raincloud")).toMatchObject({ mode: "sideviolin", violinSide: "half", violinRain: true });
    expect(open("Paired by direction")).toMatchObject({ mode: "paired", pairedDirection: true });
    expect(open("Dot chart")).toMatchObject({ mode: "lollipop", lollipopHoriz: true });
    expect(open("100% stacked histogram")).toMatchObject({ mode: "histogram", histStack: true, histPercent: true, histCols: [1] });
    expect(open("Ridgeline, each to its peak")).toMatchObject({ mode: "ridgeline", ridgeEach: true });
    expect(open("Ridgeline, bandwidth 0.6")).toMatchObject({ mode: "ridgeline", ridgeBw: "0.6" });
    expect(open("Ridgeline, bandwidth 0.15")).toMatchObject({ mode: "ridgeline", ridgeBw: "0.15" });
    expect(useApp.getState().statMode).toBe(true);
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
