// "Open in Units / Internal field / Curie–Weiss" (lane RO3): the bits the three
// Magnetometry tabs share. They commit through the same plotted channels, so
// each records which channels it ran on beside its settings (reopen plots them
// again, or says they moved: store/toolReopenChannels.ts), and the panel opens
// on the tab of the result it was reopened from.

import type { CommitSettings } from "../../../lib/committedOutput";
import type { Dataset } from "../../../lib/types";
import { useToolReopen } from "../../../store/toolReopen";

/** The producers of the Magnetometry tabs, by tab. */
export const MAG_REOPEN_TOOLS = { units: "mag-normalization", demag: "mag-demag", "curie-weiss": "curie-weiss" } as const;
export type MagReopenTab = keyof typeof MAG_REOPEN_TOOLS;

/** The channels a Magnetometry tab ran on, as `extra.channels` records them. */
export function magChannelsExtra(ds: Dataset, xKey: number | null, yKey: number): CommitSettings {
  return {
    channels: { xLabel: xKey == null ? null : (ds.data.labels[xKey] ?? ""), yLabel: ds.data.labels[yKey] ?? "", xIndex: xKey, yIndex: yKey },
  };
}

/** The tab of the newest Magnetometry reopen session, or null (a plain open). */
export function reopenedMagTab(): MagReopenTab | null {
  const { sessions } = useToolReopen.getState();
  let best: { tab: MagReopenTab; nonce: number } | null = null;
  for (const tab of Object.keys(MAG_REOPEN_TOOLS) as MagReopenTab[]) {
    const session = sessions[MAG_REOPEN_TOOLS[tab]];
    if (session && (!best || session.nonce > best.nonce)) best = { tab, nonce: session.nonce };
  }
  return best?.tab ?? null;
}

/** Changes whenever a Magnetometry reopen session starts: the panel mounts its
 *  body under it, so every tab hook seeds afresh from the new session. */
export function magReopenKey(sessions: ReturnType<typeof useToolReopen.getState>["sessions"]): number {
  return Object.values(MAG_REOPEN_TOOLS).reduce((sum, tool) => sum + (sessions[tool]?.nonce ?? 0), 0);
}
