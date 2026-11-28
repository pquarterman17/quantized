// The marginal / ridgeline controls through the real stage hook (plan item 20): a user picks in the
// toolbar, the picks land in the window's saved picks, and the request the stage posts changes.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsMarginal, statsRidgeline } from "../../lib/api/statsDist2";
import type { DataStruct, Dataset } from "../../lib/types";
import { setStatPicks } from "../../store/statLevelOptions";
import { useActiveDataset, useApp } from "../../store/useApp";
import StatDist2Controls from "./StatDist2Controls";
import { useStatStage } from "./useStatStage";

vi.mock("../../lib/api/statsDist2", () => ({ statsMarginal: vi.fn(), statsRidgeline: vi.fn() }));

const n = 12;
const data: DataStruct = {
  time: Array.from({ length: n }, (_, i) => i),
  values: Array.from({ length: n }, (_, i) => [i * 1.5, Math.sin(i) * 3 + i, i % 3, 10 + i * i % 7]),
  labels: ["field", "moment", "lot", "temp"],
  units: ["", "", "", ""],
  metadata: {},
  cat_levels: { 2: ["A", "B", "C"] },
};
const dataset: Dataset = { id: "c", name: "controls.csv", data };

function Toolbar() {
  const st = useStatStage({
    active: useActiveDataset(), yKeys: null, xKey: null, seriesOrder: null, seed: null,
    onSeedConsumed: () => {}, picks: useApp((s) => s.statPicks), onPicksChange: setStatPicks,
  });
  return <StatDist2Controls st={st} />;
}

beforeEach(() => {
  vi.resetAllMocks();
  const wire = { kind: "histogram", n, x: [0, 1], y: [0, 1], domain: { x: [0, 1], y: [0, 1] }, marginals: { x: { edges: [0, 1], counts: [1] }, y: { edges: [0, 1], counts: [1] } } };
  vi.mocked(statsMarginal).mockResolvedValue(wire as never);
  vi.mocked(statsRidgeline).mockRejectedValue(new Error("unused"));
  const init = useApp.getInitialState();
  useApp.setState({
    datasets: [dataset], activeId: "c", statMode: true, statPicks: { mode: "marginal", marginal: "histogram" },
    plotWindows: init.plotWindows, focusedWindowId: init.focusedWindowId, history: [], future: [],
  });
});

describe("marginal controls, end to end", () => {
  it("split by a group, then size by a column: the saved picks and the posted request follow", async () => {
    render(<Toolbar />);
    await waitFor(() => expect(vi.mocked(statsMarginal).mock.calls.length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("split by"), { target: { value: "2" } });
    await waitFor(() => expect(useApp.getState().statPicks).toMatchObject({ marginalSplit: true }));
    await waitFor(() => expect(vi.mocked(statsMarginal).mock.calls.at(-1)![4]).toMatchObject({ group_labels: ["A", "B", "C"] }));
    fireEvent.change(screen.getByLabelText("size"), { target: { value: "3" } });
    await waitFor(() => expect(useApp.getState().statPicks.marginalSize).toBe(3));
    await waitFor(() => expect(vi.mocked(statsMarginal).mock.calls.at(-1)![4]).toMatchObject({ size_label: "temp" }));
    fireEvent.change(screen.getByLabelText("size"), { target: { value: "none" } });
    await waitFor(() => expect(vi.mocked(statsMarginal).mock.calls.at(-1)![4]).not.toHaveProperty("size"));
    fireEvent.change(screen.getByLabelText("split by"), { target: { value: "none" } });
    await waitFor(() => expect(vi.mocked(statsMarginal).mock.calls.at(-1)![4]).toEqual({}));
  });
});
