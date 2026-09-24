// P2.2 slice 4 — "Estimate uncertainty (DREAM)" on a finished reflectivity
// fit: the job re-sends exactly the fit's points and parameters with the
// fitted values as the centre, reports progress, can be cancelled, and stores
// a compact posterior summary on the fit's record (one undo step) that the
// live and the saved views show beside the least-squares values.

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelReflJob,
  pollReflJob,
  reflDream,
  reflFit,
  ReflJobCancelled,
  reflPresets,
  type ReflPosteriorResult,
} from "../../../lib/api/reflectivity";
import { reportEmit } from "../../../lib/api/report";
import { useApp } from "../../../store/useApp";
import { R_BAND_LABELS } from "./reflDreamBands";
import { dreamResult, fitResponse, makeRecord, TEST_PRESETS, xrrDataset } from "./reflFit.testkit";
import { encodeRecord, recordsFor } from "./reflFitRecord";
import { DREAM_DEFAULTS, posteriorSummary } from "./reflPosterior";
import ReflFitView from "./ReflFitView";
import { useReflFit } from "./useReflFit";
import { useReflectivity } from "./useReflectivity";

vi.mock("../../../lib/api/reflectivity", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api/reflectivity")>("../../../lib/api/reflectivity");
  return {
    reflPresets: vi.fn(),
    reflSimulate: vi.fn(),
    reflSldProfile: vi.fn(),
    reflFit: vi.fn(),
    reflDream: vi.fn(),
    pollReflJob: vi.fn(),
    cancelReflJob: vi.fn(),
    ReflJobCancelled: actual.ReflJobCancelled,
  };
});

vi.mock("../../../lib/api/report", () => ({ reportEmit: vi.fn(), reportExport: vi.fn() }));

function useBoth() {
  const refl = useReflectivity();
  const fit = useReflFit(refl);
  return { refl, fit };
}

function Harness() {
  const { fit } = useBoth();
  return <ReflFitView fit={fit} />;
}

async function fittedHook() {
  vi.mocked(reflFit).mockResolvedValueOnce(fitResponse());
  const view = renderHook(() => useBoth());
  await waitFor(() => expect(view.result.current.refl.presets).toHaveLength(TEST_PRESETS.length));
  await act(async () => {
    await view.result.current.fit.run();
  });
  return view;
}

/** A job whose poll reports progress, then waits until `finish` is called. */
function controllableJob() {
  let finish: (res: ReflPosteriorResult | Error) => void = () => undefined;
  vi.mocked(reflDream).mockResolvedValue({ job_id: "j1", plan: { n_free: 3, n_chains: 12, n_generations: 1033, n_evaluations: 12500 } });
  vi.mocked(pollReflJob).mockImplementation((_id, onProgress) => {
    onProgress?.(0.42, "sampling posterior");
    return new Promise((resolve, reject) => {
      finish = (res) => (res instanceof Error ? reject(res) : resolve(res as never));
    });
  });
  return { finish: (res: ReflPosteriorResult | Error) => finish(res) };
}

const stored = () => recordsFor(useApp.getState().datasets[0]);

beforeEach(() => {
  // Reset, not just clear: a never-settling job from one test must not leak
  // its implementation into the next.
  vi.resetAllMocks();
  vi.mocked(reflPresets).mockResolvedValue({ presets: TEST_PRESETS });
  vi.mocked(cancelReflJob).mockResolvedValue({});
  useApp.setState({ datasets: [xrrDataset("xrr")], activeId: "xrr", status: "", fitOverlay: null, reflectivitySeed: null });
});

