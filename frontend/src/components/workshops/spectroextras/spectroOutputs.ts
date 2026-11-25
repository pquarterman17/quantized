// Spectroscopy extras workshop: a result as drawn figures and as the worksheet(s)
// that are committed (result-lifecycle contract). Pure.

import type { PlotPayload } from "../../../lib/plotdata";
import type { DataStruct } from "../../../lib/types";
import type { SeChannel, SeInput, SeResult } from "./spectroRun";

export interface SeFigure { key: string; title: string; payload: PlotPayload }

const MAX_FIGURE_CHANNELS = 3;
const nan = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);
const nul = (v: number): number | null => (Number.isFinite(v) ? v : null);

type Spec = PlotPayload["series"][number];
const line = (label: string, overlay: boolean): Spec => ({ label, unit: "", kind: "line", overlay });

function figure(key: string, title: string, xLabel: string, xs: number[], cols: [Spec, (number | null)[]][]): SeFigure {
  return { key, title, payload: { data: [xs, ...cols.map(([, c]) => c)] as PlotPayload["data"], series: cols.map(([s]) => s), xLabel, xUnit: "" } };
}

/** The picked column's values on the (ascending) window rows `wx` of an onset result. */
function onWindow(input: SeInput, c: SeChannel, wx: readonly number[]): number[] {
  const at = new Map(input.x.map((v, i) => [v, c.y[i]]));
  return wx.map((v) => at.get(v) ?? Number.NaN);
}

export function seFigures(r: SeResult, input: SeInput): SeFigure[] {
  switch (r.tab) {
    case "fsd": {
      const runs = r.runs.slice(0, MAX_FIGURE_CHANNELS);
      const cols: [Spec, (number | null)[]][] = [];
      runs.forEach((run, i) => {
        cols.push([line(run.label, false), input.channels[i].y]);
        cols.push([line(`${run.label} · FSD`, true), run.res.y]);
      });
      return [figure("fsd", "Original and self-deconvolved", input.xLabel, input.x, cols)];
    }
    case "corr2d": {
      const d = r.data.info;
      return [figure("ref", "Mean (reference) spectrum", input.xLabel, d.x, [[line("mean", false), d.reference]])];
    }
    case "onset":
      return r.runs.slice(0, MAX_FIGURE_CHANNELS).map((run, i) => {
        const y = onWindow(input, input.channels[i], run.res.x);
        const finite = y.filter(Number.isFinite);
        const lo = Math.min(...finite), hi = Math.max(...finite), pad = 0.25 * (hi - lo);
        // The tangent runs off to large values away from the edge: keep only the part inside the plot range.
        const tan = run.res.tangent_line.map((v) => (v >= lo - pad && v <= hi + pad ? v : null));
        const base = run.res.baseline_line.map((v) => (v >= lo - pad && v <= hi + pad ? v : null));
        return figure(`onset${i}`,
          `${run.label}: onset ${run.res.tangent.x_onset.toPrecision(5)} (tangent), ${run.res.threshold.x_onset.toPrecision(5)} (${Math.round(run.res.threshold.fraction * 100)} % threshold)`,
          input.xLabel, run.res.x, [[line(run.label, false), y.map(nul)], [line("baseline", true), base], [line("steepest tangent", true), tan]]);
      });
  }
}

function struct(time: number[], cols: [string, number[]][], xName: string, meta: Record<string, unknown>): DataStruct {
  return {
    time, values: time.map((_, i) => cols.map(([, c]) => c[i])),
    labels: cols.map(([n]) => n), units: cols.map(() => ""),
    metadata: { x_column_name: xName, technique: "spectroscopy-extras", ...meta },
  };
}

/** The worksheets a result commits as (the 2-D correlation makes two maps). */
export function seOutputs(r: SeResult, input: SeInput, sourceName: string): { name: string; data: DataStruct }[] {
  switch (r.tab) {
    case "fsd":
      return [{ name: `${sourceName} · FSD`, data: struct([...input.x], r.runs.map((run) => [`${run.label} · FSD`, run.res.y.map(nan)]), input.xLabel, {
        spectroExtras: { tool: "fsd", info: r.runs[0]?.res.info },
      }) }];
    case "corr2d":
      return [
        { name: `${sourceName} · 2D synchronous`, data: r.data.synchronous },
        { name: `${sourceName} · 2D asynchronous`, data: r.data.asynchronous },
      ];
    case "onset": {
      const cols: [string, number[]][] = [];
      r.runs.forEach((run, i) => {
        cols.push([run.label, onWindow(input, input.channels[i], run.res.x)], [`${run.label} · baseline`, run.res.baseline_line], [`${run.label} · tangent`, run.res.tangent_line]);
      });
      const first = r.runs[0]?.res;
      return [{ name: `${sourceName} · onset`, data: struct(first ? [...first.x] : [], cols, input.xLabel, {
        spectroExtras: { tool: "onset", channels: r.runs.map((run) => ({ label: run.label, tangent: run.res.tangent, threshold: run.res.threshold, baseline: run.res.baseline, top: run.res.top })) },
      }) }];
    }
  }
}
