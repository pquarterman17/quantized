// Ellipse fit (implicit curve) workshop — state hook. Fits an ellipse to two
// columns of the active dataset (/api/fit-implicit/ellipse, calc.fit_implicit):
// the direct algebraic fit, refined to orthogonal distance. "Add fitted
// ellipse" writes the curve as a dataset to overlay on the points.

import { useEffect, useMemo, useState } from "react";

import { ellipseFit, type EllipseResult } from "../../../lib/api/analysisExtras";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { DataStruct } from "../../../lib/types";
import { nextDatasetId, useActiveDataset, useApp } from "../../../store/useApp";
import { useFollowColumnPicks } from "../useFollowColumnPicks";
import { useLoadColumns, pickColumns, pickLabel, pickUnit, validPick, type PickColumn } from "../analysisextras/columnPicks";

export interface EllipseFitState {
  hasData: boolean;
  columns: PickColumn[];
  xCol: number;
  yCol: number;
  setXCol: (i: number) => void;
  setYCol: (i: number) => void;
  geometric: boolean;
  setGeometric: (g: boolean) => void;
  busy: boolean;
  error: string | null;
  result: EllipseResult | null;
  /** The points the fit ran on (finite pairs, as sent). */
  points: { x: number[]; y: number[] } | null;
  labels: { x: string; y: string };
  fit: () => Promise<void>;
  addEllipse: () => void;
}

export function useEllipseFit(): EllipseFitState {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const columns = useMemo(() => pickColumns(active), [active]);
  const load = useLoadColumns();
  const [picks, setPicks] = useState<[number, number]>([-1, 0]);
  const [geometric, setGeometric] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<{ key: string; res: EllipseResult; x: number[]; y: number[] } | null>(null);

  const xCol = validPick(columns, picks[0], -1);
  const yCol = validPick(columns, picks[1], 0);
  const fingerprint = useMemo(() => (active && !active.pending ? analysisDataFingerprint(active) : "pending"), [active]);
  const key = [active?.id, fingerprint, xCol, yCol, geometric].join(":");
  const live = stored && stored.key === key ? stored : null;
  const hasData = !!active && columns.length >= 2;

  useEffect(() => {
    setPicks([-1, 0]);
    setError(null);
  }, [active?.id]);
  useFollowColumnPicks(active, (follow) => setPicks((p) => [follow(p[0]) ?? -1, follow(p[1]) ?? 0]));

  async function fit(): Promise<void> {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const got = await load(active.id, [xCol, yCol]);
      if (!got) return;
      const [x, y] = got.columns;
      const res = await ellipseFit({ x, y, geometric });
      setStored({ key, res, x, y });
    } catch (e) {
      setStored(null);
      setError(e instanceof Error ? e.message : "ellipse fit failed");
    } finally {
      setBusy(false);
    }
  }

  const labels = { x: pickLabel(columns, xCol), y: pickLabel(columns, yCol) };

  function addEllipse(): void {
    if (!live || !active) return;
    const d = active.data;
    const data: DataStruct = {
      time: live.res.curve_x,
      values: live.res.curve_y.map((v) => [v]),
      labels: [labels.y],
      units: [pickUnit(d, yCol)],
      metadata: {
        x_column_name: labels.x,
        x_column_unit: pickUnit(d, xCol),
        ellipse_fit: {
          center: [live.res.center_x, live.res.center_y],
          semi_major: live.res.semi_major,
          semi_minor: live.res.semi_minor,
          angle_deg: live.res.angle_deg,
        },
      },
    };
    addDataset({ id: nextDatasetId(), name: `${active.name} (fitted ellipse)`, data });
    setStatus("added the fitted ellipse");
  }

  return {
    hasData,
    columns,
    xCol,
    yCol,
    setXCol: (i) => setPicks((p) => [i, p[1]]),
    setYCol: (i) => setPicks((p) => [p[0], i]),
    geometric,
    setGeometric,
    busy,
    error,
    result: live?.res ?? null,
    points: live ? { x: live.x, y: live.y } : null,
    labels,
    fit,
    addEllipse,
  };
}
