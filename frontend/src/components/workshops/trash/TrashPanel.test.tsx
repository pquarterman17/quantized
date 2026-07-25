// Trash view (MAIN_PLAN #32). The behaviour worth pinning is the ASYMMETRY:
// restoring is one click, deleting permanently is not — trash exists to make
// deletion recoverable, so the recovering action should be frictionless and the
// irreversible one should not.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import TrashPanel, { trashAge } from "./TrashPanel";
import { useApp } from "../../../store/useApp";
import type { Dataset } from "../../../lib/types";

const ds = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0], values: [[1]], labels: ["M"], units: [""], metadata: {} },
});

beforeEach(() => {
  useApp.setState({ datasets: [], trash: [], trashOpen: true, activeId: null, status: "" });
});

describe("trashAge", () => {
  it("buckets coarsely, like the Recent menu", () => {
    const now = 100 * 86_400_000;
    expect(trashAge(now, now)).toBe("just now");
    expect(trashAge(now - 5 * 3_600_000, now)).toBe("5h ago");
    expect(trashAge(now - 86_400_000, now)).toBe("yesterday");
    expect(trashAge(now - 3 * 86_400_000, now)).toBe("3d ago");
  });
});

describe("TrashPanel", () => {
  it("explains itself when empty, rather than showing a bare box", () => {
    render(<TrashPanel />);
    expect(screen.getByText(/Nothing deleted yet/)).toBeInTheDocument();
  });

  it("lists trashed datasets", () => {
    useApp.setState({ trash: [{ at: Date.now(), dataset: ds("a") }] });
    render(<TrashPanel />);
    expect(screen.getByText("a.dat")).toBeInTheDocument();
  });

  it("restores in ONE click", () => {
    useApp.setState({ trash: [{ at: Date.now(), dataset: ds("a") }] });
    render(<TrashPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a"]);
    expect(useApp.getState().trash).toHaveLength(0);
  });

  it("does NOT delete permanently on the first click", () => {
    // The irreversible action is two-step on purpose.
    useApp.setState({ trash: [{ at: Date.now(), dataset: ds("a") }] });
    render(<TrashPanel />);
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(useApp.getState().trash).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Sure?" })).toBeInTheDocument();
  });

  it("deletes permanently on the confirm click", () => {
    useApp.setState({ trash: [{ at: Date.now(), dataset: ds("a") }] });
    render(<TrashPanel />);
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    fireEvent.click(screen.getByRole("button", { name: "Sure?" }));
    expect(useApp.getState().trash).toHaveLength(0);
    expect(useApp.getState().datasets).toHaveLength(0); // purge ≠ restore
  });

  it("STATES the eviction rules rather than letting entries vanish silently", () => {
    // An entry disappearing unannounced teaches users the trash cannot be
    // trusted, which is worse than not having one.
    useApp.setState({ trash: [{ at: Date.now(), dataset: ds("a") }] });
    render(<TrashPanel />);
    expect(screen.getByText(/most recent for/)).toBeInTheDocument();
    expect(screen.getByText(/Raw source files are never touched/)).toBeInTheDocument();
  });
});
