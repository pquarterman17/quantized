// Surface fit z = f(x, y) workshop — state hook. Fits one of the backend's 2-D
// models (/api/surface-fit, calc.surface_fit) to three columns of the active
// dataset: the X axis plus two value channels (a long-form XYZ table or a map
// dataset), or any three value channels. Reads the FULL analysis view
// (columnPicks.useLoadColumns) so excluded rows never bias the fit. "Add fitted
// surface" writes x, y, z_fit, z, residual as a new dataset, a map-able XYZ
// table.

import { useEffect, useMemo, useRef, useState } from "react";

import {
  surfaceFit,
  surfaceGuess,
  surfaceModels,
  type SurfaceFitResult,
  type SurfaceModelInfo,
} from "../../../lib/api/analysisExtras";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { DataStruct } from "../../../lib/types";
import { nextDatasetId, useActiveDataset, useApp } from "../../../store/useApp";
import { useFollowColumnPicks } from "../useFollowColumnPicks";
import { useLoadColumns, parseField, pickColumns, pickLabel, pickUnit, validPick, type PickColumn } from "../analysisextras/columnPicks";

export interface SurfaceFitState {
  hasData: boolean;
  columns: PickColumn[];
  xCol: number;
  yCol: number;
  zCol: number;
  setXCol: (i: number) => void;
  setYCol: (i: number) => void;
  setZCol: (i: number) => void;
  models: SurfaceModelInfo[];
  model: SurfaceModelInfo | null;
  setModelName: (n: string) => void;
  p0: string[];
  lower: string[];
  upper: string[];
  setBound: (kind: "p0" | "lower" | "upper", i: number, v: string) => void;
  busy: boolean;
  error: string | null;
  result: SurfaceFitResult | null;
  fit: () => Promise<void>;
  resetGuess: () => void;
  addFittedSurface: () => void;
  labels: { x: string; y: string; z: string };
}

const fmtStart = (v: number): string => String(Number(v.toPrecision(6)));

/** Default picks: X axis, first channel, second channel (a map's X, Y, Z). */
function defaults(cols: PickColumn[]): [number, number, number] {
  const n = cols.length;
  return [cols[0]?.index ?? -1, cols[Math.min(1, n - 1)]?.index ?? -1, cols[Math.min(2, n - 1)]?.index ?? -1];
}

