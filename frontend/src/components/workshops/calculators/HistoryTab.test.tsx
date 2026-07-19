// GUI_INTERACTION #17 — "Clear" used to wipe the whole calculator history on
// one click, with a bare verb for a label and no confirm. Clearing is
// irrecoverable and the history is accumulated WORK (every entry would have
// to be re-run), so it is not in the "cheap to recreate, skip the confirm"
// category lib/contextActions.ts carves out for canvas objects.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HistoryTab from "./HistoryTab";
import { askConfirm } from "../../overlays/ConfirmDialog";
import { useCalcHistory, type CalcEntry } from "../../../store/calcHistory";

vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const entry = (id: string): CalcEntry => ({
  id,
  domain: "Optics",
  label: `calc ${id}`,
  summary: "n = 1.5",
  ts: "2026-07-19T00:00:00.000Z",
});

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  useCalcHistory.setState({ history: [entry("a"), entry("b")], favorites: [] });
});

describe("HistoryTab — clearing confirms first", () => {
  it("labels the action, not just the verb", () => {
    render(<HistoryTab />);
    expect(screen.getByText("Clear history")).toBeInTheDocument();
  });

  it("declining the confirm keeps every result", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    render(<HistoryTab />);
    fireEvent.click(screen.getByText("Clear history"));
    expect(askConfirm).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(useCalcHistory.getState().history).toHaveLength(2);
  });

  it("confirming clears them", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    render(<HistoryTab />);
    fireEvent.click(screen.getByText("Clear history"));
    await Promise.resolve();
    expect(useCalcHistory.getState().history).toEqual([]);
  });

  it("counts the results in the confirm and says favourites survive", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    render(<HistoryTab />);
    fireEvent.click(screen.getByText("Clear history"));
    const [title, message] = vi.mocked(askConfirm).mock.calls[0];
    expect(title).toContain("2 calculator results");
    expect(message).toMatch(/Favourites are kept/i);
  });

  it("is disabled with nothing to clear (no confirm to decline)", () => {
    useCalcHistory.setState({ history: [], favorites: [] });
    render(<HistoryTab />);
    fireEvent.click(screen.getByText("Clear history"));
    expect(askConfirm).not.toHaveBeenCalled();
  });
});
