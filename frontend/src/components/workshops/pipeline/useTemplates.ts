// Analysis templates (#2) + template batch (#3) — state hook. Save the current
// step list as a named template (outputs auto-declared from the last fit
// step's model), load one back into the pipeline, export/import as standalone
// .json, and batch-run over N picked files: each file imports, runs the steps
// (executeSteps — failure isolated), lands a per-file #36 fit report, and one
// summary worksheet (one row per file, columns = declared outputs) joins the
// library as a normal plottable dataset.

import { useCallback, useState } from "react";

import { runTemplateOnDataset } from "./runTemplate";
import { PipelineCancelledError } from "./executeSteps";
import { listFitModels } from "../../../lib/api/curvefit";
import { uploadFile } from "../../../lib/api";
import { saveBlob } from "../../../lib/download";
import type { PipelineStep } from "../../../lib/pipeline";
import {
  deleteTemplate,
  extractOutputs,
  loadTemplates,
  parseTemplate,
  saveTemplate,
  serializeTemplate,
  summaryDataset,
  toTemplate,
  type AnalysisTemplate,
  type BatchRow,
} from "../../../lib/template";
import { deriveExpectations } from "../../../lib/recipeExpect";
import { canonicalJson } from "../../../lib/canonicalJson";
import { definitionKey } from "../../../lib/templatesProject";
import { recordUse } from "../../../lib/recipeIndex";
import { toast } from "../../../store/toasts";
import { runCancellable } from "../../../store/pendingOpActions";
import { removeDatasetsPatch, scrubDatasetsFromHistory } from "../../../store/removeDatasets";
import { nextDatasetId, useApp } from "../../../store/useApp";

export interface BatchProgress {
  done: number;
  total: number;
  current: string;
  failures: string[];
}

/** P2.5 box 4: what makes a saved template a transformation recipe. */
export interface SaveRecipeOptions {
  /** Blank keeps a re-saved recipe's description. */
  description?: string;
  /** The dataset the expected input is read from (usually the recording's);
   *  null = explicitly none; absent or not loaded = keep a re-saved recipe's. */
  exampleId?: string | null;
}

export interface TemplatesState {
  templates: AnalysisTemplate[];
  batch: BatchProgress | null;
  saveCurrent: (name: string, recipe?: SaveRecipeOptions) => Promise<string | null>;
  load: (name: string) => void;
  remove: (name: string) => void;
  exportFile: (name: string) => void;
  importFile: (file: File) => Promise<string | null>;
  runBatch: (name: string, files: File[]) => Promise<void>;
}

/** The declared outputs for a step list: the LAST fit step's parameter names
 *  (from the model registry) + R2; empty when the pipeline has no fit. */
async function deriveOutputs(steps: readonly PipelineStep[]): Promise<string[]> {
  const lastFit = [...steps].reverse().find((s) => s.kind === "fit" && s.enabled);
  if (!lastFit) return [];
  const model = String(lastFit.params.model ?? "");
  try {
    const { models } = await listFitModels();
    const names = models.find((m) => m.name === model)?.paramNames ?? [];
    return [...names, "R2"];
  } catch {
    return ["R2"]; // offline — the model registry is unavailable, declare GOF only
  }
}

function sameStepDefinition(a: readonly PipelineStep[], b: readonly PipelineStep[]): boolean {
  return a.length === b.length && a.every((step, index) => {
    const other = b[index];
    return step.kind === other.kind && step.label === other.label && step.code === other.code &&
      step.enabled === other.enabled && canonicalJson(step.params) === canonicalJson(other.params);
  });
}

