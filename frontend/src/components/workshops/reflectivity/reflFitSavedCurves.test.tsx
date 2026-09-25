// P2.2 slice 3 follow-up — a saved fit carries its curves: after the workshop
// (or the workspace) is reopened it overlays its model and adds its fit
// curves WITHOUT re-running; a record written before curves were stored says
// "re-run to plot" instead.

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reflFit, reflPresets } from "../../../lib/api/reflectivity";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";
import { useApp } from "../../../store/useApp";
import { encodeRecord } from "./reflFitRecord";
import { fitResponse, makeRecord, TEST_PRESETS, xrrDataset } from "./reflFit.testkit";
import ReflFitView from "./ReflFitView";
import { useReflFit } from "./useReflFit";
import { useReflectivity } from "./useReflectivity";

vi.mock("../../../lib/api/reflectivity", () => ({
  reflPresets: vi.fn(),
  reflSimulate: vi.fn(),
  reflSldProfile: vi.fn(),
  reflFit: vi.fn(),
}));

function useBoth() {
  const refl = useReflectivity();
  const fit = useReflFit(refl);
  return { refl, fit };
}

function Harness() {
  const { fit } = useBoth();
  return <ReflFitView fit={fit} />;
}

const realResolve = useApp.getState().resolveDataset;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reflPresets).mockResolvedValue({ presets: TEST_PRESETS });
  useApp.setState({
    datasets: [xrrDataset("xrr", { workbookId: "wb-x" })],
    activeId: "xrr",
    status: "",
    fitOverlay: null,
    reflectivitySeed: null,
    resolveDataset: realResolve,
  });
});

describe("a saved fit's stored curves", () => {
  it("overlay and add fit curves after a workspace save -> reopen, without re-running", async () => {
    vi.mocked(reflFit).mockResolvedValueOnce(fitResponse());
    const view = renderHook(() => useBoth());
    await waitFor(() => expect(view.result.current.refl.presets).toHaveLength(TEST_PRESETS.length));
    await act(async () => {
      await view.result.current.fit.run();
    });
    view.unmount();

    // Save and reopen the workspace; the live overlay is gone with the session.
    const reopened = parseWorkspace(serializeWorkspace({ datasets: useApp.getState().datasets })).datasets;
    useApp.setState({ datasets: reopened, fitOverlay: null });

    render(<Harness />);
    expect(await screen.findByLabelText("saved fit")).toBeTruthy();
    expect(screen.getByText("The fit's curves are stored with it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Overlay on data" }));
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "xrr", y: [0.9, null, 0.4, null, 0.1, null] });

    fireEvent.click(screen.getByRole("button", { name: "Add fit curves" }));
    const added = useApp.getState().datasets.slice(1);
    expect(added.map((d) => d.name)).toEqual(["film.refl — refl fit #1 model", "film.refl — refl fit #1 SLD"]);
    expect(added[0].data.values).toEqual([[1, 0.9], [0.5, 0.4], [0.2, 0.1]]);
    const host = useApp.getState().datasets[0];
    expect(added.map((d) => [d.workbookId, d.derivedFrom])).toEqual(added.map(() => [host.workbookId, undefined]));
    expect(screen.getByRole("button", { name: "Fit curves added" })).toHaveProperty("disabled", true);
    expect(reflFit).toHaveBeenCalledTimes(1); // nothing was re-run
  });

  it("a record from before curves were stored loads, and says re-run to plot", async () => {
    useApp.setState({ datasets: [xrrDataset("xrr", { reflFits: [encodeRecord(makeRecord())] })] });
    render(<Harness />);
    expect(await screen.findByLabelText("saved fit")).toBeTruthy();
    expect(screen.getByText(/not stored with this fit — re-run to plot/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Overlay on data" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Add fit curves" })).toHaveProperty("disabled", true);
  });
});
