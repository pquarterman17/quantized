// P2.5 — preview/commit PARITY for the Reshape & combine workshop: for every
// op, the dataset Create adds is exactly the result the preview showed (plus
// the stamped provenance), because both run lib/transformRun.computeTransform
// with the same params. And the commit never creates silently when its
// inputs changed under it (a still-loading book resolving at Create).

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct, Dataset } from "../../../lib/types";
import { useTransformPreviewDialog, type PreviewOp } from "../../../store/transformPreviewDialog";
import { useApp } from "../../../store/useApp";
import { useReshapePreview } from "./useReshapePreview";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn() }));
const { askConfirm } = await import("../../../store/confirmDialog");

const wide: DataStruct = {
  time: [1, 2, 3],
  values: [[10, 0.1], [20, 0.2], [30, 0.3]],
  labels: ["M", "T"],
  units: ["emu", "K"],
  metadata: {},
};
const long: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[5, 1, 7], [5, 2, 8], [6, 1, 9], [5, 1, 11]],
  labels: ["key", "cat", "val"],
  units: ["", "", "V"],
  metadata: {},
};
const other: DataStruct = { time: [4], values: [[0.4, 40, 1]], labels: ["T", "M", "H"], units: ["K", "emu", "Oe"], metadata: {} };

function setup(op: PreviewOp, seed: string[], datasets: Dataset[]) {
  useApp.setState({ datasets, folders: [], activeId: seed[0], selectedIds: seed, macroRecording: true, macroSteps: [] });
  useTransformPreviewDialog.setState({ op, seed, opened: 1 });
}

beforeEach(() => {
  vi.clearAllMocks();
});

/** The created data must be the previewed data plus the stamped provenance. */
function expectParity(shown: { data: DataStruct; name: string; preview: { warnings: { text: string }[] } }, created: Dataset, op: string) {
  expect(created.name).toBe(shown.name);
  expect(created.data).toEqual({
    ...shown.data,
    metadata: { ...shown.data.metadata, worksheet_transform: op, transform_warnings: shown.preview.warnings.map((w) => w.text) },
  });
}

describe("Reshape & combine — the created dataset IS the previewed one", () => {
  it.each([
    ["transpose", ["w"]],
    ["stack", ["w"]],
    ["unstack", ["l"]],
  ] as const)("%s", async (op, seed) => {
    setup(op, [...seed], [
      { id: "w", name: "wide.dat", data: wide },
      { id: "l", name: "long.dat", data: long },
    ]);
    const { result } = renderHook(() => useReshapePreview());
    if (op === "unstack") act(() => result.current.setForm({ key: 0, category: 1, value: 2 }));
    await waitFor(() => expect(result.current.computed).not.toBeNull());
    const shown = result.current.computed!;
    // Stack of M (emu) and T (K) is a unit mismatch: acknowledged first.
    if (op === "stack") {
      expect(result.current.blockedByUnits).toBe(true);
      expect(result.current.canCreate).toBe(false);
      act(() => result.current.setUnitsAcknowledged(true));
    }
    expect(result.current.canCreate).toBe(true);
    await act(async () => result.current.create());
    const created = useApp.getState().datasets[2];
    expectParity(shown, created, op);
    expect(askConfirm).not.toHaveBeenCalled();
    expect(useApp.getState().macroSteps[0].params).toMatchObject({ op, input: { id: seed[0] } });
    // Closes on success.
    expect(useTransformPreviewDialog.getState().op).toBeNull();
  });

  it("append by name", async () => {
    setup("merge", ["w", "o"], [
      { id: "w", name: "wide.dat", data: wide },
      { id: "o", name: "other.dat", data: other },
    ]);
    const { result } = renderHook(() => useReshapePreview());
    // By position the counts differ: the preview says so and Create is off.
    await waitFor(() => expect(result.current.error).toMatch(/column-count mismatch/));
    expect(result.current.canCreate).toBe(false);
    act(() => result.current.setForm({ match: "name" }));
    await waitFor(() => expect(result.current.computed).not.toBeNull());
    const shown = result.current.computed!;
    expect(shown.preview.warnings.map((w) => w.code)).toEqual(["missing-columns"]);
    expect(shown.preview.inputs).toEqual([
      { name: "wide.dat", rows: 3, cols: 2 },
      { name: "other.dat", rows: 1, cols: 3 },
    ]);
    await act(async () => result.current.create());
    const created = useApp.getState().datasets[2];
    expectParity(shown, created, "merge");
    expect(created.data.labels).toEqual(["M", "T", "H"]);
    expect(useApp.getState().macroSteps[0].params).toMatchObject({ op: "merge", match: "name", with: [{ id: "o", name: "other.dat" }] });
  });

  it("join by a text key, duplicate keys and all", async () => {
    const l: DataStruct = { ...wide, values: [[0, 1], [1, 2], [1, 3]], labels: ["S", "a"], units: ["", ""], cat_levels: { 0: ["x", "y"] } };
    const r: DataStruct = { time: [0, 1], values: [[0, 9], [1, 8]], labels: ["S", "b"], units: ["", ""], metadata: {}, cat_levels: { 0: ["y", "x"] } };
    setup("join", ["L", "R"], [
      { id: "L", name: "l.dat", data: l },
      { id: "R", name: "r.dat", data: r },
    ]);
    const { shown, created } = await (async () => {
      const { result } = renderHook(() => useReshapePreview());
      act(() => result.current.setForm({ leftKey: "0", rightKey: "0" }));
      await waitFor(() => expect(result.current.computed).not.toBeNull());
      const shown = result.current.computed!;
      await act(async () => result.current.create());
      return { shown, created: useApp.getState().datasets[2] };
    })();
    expect(shown.preview.warnings.map((w) => w.code)).toEqual(["duplicate-keys"]);
    // x matched r's "x" (its code 1), y matched r's "y" (its code 0).
    expect(shown.data.values).toEqual([[0, 1, 8], [1, 2, 9]]);
    expectParity(shown, created, "join");
    expect(useApp.getState().macroSteps[0].params).toMatchObject({ op: "join", leftKey: 0, rightKey: 0, with: { id: "R" } });
  });
});

