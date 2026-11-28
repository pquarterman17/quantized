// Map operations workshop — state hook. Runs one op (/api/map-ops/apply) on the
// active 2-D map (A), optionally with a second map (B), and commits the result
// as a NEW derived dataset through the shared result contract
// (store/commitComputedOutput): one undo step, no duplicate on a repeat, marked
// out of date when A or B changes, inputs and settings recorded.

import { useMemo, useState } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { mapOpApply } from "../../../lib/api/mapOps";
import { polygonRefusal } from "../../../lib/roiPolygon";
import type { DataStruct } from "../../../lib/types";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { mapDefaults } from "../analysisextras/columnPicks";
import { isAbortError } from "../workbench/useWorkbenchPreview";
import { useWorkbenchCommit } from "../workbench/useWorkbenchCommit";
import { boundText, snapDrawnRegion } from "./drawnCrop";
import { buildRequest, emptyForm, opLabel, type MapOpsForm } from "./mapOpsForm";

export const MAP_OPS_PRODUCER = { id: "map-ops", label: "Map operations", version: 1 } as const;

const isMap = (d: DataStruct | undefined): boolean => d?.metadata?.["is2D"] === true;

export interface MapOpsState {
  isMap: boolean;
  form: MapOpsForm;
  setForm: (patch: Partial<MapOpsForm>) => void;
  /** Other maps in the project, for B. */
  maps: { id: string; name: string }[];
  /** The map's columns, and the X / Y / value picks (-1: let the server choose). */
  columns: { index: number; label: string }[];
  picks: [number, number, number];
  setPick: (slot: 0 | 1 | 2, index: number) => void;
  showPicks: boolean;
  /** "label min .. max" per axis of the loaded data, to guide the crop bounds. */
  ranges: { x: string; y: string } | null;
  /** Fill the crop bounds from the box drawn on the map (snapped to cells). */
  applyDrawnBox: () => void;
  hasDrawnBox: boolean;
  busy: boolean;
  error: string | null;
  cancel: () => void;
  run: () => Promise<void>;
}

const rangeText = (d: DataStruct, col: number): string => {
  let lo = Infinity, hi = -Infinity;
  for (const row of d.values) {
    const v = row?.[col];
    if (typeof v === "number" && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  return lo <= hi ? `${d.labels[col]}: ${Number(lo.toPrecision(6))} … ${Number(hi.toPrecision(6))}${d.units[col] ? ` ${d.units[col]}` : ""}` : "";
};

export function useMapOps(): MapOpsState {
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const resolveDataset = useApp((s) => s.resolveDataset);
  const [form, setFormState] = useState<MapOpsForm>(emptyForm);
  const [userPicks, setUserPicks] = useState<[number, number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mapRoi = useApp((s) => s.mapRoi);
  const mapPolygon = useApp((s) => s.mapPolygon);
  const committing = useWorkbenchCommit();

  const data = active?.data;
  const map = isMap(data);
  const columns = useMemo(() => (data ? data.labels.map((label, index) => ({ index, label })) : []), [data]);
  const defaults = useMemo(() => mapDefaults(active ?? null), [active]);
  const picks: [number, number, number] = userPicks ?? defaults ?? [-1, -1, -1];
  const maps = datasets.filter((d) => d.id !== active?.id && isMap(d.data)).map((d) => ({ id: d.id, name: d.name }));
  const ranges = useMemo(() => {
    if (!data || !map || picks[0] < 0 || picks[1] < 0) return null;
    return { x: rangeText(data, picks[0]), y: rangeText(data, picks[1]) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, map, picks[0], picks[1]]);

  const applyDrawnBox = (): void => {
    if (!data) return;
    if (!mapRoi && mapPolygon) { setError(polygonRefusal("Crop")); return; }
    const r = snapDrawnRegion(data, mapRoi, picks[2]);
    if (r.error !== undefined) { setError(r.error); return; }
    setError(null);
    const c = r.crop;
    setUserPicks(c.cols);
    setFormState((f) => ({ ...f, xmin: boundText(c.xmin), xmax: boundText(c.xmax), ymin: boundText(c.ymin), ymax: boundText(c.ymax) }));
  };

  const run = async (): Promise<void> => {
    if (!active) return;
    const built = buildRequest(form);
    if (built.error !== undefined) { setError(built.error); return; }
    setError(null);
    const cols = picks[0] >= 0 && picks[1] >= 0 && picks[2] >= 0 ? { x_col: picks[0], y_col: picks[1], z_col: picks[2] } : {};
    await committing.run(async (signal) => {
      try {
        const a = await resolveDataset(active.id);
        if (!a) throw new Error("the map is unavailable");
        const b = form.op === "arith" ? await resolveDataset(form.otherId) : null;
        if (form.op === "arith" && !b) throw new Error("the second map is unavailable");
        signal.throwIfAborted();
        const out = await mapOpApply({ ...built.req, ...cols, dataset: a.data, ...(b ? { other: b.data } : {}) }, signal);
        signal.throwIfAborted();
        const used = b ? [a, b] : [a];
        const name = `${a.name} · ${opLabel(form, b?.name)}`;
        const outcome = commitComputedOutput({
          producer: MAP_OPS_PRODUCER,
          sources: used.map((d) => ({ id: d.id, computedOn: analysisDataFingerprint(d) })),
          settings: { ...built.req, ...cols, ...(b ? { other: b.name } : {}) },
          name,
          data: out,
          status: `created ${name}`,
        });
        if (outcome.kind === "refused") setError(outcome.reason);
        else if (outcome.kind !== "existing") void import("./presetAdapter").then((m) => m.recordMapOpsRun(form)).catch(() => undefined);
      } catch (e) {
        if (signal.aborted || isAbortError(e)) return;
        setError(e instanceof Error ? e.message : "map operation failed");
      }
    });
  };

  return {
    isMap: map,
    form,
    setForm: (patch) => setFormState((f) => ({ ...f, ...patch })),
    maps,
    columns,
    picks,
    setPick: (slot, index) => setUserPicks((p) => { const n: [number, number, number] = [...(p ?? picks)]; n[slot] = index; return n; }),
    showPicks: map && columns.length > 3,
    ranges,
    applyDrawnBox,
    hasDrawnBox: mapRoi != null || mapPolygon != null,
    busy: committing.busy,
    error,
    cancel: committing.abort,
    run,
  };
}
