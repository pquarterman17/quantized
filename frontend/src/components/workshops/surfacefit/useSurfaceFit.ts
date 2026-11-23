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
import { copyText } from "../../../lib/clipboard";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useLatestRef } from "../../../lib/previewKey";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { afterCommit } from "../workbench/afterCommit";
import { useAnalysisCommit } from "../resultcommit/useAnalysisCommit";
import { seedNumber, seedStrings, useReopenSeed, useSeedHold } from "../resultcommit/useReopenSession";
import { surfaceResultText } from "./surfaceFitText";
import { useFollowColumnPicks } from "../useFollowColumnPicks";
import { useLoadColumns, mapDefaults, parseField, pickColumns, pickLabel, pickUnit, validPick, type PickColumn } from "../analysisextras/columnPicks";

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
  /** Why "Add fitted surface" is disabled (already added, or nothing to add). */
  addDisabledReason: string | null;
  /** The output a commit replaces (opened from its result, Replace chosen), else null. */
  replacing: string | null;
  /** The finite rows the fit ran on (what the residual map and the output draw from). */
  points: { x: number[]; y: number[]; z: number[] } | null;
  guessing: boolean;
  copyResults: (markdown: boolean) => Promise<void>;
  labels: { x: string; y: string; z: string };
}

const SURFACE_FIT_PRODUCER = { id: "surface-fit", label: "Surface fit", version: 1 } as const;

const fmtStart = (v: number): string => String(Number(v.toPrecision(6)));

/** Default picks: X axis, first channel, second channel (a map's X, Y, Z). */
function defaults(cols: PickColumn[], ds: Dataset | null): [number, number, number] {
  const map = mapDefaults(ds);
  if (map) return map;
  const n = cols.length;
  return [cols[0]?.index ?? -1, cols[Math.min(1, n - 1)]?.index ?? -1, cols[Math.min(2, n - 1)]?.index ?? -1];
}

