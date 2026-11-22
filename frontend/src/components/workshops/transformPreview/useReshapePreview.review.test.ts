// Lane WB3 nit: closing Reshape & combine while its unit-mismatch review dialog
// is open used to leave the dialog up, and confirming it then silently created
// nothing (the commit was already aborted). Close now dismisses the dialog (its
// answer is "no"); nothing is created and nothing is reported as a failure.
// Forced deterministically: the commit's full compute is replaced by one that
// asks for review with warnings different from the previewed ones, and Close is
// pressed while the dialog is up.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewFn } from "../../../lib/transformRun";
import { useConfirm } from "../../../store/confirmDialog";
import { useTransformPreviewDialog } from "../../../store/transformPreviewDialog";
import { useApp } from "../../../store/useApp";
import { useReshapePreview } from "./useReshapePreview";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
const { runTransform } = vi.hoisted(() => ({ runTransform: vi.fn() }));
vi.mock("../../../lib/transformRun", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/transformRun")>()),
  runTransform,
}));

const MISMATCH = {
  title: "Transpose", summary: "Result: 1 row", inputs: [],
  warnings: [{ code: "unit-mismatch" as const, text: "units differ: emu vs K", confirm: true }],
};

beforeEach(() => {
  vi.clearAllMocks();
  useConfirm.getState().close();
  useApp.setState({
    datasets: [{ id: "d", name: "a.dat", data: { time: [1, 2], values: [[1, 2], [3, 4]], labels: ["M", "T"], units: ["emu", "K"], metadata: {} } }],
    folders: [], activeId: "d", selectedIds: ["d"], macroSteps: [],
  });
  useTransformPreviewDialog.setState({ op: "transpose", seed: ["d"], opened: 1 });
});

/** The commit's compute: asks for review, then reports whether it was approved. */
function reviewing() {
  const outcome: { approved: boolean | null } = { approved: null };
  runTransform.mockImplementation(async (_get: unknown, _p: unknown, _id: string, review: ReviewFn) => {
    outcome.approved = await review(MISMATCH);
    return null;
  });
  return outcome;
}

describe("Reshape & combine: Close while the unit-mismatch review is open", () => {
  it("dismisses the dialog, creates nothing and reports no failure", async () => {
    const outcome = reviewing();
    const { result } = renderHook(() => useReshapePreview());
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    let creating!: Promise<void>;
    act(() => { creating = result.current.create(); });
    await waitFor(() => expect(useConfirm.getState().title).toMatch(/units differ/));
    act(() => result.current.close());
    expect(useConfirm.getState().title).toBeNull(); // the dialog is gone
    await act(async () => { await creating; });
    expect(outcome.approved).toBe(false);
    expect(result.current.commitError).toBeNull();
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("without Close the dialog stays and confirming approves (control)", async () => {
    const outcome = reviewing();
    const { result } = renderHook(() => useReshapePreview());
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    let creating!: Promise<void>;
    act(() => { creating = result.current.create(); });
    await waitFor(() => expect(useConfirm.getState().title).toMatch(/units differ/));
    await act(async () => { useConfirm.getState().resolve?.(true); await creating; });
    expect(outcome.approved).toBe(true);
  });

  it("Close dismisses only ITS dialog, not an unrelated confirm opened since", async () => {
    reviewing();
    const { result } = renderHook(() => useReshapePreview());
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    let creating!: Promise<void>;
    act(() => { creating = result.current.create(); });
    await waitFor(() => expect(useConfirm.getState().title).toMatch(/units differ/));
    const { askConfirm } = await import("../../../store/confirmDialog");
    void askConfirm("Something else?"); // replaces ours (ours is answered "no")
    act(() => result.current.close());
    expect(useConfirm.getState().title).toBe("Something else?");
    await act(async () => { await creating; });
  });
});
