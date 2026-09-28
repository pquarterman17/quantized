import { beforeEach, describe, expect, it, vi } from "vitest";

import { askConfirm } from "../components/overlays/ConfirmDialog";
import { createPageDocument } from "../lib/pageDocumentActions";
import { useImportBatch } from "../store/importBatch";
import { useApp } from "../store/useApp";
import { buildFileCommands } from "./fileCommands";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

function runRemoveAll(): void {
  const action = buildFileCommands(useApp.getState).find((item) => item.id === "remove-all");
  if (!action) throw new Error("remove-all command missing");
  action.run();
}

describe("File ▸ Remove all", () => {
  beforeEach(() => {
    vi.mocked(askConfirm).mockReset();
    useImportBatch.setState({ running: false });
    useApp.setState({
      datasets: [], folders: [], workbooks: [], pages: [], reports: [], figureDocs: [], editableFigures: [],
      macroSteps: [], techniqueViewMemory: {}, history: [], future: [],
    });
  });

  it("does not mistake a dataset-free project with other content for an empty project", async () => {
    useApp.setState({ pages: [createPageDocument({ id: "page-1", name: "Figure page" })] });
    vi.mocked(askConfirm).mockResolvedValue(false);
    runRemoveAll();
    await Promise.resolve();
    expect(askConfirm).toHaveBeenCalledOnce();
    expect(vi.mocked(askConfirm).mock.calls[0][1]).toContain("dataset-free session");
    expect(useApp.getState().pages).toHaveLength(1);
  });

  it("describes the real current-session undo behavior", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "data", data: { time: [], values: [], labels: [], units: [], metadata: {} } }] });
    vi.mocked(askConfirm).mockResolvedValue(false);
    runRemoveAll();
    const message = vi.mocked(askConfirm).mock.calls[0][1];
    expect(message).toContain("undo this during the current session");
    expect(message).not.toContain("can't be undone");
  });

  it("does not clear the project while an import can still append results", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "data", data: { time: [], values: [], labels: [], units: [], metadata: {} } }] });
    useImportBatch.setState({ running: true });
    vi.mocked(askConfirm).mockResolvedValue(true);

    runRemoveAll();
    await Promise.resolve();

    expect(askConfirm).toHaveBeenCalledOnce();
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("rechecks for an import that starts while confirmation is open", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "data", data: { time: [], values: [], labels: [], units: [], metadata: {} } }] });
    let confirm: ((ok: boolean) => void) | undefined;
    vi.mocked(askConfirm).mockReturnValue(new Promise((resolve) => { confirm = resolve; }));

    runRemoveAll();
    useImportBatch.setState({ running: true });
    confirm?.(true);
    await Promise.resolve();

    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("undo restores recorded macro steps and technique-specific view memory", async () => {
    const macroStep = { op: "normalize", params: { datasetId: "d1" } } as never;
    const techniqueViewMemory = { "magnetometry.mvsh": { yScale: "log" } } as never;
    useApp.setState({
      datasets: [{ id: "d1", name: "data", data: { time: [], values: [], labels: [], units: [], metadata: {} } }],
      macroSteps: [macroStep], techniqueViewMemory,
    });
    vi.mocked(askConfirm).mockResolvedValue(true);

    runRemoveAll();
    await Promise.resolve();
    expect(useApp.getState().macroSteps).toEqual([]);
    expect(useApp.getState().techniqueViewMemory).toEqual({});

    useApp.getState().undo();
    expect(useApp.getState().macroSteps).toEqual([macroStep]);
    expect(useApp.getState().techniqueViewMemory).toEqual(techniqueViewMemory);
  });
});
