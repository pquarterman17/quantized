// P2.2 — the fit view plots its residuals: data + model with the residuals
// under them on a shared, zoom-linked Q axis and the SLD profile alongside,
// for the live fit and for a saved one after a workspace reopen.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reflFit, reflPresets } from "../../../lib/api/reflectivity";
import { buildOpts } from "../../../lib/uplotOpts";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";
import { useApp } from "../../../store/useApp";
import { savedCurves } from "./reflFitCurves";
import { encodeRecord } from "./reflFitRecord";
import { RESIDUALS_NOT_STORED } from "./reflFitResiduals";
import { fitResponse, makeRecord, TEST_PRESETS, xrrDataset } from "./reflFit.testkit";
import ReflFitView from "./ReflFitView";
import { useReflFit } from "./useReflFit";
import { useReflectivity } from "./useReflectivity";

const { plots, MockUPlot } = vi.hoisted(() => {
  type Hook = (u: unknown, key: string) => void;
  const plots: InstanceType<typeof MockUPlot>[] = [];
  class MockUPlot {
    scales: Record<string, { min: number; max: number }> = { x: { min: 0, max: 1 } };
    label: string;
    constructor(
      public opts: { cursor?: { sync?: { key: string } }; hooks?: { setScale?: Hook[] } },
      public data: unknown[],
      host: HTMLElement,
    ) {
      this.label = host.getAttribute("aria-label") ?? "";
      plots.push(this);
    }
    setScale(key: string, lim: { min: number; max: number }) {
      this.scales[key] = { ...lim };
      for (const h of this.opts.hooks?.setScale ?? []) h(this, key);
    }
    setSize() {}
    destroy() {
      plots.splice(plots.indexOf(this), 1);
    }
  }
  return { plots, MockUPlot };
});

vi.mock("uplot", () => ({ default: MockUPlot }));
vi.mock("../../../lib/uplotOpts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../lib/uplotOpts")>();
  return { ...real, buildOpts: vi.fn(real.buildOpts) };
});
vi.mock("../../../lib/api/reflectivity", () => ({
  reflPresets: vi.fn(),
  reflSimulate: vi.fn(),
  reflSldProfile: vi.fn(),
  reflFit: vi.fn(),
}));

function Harness() {
  const refl = useReflectivity();
  const fit = useReflFit(refl);
  return <ReflFitView fit={fit} />;
}

const plot = (label: string) => plots.find((p) => p.label === label);
const realResolve = useApp.getState().resolveDataset;

beforeEach(() => {
  vi.clearAllMocks();
  plots.length = 0;
  vi.mocked(reflPresets).mockResolvedValue({ presets: TEST_PRESETS });
  useApp.setState({
    datasets: [xrrDataset("xrr")],
    activeId: "xrr",
    status: "",
    fitOverlay: null,
    reflectivitySeed: null,
    history: [],
    future: [],
    resolveDataset: realResolve,
  });
});

async function runLiveFit() {
  vi.mocked(reflFit).mockResolvedValueOnce(fitResponse());
  render(<Harness />);
  const run = await screen.findByRole("button", { name: "Run fit" });
  await waitFor(() => expect(run).toHaveProperty("disabled", false));
  fireEvent.click(run);
  await screen.findByLabelText("fit plots");
}

describe("the live fit's linked data/model/residual/SLD view", () => {
  it("plots data + model, the normalised residuals with a zero line, and the SLD profile", async () => {
    await runLiveFit();
    expect(screen.getByRole("img", { name: "data and model" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "residuals" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "SLD profile" })).toBeTruthy();
    expect(plot("residuals")!.data).toEqual([[0.01, 0.03, 0.05], [-10, -10, -10]]);
    expect(plot("data and model")!.data[0]).toEqual(plot("residuals")!.data[0]);
    const residualCall = vi.mocked(buildOpts).mock.calls.find(([p]) => p.series[0]?.label === "residual")!;
    expect(residualCall[0].series[0].unit).toBe("σ");
    expect(residualCall[1].refLines).toEqual([{ id: "zero", axis: "y", value: 0 }]);
    expect(screen.getByText(/Residual = \(R fit − R\) \/ dR/)).toBeTruthy();
  });

  it("shares the Q axis between data/model and residuals, but not with the SLD depth axis", async () => {
    await runLiveFit();
    const [top, res, sld] = [plot("data and model")!, plot("residuals")!, plot("SLD profile")!];
    expect(top.opts.cursor?.sync?.key).toBeTruthy();
    expect(res.opts.cursor?.sync?.key).toBe(top.opts.cursor?.sync?.key);
    expect(sld.opts.cursor?.sync).toBeUndefined();

    res.setScale("x", { min: 0.02, max: 0.04 }); // zoom Q on the residual panel
    expect(top.scales.x).toEqual({ min: 0.02, max: 0.04 });
    expect(sld.scales.x).toEqual({ min: 0, max: 1 });
  });
});

describe("a saved fit redisplays its residuals", () => {
  it("after a workspace save -> reopen, from the residuals stored with the fit", async () => {
    const rec = { ...makeRecord(), curves: savedCurves(fitResponse()) };
    const stored = serializeWorkspace({ datasets: [xrrDataset("xrr", { reflFits: [encodeRecord(rec)] })] });
    useApp.setState({ datasets: parseWorkspace(stored).datasets });
    render(<Harness />);
    expect(await screen.findByLabelText("saved fit")).toBeTruthy();
    expect(screen.getByRole("img", { name: "residuals" })).toBeTruthy();
    expect(plot("residuals")!.data[1]).toEqual([-10, -10, -10]);
  });

  it("a dR fit saved before residuals were stored says so instead of plotting nothing", async () => {
    const { residual: _r, ...legacy } = savedCurves(fitResponse()).channels[0];
    const rec = { ...makeRecord(), curves: { channels: [legacy], sld: [] } };
    useApp.setState({ datasets: [xrrDataset("xrr", { reflFits: [encodeRecord(rec)] })] });
    render(<Harness />);
    expect(await screen.findByText(RESIDUALS_NOT_STORED)).toBeTruthy();
    expect(screen.getByRole("img", { name: "data and model" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "residuals" })).toBeNull();
  });
});
