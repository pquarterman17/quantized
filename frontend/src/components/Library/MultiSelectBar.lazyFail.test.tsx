// P3.4 residual: a failed lazy chunk load behind the multi-selection Export
// button used to be a silent no-op (a bare `void import(...)`). It now goes
// through runLazy, so the user sees the standard error toast. Its own file
// because the failing module mock would break every other Export test.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MultiSelectBar from "./MultiSelectBar";
import type { Dataset, DataStruct } from "../../lib/types";
import { usePendingOps } from "../../store/pendingOps";
import { useToasts } from "../../store/toasts";
import { useApp } from "../../store/useApp";

vi.mock("./folderOps", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

const raw: DataStruct = { time: [1, 2], values: [[1], [2]], labels: ["m"], units: ["emu"], metadata: {} };
const ds = (id: string): Dataset => ({ id, name: `${id}.dat`, data: raw });

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  usePendingOps.setState({ ops: [] });
  useApp.setState({ datasets: [ds("a"), ds("b")], selectedIds: ["a", "b"] });
});

describe("MultiSelectBar Export when its chunk fails to load", () => {
  it("shows the standard error toast and leaves no busy entry behind", async () => {
    render(<MultiSelectBar />);
    fireEvent.click(screen.getByText("Export"));
    await waitFor(() =>
      expect(useToasts.getState().toasts.map((t) => [t.kind, t.msg])).toEqual([
        ["danger", expect.stringMatching(/^Could not load the dataset export: /)],
      ]),
    );
    expect(usePendingOps.getState().ops).toEqual([]);
  });
});
