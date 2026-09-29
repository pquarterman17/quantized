// Residual R7 (P3.3): the multi-Escape ladder is deliberate — ONE Escape
// dismisses ONE thing, innermost first, and the next Escape goes to the
// surface below (lib/escapeStack.ts). The first rung of each measured ladder
// was pinned where it was fixed; these pin every rung, with the real hooks,
// so a change that makes one Escape do two things (or skip a rung) fails.

import { render, renderHook, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import LibraryWorkspace from "./components/Library/LibraryWorkspace";
import ToolWindow from "./components/overlays/ToolWindow";
import type { Dataset } from "./lib/types";
import { useApp } from "./store/useApp";
import { pressEscape } from "./test/pressEscape";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

beforeEach(() => {
  useApp.setState({ toolWindowLayout: {}, plotTool: "pointer", qfitRoi: null, gadgetCursors: null });
});

describe("the Escape ladder, one rung per key (R7)", () => {
  it("a focused workshop over an armed tool: Esc① closes the window, Esc② reverts the tool", async () => {
    useApp.setState({ plotTool: "zoom" });
    renderHook(() => useGlobalShortcuts());
    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? (
        <ToolWindow id="r7-window" title="Find peaks" onClose={() => setOpen(false)}>
          <button type="button">Run</button>
        </ToolWindow>
      ) : null;
    }
    render(<Harness />);
    const frame = document.querySelector<HTMLElement>(".qzk-win");
    expect(frame).toHaveFocus();

    await pressEscape(frame ?? window);
    expect(document.querySelector(".qzk-win")).toBeNull();
    expect(useApp.getState().plotTool).toBe("zoom");

    await pressEscape(document.activeElement ?? window);
    expect(useApp.getState().plotTool).toBe("pointer");
  });

  it("Tiles over an armed tool: Esc① closes Tiles, Esc② reverts the tool", async () => {
    const worksheet = { id: "a", name: "a", workbookId: "w1", data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} } } as unknown as Dataset;
    useApp.setState({ workbooks: [{ id: "w1", name: "Run" }], datasets: [worksheet], plotTool: "zoom" });
    renderHook(() => useGlobalShortcuts());
    function Harness() {
      const [tiles, setTiles] = useState(true);
      return tiles ? <LibraryWorkspace onClose={() => setTiles(false)} /> : <p>stage</p>;
    }
    render(<Harness />);

    await pressEscape(screen.getByLabelText("Library workspace"));
    expect(screen.getByText("stage")).toBeInTheDocument();
    expect(useApp.getState().plotTool).toBe("zoom");

    await pressEscape();
    expect(useApp.getState().plotTool).toBe("pointer");
  });
});