export function useSurfaceFit(): SurfaceFitState {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const columns = useMemo(() => pickColumns(active), [active]);
  const load = useLoadColumns();

  const [picks, setPicks] = useState<[number, number, number]>(() => defaults(columns));
  const [models, setModels] = useState<SurfaceModelInfo[]>([]);
  const [modelName, setModelName] = useState("Plane");
  const [p0, setP0] = useState<string[]>([]);
  const [lower, setLower] = useState<string[]>([]);
  const [upper, setUpper] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<{ key: string; res: SurfaceFitResult } | null>(null);
  const seq = useRef(0);

  const model = models.find((m) => m.name === modelName) ?? models[0] ?? null;
  const [xCol, yCol, zCol] = picks.map((p, i) => validPick(columns, p, defaults(columns)[i])) as [number, number, number];
  const fingerprint = useMemo(() => (active && !active.pending ? analysisDataFingerprint(active) : "pending"), [active]);
  const key = `${active?.id}:${fingerprint}:${xCol}:${yCol}:${zCol}:${model?.name}`;
  // A result describes the inputs it ran on; any change to them retires it.
  const result = stored && stored.key === key ? stored.res : null;
  const hasData = !!active && columns.length >= 3;

  useEffect(() => {
    let live = true;
    surfaceModels().then(
      (m) => live && setModels(m),
      (e: unknown) => live && setError(e instanceof Error ? e.message : "could not load the surface models"),
    );
    return () => {
      live = false;
    };
  }, []);

  // A new dataset resets the picks; a changed column list keeps them on their
  // columns (or resets one whose column is gone, with a toast).
  useEffect(() => {
    setPicks(defaults(columns));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
  useFollowColumnPicks(active, (follow) => {
    const d = defaults(columns);
    setPicks((p) => p.map((c, i) => follow(c) ?? d[i]) as [number, number, number]);
  });

  function resetGuess(): void {
    if (!active || !model || !hasData) return;
    const mine = ++seq.current;
    void (async () => {
      try {
        const got = await load(active.id, [xCol, yCol, zCol]);
        if (!got || mine !== seq.current) return;
        const [x, y, z] = got.columns;
        const g = await surfaceGuess({ x, y, z, model: model.name });
        if (mine !== seq.current) return;
        setP0(g.p0.map(fmtStart));
        setLower(g.p0.map(() => ""));
        setUpper(g.p0.map(() => ""));
        setError(null);
      } catch (e) {
        if (mine === seq.current) setError(e instanceof Error ? e.message : "could not guess starting values");
      }
    })();
  }

  // Starting values follow the data and the model until the user edits them.
  useEffect(() => {
    if (model) {
      setP0(model.param_names.map(() => ""));
      setLower(model.param_names.map(() => ""));
      setUpper(model.param_names.map(() => ""));
      resetGuess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.name, active?.id, fingerprint, xCol, yCol, zCol, hasData]);

  function setBound(kind: "p0" | "lower" | "upper", i: number, v: string): void {
    const set = kind === "p0" ? setP0 : kind === "lower" ? setLower : setUpper;
    set((arr) => arr.map((o, j) => (j === i ? v : o)));
  }

  async function fit(): Promise<void> {
    if (!active || !model) return;
    const start = p0.map(parseField);
    const bad = start.findIndex((v) => v === null || !Number.isFinite(v));
    if (bad >= 0) {
      setError(`Start value for ${model.param_names[bad]} is not a number.`);
      return;
    }
    const lo = lower.map(parseField);
    const hi = upper.map(parseField);
    const badBound = [...lo, ...hi].findIndex((v) => v !== null && Number.isNaN(v));
    if (badBound >= 0) {
      setError("A bound is not a number (leave it empty for no bound).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const got = await load(active.id, [xCol, yCol, zCol]);
      if (!got) return;
      const [x, y, z] = got.columns;
      const res = await surfaceFit({ x, y, z, model: model.name, p0: start as number[], lower: lo, upper: hi });
      setStored({ key, res });
    } catch (e) {
      setStored(null);
      setError(e instanceof Error ? e.message : "surface fit failed");
    } finally {
      setBusy(false);
    }
  }

  const labels = { x: pickLabel(columns, xCol), y: pickLabel(columns, yCol), z: pickLabel(columns, zCol) };

  function addFittedSurface(): void {
    if (!result || !active) return;
    const d = active.data;
    const data: DataStruct = {
      time: result.x,
      values: result.y.map((yy, i) => [yy, result.z_fit[i], result.z[i], result.residuals[i]]),
      labels: [labels.y, `${labels.z} (fit)`, labels.z, `${labels.z} residual`],
      units: [pickUnit(d, yCol), pickUnit(d, zCol), pickUnit(d, zCol), pickUnit(d, zCol)],
      metadata: {
        x_column_name: labels.x,
        x_column_unit: pickUnit(d, xCol),
        surface_fit: { model: result.model_name, params: result.params, r2: result.r2 },
        ...(d.metadata?.["scatteredXYZ"] === true ? { scatteredXYZ: true } : {}),
      },
    };
    addDataset({ id: nextDatasetId(), name: `${active.name} (${result.model_name} fit)`, data });
    setStatus(`added the ${result.model_name} fitted surface (${result.n_points} points)`);
  }

  return {
    hasData,
    columns,
    xCol,
    yCol,
    zCol,
    setXCol: (i) => setPicks((p) => [i, p[1], p[2]]),
    setYCol: (i) => setPicks((p) => [p[0], i, p[2]]),
    setZCol: (i) => setPicks((p) => [p[0], p[1], i]),
    models,
    model,
    setModelName,
    p0,
    lower,
    upper,
    setBound,
    busy,
    error,
    result,
    fit,
    resetGuess,
    addFittedSurface,
    labels,
  };
}
