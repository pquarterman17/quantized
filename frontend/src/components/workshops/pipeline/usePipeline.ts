// Pipeline workshop (#6) — state hook. The recorded macro steps (now typed,
// lib/pipeline) become an editable, re-runnable step list: reorder / toggle /
// edit params / delete / insert, then replay the runnable kinds against the
// ACTIVE dataset (executeSteps — shared with the #3 template batch). Recording
// is suppressed while running via `pipelineRunning`, so a run never re-records
// itself. Per-step success/skip/failure markers land in `runLog`.

import { useCallback, useEffect, useMemo, useState } from "react";

import { executeSteps, type ExecuteResult, type StepLogEntry, type StepStatus } from "./executeSteps";
import { makeStep, regenerateStep, validateExpression, type PipelineStep } from "../../../lib/pipeline";
import { analyzePipeline, type PipelineReview } from "../../../lib/pipelineStudio";
import type { Dataset } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

export type { StepStatus };

export interface PipelineRunSummary {
  inputName: string;
  outputName: string;
  createdNames: string[];
  ok: number;
  warned: number;
  failed: number;
  skipped: number;
}

export interface PipelineState {
  active: Dataset | null;
  steps: PipelineStep[];
  review: PipelineReview;
  running: boolean;
  runLog: Record<string, StepLogEntry>;
  lastRun: PipelineRunSummary | null;
  run: () => Promise<void>;
  addExpressionStep: (name: string, expr: string) => string | null;
  /** Author-time validation for expression params (#7); null = valid. */
  validate: (expr: string) => string | null;
  // edit ops (store passthroughs, gathered for the view)
  toggleStep: (id: string) => void;
  removeStep: (id: string) => void;
  moveStep: (id: string, delta: number) => void;
  duplicateStep: (id: string) => void;
  /** A params edit from the step editor — ONE undo entry (macroSteps is in
   *  the undo snapshot), then the store edit. `text` as updateStepParams. */
  editStep: (id: string, params: Record<string, unknown>, text?: { label: string; code: string }) => void;
}