describe("estimating a live fit's uncertainty", () => {
  it("re-sends the fit's points and parameters, centred on the fitted values, and stores the summary", async () => {
    const { result } = await fittedHook();
    const job = controllableJob();
    const record = stored()[0];
    let running: Promise<void> = Promise.resolve();
    act(() => {
      running = result.current.fit.dream.run(record);
    });
    await waitFor(() => expect(result.current.fit.dream.progress).toBe(0.42));
    expect(result.current.fit.dream.runningFor).toBe(record.id);
    expect(result.current.fit.dream.message).toBe("sampling posterior");

    const body = vi.mocked(reflDream).mock.calls[0][0];
    expect(body.parameters).toEqual(record.request.parameters);
    expect(body.channels).toEqual(vi.mocked(reflFit).mock.calls[0][0].channels);
    expect(body.centre).toEqual({ "L1.thickness": 187.5, "L1.roughness": 15, scale: 0.97 });
    expect(body).toMatchObject({ weighting: "dr", samples: 10_000, burn: 200, pop: 4, seed: 1 });

    await act(async () => {
      job.finish(dreamResult());
      await running;
    });
    const post = stored()[0].posterior;
    expect(post?.parameters.map((p) => p.name)).toEqual(["L1.thickness", "background"]);
    expect(post?.convergence).toMatchObject({ n_draws: 10000, rhat_max: 1.4, flagged: ["background"] });
    expect(result.current.fit.dream.busy).toBe(false);
    expect(result.current.fit.dream.hasBands(stored()[0])).toBe(true);
    expect(useApp.getState().status).toMatch(/10000 draws, R-hat max 1.400 \(not converged\)/);

    // One undo step takes the summary off the record again.
    act(() => useApp.getState().undo());
    expect(stored()[0].posterior).toBeUndefined();
    expect(result.current.fit.dream.hasBands(stored()[0])).toBe(false);
  });

  it("a cancelled job is not an error and stores nothing", async () => {
    const { result } = await fittedHook();
    const job = controllableJob();
    let running: Promise<void> = Promise.resolve();
    act(() => {
      running = result.current.fit.dream.run(stored()[0]);
    });
    await waitFor(() => expect(result.current.fit.dream.progress).toBe(0.42));
    await act(async () => {
      await result.current.fit.dream.cancel();
    });
    expect(cancelReflJob).toHaveBeenCalledWith("j1");
    await act(async () => {
      job.finish(new ReflJobCancelled("j1"));
      await running;
    });
    expect(result.current.fit.dream.error).toBeNull();
    expect(result.current.fit.dream.busy).toBe(false);
    expect(stored()[0].posterior).toBeUndefined();
    expect(useApp.getState().status).toBe("reflectivity uncertainty estimate cancelled");
  });

  it("refuses when the data changed since the fit, before submitting anything", async () => {
    const { result } = await fittedHook();
    // Were the refusal missing, the run would reach the server: fail fast.
    vi.mocked(reflDream).mockRejectedValue(new Error("submitted changed data"));
    const [ds] = useApp.getState().datasets;
    act(() =>
      useApp.setState({ datasets: [{ ...ds, data: { ...ds.data, values: ds.data.values.map((r) => [r[0] * 2, ...r.slice(1)]) } }] }),
    );
    await act(async () => {
      await result.current.fit.dream.run(stored()[0]);
    });
    expect(result.current.fit.dream.error).toMatch(/channel 1: the data of "film.refl" changed since this fit/);
    expect(reflDream).not.toHaveBeenCalled();
  });

  it("closing the workshop mid-run cancels the server's job", async () => {
    const view = await fittedHook();
    controllableJob();
    act(() => {
      void view.result.current.fit.dream.run(stored()[0]);
    });
    await waitFor(() => expect(view.result.current.fit.dream.progress).toBe(0.42));
    view.unmount();
    expect(cancelReflJob).toHaveBeenCalledWith("j1");
  });

  it("closing the workshop while the job is being submitted still cancels it", async () => {
    const view = await fittedHook();
    let accept: (v: { job_id: string; plan: never }) => void = () => undefined;
    vi.mocked(reflDream).mockReturnValue(new Promise((resolve) => (accept = resolve)));
    let running: Promise<void> = Promise.resolve();
    act(() => {
      running = view.result.current.fit.dream.run(stored()[0]);
    });
    await waitFor(() => expect(view.result.current.fit.dream.runningFor).not.toBeNull());
    view.unmount();
    await act(async () => {
      accept({ job_id: "j2", plan: undefined as never });
      await running;
    });
    expect(cancelReflJob).toHaveBeenCalledWith("j2");
    expect(pollReflJob).not.toHaveBeenCalled();
  });
});

