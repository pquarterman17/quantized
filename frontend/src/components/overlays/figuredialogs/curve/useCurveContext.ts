// What the curve tabs read from the live store without writing it: the
// dataset's channel labels, the auto-cycle position the canvas draws this curve
// at (so a picker shows the DRAWN dash and glyph, P3.3) and the colour a
// gradient gives it. The same reads the Series style card makes.

import { useMemo } from "react";

import { defaultErrKeys } from "../../../../lib/errorbars";
import { effectiveChannels } from "../../../../lib/plotdata";
import { useApp } from "../../../../store/useApp";
import { useFocusedRampedStyles } from "../../../Stage/useSeriesRamp";
import { selectFocusedWindowCycles } from "../../../Stage/useStageSeriesCycle";

export interface CurveContext {
  datasetId: string | null;
  /** Every channel's label, dataset-channel order. */
  labels: readonly string[];
  /** The dataset's default error pairing for this curve, if any. */
  naturalErr?: number;
  cycle: { channels: readonly number[]; on: boolean | number };
  /** The colour the graph's gradient gives this curve, if any. */
  drawnColor?: string;
  /** The plotted channel drawn just before this one (a floating bar's low end). */
  above?: number;
}

export function useCurveContext(channel: number): CurveContext {
  const active = useApp((s) => s.datasets.find((d) => d.id === s.activeId) ?? null);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const data = active?.data;
  const roles = active?.channelRoles;
  const channels = useMemo(
    () => (data ? effectiveChannels(data, yKeys, xKey, roles, seriesOrder) : []),
    [data, roles, yKeys, xKey, seriesOrder],
  );
  const on = useApp((s) => selectFocusedWindowCycles(s, channels.length));
  const ramped = useFocusedRampedStyles(active, useApp((s) => s.plotWindows.find((w) => w.id === s.focusedWindowId)?.document));
  const cycleChannels = on ? channels : [];
  return {
    datasetId: active?.id ?? null,
    labels: data?.labels ?? [],
    naturalErr: data ? defaultErrKeys(data)[channel] : undefined,
    cycle: { on, channels: cycleChannels },
    drawnColor: ramped[channel]?.color,
    above: cycleChannels[cycleChannels.indexOf(channel) - 1],
  };
}
