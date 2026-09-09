import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StatusBar from "./StatusBar";
import { HEALTHY } from "../../lib/autosaveGenerations";
import { useConnection } from "../../lib/lifecycle";
import { useAutosaveStatus } from "../../store/autosaveStatus";
import { beginOp, endOp, updateOp, usePendingOps } from "../../store/pendingOps";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  vi.useFakeTimers();
  useApp.setState({ status: "ready", datasets: [], activeId: null });
  useConnection.setState({ connected: true });
  useAutosaveStatus.setState({ health: HEALTHY });
  usePendingOps.setState({ ops: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StatusBar pending-op indicator (P3.4 slice 2)", () => {
  it("does not show a fresh op immediately (age-gate)", () => {
    render(<StatusBar />);
    act(() => {
      beginOp("Export figure…");
    });
    expect(screen.queryByText("Export figure…")).not.toBeInTheDocument();
  });

  it("shows an op's label once it has been pending past the age-gate", () => {
    render(<StatusBar />);
    act(() => {
      beginOp("Export figure…");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("Export figure…")).toBeInTheDocument();
  });

  it("hides again once the op completes", () => {
    render(<StatusBar />);
    let id = -1;
    act(() => {
      id = beginOp("Export figure…");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("Export figure…")).toBeInTheDocument();
    act(() => {
      endOp(id);
    });
    expect(screen.queryByText("Export figure…")).not.toBeInTheDocument();
  });

  it('shows "and N more" once multiple ops are past the gate', () => {
    render(<StatusBar />);
    act(() => {
      beginOp("Export figure…");
      beginOp("Export Origin (.ogs)…");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText(/Export figure…/)).toBeInTheDocument();
    expect(screen.getByText(/\+1 more/)).toBeInTheDocument();
  });

  it("the autosave-failing banner keeps precedence — still renders alongside a pending op", () => {
    useAutosaveStatus.setState({ health: { savedAt: null, error: "disk full", count: 0 } });
    render(<StatusBar />);
    act(() => {
      beginOp("Export figure…");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("Export figure…")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("autosave failing");
  });

  it("the autosave-failing banner still renders with no pending ops (unweakened baseline)", () => {
    useAutosaveStatus.setState({ health: { savedAt: null, error: "disk full", count: 0 } });
    render(<StatusBar />);
    expect(screen.getByRole("alert")).toHaveTextContent("autosave failing");
  });
});

describe("StatusBar pending-op live region (accessibility gap)", () => {
  // A screen-reader user gets no indication the P3.4 progress feed exists or
  // changes at all without an ARIA live region on the pending-op list itself
  // (only the Cancel button had a label before this). Progress should not
  // interrupt whatever the user is doing — `polite`, not `alert` — so this is
  // deliberately `role="status"`/`aria-live="polite"`, distinct from the
  // `role="alert"` autosave-failure banner covered above. Queried by the
  // `.qzk-pending` class (not `getByRole("status", {name})`) because "status"
  // is a name-from-author role — content alone isn't a reliable accessible
  // name, so the real fix must not depend on one either.
  function pendingRegion(): Element | null {
    return document.querySelector(".qzk-pending");
  }

  // REVIEW ROUND. The live region must already EXIST while idle. A region
  // inserted into the DOM in the same commit as its first text is commonly not
  // announced at all by screen readers — so a conditionally-rendered region
  // loses the first announcement, which for a short operation is the only one.
  // The class-based queries above cannot see this: `.qzk-pending` is still
  // absent while idle (only the class is dropped, not the element), so this
  // asserts on the region itself.
  it("keeps the live region mounted while idle, so the first op is announced", () => {
    render(<StatusBar />);
    const region = document.querySelector('[role="status"][aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region!.textContent).toBe(""); // present, but announcing nothing yet
  });

  it("exposes the pending-op indicator as a polite live region", () => {
    render(<StatusBar />);
    act(() => {
      beginOp("Export figure…");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const region = pendingRegion();
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region!.textContent).toContain("Export figure…");
  });

  it("announces the updated label (not just the initial one) as an op's progress changes", () => {
    render(<StatusBar />);
    let id = -1;
    act(() => {
      id = beginOp("Importing 1/19: a.dat…");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(pendingRegion()!.textContent).toContain("Importing 1/19");
    act(() => {
      updateOp(id, "Importing 2/19: b.dat…");
    });
    expect(pendingRegion()!.textContent).toContain("Importing 2/19");
    expect(pendingRegion()!.textContent).not.toContain("Importing 1/19");
  });

  it("does not render a status live region when nothing is pending", () => {
    render(<StatusBar />);
    expect(pendingRegion()).toBeNull();
  });
});

describe("StatusBar cancel affordance (P3.4 slice 1)", () => {
  it("renders no Cancel control for an op with no cancel callback", () => {
    render(<StatusBar />);
    act(() => {
      beginOp("Export figure…");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("Export figure…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("renders a Cancel control for an op that carries one, and clicking it calls cancel", () => {
    const cancel = vi.fn();
    render(<StatusBar />);
    act(() => {
      beginOp("Importing scan.dat…", cancel);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const btn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(btn);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("shows Cancel for only the first (oldest) op when several are pending", () => {
    const cancelA = vi.fn();
    const cancelB = vi.fn();
    render(<StatusBar />);
    act(() => {
      beginOp("Importing a.dat…", cancelA);
      beginOp("Importing b.dat…", cancelB);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelA).toHaveBeenCalledOnce();
    expect(cancelB).not.toHaveBeenCalled();
  });
});
