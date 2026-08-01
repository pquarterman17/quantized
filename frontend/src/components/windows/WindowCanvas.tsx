// The Stage cell's plot-window host (MULTI_PLOT_PLAN item 3): renders every
// VISIBLE (non-minimized) `plotWindows[]` entry, each z-stacked among the
// others inside the frames host's own stacking context — below workshop
// `ToolWindow` overlays, which float above the whole app rather than just
// the stage cell (Key Decision 3). The single-maximized-window case (every
// fresh workspace's default per decision #6) renders `PlotStage` ALONE, with
// none of this file's chrome in the DOM — pixel-identical to the
// pre-MULTI_PLOT_PLAN Stage (the visual-harness migration guarantee). MDI
// chrome (title bar / resize grip / dataset badge) appears the moment there
// are ≥2 windows (of any winState), or the sole window is explicitly
// restored down.
//
// The focused window renders the full interactive `PlotStage` composition;
// every other VISIBLE window renders a live, non-interactive
// `BackgroundPlotWindow` (item 4, Key Decision 2). A MINIMIZED window (item
// 8) renders NEITHER — it's fully unmounted (no uPlot instance at all, per
// the plan's perf risk note) and instead gets one entry in the `qzk-winstrip`
// dock along the canvas bottom; clicking it restores + focuses the window.
//
// P3.4 slice 4 (docs/performance_envelope.md finding 10): a bulk workspace
// restore stages every non-active window's real content behind
// `store/windowHydration.ts` instead of mounting all of them — 11
// simultaneous uPlot creates — in one commit. A staged (not yet hydrated,
// not focused) window renders an inert placeholder body in place of its
// normal kind dispatch below. This component owns the two reactive hooks
// into that queue: force-hydrate the moment focus changes (nobody may ever
// interact with a placeholder), and prune any id no longer in `plotWindows`
// (a window closed mid-stage stops wasting a drain frame).

import { useEffect, useRef, useState } from "react";

import { useApp } from "../../store/useApp";
import { forceHydrate, pruneHydration, useWindowHydration } from "../../store/windowHydration";
import { plotWindowDatasetId, plotWindowView } from "../../store/windowDocuments";
import { DATASET_DND } from "../Library/useLibraryTree";
import PlotStage from "../Stage/PlotStage";
import BackgroundPlotWindow from "./BackgroundPlotWindow";
import { MapWindow, WorksheetWindow } from "./DocumentWindow";
import PanelPlotWindow from "./PanelPlotWindow";
import PlotWindowFrame from "./PlotWindowFrame";
import SnapshotPlotWindow from "./SnapshotPlotWindow";

