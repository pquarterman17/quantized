// Pipeline workshop (#6) — state hook. The recorded macro steps (now typed,
// lib/pipeline) become an editable, re-runnable step list: reorder / toggle /
// edit params / delete / insert, then replay the runnable kinds against the
// ACTIVE dataset (executeSteps — shared with the #3 template batch). Recording
// is suppressed while running via `pipelineRunning`, so a run never re-records
// itself. Per-step success/skip/failure markers land in `runLog`.

import { useCallback, useState } from "react";

import { executeSteps, type StepLogEntry, type StepStatus } from "./executeSteps";
import { makeStep, validateExpression, type PipelineStep } from "../../../lib/pipeline";
import type { Dataset } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

export type { StepStatus };

export interface PipelineState {
  active: Dataset | null;
  steps: PipelineStep[];
  running: boolean;
  runLog: Record<string, StepLogEntry>;
  run: () => Promise<void>;
  addExpressionStep: (name: string, expr: string) => string | null;
  /** Author-time validation for expression params (#7); null = valid. */
  validate: (expr: string) => string | null;
  // edit ops (store passthroughs, gathered for the view)
  toggleStep: (id: string) => void;
  removeStep: (id: string) => void;
  moveStep: (id: string, delta: number) => void;
  updateStepParams: (id: string, params: Record<string, unknown>) => void;
}

export function usePipeline(): PipelineState {
  const active = useActiveDataset();
  const steps = useApp((s) => s.macroSteps);
  const running = useApp((s) => s.pipelineRunning);
  const setPipelineRunning = useApp((s) => s.setPipelineRunning);
  const toggleStep = useApp((s) => s.toggleStep);
  const removeStep = useApp((s) => s.removeStep);
  const moveStep = useApp((s) => s.moveStep);
  const updateStepParams = useApp((s) => s.updateStepParams);
  const insertStep = useApp((s) => s.insertStep);

  const [runLog, setRunLog] = useState<Record<string, StepLogEntry>>({});

  const validate = useCallback(
    (expr: string) => validateExpression(expr, active?.data.labels.length ?? 0),
    [active],
  );

  const addExpressionStep = useCallback(
    (name: string, expr: string): string | null => {
      const err = validate(expr);
      if (err) return err;
      if (!name.trim()) return "column name required";
      insertStep(
        makeStep("expression", `Add column ${name}`, `qz.addColumn("${name}", "${expr}")`, {
          name,
          expr,
        }),
      );
      return null;
    },
    [insertStep, validate],
  );

  const run = useCallback(async () => {
    const target = useApp.getState().activeId;
    if (!target) return;
    setPipelineRunning(true);
    setRunLog({});
    try {
      await executeSteps(useApp.getState().macroSteps, target, setRunLog);
    } finally {
      setPipelineRunning(false);
    }
  }, [setPipelineRunning]);

  return {
    active,
    steps,
    running,
    runLog,
    run,
    addExpressionStep,
    validate,
    toggleStep,
    removeStep,
    moveStep,
    updateStepParams,
  };
}
