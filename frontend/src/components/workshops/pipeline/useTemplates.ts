// Analysis templates (#2) + template batch (#3) — state hook. Save the current
// step list as a named template (outputs auto-declared from the last fit
// step's model), load one back into the pipeline, export/import as standalone
// .json, and batch-run over N picked files: each file imports, runs the steps
// (executeSteps — failure isolated), lands a per-file #36 fit report, and one
// summary worksheet (one row per file, columns = declared outputs) joins the
// library as a normal plottable dataset.

import { useCallback, useState } from "react";

import { runTemplateOnDataset } from "./runTemplate";
import { listFitModels, uploadFile } from "../../../lib/api";
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
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";

export interface BatchProgress {
  done: number;
  total: number;
  current: string;
  failures: string[];
}

export interface TemplatesState {
  templates: AnalysisTemplate[];
  batch: BatchProgress | null;
  saveCurrent: (name: string) => Promise<string | null>;
  load: (name: string) => void;
  remove: (name: string) => void;
  exportFile: (name: string) => void;
  importFile: (file: File) => Promise<string | null>;
  runBatch: (name: string, files: File[]) => Promise<void>;
}

let _seq = 0;

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

export function useTemplates(): TemplatesState {
  const [templates, setTemplates] = useState<AnalysisTemplate[]>(() => loadTemplates());
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const loadSteps = useApp((s) => s.loadSteps);
  const addDataset = useApp((s) => s.addDataset);
  const setPipelineRunning = useApp((s) => s.setPipelineRunning);

  const saveCurrent = useCallback(async (name: string): Promise<string | null> => {
    const steps = useApp.getState().macroSteps;
    if (steps.length === 0) return "no steps to save";
    const outputs = await deriveOutputs(steps);
    setTemplates(saveTemplate(toTemplate(name, steps, outputs)));
    toast(`template "${name}" saved`);
    return null;
  }, []);

  const load = useCallback(
    (name: string) => {
      const t = loadTemplates().find((x) => x.name === name);
      if (!t) return;
      loadSteps(t.steps);
      toast(`template "${name}" loaded — ${t.steps.length} steps`);
    },
    [loadSteps],
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
      setTemplates(saveTemplate(t));
      toast(`template "${t.name}" imported`);
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
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setBatch({ done: i, total: files.length, current: file.name, failures });
          try {
            const data = await uploadFile(file);
            const id = `tplb-${Date.now().toString(36)}-${++_seq}`;
            addDataset({ id, name: file.name, data });
            // Shared core: steps + output extraction + the per-file #36 report.
            const row = await runTemplateOnDataset(t, id, file.name);
            rows.push(row);
            if (row.failed) failures.push(file.name);
          } catch (e) {
            // One bad file yields a flagged row, never a dead batch (#3).
            const note = e instanceof Error ? e.message : "import failed";
            rows.push({ file: file.name, values: extractOutputs(t.outputs, undefined), failed: note });
            failures.push(file.name);
          }
        }
        addDataset({
          id: `tplsum-${Date.now().toString(36)}-${++_seq}`,
          name: `${t.name} summary (${rows.length} files)`,
          data: summaryDataset(t.name, t.outputs.length ? t.outputs : ["R2"], rows),
        });
        toast(
          failures.length
            ? `batch done — ${failures.length}/${files.length} file(s) flagged`
            : `batch done — ${files.length} file(s)`,
          failures.length ? "danger" : undefined,
        );
      } finally {
        setPipelineRunning(false);
        setBatch(null);
      }
    },
    [addDataset, setPipelineRunning],
  );

  return { templates, batch, saveCurrent, load, remove, exportFile, importFile, runBatch };
}
