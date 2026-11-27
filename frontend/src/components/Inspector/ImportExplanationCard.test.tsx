// "How this was imported": the decisions an import made (a row-index X, text read
// as categories, error columns bound to their values, what the reader skipped)
// used to live in a timed toast. They now have a durable home in the Inspector,
// reachable after the toast is gone. Driven through the real import action.

import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadFile } from "../../lib/api";
import type { DataStruct } from "../../lib/types";
import { useToasts } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import Inspector from "./Inspector";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), uploadFile: vi.fn() }));

const NOTE_X = "Column 'Run' is text, not numeric or datetime; the time axis fell back to a 1..N row index and the column was imported as a categorical channel.";
const grouped: DataStruct = {
  time: [1, 2, 3, 4],
  values: [[0, 5, 0.5], [0, 6, 0.4], [1, 7, 0.6], [1, 8, 0.5]],
  labels: ["Run", "Signal", "dSignal"],
  units: ["", "V", "V"],
  metadata: { x_column_name: "Sample Index", notes: [NOTE_X, "Text column(s) imported as categorical channel(s): Run."] },
  cat_levels: { 0: ["A", "B"] },
};
const plain: DataStruct = { time: [1, 2], values: [[1], [2]], labels: ["Signal"], units: ["V"], metadata: { x_column_name: "Field" } };

async function importOne(data: DataStruct, name = "run.csv") {
  vi.mocked(uploadFile).mockResolvedValue(data);
  await act(async () => { await useApp.getState().importFiles([new File(["x"], name)]); });
  // The import toast is transient; the explanation must not depend on it.
  act(() => useToasts.setState({ toasts: [] }));
}

beforeEach(() => {
  vi.mocked(uploadFile).mockReset();
  useToasts.setState({ toasts: [] });
  useApp.setState({ datasets: [], activeId: null, selectedIds: [], history: [], future: [], stageTab: "worksheet" });
});

describe("How this was imported", () => {
  it("lists the row-index fallback, categorical fields, error columns and the reader's notes after the toast is gone", async () => {
    await importOne(grouped);
    expect(useToasts.getState().toasts).toEqual([]);
    render(<Inspector />);
    const card = (await screen.findByText("How this was imported")).closest("details")!;
    const text = within(card as HTMLElement);
    expect(text.getByText(/X axis is a 1\.\.N row index/)).toBeInTheDocument();
    expect(text.getByText(/Read as categories: Run \(2 levels\)/)).toBeInTheDocument();
    expect(text.getByText(/dSignal is the ± error of Signal/)).toBeInTheDocument();
    expect(text.getByText(NOTE_X)).toBeInTheDocument();
  });

  it("shows nothing for a plain import with nothing to explain", async () => {
    await importOne(plain, "plain.csv");
    render(<Inspector />);
    await screen.findAllByText("Error columns"); // the Inspector has rendered its data cards
    await new Promise((r) => setTimeout(r, 50)); // and the lazy card had its chance
    expect(screen.queryByText("How this was imported")).toBeNull();
  });
});
