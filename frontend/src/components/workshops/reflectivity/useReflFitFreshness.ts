// Reflectivity fit — "Out of date" for the live result (lane WB5; split from
// useReflFit.ts). The result is stamped with the settings (bindings, data
// settings, the parameter table as sent, graded layers) and the bound data it was
// LAUNCHED with. Once either moves it is out of date: the caller marks it, its
// curve is taken off the plot (only if still ours) and nothing applies, adds,
// plots or reports it as current (a saved fit in the History keeps its own
// record). Applying the fitted values re-bases the stamp: that move of the start
// values is the intended one. Pure React plus the caller's overlay handles.

import { useEffect, useRef, useState } from "react";

import { useLatestRef } from "../../../lib/previewKey";
import type { Dataset, FitOverlay } from "../../../lib/types";
import { useRunStamp } from "../workbench/useRunStamp";
import { boundDataTokens, ranDataStale, reflFitKey } from "./reflFitRunPrep";
import type { ChannelBinding, FitDataSettings } from "./reflFitData";

export interface ReflFitFreshness {
  stale: boolean;
  /** The key and bound-data identity a run started now is asked with (read after its datasets resolved). */
  launch: (channels: readonly ChannelBinding[], settings: FitDataSettings, sentParams: unknown, sentGraded: unknown) => { key: string; data: Record<string, string> };
  record: (launch: { key: string; data: Record<string, string> }) => void;
  forget: () => void;
  /** The next render's settings are the result's own (after "Apply to model"). */
  rebase: () => void;
}

export function useReflFitFreshness(args: {
  channels: readonly ChannelBinding[];
  settings: FitDataSettings;
  sentParams: unknown;
  sentGraded: unknown;
  datasets: readonly Dataset[];
  hasResult: boolean;
  overlay: FitOverlay | null;
  ownOverlay: { readonly current: FitOverlay | null };
  setOverlay: (o: FitOverlay | null) => void;
}): ReflFitFreshness {
  const { channels, settings, sentParams, sentGraded, datasets, hasResult, overlay, ownOverlay, setOverlay } = args;
  const latestDatasets = useLatestRef(datasets);
  const liveKey = reflFitKey(channels, settings, sentParams, sentGraded);
  const stamp = useRunStamp(liveKey);
  const [ranData, setRanData] = useState<Record<string, string> | null>(null);
  const rebasing = useRef(false);
  useEffect(() => {
    if (!rebasing.current) return;
    rebasing.current = false;
    stamp.record(liveKey);
  });
  const stale = hasResult && (stamp.stale || ranDataStale(ranData, datasets));
  useEffect(() => {
    if (stale && ownOverlay.current && overlay === ownOverlay.current) setOverlay(null);
  }, [stale, overlay, ownOverlay, setOverlay]);
  return {
    stale,
    launch: (ch, st, p, g) => ({ key: reflFitKey(ch, st, p, g), data: boundDataTokens(ch, latestDatasets.current) }),
    record: (l) => { stamp.record(l.key); setRanData(l.data); },
    forget: () => { stamp.record(null); setRanData(null); },
    rebase: () => { rebasing.current = true; },
  };
}
