// The Analysis window's title-bar half (WORKSPACE_LAYOUT_PLAN P4): the dataset
// it follows (the focused plot's, unless pinned, D8), the mode and the pin.
// The body is ./AnalysisWindow.

import { useEffect, useRef } from "react";

import { pinOf, rememberDatasetName, rememberedDatasetName, resolveFollow, type FollowSource } from "../../../lib/windowLayout/pins";
import { pinAnalysis, unpinAnalysis } from "../../../store/windowLayoutActions";
import { useApp } from "../../../store/useApp";
import { announce } from "./layoutAnnounce";

/** What the Analysis window shows, from the live store. */
export function useAnalysisSource(): FollowSource {
  const pinned = useApp((s) => pinOf(s.windowLayout, "analysis"));
  const datasets = useApp((s) => s.datasets);
  // Only a plot window takes focus; its dataset is the facade's activeId (as for Data).
  const plotDatasetId = useApp((s) => (s.plotWindows.some((w) => w.id === s.focusedWindowId && w.kind === "plot") ? s.activeId : null));
  return resolveFollow(pinned, datasets, plotDatasetId);
}

const MODE: Record<FollowSource["mode"], string> = { plot: "following the plot", pinned: "pinned" };

/** The title-bar half: dataset, mode and the pin toggle. */
export function AnalysisTitle() {
  const src = useAnalysisSource();
  const name = useApp((s) => (src.kind === "dataset" ? s.datasets.find((d) => d.id === src.datasetId)?.name : undefined));
  const pinned = src.mode === "pinned";
  const gone = src.kind === "missing" ? rememberedDatasetName(src.pinned) : undefined;
  const label = src.kind === "dataset" ? (name ?? "dataset") : src.kind === "missing" ? (gone ?? "removed dataset") : "no dataset";
  useEffect(() => {
    if (src.kind === "dataset" && name) rememberDatasetName(src.datasetId, name);
  }, [src, name]);
  const mode = gone ? "pinned, removed" : MODE[src.mode];
  // Say what the guide now shows when it changes (focus move, pin); the first render stays silent.
  const key = `${src.kind}:${src.mode}:${src.kind === "dataset" ? src.datasetId : ""}`;
  const prev = useRef(key);
  useEffect(() => {
    if (prev.current !== key) announce(`Analysis shows ${label}, ${mode}`);
    prev.current = key;
  }, [key, label, mode]);
  return (
    <>
      <span className="qzk-wl-data-src" data-testid="analysis-source" title={`${label} · ${mode}`}>
        <span className="qzk-wl-data-name">{label}</span>
        <span className="qzk-wl-data-mode"> · {mode}</span>
      </span>
      <button
        type="button"
        className="qzk-wl-close qzk-wl-pin"
        aria-label={`Pin the Analysis window (${mode})`}
        aria-pressed={pinned}
        disabled={!pinned && src.kind !== "dataset"}
        title={pinned ? "Pinned to this dataset; press to follow the plot again." : "Now following the plot; press to keep this dataset whatever plot is focused."}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => (pinned ? unpinAnalysis() : src.kind === "dataset" && pinAnalysis(src.datasetId))}
      >
        ⚲
      </button>
    </>
  );
}
