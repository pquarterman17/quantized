// The import scorer's frontend mirror, checked against the real frontend.
//
// `tools/plot_corpus/score_import.py` (plan item 2 of
// plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md) scores what quantized DRAWS for an
// imported Origin figure through a Python mirror (`tools/plot_corpus/
// frontend_view.py`). This file runs the same shared cases
// (`tests/fixtures/plot_corpus/frontend_view_cases.json`, also asserted by
// `tests/test_plot_corpus_import_score.py` against the mirror) through the real
// rules, so a frontend change that moves what a figure draws fails here until
// the mirror -- and with it the scorecard -- follows.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { effectiveDesignations } from "./columnmeta";
import { bookDefaultHiddenChannels } from "./errorbars";
import { originCurveSeriesStyle } from "./originCurveText";
import { resolveFigureDataset } from "./originFigureEntries";
import { figureChannelSelection, figureStatState } from "./originFigureSelection";
import { ownXSeries } from "./ownXSeries";
import type { Dataset, OriginCurve, OriginFigure } from "./types";

interface RawDataset {
  metadata: Record<string, unknown>;
  time: number[];
  values: (number | null)[][];
}
interface Case {
  name: string;
  dataset: string;
  figure: { source_hint: string; curves: OriginCurve[] };
  selection: { xKey: number | null; yKeys: number[] } | null;
  stat: boolean;
  hidden?: number[];
  ownX?: Record<string, number>;
  kind: string;
  via: string;
  drawn: { x: string | null; y: string }[];
}

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(join(here, "../../../tests/fixtures/plot_corpus/frontend_view_cases.json"), "utf-8"),
) as { datasets: Record<string, RawDataset>; cases: Case[] };

function dataset(key: string): Dataset {
  const raw = FIXTURE.datasets[key];
  const letters = raw.metadata.origin_column_names as string[];
  return {
    id: key,
    name: String(raw.metadata.origin_book),
    data: {
      time: raw.time,
      values: raw.values.map((row) => row.map((v) => (v === null ? Number.NaN : v))),
      labels: letters,
      units: letters.map(() => ""),
      metadata: raw.metadata,
    },
  } as Dataset;
}

function figure(c: Case): OriginFigure {
  return {
    name: "Graph1", x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false,
    n_curves: c.figure.curves.length, annotations: [], ...c.figure,
  } as OriginFigure;
}

/** The kind the mirror's `drawn_kind` names, read off the real style rule. */
function kindOf(curves: OriginCurve[]): string {
  if (curves.length === 0) return "default";
  const kinds = new Set(
    curves.map((curve) => {
      const st = originCurveSeriesStyle(curve);
      if (st?.bars === "horizontal") return "bar";
      if (st?.bars === true) return "column";
      return curve.style ?? "default";
    }),
  );
  return kinds.size === 1 ? [...kinds][0] : "mixed";
}

describe("plot-corpus frontend mirror (shared cases)", () => {
  it.each(FIXTURE.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const ds = dataset(c.dataset);
    const fig = figure(c);
    expect(resolveFigureDataset(fig, [ds])).toBe(ds.id);

    const sel = figureChannelSelection(fig, ds);
    expect(sel ? { xKey: sel.xKey, yKeys: sel.yKeys } : null).toEqual(c.selection);

    const stat = figureStatState(fig, ds);
    expect(stat.statMode === true).toBe(c.stat);

    if (c.hidden) {
      expect(bookDefaultHiddenChannels(ds)).toEqual(c.hidden);
      const own = ownXSeries(effectiveDesignations(ds.data));
      expect(Object.fromEntries(Object.entries(own).map(([k, v]) => [k, v]))).toEqual(c.ownX);
    }

    const letters = ds.data.metadata.origin_column_names as string[];
    const xName = String(ds.data.metadata.x_column_name ?? "");
    let via: string;
    let kind: string;
    let drawn: { x: string | null; y: string }[];
    if (stat.statMode) {
      via = "stat";
      kind = "histogram";
      drawn = [{ x: null, y: fig.curves?.[0]?.y ?? "" }];
    } else if (sel) {
      via = "selection";
      const x = sel.xKey === null ? xName : letters[sel.xKey];
      drawn = sel.yKeys.map((k) => ({ x, y: letters[k] }));
      const ys = new Set(drawn.map((d) => d.y));
      kind = kindOf((fig.curves ?? []).filter((cv) => cv.book === ds.data.metadata.origin_book && ys.has(cv.y)));
    } else {
      via = "default";
      kind = "default";
      const hidden = new Set(bookDefaultHiddenChannels(ds));
      const own = ownXSeries(effectiveDesignations(ds.data));
      drawn = letters
        .map((y, i) => ({ i, y }))
        .filter(({ i }) => !hidden.has(i))
        .map(({ i, y }) => ({ x: i in own ? letters[own[i]] : xName, y }));
    }
    expect(via).toBe(c.via);
    expect(kind).toBe(c.kind);
    expect(drawn).toEqual(c.drawn);
  });
});