describe("the uncertainty section", () => {
  it("runs from the live result and shows intervals beside least squares, the R-hat warning and bands", async () => {
    vi.mocked(reflFit).mockResolvedValue(fitResponse());
    const job = controllableJob();
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Run fit" })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run fit" }));
    });
    fireEvent.click(await screen.findByRole("button", { name: "Estimate uncertainty (DREAM)" }));
    expect(await screen.findByLabelText("DREAM progress")).toBeTruthy();
    await act(async () => {
      job.finish(dreamResult());
    });
    const table = await screen.findByRole("table", { name: "posterior intervals" });
    expect(table.textContent).toMatch(/187\.5 ± 0\.8/); // least squares beside…
    expect(table.textContent).toMatch(/186\.6 – 188\.2/); // …the 68% interval
    expect(table.textContent).toMatch(/4\.000e-7 ⇤/); // the bounds limit background's 95%
    expect(screen.getByText(/R-hat above 1.2 for background/)).toBeTruthy();
    expect(screen.getByTestId("refl-dream-run").textContent).toMatch(/10000 draws · 10 chains · burn-in 200/);

    const before = useApp.getState().datasets.length;
    fireEvent.click(screen.getByRole("button", { name: "Add uncertainty bands" }));
    await waitFor(() => expect(useApp.getState().datasets.length).toBe(before + 2));
    const band = useApp.getState().datasets.find((d) => d.name.endsWith("R band"));
    expect(band?.data.labels).toEqual(R_BAND_LABELS);
    expect(screen.getByRole("button", { name: "Uncertainty bands added" })).toBeTruthy();
  });

  it("a saved fit shows its stored posterior without a run; a legacy record offers the run only", async () => {
    const withPost = { ...makeRecord({ seq: 2, id: "rfit-2" }), posterior: posteriorSummary(dreamResult(), DREAM_DEFAULTS, "2026-09-24T12:00:00.000Z") };
    const legacy = makeRecord();
    useApp.setState({ datasets: [xrrDataset("xrr", { reflFits: [encodeRecord(withPost), encodeRecord(legacy)] })] });
    render(<Harness />);
    expect(await screen.findByRole("table", { name: "posterior intervals" })).toBeTruthy();
    expect(screen.getByText(/re-estimate to plot them/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add uncertainty bands" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Re-estimate uncertainty (DREAM)" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("saved fits"), { target: { value: legacy.id } });
    expect(screen.queryByRole("table", { name: "posterior intervals" })).toBeNull();
    expect(screen.getByRole("button", { name: "Estimate uncertainty (DREAM)" })).toBeTruthy();
  });

  it("Add to report sends the stored posterior with the result, and a legacy record without one", async () => {
    vi.mocked(reportEmit).mockImplementation(async (body) => ({ report: { title: body.title ?? "", sections: [], source_refs: [] } }));
    const withPost = { ...makeRecord({ seq: 2, id: "rfit-2" }), posterior: posteriorSummary(dreamResult(), DREAM_DEFAULTS, "2026-09-24T12:00:00.000Z") };
    useApp.setState({ reports: [], datasets: [xrrDataset("xrr", { reflFits: [encodeRecord(withPost), encodeRecord(makeRecord())] })] });
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to report" }));
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    const sent = vi.mocked(reportEmit).mock.calls[0][0].result as { posterior?: { convergence: { n_draws: number } } };
    expect(sent.posterior?.convergence.n_draws).toBe(10000);

    fireEvent.change(screen.getByLabelText("saved fits"), { target: { value: makeRecord().id } });
    fireEvent.click(screen.getByRole("button", { name: "Add to report" }));
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(2));
    expect(vi.mocked(reportEmit).mock.calls[1][0].result).not.toHaveProperty("posterior");
  });

  it("a log-weighted fit says why it cannot be sampled and offers no run", async () => {
    const rec = makeRecord();
    rec.request.weighting = "log";
    useApp.setState({ datasets: [xrrDataset("xrr", { reflFits: [encodeRecord(rec)] })] });
    render(<Harness />);
    expect(await screen.findByText(/DREAM needs dR weighting/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Estimate uncertainty/ })).toBeNull();
  });
});
