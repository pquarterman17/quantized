// N4: Ctrl+F / Ctrl+H in a focused worksheet open Find / Replace; replace-all
// is ONE undo step; a re-derived (read-only) sheet refuses with the existing
// notice.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { LINKED_GRAPH_EDIT_NOTICE } from "../../../lib/rederived";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import WorksheetPane from "./WorksheetPane";

const sheet = (over: Partial<Dataset> = {}): Dataset => ({
  id: "s1",
  name: "Sheet",
  data: { time: [1, 2, 3, 4], values: [[1.5, 10], [2.5, 1.5], [3.5, 15], [1.5, 100]], labels: ["A", "B"], units: ["", ""], metadata: {} },
  ...over,
});

const values = () => useApp.getState().datasets.find((d) => d.id === "s1")!.data.values;

async function openFind(key: "f" | "h") {
  const { container } = render(<WorksheetPane datasetId="s1" />);
  fireEvent.keyDown(container.querySelector(".qzk-sheet")!, { key, ctrlKey: true });
  return { container, find: await screen.findByRole("search", { name: "Find and replace" }) };
}

beforeEach(() => {
  useApp.setState({ datasets: [sheet()], history: [], future: [], status: "" } as never);
});

describe("worksheet Find / Replace", () => {
  it("Ctrl+F opens Find without the replace row; Ctrl+H opens it with Replace", async () => {
    const f = await openFind("f");
    expect(within(f.find).queryByLabelText("Replace with")).toBeNull();
    f.container.remove();
    const h = await openFind("h");
    expect(within(h.find).getByLabelText("Replace with")).toBeInTheDocument();
  });

  it("counts matches and Escape closes the bar", async () => {
    const { find } = await openFind("f");
    fireEvent.change(within(find).getByLabelText("Find"), { target: { value: "1.5" } });
    expect(within(find).getByText("3 matches")).toBeInTheDocument();
    fireEvent.click(within(find).getByLabelText("Match whole cell"));
    fireEvent.change(within(find).getByLabelText("Find"), { target: { value: "1.50" } });
    expect(within(find).getByText("3 matches")).toBeInTheDocument();
    fireEvent.keyDown(within(find).getByLabelText("Find"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("search", { name: "Find and replace" })).toBeNull());
  });

  it("Replace all rewrites every match as ONE undo step", async () => {
    const { find } = await openFind("h");
    fireEvent.click(within(find).getByLabelText("Match whole cell"));
    fireEvent.change(within(find).getByLabelText("Find"), { target: { value: "1.5" } });
    fireEvent.change(within(find).getByLabelText("Replace with"), { target: { value: "7" } });
    const before = useApp.getState().history.length;
    fireEvent.click(within(find).getByRole("button", { name: "Replace all" }));
    expect(values()).toEqual([[7, 10], [2.5, 7], [3.5, 15], [7, 100]]);
    expect(useApp.getState().history.length).toBe(before + 1);
    useApp.getState().undo();
    expect(values()).toEqual([[1.5, 10], [2.5, 1.5], [3.5, 15], [1.5, 100]]);
  });

  it("Replace changes only the current match and moves to the next", async () => {
    const { find } = await openFind("h");
    fireEvent.click(within(find).getByLabelText("Match whole cell"));
    fireEvent.change(within(find).getByLabelText("Find"), { target: { value: "1.5" } });
    fireEvent.change(within(find).getByLabelText("Replace with"), { target: { value: "7" } });
    fireEvent.click(within(find).getByRole("button", { name: "Replace" }));
    expect(values()).toEqual([[7, 10], [2.5, 1.5], [3.5, 15], [1.5, 100]]);
    expect(within(find).getByText("2 matches")).toBeInTheDocument();
  });

  it("a re-derived live-graph sheet refuses to replace and says why", async () => {
    useApp.setState({ datasets: [sheet({ linkedCurves: [] as never })] });
    const { find } = await openFind("h");
    fireEvent.change(within(find).getByLabelText("Find"), { target: { value: "1.5" } });
    fireEvent.change(within(find).getByLabelText("Replace with"), { target: { value: "7" } });
    fireEvent.click(within(find).getByRole("button", { name: "Replace all" }));
    expect(values()[0][0]).toBe(1.5);
    expect(within(find).getByRole("status")).toHaveTextContent(LINKED_GRAPH_EDIT_NOTICE);
  });

  it("a whole-cell replacement that is not a number is refused, nothing changes", async () => {
    const { find } = await openFind("h");
    fireEvent.click(within(find).getByLabelText("Match whole cell"));
    fireEvent.change(within(find).getByLabelText("Find"), { target: { value: "1.5" } });
    fireEvent.change(within(find).getByLabelText("Replace with"), { target: { value: "abc" } });
    fireEvent.click(within(find).getByRole("button", { name: "Replace all" }));
    expect(values()[0][0]).toBe(1.5);
    expect(within(find).getByRole("status")).toHaveTextContent(/not a number/);
  });
});
