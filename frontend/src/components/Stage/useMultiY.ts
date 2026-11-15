// The canvas side of Origin-style multiple Y axes (gap audit 4 G11): the
// view's Y3+ axes resolved against what is plotted, their series re-tagged in
// the display payload, and a status note when a view cannot draw them or a
// series names an axis that no longer exists (`multiYView`, lib/multiY.ts).
//
// lib/multiY.ts loads on demand, the first time a view has a Y3+ axis or an
// assignment (eager bundle budget): until it lands that view draws Y1 / Y2,
// then re-renders with its extra axes.

import { useEffect, useMemo, useState } from "react";

import type { MultiYInputs, ResolvedExtraY } from "../../lib/multiY";
import type { PlotPayload } from "../../lib/plotdata";
import { loadAxisExtras } from "../../lib/axisExtrasHook";
import { useStableByEquality } from "../../lib/useStableByEquality";
import { useApp } from "../../store/useApp";

let mod: typeof import("../../lib/multiY") | null = null;
/** Settles once the derivation chunk has loaded (the tests wait on it). */
export let loading: Promise<unknown> | null = null;
const NONE: readonly ResolvedExtraY[] = [];

/** `announce`: post the note (the focused window; a background one stays quiet). */
export function useMultiY(
  payload: PlotPayload | null,
  plotted: readonly number[],
  view: MultiYInputs,
  announce: boolean,
): { payload: PlotPayload | null; axes: readonly ResolvedExtraY[] } {
  const wanted = view.yAxes.length + Object.keys(view.yAxisOf).length > 0;
  const [loaded, setLoaded] = useState(false); // flips once: the chunks landing
  useEffect(() => {
    // Both chunks in parallel -- the derivation and the axis builder (it rides
    // the axis-extras chunk) -- so the tagged series never draw axis-less.
    if (wanted && !mod) void (loading ??= Promise.all([import("../../lib/multiY"), loadAxisExtras()]).then(([m]) => (mod = m))).then(() => setLoaded(true));
  }, [wanted]);
  const out = useMemo(
    () => (!wanted ? null : mod ? mod.multiYView(payload, plotted, view) : { payload: payload && { ...payload, data: withheld(payload, plotted, view.yAxisOf) }, axes: NONE, note: null }),
    [wanted, loaded, payload, plotted, view], // eslint-disable-line react-hooks/exhaustive-deps -- `loaded`: the chunks landing
  );
  const note = out?.note, setStatus = useApp((s) => s.setStatus);
  useEffect(() => {
    if (announce && note) setStatus(note);
  }, [announce, note, setStatus]);
  return out ?? { payload, axes: NONE };
}

/** Until the chunks land, the Y3+ series draw nothing (not a scale with no axis). */
const withheld = (payload: PlotPayload, plotted: readonly number[], of: Record<number, number>) =>
  payload.data.map((col, k) => (k > 0 && of[plotted[k - 1]] ? new Array<null>(col.length).fill(null) : col)) as PlotPayload["data"];

/** `useMultiY` for the focused window: its Y3+ model from the store, the
 *  rest of the view as the Stage already reads it (`base`, eager bundle). */
export function useStageMultiY(
  payload: PlotPayload | null,
  plotted: readonly number[],
  base: Omit<MultiYInputs, "yAxes" | "yAxisOf">,
): { payload: PlotPayload | null; axes: readonly ResolvedExtraY[] } {
  const yAxes = useApp((s) => s.yAxes), yAxisOf = useApp((s) => s.yAxisOf);
  // `base` is a fresh literal each render: keep one view while its fields are the same.
  return useMultiY(payload, plotted, useStableByEquality({ ...base, yAxes, yAxisOf }), true);
}