describe("Reshape & combine — staleness and a still-loading book", () => {
  it("an edit makes the preview stale; Create waits for the new one", async () => {
    setup("stack", ["w"], [{ id: "w", name: "wide.dat", data: wide }]);
    const { result } = renderHook(() => useReshapePreview());
    await waitFor(() => expect(result.current.computed).not.toBeNull());
    act(() => result.current.setForm({ channels: [0] }));
    expect(result.current.computed).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(result.current.canCreate).toBe(false);
    await waitFor(() => expect(result.current.computed?.data.time).toHaveLength(3));
    expect(result.current.canCreate).toBe(true);
  });

  it("labels a pending book's preview, and reviews again when the full rows warn differently", async () => {
    const preview: DataStruct = { ...wide, time: [1], values: [[10, 0.1]] };
    const full: DataStruct = { ...wide, values: [[10, 0.1], [Number.NaN, 0.2], [30, 0.3]] };
    const pending: Dataset = {
      id: "p", name: "book.opj", data: preview,
      pending: { kind: "path", path: "/b.opj", bookId: "B", rows: 3, cols: 2 },
    };
    setup("unstack", ["p"], [pending]);
    const resolved: Dataset = { id: "p", name: "book.opj", data: full };
    useApp.setState({
      resolveDataset: vi.fn(async () => {
        useApp.setState({ datasets: [resolved] });
        return resolved;
      }),
    });
    vi.mocked(askConfirm).mockResolvedValue(false);
    const { result } = renderHook(() => useReshapePreview());
    act(() => result.current.setForm({ key: 0, category: -1, value: 1 }));
    await waitFor(() => expect(result.current.computed).not.toBeNull());
    expect(result.current.previewOnly).toBe(true);
    expect(result.current.computed!.preview.warnings).toEqual([]);
    await act(async () => result.current.create());
    // The full rows drop a blank key the preview never saw: asked, declined,
    // nothing created, the workshop stays open.
    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(askConfirm).mock.calls[0][1])).toContain("1 row with a blank key");
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useTransformPreviewDialog.getState().op).toBe("unstack");
  });
});
