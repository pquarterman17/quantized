// Panel inset box (#15): selection, delete, content switch, and the
// drag-to-move wiring into the store (the pure geometry itself — movedAt/
// resizedAt/insetBoxRect — is already unit-tested in lib/inset.test.ts).

import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import type uPlot from "uplot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PanelInset } from "../../lib/panelInset";
import { useApp } from "../../store/useApp";
import PanelInsetBox from "./PanelInsetBox";

const ORIGINAL = useApp.getState();
afterEach(() => useApp.setState(ORIGINAL, true));

const TABLE_INSET: PanelInset = {
  id: "p1",
  at: [0.1, 0.1, 0.3, 0.3],
  content: { kind: "table", headers: ["a"], rows: [["1"]] },
};

describe("PanelInsetBox", () => {
  it("renders its content and is unselected by default", () => {
    render(<PanelInsetBox inset={TABLE_INSET} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByLabelText("Delete panel inset")).not.toBeInTheDocument();
  });

  it("clicking the box selects it and shows the delete/resize chrome", () => {
    render(<PanelInsetBox inset={TABLE_INSET} />);
    fireEvent.click(screen.getByTestId("panel-inset-box"));
    expect(useApp.getState().selectedPanelInsetId).toBe("p1");
    expect(screen.getByLabelText("Delete panel inset")).toBeInTheDocument();
    expect(screen.getByLabelText("Resize panel inset")).toBeInTheDocument();
  });

  it("the delete button removes the inset from the store", () => {
    useApp.setState({ panelInsets: [TABLE_INSET], selectedPanelInsetId: "p1" });
    render(<PanelInsetBox inset={TABLE_INSET} />);
    fireEvent.click(screen.getByLabelText("Delete panel inset"));
    expect(useApp.getState().panelInsets).toEqual([]);
  });

  describe("drag to move", () => {
    beforeEach(() => {
      // jsdom's requestAnimationFrame never fires on its own (no paint loop,
      // per PlotLegend.test.tsx's own note) — fire the box's tick EXACTLY
      // ONCE synchronously so its measured frame is populated, without the
      // self-rescheduling tick looping forever under a naive always-fire stub.
      let calls = 0;
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        calls += 1;
        if (calls === 1) cb(0);
        return calls;
      });
      vi.stubGlobal("cancelAnimationFrame", () => {});
    });
    afterEach(() => vi.unstubAllGlobals());

    it("dragging the header commits a moved placement to the store", () => {
      const plotRef = createRef<uPlot | null>();
      const over = document.createElement("div");
      vi.spyOn(over, "getBoundingClientRect").mockReturnValue(
        { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) },
      );
      plotRef.current = { over } as unknown as uPlot;

      useApp.setState({ panelInsets: [TABLE_INSET], selectedPanelInsetId: "p1" });
      render(<PanelInsetBox inset={TABLE_INSET} plotRef={plotRef} />);
      fireEvent.click(screen.getByTestId("panel-inset-box"));
      const header = screen.getByTitle("Drag to move.");
      fireEvent.pointerDown(header, { clientX: 100, clientY: 100, button: 0 });
      fireEvent.pointerMove(header, { clientX: 140, clientY: 100 });
      fireEvent.pointerUp(header);

      const updated = useApp.getState().panelInsets[0];
      expect(updated.at).not.toEqual(TABLE_INSET.at);
      expect(updated.at[0]).toBeGreaterThan(TABLE_INSET.at[0]); // moved right
    });
  });
});
