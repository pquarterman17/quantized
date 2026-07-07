// Pipeline workshop (#6) — state hook. The recorded macro steps (now typed,
// lib/pipeline) become an editable, re-runnable step list: reorder / toggle /
// edit params / delete / insert, then replay the runnable kinds against the
// ACTIVE dataset through the same store actions that recorded them (recording
// is suppressed while running via `pipelineRunning`, so a run never re-records
// itself). Per-step success/skip/failure markers land in `runLog`.

import { useCallback, useState } from "react";

import { fitModel } from "../../../lib/api";
import {
  makeStep,
  validateExpression,
  type PipelineStep,
} from "../../../lib/pipeline";
import { analysisData } from "../../../lib/rowstate";
import type { CorrectionParams, Dataset } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

export type StepStatus = "ok" | "skipped" | "failed";

export interface PipelineState {
  active: Dataset | null;
  steps: PipelineStep[];
  running: boolean;
  runLog: Record<string, { status: StepStatus; note?: string }>;
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
  const addFormula = useApp((s) => s.addFormula);
  const applyCorrections = useApp((s) => s.applyCorrections);
  const resetCorrections = useApp((s) => s.resetCorrections);

  const [runLog, setRunLog] = useState<PipelineState["runLog"]>({});

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
    const log: PipelineState["runLog"] = {};
    setRunLog({});
    try {
      for (const step of useApp.getState().macroSteps) {
        if (!step.enabled) {
          log[step.id] = { status: "skipped", note: "disabled" };
          continue;
        }
        try {
          switch (step.kind) {
            case "expression": {
              const name = String(step.params.name ?? "");
              const expr = String(step.params.expr ?? "");
              const err = validateExpression(
                expr,
                useApp.getState().datasets.find((d) => d.id === target)?.data.labels.length ?? 0,
              );
              if (err) throw new Error(err);
              addFormula(target, name, expr);
              log[step.id] = { status: "ok" };
              break;
            }
            case "correction": {
              const params = (step.params.params ?? {}) as CorrectionParams;
              const bg = step.params.bg as { datasetId: string; interp: string } | undefined;
              await applyCorrections(target, params, bg);
              log[step.id] = { status: "ok" };
              break;
            }
            case "reset": {
              resetCorrections(target);
              log[step.id] = { status: "ok" };
              break;
            }
            case "fit": {
              const ds = useApp.getState().datasets.find((d) => d.id === target);
              const d = analysisData(ds);
              if (!d || d.values.length === 0) throw new Error("no data to fit");
              const r = await fitModel({
                model: String(step.params.model ?? "Linear"),
                x: d.time,
                y: d.values.map((row) => row[0]),
              });
              const r2 = typeof r.R2 === "number" ? ` R²=${r.R2.toFixed(4)}` : "";
              log[step.id] = { status: "ok", note: `fit${r2}` };
              break;
            }
            default:
              log[step.id] = {
                status: "skipped",
                note: step.kind === "import" ? "input slot" : "ui step",
              };
          }
        } catch (e) {
          log[step.id] = {
            status: "failed",
            note: e instanceof Error ? e.message : "error",
          };
        }
        setRunLog({ ...log });
      }
    } finally {
      setPipelineRunning(false);
    }
  }, [addFormula, applyCorrections, resetCorrections, setPipelineRunning]);

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