export function usePipeline(): PipelineState {
  const active = useActiveDataset();
  const steps = useApp((s) => s.macroSteps);
  const datasets = useApp((s) => s.datasets);
  const running = useApp((s) => s.pipelineRunning);
  const setPipelineRunning = useApp((s) => s.setPipelineRunning);
  const toggleStep = useApp((s) => s.toggleStep);
  const removeStep = useApp((s) => s.removeStep);
  const moveStep = useApp((s) => s.moveStep);
  const updateStepParams = useApp((s) => s.updateStepParams);
  const recordHistory = useApp((s) => s.recordHistory);
  const insertStep = useApp((s) => s.insertStep);
  const loadSteps = useApp((s) => s.loadSteps);

  const [runLog, setRunLog] = useState<Record<string, StepLogEntry>>({});
  const [lastRun, setLastRun] = useState<PipelineRunSummary | null>(null);
  const review = useMemo(() => analyzePipeline(steps, active, datasets), [active, datasets, steps]);

  // A result belongs to exactly one recipe/input pair. Keeping its markers
  // after an edit or showing them beside another active worksheet would make
  // an old pass/fail look like evidence about the new configuration.
  useEffect(() => {
    setRunLog({});
    setLastRun(null);
  }, [steps]);
  useEffect(() => setRunLog({}), [active?.id]);

  const validate = useCallback(
    (expr: string) => validateExpression(expr, active?.data.labels.length ?? 0),
    [active],
  );

  const addExpressionStep = useCallback(
    (name: string, expr: string): string | null => {
      const err = validate(expr);
      if (err) return err;
      if (!name.trim()) return "column name required";
      recordHistory("add pipeline step");
      insertStep(regenerateStep(
        makeStep("expression", `Add column ${name}`, "", {
          name,
          expr,
        }),
      ));
      return null;
    },
    [insertStep, recordHistory, validate],
  );

  const undoableToggle = useCallback((id: string) => {
    if (!useApp.getState().macroSteps.some((step) => step.id === id)) return;
    recordHistory("toggle pipeline step");
    toggleStep(id);
  }, [recordHistory, toggleStep]);

  const undoableRemove = useCallback((id: string) => {
    if (!useApp.getState().macroSteps.some((step) => step.id === id)) return;
    recordHistory("remove pipeline step");
    removeStep(id);
  }, [recordHistory, removeStep]);

  const undoableMove = useCallback((id: string, delta: number) => {
    const current = useApp.getState().macroSteps;
    const index = current.findIndex((step) => step.id === id);
    const destination = Math.max(0, Math.min(current.length - 1, index + delta));
    if (index < 0 || destination === index) return;
    recordHistory("reorder pipeline step");
    moveStep(id, delta);
  }, [moveStep, recordHistory]);

  const duplicateStep = useCallback((id: string) => {
    const current = useApp.getState().macroSteps;
    const index = current.findIndex((step) => step.id === id);
    if (index < 0) return;
    const source = current[index];
    const copy = {
      ...makeStep(source.kind, `${source.label} copy`, source.code, structuredClone(source.params)),
      enabled: source.enabled,
    };
    recordHistory("duplicate pipeline step");
    loadSteps([...current.slice(0, index + 1), copy, ...current.slice(index + 1)]);
  }, [loadSteps, recordHistory]);

  const editStep = useCallback(
    (id: string, params: Record<string, unknown>, text?: { label: string; code: string }) => {
      // An Apply that changes nothing (a double-click) is not an undo step.
      const st = useApp.getState().macroSteps.find((s) => s.id === id);
      if (!st) return;
      const same = JSON.stringify(st.params) === JSON.stringify(params);
      if (same && (!text || (text.label === st.label && text.code === st.code))) return;
      recordHistory("edit pipeline step");
      updateStepParams(id, params, text);
    },
    [recordHistory, updateStepParams],
  );

  const run = useCallback(async () => {
    const before = useApp.getState();
    const target = before.activeId;
    if (!target) return;
    const targetDataset = before.datasets.find((item) => item.id === target) ?? null;
    const currentReview = analyzePipeline(before.macroSteps, targetDataset, before.datasets);
    if (!currentReview.canRun) {
      setRunLog(Object.fromEntries(currentReview.steps
        .filter((step) => step.state === "invalid")
        .map((step) => [step.id, { status: "failed" as const, note: step.issue ?? "invalid step" }])));
      return;
    }
    setPipelineRunning(true);
    setRunLog({});
    setLastRun(null);
    try {
      const result = await executeSteps(before.macroSteps, target, (log) => {
        if (useApp.getState().activeId === target) setRunLog(log);
      });
      setLastRun(summarizeRun(result, targetDataset?.name ?? target));
    } finally {
      setPipelineRunning(false);
    }
  }, [setPipelineRunning]);

  return {
    active,
    steps,
    review,
    running,
    runLog,
    lastRun,
    run,
    addExpressionStep,
    validate,
    toggleStep: undoableToggle,
    removeStep: undoableRemove,
    moveStep: undoableMove,
    duplicateStep,
    editStep,
  };
}

function summarizeRun(result: ExecuteResult, inputName: string): PipelineRunSummary {
  const state = useApp.getState();
  const nameOf = (id: string) => state.datasets.find((item) => item.id === id)?.name ?? id;
  const statuses = Object.values(result.log).map((entry) => entry.status);
  return {
    inputName,
    outputName: nameOf(result.target),
    createdNames: result.created.map(nameOf),
    ok: statuses.filter((status) => status === "ok").length,
    warned: statuses.filter((status) => status === "warn").length,
    failed: statuses.filter((status) => status === "failed").length,
    skipped: statuses.filter((status) => status === "skipped").length,
  };
}
