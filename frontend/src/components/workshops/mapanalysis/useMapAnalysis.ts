// Map analysis workshop — state hook. Runs peak finding / ROI volume on the
// active 2-D map (/api/map-analysis/*) and commits the result TABLE as a NEW
// derived dataset through the shared result contract (store/commitComputedOutput):
// one undo step, no duplicate on a repeat, marked out of date when the map
// changes, inputs and settings recorded. The map itself is never edited.

import { useMemo, useState } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { mapPeaks, mapVolume } from "../../../lib/api/mapAnalysis";
import type { DataStruct } from "../../../lib/types";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { mapDefaults } from "../analysisextras/columnPicks";
import { isAbortError } from "../workbench/useWorkbenchPreview";
import { useWorkbenchCommit } from "../workbench/useWorkbenchCommit";
import { boundText, buildPeaksRequest, buildVolumeRequest, drawnBounds, emptyForm, summarize, type MapAnalysisForm } from "./mapAnalysisForm";

export const MAP_ANALYSIS_PRODUCER = { id: "map-analysis", label: "Map analysis", version: 1 } as const;

export interface MapAnalysisState {
  isMap: boolean;
  form: MapAnalysisForm;
  setForm: (patch: Partial<MapAnalysisForm>) => void;
  columns: { index: number; label: string }[];
  picks: [number, number, number];
  setPick: (slot: 0 | 1 | 2, index: number) => void;
  showPicks: boolean;
  hasDrawnBox: boolean;
  applyDrawnBox: () => void;
  busy: boolean;
  error: string | null;
  summary: string[];
  cancel: () => void;
  run: () => Promise<void>;
}

export function useMapAnalysis(): MapAnalysisState {
  const active = useActiveDataset();
  const resolveDataset = useApp((s) => s.resolveDataset);
  const mapRoi = useApp((s) => s.mapRoi);
  const [form, setFormState] = useState<MapAnalysisForm>(emptyForm);
  const [userPicks, setUserPicks] = useState<[number, number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string[]>([]);
  const committing = useWorkbenchCommit();

  const data = active?.data;
  const map = data?.metadata?.["is2D"] === true;
  const columns = useMemo(() => (data ? data.labels.map((label, index) => ({ index, label })) : []), [data]);
  const defaults = useMemo(() => mapDefaults(active ?? null), [active]);
  const picks: [number, number, number] = userPicks ?? defaults ?? [-1, -1, -1];
  const havePicks = picks[0] >= 0 && picks[1] >= 0 && picks[2] >= 0;

  const applyDrawnBox = (): void => {
    if (!data) return;
    const r = drawnBounds(data, mapRoi, picks[2]);
    if (r.error !== undefined) { setError(r.error); return; }
    setError(null);
    const [x0, x1, y0, y1] = r.bounds;
    setUserPicks(r.cols);
    setFormState((f) => ({ ...f, x0: boundText(x0), x1: boundText(x1), y0: boundText(y0), y1: boundText(y1) }));
  };

  const run = async (): Promise<void> => {
    if (!active) return;
    const peaks = form.mode === "peaks";
    const built = peaks ? buildPeaksRequest(form) : buildVolumeRequest(form);
    if (built.error !== undefined) { setError(built.error); return; }
    setError(null);
    const cols = havePicks ? { x_col: picks[0], y_col: picks[1], z_col: picks[2] } : {};
    await committing.run(async (signal) => {
      try {
        const a = await resolveDataset(active.id);
        if (!a) throw new Error("the map is unavailable");
        signal.throwIfAborted();
        const out: DataStruct = peaks
          ? await mapPeaks({ ...built.req, ...cols, dataset: a.data } as Parameters<typeof mapPeaks>[0], signal)
          : await mapVolume({ ...built.req, ...cols, dataset: a.data } as Parameters<typeof mapVolume>[0], signal);
        signal.throwIfAborted();
        const name = `${a.name} · ${peaks ? "map peaks" : "ROI volume"}`;
        const outcome = commitComputedOutput({
          producer: MAP_ANALYSIS_PRODUCER,
          sources: [{ id: a.id, computedOn: analysisDataFingerprint(a) }],
          settings: { ...built.req, ...cols, mode: form.mode },
          name,
          data: out,
          status: `created ${name}`,
          quiet: true, // keep the map active: the panel and a repeat run still see it
        });
        if (outcome.kind === "refused") setError(outcome.reason);
        else setSummary(summarize(out, form.mode));
      } catch (e) {
        if (signal.aborted || isAbortError(e)) return;
        setError(e instanceof Error ? e.message : "map analysis failed");
      }
    });
  };

  return {
    isMap: map,
    form,
    setForm: (patch) => setFormState((f) => ({ ...f, ...patch })),
    columns,
    picks,
    setPick: (slot, index) => setUserPicks((p) => { const n: [number, number, number] = [...(p ?? picks)]; n[slot] = index; return n; }),
    showPicks: map && columns.length > 3,
    hasDrawnBox: mapRoi != null,
    applyDrawnBox,
    busy: committing.busy,
    error,
    summary,
    cancel: committing.abort,
    run,
  };
}