export default function WindowCanvas() {
  const plotWindows = useApp((s) => s.plotWindows);
  const focusedWindowId = useApp((s) => s.focusedWindowId);
  const datasets = useApp((s) => s.datasets);
  const restoreWindow = useApp((s) => s.restoreWindow);
  const setPlotCanvasBounds = useApp((s) => s.setPlotCanvasBounds);
  const createWindowAt = useApp((s) => s.createWindowAt);
  const focusWindow = useApp((s) => s.focusWindow);
  // P3.4 slice 4: read the WHOLE staging set once here (not a per-window
  // hook inside `.map()` below, which would call a hook a variable number of
  // times per render) — a window's own gate is then a plain `.has(win.id)`.
  const pendingHydration = useWindowHydration((s) => s.pending);

  const hostRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<{ width: number; height: number } | undefined>(undefined);
  // Item 14: a Library dataset drag hovering the EMPTY canvas background
  // (drops on a frame stop propagation, so this never double-lights).
  const [dropping, setDropping] = useState(false);

  // Track the frames host's own size (never the window's, and never
  // including the winstrip below it) so PlotWindowFrame can keep every title
  // bar reachable across a browser/panel resize (its `bounds` prop doc), and
  // so item 6's Tile/Cascade commands have a real pixel size to lay out
  // against (`plotCanvasBounds` — the store's sole writer is this effect).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) {
        setBounds({ width: box.width, height: box.height });
        setPlotCanvasBounds({ width: box.width, height: box.height });
      }
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      setPlotCanvasBounds(null);
    };
  }, [setPlotCanvasBounds]);

  // ORIGIN_FILE_DECODE_PLAN #38: every VISIBLE window's bound dataset gets
  // its full data fetched (if it's still a lazy Origin book) — covers the
  // background (non-focused) windows a plain click never activates. The
  // focused window's own fetch is triggered by PlotStage's identical effect;
  // ensureBookData is single-flight, so covering it again here is harmless.
  useEffect(() => {
    for (const win of plotWindows) {
      const datasetId = plotWindowDatasetId(win);
      if (win.winState === "minimized" || !datasetId) continue;
      const ds = datasets.find((d) => d.id === datasetId);
      if (ds?.pending) useApp.getState().ensureBookData(ds.id);
    }
  }, [plotWindows, datasets]);

  // P3.4 slice 4, one effect covering both staging-queue reactions (each is
  // a no-op when the OTHER dep changed, so combining costs nothing): (1)
  // focusing a window (click, restore-from-strip, close's refocus, minimize's
  // handoff, …) must show its real content immediately, never a placeholder
  // — every focus path funnels through `focusedWindowId`; (2) a window
  // closed mid-stage (before its drain turn) must stop occupying a slot —
  // pruned against the CURRENT id set on every `plotWindows` change.
  useEffect(() => {
    if (focusedWindowId) forceHydrate(focusedWindowId);
    pruneHydration(new Set(plotWindows.map((w) => w.id)));
  }, [focusedWindowId, plotWindows]);

  // Decision #6 — the migration guarantee: a single maximized window is
  // PIXEL-IDENTICAL to the pre-MULTI_PLOT_PLAN Stage (no chrome at all, and
  // no extra host div — PlotStage keeps rendering directly into the
  // `.qzk-stage-cell` tab slot exactly as it did before this plan).
  if (plotWindows.length === 1 && plotWindows[0].winState === "maximized") {
    return <PlotStage />;
  }

  const visible = plotWindows.filter((w) => w.winState !== "minimized");
  const minimized = plotWindows.filter((w) => w.winState === "minimized");

  return (
    <div className="qzk-wincanvas">
      <div
        className={`qzk-wincanvas-frames${dropping ? " dropping" : ""}`}
        ref={hostRef}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DATASET_DND)) return;
          e.preventDefault(); // required every dragover to keep the drop legal
          if (!dropping) setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes(DATASET_DND)) return;
          e.preventDefault();
          setDropping(false);
          const droppedId = e.dataTransfer.getData(DATASET_DND);
          if (!droppedId) return;
          // Item 14: a drop on EMPTY canvas (frames stopPropagation their
          // own drops) opens a NEW window at the drop point, then focuses
          // it — Origin's "drag data out to make a graph" gesture.
          const rect = hostRef.current?.getBoundingClientRect();
          const id = createWindowAt(
            droppedId,
            e.clientX - (rect?.left ?? 0),
            e.clientY - (rect?.top ?? 0),
          );
          focusWindow(id);
        }}
      >
        {visible.map((win) => {
          const focused = win.id === focusedWindowId;
          const datasetId = plotWindowDatasetId(win);
          const dataset = datasetId ? (datasets.find((d) => d.id === datasetId) ?? null) : null;
          const datasetMeta = dataset
            ? { channels: dataset.data.labels.length, rows: dataset.data.time.length }
            : undefined;
          // P3.4 slice 4: a staged, not-yet-hydrated background window skips
          // the whole kind dispatch below for an inert placeholder — no
          // canvas, no data read, nothing an export/copy path could ever
          // mistake for real content.
          const staged = !focused && pendingHydration.has(win.id);
          return (
            <PlotWindowFrame
              key={win.id}
              win={win}
              focused={focused}
              datasetName={dataset?.name}
              datasetMeta={datasetMeta}
              bounds={bounds}
            >
              {staged ? (
                <div className="qzk-plotwin-placeholder" aria-hidden="true">
                  {win.title || "…"}
                </div>
              ) : win.kind === "snapshot" && win.snapshot ? (
                // Item 11: a snapshot window renders its FROZEN bundle
                // statically — never focused (the store guarantees it), so
                // this branch is checked before the focused dispatch.
                <SnapshotPlotWindow frozen={win.snapshot} view={win.view} bg={win.bg} />
              ) : win.kind === "worksheet" ? (
                // Item 17: a document window mounts the SAME component the
                // stage tab does, live-bound to ITS dataset — also never the
                // focus target, so before the focused dispatch. #14: its own
                // window id gives it an independent row selection.
                <WorksheetWindow dataset={dataset} windowId={win.id} />
              ) : win.kind === "map" ? (
                <MapWindow dataset={dataset} />
              ) : win.kind === "panel" ? (
                // Item 19 v1: a composite multi-dataset window — also never
                // the focus target (like snapshot/worksheet/map above), so
                // before the focused dispatch.
                <PanelPlotWindow win={win} datasets={datasets} />
              ) : focused ? (
                <PlotStage />
              ) : (
                <BackgroundPlotWindow
                  dataset={dataset}
                  view={plotWindowView(win)}
                  bg={win.bg}
                  linkGroup={win.linkGroup}
                />
              )}
            </PlotWindowFrame>
          );
        })}
      </div>
      {minimized.length > 0 && (
        <div className="qzk-winstrip">
          {minimized.map((win) => {
            const datasetId = plotWindowDatasetId(win);
            const dataset = datasetId ? (datasets.find((d) => d.id === datasetId) ?? null) : null;
            const title = win.title || dataset?.name || "Untitled graph";
            return (
              <button
                key={win.id}
                type="button"
                className="qzk-winstrip-item"
                title={`Restore "${title}"`}
                onClick={() => restoreWindow(win.id)}
              >
                {title}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
