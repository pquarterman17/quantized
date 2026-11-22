// Lane WB2: Close aborts a Create already running. Forced deterministically:
// the still-loading book's full rows are held on a deferred promise, Close is
// pressed inside that window, then the rows arrive. Nothing may be created.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct, Dataset } from "../../../lib/types";
import { useTransformPreviewDialog } from "../../../store/transformPreviewDialog";
import { useApp } from "../../../store/useApp";
import { useReshapePreview } from "./useReshapePreview";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn() }));

const wide: DataStruct = {
  time: [1, 2, 3],
  values: [[10, 0.1], [20, 0.2], [30, 0.3]],
  labels: ["M", "T"],
  units: ["emu", "K"],
  metadata: {},
};

beforeEach(() => vi.clearAllMocks());

function pendingBook(): { resolve: () => void } {
  const pending: Dataset = {
    id: "p", name: "book.opj", data: { ...wide, time: [1], values: [[10, 0.1]] },
    pending: { kind: "path", path: "/b.opj", bookId: "B", rows: 3, cols: 2 },
  };
  useApp.setState({ datasets: [pending], folders: [], activeId: "p", selectedIds: ["p"], macroSteps: [] });
  useTransformPreviewDialog.setState({ op: "transpose", seed: ["p"], opened: 1 });
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  useApp.setState({
    resolveDataset: vi.fn(async () => {
      await held;
      const full: Dataset = { id: "p", name: "book.opj", data: wide };
      useApp.setState({ datasets: [full] });
      return full;
    }),
  });
  return { resolve: release };
}

describe("Reshape & combine: Close aborts a running Create", () => {
  it("creates nothing when Close lands before the book's rows arrive", async () => {
    const book = pendingBook();
    const { result } = renderHook(() => useReshapePreview());
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    let creating!: Promise<void>;
    act(() => { creating = result.current.create(); });
    await waitFor(() => expect(result.current.busy).toBe(true));
    act(() => result.current.close());
    expect(result.current.busy).toBe(false);
    expect(useTransformPreviewDialog.getState().op).toBeNull();
    await act(async () => { book.resolve(); await creating; });
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().macroSteps).toHaveLength(0);
    expect(result.current.commitError).toBeNull();
  });

  it("creates nothing when the window unmounts mid-Create", async () => {
    const book = pendingBook();
    const { result, unmount } = renderHook(() => useReshapePreview());
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    let creating!: Promise<void>;
    act(() => { creating = result.current.create(); });
    unmount();
    await act(async () => { book.resolve(); await creating; });
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("still creates when nobody closes (control)", async () => {
    const book = pendingBook();
    const { result } = renderHook(() => useReshapePreview());
    await waitFor(() => expect(result.current.canCreate).toBe(true));
    let creating!: Promise<void>;
    act(() => { creating = result.current.create(); });
    await act(async () => { book.resolve(); await creating; });
    expect(useApp.getState().datasets).toHaveLength(2);
  });
});
