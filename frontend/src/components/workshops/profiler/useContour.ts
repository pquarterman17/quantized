// Contour profiler data (GAP_AUDIT_9 G7): the predicted response over two
// continuous factors, the others at their current settings. One debounced
// request per change of the OTHER factors; moving the two plotted factors
// only moves the crosshair, so a drag in the contour never refetches.

import { useEffect, useMemo, useState } from "react";

import { statsContour, type ContourResponse, type ProfilerModel, type ProfilerSettings } from "../../../lib/api/modelEvaluate";
import { DEBOUNCE_MS } from "./useProfiler";

export function useContour(model: ProfilerModel | null, settings: ProfilerSettings, xName: string, yName: string, enabled: boolean) {
  const others = useMemo(() => {
    const o: ProfilerSettings = { ...settings };
    delete o[xName];
    delete o[yName];
    return o;
  }, [settings, xName, yName]);
  const key = JSON.stringify([xName, yName, others]);
  const [done, setDone] = useState<{ model: ProfilerModel; key: string; grid: ContourResponse } | null>(null);
  const [failure, setFailure] = useState<{ model: ProfilerModel; key: string; message: string } | null>(null);
  const live = enabled && !!model && !!xName && !!yName && xName !== yName;
  useEffect(() => {
    if (!model || !live) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      statsContour({ model, current: others, x_factor: xName, y_factor: yName, n_x: 31, n_y: 31 }, controller.signal).then(
        (grid) => { if (!controller.signal.aborted) setDone({ model, key, grid }); },
        (e: unknown) => {
          if (!controller.signal.aborted) setFailure({ model, key, message: e instanceof Error ? e.message : "Contour failed" });
        },
      );
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the identity of (factors, other settings)
  }, [model, live, key]);
  // Keep the previous grid of the same model and axes while a new one loads.
  const grid = live && done && done.model === model && done.grid.x_factor === xName && done.grid.y_factor === yName
    ? done.grid : null;
  const error = live && failure && failure.model === model && failure.key === key ? failure.message : null;
  return { grid, error };
}
