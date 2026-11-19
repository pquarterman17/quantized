// "Apply to selected sheets…" with grouping on (Signal Processing passes
// `groupName`): N >= 2 outputs land in a folder "<Operation> (N)" next to the
// sources, as ONE undo step with the apply, and "Overlay these N" is offered.
// Runs the REAL applyRecipe through the real store.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeStep } from "../../../lib/pipelineStep";
import { deriveExpectations } from "../../../lib/recipeExpect";
import { toTemplate } from "../../../lib/template";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import BatchApplyLauncher from "./BatchApplyLauncher";

const { plotMock } = vi.hoisted(() => ({ plotMock: vi.fn() }));
vi.mock("../../../lib/plotSelectedTogether", () => ({ plotSelectedTogether: plotMock }));
vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

const sheet = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["v"], units: [""], metadata: {} },
});
const stackStep = makeStep("transform", "Stack", "", { op: "stack", channels: [0] });
const recipe = () => toTemplate("recipe", [stackStep], [], { expects: deriveExpectations([stackStep], sheet("a")) });

const setup = (ids: string[]) =>
  useApp.setState({
    datasets: ids.map(sheet),
    folders: [],
    selectedIds: ids,
    activeId: ids[0],
    pipelineRunning: false,
    macroRecording: false,
    history: [],
    future: [],
  });

async function applyAll(n: number) {
  fireEvent.click(screen.getByRole("button", { name: "Apply to selected sheets…" }));
  const apply = await screen.findByRole("button", { name: `Apply to ${n} dataset${n === 1 ? "" : "s"}` });
  await act(async () => {
    fireEvent.click(apply);
  });
  await waitFor(() => expect(screen.getByRole("list", { name: "Apply results" })).toBeInTheDocument());
}

beforeEach(() => plotMock.mockReset());

describe("BatchApplyLauncher grouping", () => {
  it("3 outputs land in one '<Operation> (3)' folder, offer Overlay, and one undo removes outputs + folder", async () => {
    setup(["a", "b", "c"]);
    render(<BatchApplyLauncher setup="s" build={recipe} disabledReason="" groupName="Normalise" />);
    await applyAll(3);
    const s = useApp.getState();
    expect(s.folders.map((f) => f.name)).toEqual(["Normalise (3)"]);
    const outs = s.datasets.filter((d) => !["a", "b", "c"].includes(d.id));
    expect(outs).toHaveLength(3);
    expect(outs.every((d) => d.folderId === s.folders[0].id)).toBe(true);
    expect(s.history).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Overlay these 3/ }));
    expect(plotMock).toHaveBeenCalledWith(outs.map((d) => d.id));

    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(useApp.getState().folders).toHaveLength(0);
  });

  it("a single sheet is unchanged: no folder, no overlay button", async () => {
    setup(["a"]);
    render(<BatchApplyLauncher setup="s" build={recipe} disabledReason="" groupName="Normalise" />);
    await applyAll(1);
    expect(useApp.getState().folders).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Overlay these/ })).toBeNull();
  });

  it("without groupName (Recipe-style callers) nothing is grouped", async () => {
    setup(["a", "b"]);
    render(<BatchApplyLauncher setup="s" build={recipe} disabledReason="" />);
    await applyAll(2);
    expect(useApp.getState().folders).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Overlay these/ })).toBeNull();
  });
});
