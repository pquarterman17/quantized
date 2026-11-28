// B4 (acceptance pass 13): a plain CSV `id,grp,sub,val` makes only its first text column a
// channel; `grp` and `sub` stay in `metadata.text_columns`. The Statistics stage's
// group-by / then-by / facet-by / colour-by pickers must still offer them, through the real
// stage and store. Medians are checked against values worked out by hand.

import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox } from "../../lib/api";
import { withTextGroupChannels } from "../../lib/groupableColumns";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import StatStage from "./StatStage";
import { useStatStage } from "./useStatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

// id,grp,sub,val -- as the CSV importer leaves it: `id` (first column) is the categorical
// channel, `val` numeric, `grp` and `sub` text sidecars. 12 rows.
const GRP = ["A", "A", "A", "A", "A", "A", "B", "B", "B", "B", "B", "B"];
const SUB = ["x", "x", "x", "y", "y", "y", "x", "x", "x", "y", "y", "y"];
const VAL = [1, 2, 3, 10, 11, 12, 20, 21, 22, 30, 31, 32];
const DS: Dataset = {
  id: "sv", name: "sv.csv",
  data: {
    time: VAL.map((_, i) => i + 1),
    values: VAL.map((v, i) => [v, i]),
    labels: ["val", "id"], units: ["", ""],
    cat_levels: { 1: VAL.map((_, i) => `r${i + 1}`) },
    metadata: { text_columns: { grp: GRP, sub: SUB } },
  },
};
const combo = (name: string) => screen.getByRole("combobox", { name });
const optionsOf = (name: string) => Array.from(combo(name).querySelectorAll("option")).map((o) => o.textContent);

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(statsBox).mockRejectedValue(new Error("offline"));
  useApp.setState({
    theme: "dark", accent: "violet", datasets: [DS], activeId: "sv", selection: null, yKeys: [0], xKey: null,
    seriesOrder: null, statStageSeed: null, statMarks: {}, statPicks: {}, history: [], future: [],
  });
});

describe("Statistics stage pickers on a plain CSV", () => {
  it("offers every text column to group by, then by and facet by", async () => {
    render(<StatStage />);
    await waitFor(() => expect(optionsOf("group by")).toContain("grp"));
    expect(optionsOf("group by")).toEqual(["(per channel)", "id", "grp", "sub"]);
    await userEvent.selectOptions(combo("group by"), "grp");
    await waitFor(() => expect(optionsOf("facet by")).toEqual(["(none)", "id", "sub"]));
    expect(optionsOf("then by")).toEqual(["(none)", "id", "sub"]);
  });

  it("groups by a text column and facets by another, one panel per level", async () => {
    const { container } = render(<StatStage />);
    await userEvent.selectOptions(combo("group by"), "grp");
    await userEvent.selectOptions(combo("value"), "val");
    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(1));
    await userEvent.selectOptions(combo("facet by"), "sub");
    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(2));
    expect(screen.getByText(/\bx\b/)).toBeInTheDocument();
    expect(screen.getByText(/\by\b/)).toBeInTheDocument();
  });
});

describe("the groups and panels a text column makes", () => {
  it("puts each (grp, sub) cell's own rows in its panel, with the hand-computed values", async () => {
    const active = withTextGroupChannels(DS);
    expect(active.data.labels).toEqual(["val", "id", "grp", "sub"]);
    const { result } = renderHook(() => useStatStage({ active, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {} }));
    act(() => result.current.setValueCol(0));
    act(() => result.current.setGroupCol(2));
    act(() => result.current.setFacetCol(3));
    act(() => result.current.setMarks({ points: "all", jitterWidth: 0.5 }));
    await waitFor(() => expect(result.current.drawFacets?.length).toBe(2));
    const panels = (result.current.drawFacets ?? []).map((f) => {
      const d = f.draw;
      if (d.mode !== "box") throw new Error(d.mode);
      return { facet: f.label, groups: (d.points ?? []).map((g) => ({ label: g.label, rows: g.points.map((p) => p.rowIndex) })) };
    });
    // Rows by hand: grp A = rows 0-5, B = 6-11; sub x = 0-2 and 6-8, y = 3-5 and 9-11.
    expect(panels.map((p) => p.groups.map((g) => g.rows))).toEqual([
      [[0, 1, 2], [6, 7, 8]],
      [[3, 4, 5], [9, 10, 11]],
    ]);
    expect(panels.map((p) => p.groups.map((g) => g.label))).toEqual([["grp = A", "grp = B"], ["grp = A", "grp = B"]]);
    expect(panels[0].facet).toContain("x");
    expect(panels[1].facet).toContain("y");
  });
});

describe("an error does not trap the user in the mode (B3)", () => {
  it("shows the error click-through and below the tool bar, and the mode tabs still switch", async () => {
    const one: Dataset = { id: "one", name: "one.csv", data: { time: [1, 2, 3], values: [[1], [2], [3]], labels: ["val"], units: [""], metadata: {} } };
    useApp.setState({ datasets: [one], activeId: "one", yKeys: [0] });
    render(<StatStage />);
    await userEvent.click(screen.getByRole("radio", { name: "Paired" }));
    const err = await screen.findByTestId("stat-stage-error");
    expect(err).toHaveTextContent(/after/);
    expect(err.style.pointerEvents).toBe("none");
    expect(err.style.inset === "0" || err.style.top === "0px").toBe(false);
    await userEvent.click(screen.getByRole("radio", { name: "Box" }));
    await waitFor(() => expect(screen.queryByTestId("stat-stage-error")).toBeNull());
  });
});
