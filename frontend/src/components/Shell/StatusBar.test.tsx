import { act, render, screen } from "@testing-library/react";
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
