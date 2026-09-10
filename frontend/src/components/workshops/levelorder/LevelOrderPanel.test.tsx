// Group O-2b: LevelOrderPanel — view wiring smoke test (the actual reorder/
// commit LOGIC is store/levelOrder.test.ts's job). Uses the REAL useApp/
// useLevelOrder/useLevelOrderPanel stores, the same shape RecodePanel.test.tsx
// uses.
//
// BUNDLE SPLIT: the real trigger (WorksheetPane's menu) only ever sets the
// TINY store/levelOrderPanel.ts now — so every test here opens through
// `useLevelOrderPanel.getState().openPanel(...)`, never the heavy store's
// own `openLevelOrder` directly, matching how the app actually drives this
// panel post-split. The heavy store still gets exercised: the panel's own
// mount effect seeds it (through `categoryLevels`), which is what the
// "shows the level count…" test below actually proves happened.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useLevelOrder } from "../../../store/levelOrder";
import { useLevelOrderPanel } from "../../../store/levelOrderPanel";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import LevelOrderPanel from "./LevelOrderPanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

function catDataset(): Dataset {
  return {
    id: "d1",
    name: "grades.dat",
    data: {
      time: [0, 1, 2],
      values: [[0], [1], [2]],
      labels: ["Grade"],
      units: [""],
      metadata: {},
      cat_levels: { 0: ["Pass", "OK", "Fail"] },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [catDataset()], activeId: "d1" });
  useLevelOrder.setState({ open: false, datasetId: null, channel: null, openLabel: null, draft: [] });
  useLevelOrderPanel.setState({ open: false, datasetId: null, channel: null, openLabel: null });
});

describe("LevelOrderPanel", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<LevelOrderPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("opening via the tiny store seeds the heavy store on mount (through categoryLevels) and shows the level table", () => {
    useLevelOrderPanel.getState().openPanel("d1", 0, "Grade");
    render(<LevelOrderPanel />);
    // Proves the mount-effect seed actually ran: the heavy store now has a
    // real draft, and the table renders from it.
    expect(useLevelOrder.getState().open).toBe(true);
    expect(useLevelOrder.getState().draft).toEqual([0, 1, 2]);
    expect(screen.getByText(/3 levels/)).toBeInTheDocument();
    expect(screen.getByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
  });

  it("Move up/down glyph buttons reorder the draft, and are disabled at the boundaries", () => {
    useLevelOrderPanel.getState().openPanel("d1", 0, "Grade"); // seeds heavy draft = [0,1,2] = Pass,OK,Fail
    render(<LevelOrderPanel />);
    expect(screen.getByLabelText('move "Pass" up')).toBeDisabled();
    expect(screen.getByLabelText('move "Fail" down')).toBeDisabled();
    expect(screen.getByLabelText('move "OK" up')).not.toBeDisabled();

    fireEvent.click(screen.getByLabelText('move "OK" up'));
    expect(useLevelOrder.getState().draft).toEqual([1, 0, 2]); // OK moved above Pass
  });

  it("Sort by label reorders the visible rows", () => {
    useLevelOrderPanel.getState().openPanel("d1", 0, "Grade"); // Pass, OK, Fail
    render(<LevelOrderPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Sort by label" }));
    // Alphabetical: Fail, OK, Pass.
    expect(useLevelOrder.getState().draft).toEqual([2, 1, 0]);
  });

  it("Reset to code order restores ascending", () => {
    useLevelOrderPanel.getState().openPanel("d1", 0, "Grade");
    render(<LevelOrderPanel />);
    fireEvent.click(screen.getByLabelText('move "OK" up'));
    expect(useLevelOrder.getState().draft).toEqual([1, 0, 2]);
    fireEvent.click(screen.getByRole("button", { name: "Reset to code order" }));
    expect(useLevelOrder.getState().draft).toEqual([0, 1, 2]);
  });

  it("Commit writes the order and closes BOTH the heavy store and the tiny panel flag", () => {
    useLevelOrderPanel.getState().openPanel("d1", 0, "Grade");
    render(<LevelOrderPanel />);
    fireEvent.click(screen.getByLabelText('move "OK" up'));
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    const d = useApp.getState().datasets.find((x) => x.id === "d1")!;
    expect(d.data.level_order).toEqual({ 0: [1, 0, 2] });
    expect(useLevelOrder.getState().open).toBe(false);
    expect(useLevelOrderPanel.getState().open).toBe(false); // the flag AppOverlays actually gates on
  });

  it("Cancel closes BOTH stores without committing", () => {
    useLevelOrderPanel.getState().openPanel("d1", 0, "Grade");
    render(<LevelOrderPanel />);
    fireEvent.click(screen.getByLabelText('move "OK" up'));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useLevelOrder.getState().open).toBe(false);
    expect(useLevelOrderPanel.getState().open).toBe(false);
    const d = useApp.getState().datasets.find((x) => x.id === "d1")!;
    expect(d.data.level_order).toBeUndefined();
  });

  it("the ToolWindow's own close (X) also closes both stores", () => {
    useLevelOrderPanel.getState().openPanel("d1", 0, "Grade");
    render(<LevelOrderPanel />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(useLevelOrder.getState().open).toBe(false);
    expect(useLevelOrderPanel.getState().open).toBe(false);
  });

  // Belt-and-braces (module header): the heavy store's own refusal check
  // still runs at seed time. If it refuses, the tiny flag must not be left
  // stuck open with nothing able to close it (AppOverlays would keep
  // mounting this panel, which renders null once the heavy store never
  // opens — a silent, permanently-stuck menu action otherwise).
  it("a heavy-store refusal on seed (column no longer categorical) closes the tiny flag too, with no stuck panel", () => {
    useApp.setState({
      datasets: [{ ...catDataset(), data: { ...catDataset().data, cat_levels: undefined } }],
      activeId: "d1",
    });
    useLevelOrderPanel.getState().openPanel("d1", 0, "Grade");
    const { container } = render(<LevelOrderPanel />);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/isn't categorical/), "danger");
    expect(useLevelOrder.getState().open).toBe(false);
    expect(useLevelOrderPanel.getState().open).toBe(false); // not left stuck
    expect(container.firstChild).toBeNull();
  });
});
