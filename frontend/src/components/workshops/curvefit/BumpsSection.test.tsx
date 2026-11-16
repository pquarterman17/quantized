// Review D2: while a job runs, `setEngine` refuses a change (switching would
// orphan the job), so the Engine select is disabled rather than letting the
// user's choice silently snap back.

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitBumps } from "../../../lib/fitbumps";
import { useApp } from "../../../store/useApp";
import BumpsSection from "./BumpsSection";
import { resetBumpsFitSession } from "./useBumpsFit";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/fitbumps", () => ({ fitBumps: vi.fn() }));

beforeEach(() => {
  resetBumpsFitSession();
  useApp.setState({
    datasets: [{ id: "d1", name: "a", data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["y"], units: [""], metadata: {} } }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
  });
});

describe("BumpsSection Engine select", () => {
  it("is disabled while a fit runs, and enabled again after", async () => {
    let done!: (v: Awaited<ReturnType<typeof fitBumps>>) => void;
    vi.mocked(fitBumps).mockReturnValue(new Promise((r) => (done = r)));
    render(<BumpsSection modelName="Linear" />);
    const engine = () => screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(engine().disabled).toBe(false);
    act(() => {
      engine().value = "lm";
      engine().dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      screen.getByRole("button", { name: /fit/i }).click();
    });
    await waitFor(() => expect(engine().disabled).toBe(true));
    await act(async () => {
      done({ engine: "lm", popt: [1], uncertainties: [0.1], chisq: 1, uncertainty_kind: "hessian", paramNames: ["m"], yFit: [1, 2, 3] });
    });
    await waitFor(() => expect(engine().disabled).toBe(false));
  });
});
