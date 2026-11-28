// Acceptance 14 C3: Create derived worksheet and Freeze copy each set their own status line (the bar
// kept reading the import's "imported 1 file"). Driven through the context-menu actions and the banner button.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { datasetDerivedWorksheetActions } from "../lib/derivedWorksheetActions";
import type { DataStruct, Dataset } from "../lib/types";
import DerivedWorksheetBanner from "../components/Stage/worksheet/DerivedWorksheetBanner";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  applyCorrections: vi.fn(),
}));
import { applyCorrections } from "../lib/api";

const data = (): DataStruct => ({ time: [1, 2, 3], values: [[10], [20], [30]], labels: ["A"], units: ["u"], metadata: {} });
const src: Dataset = { id: "s", name: "src", data: data() };
const action = (id: string) => datasetDerivedWorksheetActions.find((a) => a.id === id)!;

beforeEach(() => {
  vi.mocked(applyCorrections).mockResolvedValue(data());
  useApp.setState({ datasets: [src], activeId: "s", status: "imported 1 file", macroRecording: false, macroSteps: [] });
});

describe("derived worksheet status lines", () => {
  it("Create derived worksheet says what it made", async () => {
    action("dataset.createDerivedWorksheet").run({ dataset: src } as never);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    expect(useApp.getState().status).toBe("created derived worksheet src (derived)");
  });

  it("Freeze copy (context action) says what it froze", async () => {
    action("dataset.createDerivedWorksheet").run({ dataset: src } as never);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    useApp.setState({ status: "imported 1 file" });
    const derived = useApp.getState().datasets[1]!;
    action("dataset.freezeCopy").run({ dataset: derived } as never);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    expect(useApp.getState().status).toBe("froze src (derived) as src (derived) (frozen)");
  });

  it("the banner's Freeze Copy button sets it too, and a passive freeze leaves the status alone", async () => {
    action("dataset.createDerivedWorksheet").run({ dataset: src } as never);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    const derived = useApp.getState().datasets[1]!;
    useApp.setState({ status: "imported 1 file" });
    useApp.getState().freezeCopy(derived.id, { activate: false });
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    expect(useApp.getState().status).toBe("imported 1 file");
    render(<DerivedWorksheetBanner ds={derived} />);
    fireEvent.click(screen.getByRole("button", { name: "Freeze Copy" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(4));
    expect(useApp.getState().status).toMatch(/^froze /);
  });
});
