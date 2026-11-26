// The welcome screen's "Restore last session" card (owner decision 2026-11-26).

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setAutosaveBackend } from "../../lib/autosave";
import { memoryBackend } from "../../lib/autosaveBackend";
import { holdForWelcome, resetLateRestore } from "../../lib/lateRestore";
import type { Dataset } from "../../lib/types";
import { parseWorkspace, serializeWorkspace } from "../../lib/workspace";
import { useHeldRestore } from "../../store/heldRestore";
import { useApp } from "../../store/useApp";
import EmptyProjectStage from "./EmptyProjectStage";

vi.mock("../../lib/api", () => ({ fetchBookData: vi.fn() }));

const ds = (id: string, name: string): Dataset => ({
  id,
  name,
  data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
});

function hold(crashed: boolean): void {
  const workspace = parseWorkspace(serializeWorkspace({ datasets: [ds("a", "MH_300K.dat"), ds("b", "MH_10K.dat")] }));
  holdForWelcome({ workspace, at: Date.UTC(2026, 10, 25, 14, 2) }, crashed);
}

beforeEach(() => {
  localStorage.clear();
  setAutosaveBackend(memoryBackend());
  useApp.setState(useApp.getInitialState(), true);
  resetLateRestore();
});

describe("welcome screen restore card", () => {
  it("is absent when nothing is held", () => {
    render(<EmptyProjectStage />);
    expect(screen.queryByRole("button", { name: /Restore last session/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Import data/ })).toBeInTheDocument();
  });

  it("names what would come back and when, and keeps the usual start actions", () => {
    hold(false);
    render(<EmptyProjectStage />);
    const restore = screen.getByRole("button", { name: /Restore last session \(MH_300K\.dat, / });
    expect(restore).toBeInTheDocument();
    expect(screen.getByText(/2 datasets: MH_300K\.dat, MH_10K\.dat/)).toBeInTheDocument();
    expect(screen.getByText("Your last session is saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import data/ })).toBeInTheDocument();
  });

  it("after a crash the card says so", () => {
    hold(true);
    render(<EmptyProjectStage />);
    expect(screen.getByText("Quantized closed unexpectedly")).toBeInTheDocument();
  });

  it("Restore loads the session and the card goes away", async () => {
    hold(false);
    render(<EmptyProjectStage />);
    await userEvent.click(screen.getByRole("button", { name: /Restore last session/ }));
    await waitFor(() => expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["MH_300K.dat", "MH_10K.dat"]));
    expect(useHeldRestore.getState().held).toBeNull();
    await act(async () => undefined);
    expect(screen.queryByRole("button", { name: /Restore last session/ })).toBeNull();
  });
});