export function useTemplates(): TemplatesState {
  const [templates, setTemplates] = useState<AnalysisTemplate[]>(() => loadTemplates());
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const loadSteps = useApp((s) => s.loadSteps);
  const recordHistory = useApp((s) => s.recordHistory);
  const addDataset = useApp((s) => s.addDataset);
  const setPipelineRunning = useApp((s) => s.setPipelineRunning);

  const saveCurrent = useCallback(async (name: string, recipe: SaveRecipeOptions = {}): Promise<string | null> => {
    const steps = useApp.getState().macroSteps;
    if (steps.length === 0) return "no steps to save";
    const outputs = await deriveOutputs(steps);
    // P2.5 box 4: a re-save under the same name is the next revision, and the
    // expected input is read off the example dataset (lib/recipeExpect.ts).
    // A blank description keeps the saved one; so does the expected input
    // when no example is available — only an explicit "no example" (null)
    // drops it.
    const prior = loadTemplates().find((t) => t.name === name);
    const example = useApp.getState().datasets.find((d) => d.id === recipe.exampleId);
    const expects = example ? deriveExpectations(steps, example) : recipe.exampleId === null ? undefined : prior?.expects;
    setTemplates(
      saveTemplate(
        toTemplate(name, steps, outputs, {
          description: recipe.description?.trim() ? recipe.description : prior?.description,
          revision: prior ? (prior.revision ?? 1) + 1 : 1,
          ...(expects ? { expects } : {}),
        }),
      ),
    );
    toast(`template "${name}" saved${prior ? ` (revision ${(prior.revision ?? 1) + 1})` : ""}`);
    return null;
  }, []);

  const load = useCallback(
    (name: string) => {
      const t = loadTemplates().find((x) => x.name === name);
      if (!t) return;
      recordUse({ kind: "analysis", scope: "global", id: t.name });
      // Loading from storage deliberately remints step ids. Compare the
      // scientific/script definition, not those transient identities.
      if (sameStepDefinition(useApp.getState().macroSteps, t.steps)) {
        toast(`template "${name}" is already loaded`);
        return;
      }
      recordHistory("load pipeline template");
      loadSteps(t.steps);
      // P3.5 "recently used". After the existence check, so loading a template
      // deleted in another tab records nothing. A direct import is free here:
      // this hook only ever ships in the lazy Pipeline workshop chunk.
      toast(`template "${name}" loaded — ${t.steps.length} steps`);
    },
    [loadSteps, recordHistory],
  );

  const remove = useCallback((name: string) => {
    setTemplates(deleteTemplate(name));
  }, []);

  const exportFile = useCallback((name: string) => {
    const t = loadTemplates().find((x) => x.name === name);
    if (!t) return;
    saveBlob(
      new Blob([serializeTemplate(t)], { type: "application/json" }),
      `${name.replace(/[^A-Za-z0-9._-]/g, "_")}.qzt.json`,
    );
  }, []);

  const importFile = useCallback(async (file: File): Promise<string | null> => {
    try {
      const t = parseTemplate(await file.text());
      // Finding #8: importing over an existing name must never move its
      // revision BACKWARDS or leave it repeating an already-used one — both
      // of which a bare "upsert with the file's own revision" can do (an
      // older export re-imported, or two machines re-saving the same recipe
      // to different revisions before syncing). An IDENTICAL definition
      // keeps the local revision (nothing to bump for); a DIFFERENT one
      // bumps past whichever of the two was ahead, so the next re-save is
      // unambiguously the newest.
      const prior = loadTemplates().find((x) => x.name === t.name);
      const revision = !prior
        ? t.revision
        : definitionKey(prior) === definitionKey(t)
          ? prior.revision
          : Math.max(prior.revision ?? 1, t.revision ?? 1) + 1;
      const imported = revision !== undefined ? { ...t, revision } : t;
      setTemplates(saveTemplate(imported));
      toast(`template "${t.name}" imported${prior ? ` (revision ${imported.revision ?? 1})` : ""}`);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "import failed";
    }
  }, []);

  const runBatch = useCallback(
    async (name: string, files: File[]) => {
      const t = loadTemplates().find((x) => x.name === name);
      if (!t || files.length === 0) return;
      setPipelineRunning(true);
      setBatch({ done: 0, total: files.length, current: files[0].name, failures: [] });
      const rows: BatchRow[] = [];
      const failures: string[] = [];
      try {
        const completed = await runCancellable(`Running “${t.name}” on ${files.length} files…`, async (signal) => {
          for (let i = 0; i < files.length; i++) {
            signal.throwIfAborted();
            const file = files[i];
            let importedId: string | null = null;
            setBatch({ done: i, total: files.length, current: file.name, failures });
            try {
              const data = await uploadFile(file, signal);
              signal.throwIfAborted();
              importedId = nextDatasetId();
              addDataset({ id: importedId, name: file.name, data });
              // Shared core: steps + output extraction + the per-file #36 report.
              const row = await runTemplateOnDataset(t, importedId, file.name, signal);
              rows.push(row);
              if (row.failed) failures.push(file.name);
              // This file is complete. A later Cancel keeps completed files;
              // only an in-flight file and its partial derived outputs roll back.
              importedId = null;
            } catch (e) {
              if (signal.aborted) {
                const partial = e instanceof PipelineCancelledError ? e.created : [];
                const own = [...(importedId ? [importedId] : []), ...partial];
                if (own.length) {
                  // This is a true rollback, not Delete: no trash entry. Scrub
                  // the cancelled ids from undo/redo too, or a later Ctrl+Z
                  // can resurrect the partial input/output we just promised
                  // was removed.
                  useApp.setState((state) => ({
                    ...removeDatasetsPatch(state, own),
                    ...scrubDatasetsFromHistory(state, own),
                  }));
                }
                throw e;
              }
              // One bad file yields a flagged row, never a dead batch (#3).
              const note = e instanceof Error ? e.message : "import failed";
              rows.push({ file: file.name, values: extractOutputs(t.outputs, undefined), failed: note });
              failures.push(file.name);
            }
          }
          addDataset({
            id: nextDatasetId(),
            name: `${t.name} summary (${rows.length} files)`,
            data: summaryDataset(t.name, t.outputs.length ? t.outputs : ["R2"], rows),
          });
        });
        if (completed) {
          toast(
            failures.length
              ? `batch done — ${failures.length}/${files.length} file(s) flagged`
              : `batch done — ${files.length} file(s)`,
            failures.length ? "danger" : undefined,
          );
        } else {
          // Completed files are real, useful work. Keep them and make their
          // partial result set discoverable instead of silently stranding it.
          if (rows.length) {
            addDataset({
              id: nextDatasetId(),
              name: `${t.name} summary (${rows.length}/${files.length}, cancelled)`,
              data: summaryDataset(t.name, t.outputs.length ? t.outputs : ["R2"], rows),
            });
          }
          toast(`batch cancelled — kept ${rows.length} completed file${rows.length === 1 ? "" : "s"}`, "info");
        }
      } finally {
        setPipelineRunning(false);
        setBatch(null);
      }
    },
    [addDataset, setPipelineRunning],
  );

  return { templates, batch, saveCurrent, load, remove, exportFile, importFile, runBatch };
}