export function useSurfaceFit(): SurfaceFitState {
  const active = useActiveDataset();
  const resolveDataset = useApp((s) => s.resolveDataset);
  const setStatus = useApp((s) => s.setStatus);
  const columns = useMemo(() => pickColumns(active), [active]);
  const load = useLoadColumns();

  // "Open in Surface fit" (lane RO): start from the recorded columns, model and
  // start values; the reset/re-guess effects below leave them alone until the
  // user changes one of them.
  const seed = useReopenSeed(SURFACE_FIT_PRODUCER.id, active?.id);
  const seeded = seed && {
    picks: [seedNumber(seed.settings.xCol, -1), seedNumber(seed.settings.yCol, 0), seedNumber(seed.settings.zCol, 1)] as [number, number, number],
    model: typeof seed.settings.model === "string" ? seed.settings.model : "Plane",
  };
  // Held only when start values were recorded (else they are re-guessed as usual).
  const seedRef = useRef(seeded && Array.isArray(seed?.extra?.p0) ? seeded : null);
  const [picks, setPicks] = useState<[number, number, number]>(() => seeded?.picks ?? defaults(columns, active));
  const [models, setModels] = useState<SurfaceModelInfo[]>([]);
  const [modelName, setModelName] = useState(() => seeded?.model ?? "Plane");
  const [p0, setP0] = useState<string[]>(() => seedStrings(seed?.extra?.p0));
  const [lower, setLower] = useState<string[]>(() => seedStrings(seed?.extra?.lower));
  const [upper, setUpper] = useState<string[]>(() => seedStrings(seed?.extra?.upper));
  const holdSeed = useSeedHold(!!seed, [active?.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<{ key: string; res: SurfaceFitResult; x: number[]; y: number[]; z: number[]; start: { p0: string[]; lower: string[]; upper: string[] } } | null>(null);
  const [guessing, setGuessing] = useState(false);
  const seq = useRef(0);

  const model = models.find((m) => m.name === modelName) ?? models[0] ?? null;
  const [xCol, yCol, zCol] = picks.map((p, i) => validPick(columns, p, defaults(columns, active)[i])) as [number, number, number];
  const fingerprint = useMemo(() => (active && !active.pending ? analysisDataFingerprint(active) : "pending"), [active]);
  // The start values and bounds are inputs too (lane WB6): the fit ran from them.
  const key = `${active?.id}:${fingerprint}:${xCol}:${yCol}:${zCol}:${model?.name}:${JSON.stringify([p0, lower, upper])}`;
  const liveKey = useLatestRef(key);
  const settingsKey = JSON.stringify([xCol, yCol, zCol, model?.name, p0, lower, upper]);
  const settingsRef = useLatestRef(settingsKey);
  // A result describes the inputs it ran on; any change to them retires it.
  const live = stored && stored.key === key ? stored : null;
  const result = live?.res ?? null;
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
    if (holdSeed()) return; // a reopen's recorded picks, not the defaults
    setPicks(defaults(columns, active));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
  useFollowColumnPicks(active, (follow) => {
    const d = defaults(columns, active);
    setPicks((p) => p.map((c, i) => follow(c) ?? d[i]) as [number, number, number]);
  });

  function resetGuess(): void {
    if (!active || !model || !hasData) return;
    const mine = ++seq.current;
    setGuessing(true);
    void (async () => {
      try {
        const got = await load(active.id, [xCol, yCol, zCol]);
        if (mine !== seq.current) return;
        const [x, y, z] = got.columns;
        const g = await surfaceGuess({ x, y, z, model: model.name });
        if (mine !== seq.current) return;
        setP0(g.p0.map(fmtStart));
        setLower(g.p0.map(() => ""));
        setUpper(g.p0.map(() => ""));
        setError(null);
      } catch (e) {
        if (mine === seq.current) setError(e instanceof Error ? e.message : "could not guess starting values");
      } finally {
        if (mine === seq.current) setGuessing(false);
      }
    })();
  }

  // Starting values are re-guessed when the model, the dataset or a picked column
  // changes (a different quantity), never when rows are merely excluded or edited.
  useEffect(() => {
    const held = seedRef.current;
    if (held && held.picks.join(":") === [xCol, yCol, zCol].join(":") && (!model || held.model === model.name)) return;
    seedRef.current = null;
    if (model) {
      setP0(model.param_names.map(() => ""));
      setLower(model.param_names.map(() => ""));
      setUpper(model.param_names.map(() => ""));
      resetGuess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.name, active?.id, xCol, yCol, zCol, hasData]);

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
      const got = await load(active.id, [xCol, yCol, zCol]);
      const [x, y, z] = got.columns;
      const res = await surfaceFit({ x, y, z, model: model.name, p0: start as number[], lower: lo, upper: hi });
      setStored({ key: launchKey, res, x, y, z, start: { p0, lower, upper } }); // what it ran from, for a reopen
    } catch (e) {
      setStored(null);
      setError(e instanceof Error ? e.message : "surface fit failed");
    } finally {
      setBusy(false);
    }
  }

  const labels = { x: pickLabel(columns, xCol), y: pickLabel(columns, yCol), z: pickLabel(columns, zCol) };

  // One undo step, no duplicates, stale when the source changes
  // (store/analysisOutputCommit.ts).
  const commit = useAnalysisCommit(result && live && active ? {
    producer: SURFACE_FIT_PRODUCER,
    sourceId: active.id,
    computedOn: fingerprint,
    settings: { xCol, yCol, zCol, model: result.model_name, params: result.params, errors: result.errors, n: result.n_points },
    reopenExtra: live.start,
    status: `added the ${result.model_name} fitted surface (${result.n_points} points)`,
    output: (source) => {
      const d = source.data;
      return {
        name: `${source.name} (${result.model_name} fit)`,
        data: {
          time: live.x,
          values: live.y.map((yy, i) => [yy, result.z_fit[i], live.z[i], result.residuals[i]]),
          labels: [labels.y, `${labels.z} (fit)`, labels.z, `${labels.z} residual`],
          units: [pickUnit(d, yCol), pickUnit(d, zCol), pickUnit(d, zCol), pickUnit(d, zCol)],
          metadata: {
            x_column_name: labels.x,
            x_column_unit: pickUnit(d, xCol),
            surface_fit: {
              model: result.model_name,
              param_names: result.param_names,
              params: result.params,
              errors: result.errors,
              ci_level: result.level,
              ci_low: result.inference.map((r) => r.lcl),
              ci_high: result.inference.map((r) => r.ucl),
              fixed: result.fixed,
              r2: result.r2,
              rmse: result.rmse,
              dof: result.dof,
            },
            ...(d.metadata?.["scatteredXYZ"] === true ? { scatteredXYZ: true } : {}),
          },
        } satisfies DataStruct,
      };
    },
  } : null);

  function addFittedSurface(): void {
    if (commit.disabledReason) return;
    commit.commit();
  }

  async function copyResults(markdown: boolean): Promise<void> {
    if (!result) return;
    const ok = await copyText(surfaceResultText(result, markdown));
    setStatus(ok ? `copied the fit results (${markdown ? "Markdown" : "TSV, paste into Excel"})` : "clipboard unavailable");
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
    addDisabledReason: commit.disabledReason,
    replacing: commit.replacing,
    points: live ? { x: live.x, y: live.y, z: live.z } : null,
    guessing,
    copyResults,
    labels,
  };
}
