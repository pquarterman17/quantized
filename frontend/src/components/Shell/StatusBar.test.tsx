import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StatusBar from "./StatusBar";
import { HEALTHY } from "../../lib/autosaveGenerations";
import { useConnection } from "../../lib/lifecycle";
import { useAutosaveStatus } from "../../store/autosaveStatus";
import { beginOp, endOp, usePendingOps } from "../../store/pendingOps";
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
