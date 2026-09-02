// Trash view (MAIN_PLAN #32; widened by P3.7). The behaviour worth pinning
// is the ASYMMETRY: restoring is one click, deleting one row permanently is
// two, and emptying the WHOLE trash shows a purge preview first — trash
// exists to make deletion recoverable, so the recovering action should be
// frictionless and the irreversible ones should not.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TrashPanel from "./TrashPanel";
import { askConfirm } from "../../overlays/ConfirmDialog";
import { byteSize, type DatasetTrashEntry } from "../../../store/trash";
import { useApp } from "../../../store/useApp";
import type { Dataset } from "../../../lib/types";

vi.mock("../../overlays/ConfirmDialog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../overlays/ConfirmDialog")>();
  return { ...actual, askConfirm: vi.fn() };
});

const ds = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0], values: [[1]], labels: ["M"], units: [""], metadata: {} },
});

const dsEntry = (id: string, at = Date.now()): DatasetTrashEntry => ({
  kind: "dataset", at, bytes: byteSize(ds(id)), dataset: ds(id),
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [], trash: [], trashOpen: true, activeId: null, status: "" });
});

describe("TrashPanel", () => {
  it("explains itself when empty, rather than showing a bare box", () => {
    render(<TrashPanel />);
    expect(screen.getByText(/Nothing deleted yet/)).toBeInTheDocument();
  });

  it("lists trashed datasets with a kind badge and size", () => {
    useApp.setState({ trash: [dsEntry("a")] });
    render(<TrashPanel />);
    expect(screen.getByText("a.dat")).toBeInTheDocument();
    expect(screen.getByText("Data")).toBeInTheDocument();
  });

  it("restores in ONE click", () => {
    useApp.setState({ trash: [dsEntry("a")] });
    render(<TrashPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a"]);
    expect(useApp.getState().trash).toHaveLength(0);
  });

  it("does NOT delete one row permanently on the first click", () => {
    useApp.setState({ trash: [dsEntry("a")] });
    render(<TrashPanel />);
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(useApp.getState().trash).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Sure?" })).toBeInTheDocument();
  });

  it("deletes one row permanently on the confirm click", () => {
    useApp.setState({ trash: [dsEntry("a")] });
    render(<TrashPanel />);
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    fireEvent.click(screen.getByRole("button", { name: "Sure?" }));
    expect(useApp.getState().trash).toHaveLength(0);
    expect(useApp.getState().datasets).toHaveLength(0); // purge ≠ restore
  });

  it("STATES the eviction rules (count/age/size) rather than letting entries vanish silently", () => {
    useApp.setState({ trash: [dsEntry("a")] });
    render(<TrashPanel />);
    expect(screen.getByText(/most recent, up to/)).toBeInTheDocument();
    expect(screen.getByText(/MiB total/)).toBeInTheDocument();
    expect(screen.getByText(/Raw source files are never touched/)).toBeInTheDocument();
  });

  it("shows a summary line naming counts/kinds and total size", () => {
    useApp.setState({ trash: [dsEntry("a"), dsEntry("b")] });
    render(<TrashPanel />);
    expect(screen.getByText(/2 datasets/)).toBeInTheDocument();
  });

  it("Empty trash asks first, with a purge-preview body naming what's lost", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    useApp.setState({ trash: [dsEntry("a"), dsEntry("b")] });
    render(<TrashPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Empty trash" }));
    // askConfirm is called synchronously, before emptyTrash's first await —
    // a bare (unwrapped) assertion is fine (see architecture.test.ts's own
    // weak-wait-ratchet doc); no need to synchronize on it.
    expect(askConfirm).toHaveBeenCalled();
    const [title, message] = vi.mocked(askConfirm).mock.calls[0];
    expect(title).toMatch(/Empty trash/);
    expect(message).toMatch(/2 datasets/);
    expect(message).toMatch(/cannot be undone/);
    await Promise.resolve(); // flush the resolved (cancelled) confirm
    expect(useApp.getState().trash).toHaveLength(2); // cancelled — nothing purged
  });

  it("Empty trash purges everything only on confirm", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    useApp.setState({ trash: [dsEntry("a"), dsEntry("b")] });
    render(<TrashPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Empty trash" }));
    await waitFor(() => expect(useApp.getState().trash).toHaveLength(0));
  });
});
