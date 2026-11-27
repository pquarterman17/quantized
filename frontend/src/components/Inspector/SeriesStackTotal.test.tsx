// #1081 stack totals: the Stack total checkbox is reachable on a stacked series
// (built by the real "Stacked Column per X row" gallery tile), sets
// `SeriesStyle.stackTotal` through the store, and reaches the export request as
// `stack_total`. It is absent on an unstacked series (it would do nothing there).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { applyPlotType } from "../../lib/figureDialogActions";
import { buildExportStyles } from "../../lib/exportStyles";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import SeriesMarkMapControls from "./SeriesMarkMapControls";

const ds: Dataset = {
  id: "d", name: "stack.csv",
  data: { time: [1, 2, 3], values: [[1, 2], [2, 3], [3, 4]], labels: ["a", "b"], units: ["", ""], metadata: {} },
};

function Host({ channel }: { channel: number }) {
  const style = useApp((s) => s.seriesStyles[channel]) ?? {};
  const set = useApp((s) => s.setSeriesStyle);
  return <SeriesMarkMapControls channel={channel} style={style} setSeriesStyle={set} />;
}

beforeEach(() => {
  useApp.setState({ ...defaultPlotView(), datasets: [ds], activeId: "d", history: [], future: [], status: "" });
});

describe("Stack total control", () => {
  it("is not offered on an unstacked series", () => {
    render(<Host channel={1} />);
    expect(screen.queryByRole("checkbox", { name: /Stack total/ })).toBeNull();
  });

  it("is offered on a stacked series, sets the style and reaches the export request", () => {
    applyPlotType("stackedColumnX");
    render(<Host channel={1} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Stack total/ }));
    expect(useApp.getState().seriesStyles[1]).toMatchObject({ stack: true, stackTotal: true });
    const spec = buildExportStyles([0, 1], useApp.getState().seriesStyles);
    expect(spec[1]).toMatchObject({ stack: true, stack_total: true });
    expect(spec[0]?.stack_total).toBeUndefined();
    fireEvent.click(screen.getByRole("checkbox", { name: /Stack total/ }));
    expect(useApp.getState().seriesStyles[1]?.stackTotal).toBeUndefined();
  });
});
