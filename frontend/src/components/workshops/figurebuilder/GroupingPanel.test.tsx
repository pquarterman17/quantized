import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import GroupingPanel from "./GroupingPanel";

const LABELS = ["X", "R", "dR"];

function renderPanel(groupKey: number | null, labels: readonly string[] = LABELS) {
  const onGroupKey = vi.fn();
  render(<GroupingPanel groupKey={groupKey} labels={labels} onGroupKey={onGroupKey} />);
  return { onGroupKey };
}

describe("GroupingPanel", () => {
  it("shows None selected when nothing is grouped", () => {
    renderPanel(null);
    expect(screen.getByLabelText("group by")).toHaveValue("");
  });

  it("shows the bound column selected when a group is set", () => {
    renderPanel(1);
    expect(screen.getByLabelText("group by")).toHaveValue("1");
  });

  it("offers None plus every column label, in channel order", () => {
    renderPanel(null);
    const select = screen.getByLabelText("group by") as HTMLSelectElement;
    const optionLabels = [...select.options].map((o) => o.textContent);
    expect(optionLabels).toEqual(["None", "X", "R", "dR"]);
  });

  it("does not exclude the option that would coincide with an X binding -- the app invents no such rule elsewhere", () => {
    // GraphBuilderPanel's Group well places no restriction on which channel
    // can be dropped in, including one already used elsewhere in the plot;
    // this panel intentionally offers every column for the same reason.
    renderPanel(null);
    const select = screen.getByLabelText("group by") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["", "0", "1", "2"]);
  });

  it("forwards the numeric channel index when a column is picked", () => {
    const { onGroupKey } = renderPanel(null);
    fireEvent.change(screen.getByLabelText("group by"), { target: { value: "2" } });
    expect(onGroupKey).toHaveBeenCalledWith(2);
  });

  it("forwards null when None is picked, clearing an existing group", () => {
    const { onGroupKey } = renderPanel(0);
    fireEvent.change(screen.getByLabelText("group by"), { target: { value: "" } });
    expect(onGroupKey).toHaveBeenCalledWith(null);
  });

  it("renders with no columns without crashing -- None is still a valid choice", () => {
    renderPanel(null, []);
    expect(screen.getByLabelText("group by")).toHaveValue("");
    const select = screen.getByLabelText("group by") as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
  });
});
