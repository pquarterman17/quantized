// The axis menu's "Set Y limits…" dialog and half-open / reversed limits.
// A blank side is auto for that side (P2.8 residual (b)): the dialog prefills
// it blank and saves a blank side as null, never as Number("") === 0. A
// descending committed pair is a deliberately reversed axis (an applied Origin
// figure, `lib/axisLim.resolveHalfLim`), so confirming it keeps the order; an
// ordinary axis still sorts a backwards entry, as before.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import type { ParamField, ParamValues } from "../../lib/params";
import type { PlotPayload } from "../../lib/plotdata";
import { useApp } from "../../store/useApp";
import { askParams } from "../overlays/ParamDialog";
import PlotContextMenu from "./PlotContextMenu";
import type { PlotStageActions } from "./usePlotStageActions";

vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
const mockAsk = vi.mocked(askParams);

function fakePlot(): uPlot {
  return {
    over: { getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 }) },
    data: [[0, 100, 200], [10, 20, 150]],
    series: [{}, { scale: "y" }],
    scales: { x: { min: 0, max: 400 }, y: { min: 8, max: 32 } },
    posToVal: (px: number) => px,
    valToPos: (v: number) => v,
  } as unknown as uPlot;
}

const payload = { series: [{ label: "A", unit: "" }] } as unknown as PlotPayload;
const actions = { resetView: vi.fn() } as unknown as PlotStageActions;

/** Open the Y-axis menu (left of the plot rect), run "Set Y limits…" and
 *  answer the dialog with `answer`; returns the fields the dialog was given. */
async function setYLimits(answer: ParamValues): Promise<ParamField[]> {
  cleanup(); // one menu at a time (the menu is single-shot)
  let fields: ParamField[] = [];
  mockAsk.mockImplementation((_title, f) => {
    fields = f;
    return Promise.resolve(answer);
  });
  render(
    <PlotContextMenu x={80} y={250} plotRef={{ current: fakePlot() }} payload={payload}
      plotted={[0]} hidden={[false]} actions={actions} onClose={vi.fn()} />,
  );
  fireEvent.click(screen.getByText("Set Y limits…"));
  await act(async () => {}); // the dialog's promise
  return fields;
}

const prefill = (fields: ParamField[]) => fields.map((f) => String(f.default));

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ yLim: null, y2Keys: null, yScale: "linear", xScale: "linear" });
});

describe("PlotContextMenu — Set limits dialog", () => {
  it("prefills a half-open limit's blank side blank and saves it back as null", async () => {
    useApp.setState({ yLim: [null, 25] });
    const fields = await setYLimits({ min: "", max: "25" });
    expect(prefill(fields)).toEqual(["", "25"]);
    expect(useApp.getState().yLim).toEqual([null, 25]);
  });

  it("a blank side typed into a fixed limit makes it half-open; both blank is auto", async () => {
    useApp.setState({ yLim: [5, 25] });
    await setYLimits({ min: "5", max: "" });
    expect(useApp.getState().yLim).toEqual([5, null]);
    await setYLimits({ min: "", max: "" });
    expect(useApp.getState().yLim).toBeNull();
  });

  it("with no committed limit both sides prefill from the live scale", async () => {
    const fields = await setYLimits({ min: "8", max: "32" });
    expect(prefill(fields)).toEqual(["8", "32"]);
    expect(useApp.getState().yLim).toEqual([8, 32]);
  });

  it("confirming a reversed (descending) pair keeps it reversed", async () => {
    useApp.setState({ yLim: [300, 0] });
    await setYLimits({ min: "300", max: "0" });
    expect(useApp.getState().yLim).toEqual([300, 0]);
  });

  it("an ordinary axis still sorts a backwards entry", async () => {
    await setYLimits({ min: "50", max: "10" });
    expect(useApp.getState().yLim).toEqual([10, 50]);
  });
});
