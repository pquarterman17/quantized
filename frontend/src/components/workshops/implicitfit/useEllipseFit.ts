// Ellipse fit (implicit curve) workshop — state hook. Fits an ellipse to two
// columns of the active dataset (/api/fit-implicit/ellipse, calc.fit_implicit):
// the direct algebraic fit, refined to orthogonal distance. "Add fitted
// ellipse" writes the curve as a dataset to overlay on the points.

import { useEffect, useMemo, useState } from "react";

import { ellipseFit, type EllipseResult } from "../../../lib/api/analysisExtras";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { DataStruct } from "../../../lib/types";
import { useLatestRef } from "../../../lib/previewKey";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { afterCommit } from "../workbench/afterCommit";
import { useAnalysisCommit } from "../resultcommit/useAnalysisCommit";
import { seedNumber, useReopenSeed, useSeedHold } from "../resultcommit/useReopenSession";
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
  /** Why "Add fitted ellipse" is disabled (already added, or nothing to add). */
  addDisabledReason: string | null;
  /** The output a commit replaces (opened from its result, Replace chosen), else null. */
  replacing: string | null;
}

const ELLIPSE_FIT_PRODUCER = { id: "ellipse-fit", label: "Ellipse fit", version: 1 } as const;

export function useEllipseFit(): EllipseFitState {
  const active = useActiveDataset();
  const resolveDataset = useApp((s) => s.resolveDataset);
  const columns = useMemo(() => pickColumns(active), [active]);
  const load = useLoadColumns();
  // "Open in Ellipse fit" (lane RO): start from the recorded columns and method.
  const seed = useReopenSeed(ELLIPSE_FIT_PRODUCER.id, active?.id)?.settings;
  const holdSeed = useSeedHold(!!seed, [active?.id]);
  const [picks, setPicks] = useState<[number, number]>(() => (seed ? [seedNumber(seed.xCol, -1), seedNumber(seed.yCol, 0)] : [-1, 0]));
  const [geometric, setGeometric] = useState(() => seed?.geometric !== false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<{ key: string; res: EllipseResult; x: number[]; y: number[] } | null>(null);

  const xCol = validPick(columns, picks[0], -1);
  const yCol = validPick(columns, picks[1], 0);
  const fingerprint = useMemo(() => (active && !active.pending ? analysisDataFingerprint(active) : "pending"), [active]);
  const key = [active?.id, fingerprint, xCol, yCol, geometric].join(":");
  const live = stored && stored.key === key ? stored : null;
  const liveKey = useLatestRef(key);
  const settingsKey = JSON.stringify([xCol, yCol, geometric]);
  const settingsRef = useLatestRef(settingsKey);
  const hasData = !!active && columns.length >= 2;

  useEffect(() => {
    if (holdSeed()) return; // a reopen's recorded picks, not the defaults
    setPicks([-1, 0]);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
  useFollowColumnPicks(active, (follow) => setPicks((p) => [follow(p[0]) ?? -1, follow(p[1]) ?? 0]));

  async function fit(): Promise<void> {
    if (!active) return;
    const clickSettings = settingsKey;
    const clickKey = key;
    setBusy(true);
    setError(null);
    try {
      // A lazy book's arrival moves the key the result is stored under: install it,
      // let that commit land, then take the key this fit is asked with. With no wait
      // nothing can have changed, and the refs (which catch up in a passive effect)
      // may still trail the render this click came from, so the click's own key is
      // the truth: reading the refs there dropped a click made just after a commit.
      let launchKey = clickKey;
      if (active.pending) {
        await resolveDataset(active.id);
        await afterCommit();
        if (settingsRef.current !== clickSettings) return; // changed while the book loaded: this request carries the old ones
        launchKey = liveKey.current;
      }
      const got = await load(active.id, [xCol, yCol]);
      if (!got) return;
      const [x, y] = got.columns;
      const res = await ellipseFit({ x, y, geometric });
      setStored({ key: launchKey, res, x, y });
    } catch (e) {
      setStored(null);
      setError(e instanceof Error ? e.message : "ellipse fit failed");
    } finally {
      setBusy(false);
    }
  }

  const labels = { x: pickLabel(columns, xCol), y: pickLabel(columns, yCol) };

  // One undo step, no duplicates, stale when the source changes
  // (store/analysisOutputCommit.ts).
  const commit = useAnalysisCommit(live && active ? {
    producer: ELLIPSE_FIT_PRODUCER,
    sourceId: active.id,
    computedOn: fingerprint,
    settings: {
      xCol, yCol, geometric, center: [live.res.center_x, live.res.center_y], semiMajor: live.res.semi_major,
      semiMinor: live.res.semi_minor, angle: live.res.angle_deg, rms: live.res.rms, n: live.x.length,
    },
    status: "added the fitted ellipse",
    output: (source) => {
      const d = source.data;
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
            se: {
              center_x: live.res.center_x_se,
              center_y: live.res.center_y_se,
              semi_major: live.res.semi_major_se,
              semi_minor: live.res.semi_minor_se,
              angle_deg: live.res.angle_deg_se,
            },
            rms: live.res.rms,
            arc_coverage_deg: live.res.arc_coverage_deg,
          },
        },
      };
      return { name: `${source.name} (fitted ellipse)`, data };
    },
  } : null);

  function addEllipse(): void {
    if (commit.disabledReason) return;
    commit.commit();
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
    addDisabledReason: commit.disabledReason,
    replacing: commit.replacing,
  };
}
