// Stage-side graph templates and Copy/Paste Format (figures-audit B2): the
// Plot menu's "Save Graph Template…", "Apply Graph Template…", "Copy Format"
// and "Paste Format". Loaded on demand (`commands/plotCommands.ts` reaches it
// through `runLazy`), so none of it costs the eager bundle.
//
// A template here is the SAME `GraphTemplate` record the Publication preview
// saves (`lib/figuredoc.ts`, localStorage `qz.graphTemplates`), so a template
// saved in either place is listed and applied in both: the Stage writes its
// `format` (`lib/graphFormat.ts`) plus the export-wire `seriesStyles`; the
// preview applies `style`/`overrides`/`seriesStyles` and the Stage `format`.
// Style only, never data: no channel binding, limit or title travels.

import { askParams } from "../store/paramDialog";
import { effectiveChannels } from "./plotdata";
import type { StoreGet } from "./exportActive";
import { buildExportStyles } from "./exportStyles";
import { loadGraphTemplates, saveGraphTemplate, type GraphTemplate } from "./figuredoc";
import {
  captureGraphFormat,
  graphFormatPatch,
  sanitizeGraphFormat,
  seriesStyleFromExport,
  type GraphFormat,
} from "./graphFormat";
import { recordUse } from "./recipeIndex";
import { useApp } from "../store/useApp";

/** The session's format clipboard -- one slot, like Origin's. */
let copiedFormat: GraphFormat | null = null;

/** Test-only: empty the format clipboard. */
export function resetCopiedFormatForTests(): void {
  copiedFormat = null;
}

/** The focused graph's plotted series in display order, or null (with a
 *  status message) when no dataset is plotted. */
function plottedSeries(s: StoreGet, verb: string): number[] | null {
  const state = s();
  const dataset = state.datasets.find((d) => d.id === state.activeId);
  if (!dataset) {
    state.setStatus(`${verb} unavailable: no plotted dataset`);
    return null;
  }
  return effectiveChannels(dataset.data, state.yKeys, state.xKey, dataset.channelRoles, state.seriesOrder)
    .filter((ch) => !state.y2Keys?.includes(ch))
    .concat(state.y2Keys ?? []);
}

/** Restyle the focused graph with `format`, as ONE undo step. */
function applyFormat(s: StoreGet, format: GraphFormat, label: string): boolean {
  const plotted = plottedSeries(s, label);
  if (!plotted) return false;
  s().recordHistory(label.toLowerCase());
  useApp.setState(graphFormatPatch(format, plotted, s().seriesStyles, s()));
  return true;
}

export function copyStageFormat(s: StoreGet): void {
  const plotted = plottedSeries(s, "Copy Format");
  if (!plotted) return;
  copiedFormat = captureGraphFormat(s(), plotted);
  s().setStatus("graph format copied — use Paste Format on another graph");
}

export function pasteStageFormat(s: StoreGet): void {
  if (!copiedFormat) {
    s().setStatus("Paste Format: nothing copied yet — use Copy Format on a styled graph first");
    return;
  }
  if (applyFormat(s, copiedFormat, "Paste Format")) s().setStatus("graph format pasted");
}

/** A template's Stage format: its own when it has one, else one derived
 *  from its publication series styles (a template saved before `format`
 *  existed, or imported from an Origin .otp) over the CURRENT chrome. */
export function templateFormat(template: GraphTemplate, s: StoreGet, plotted: readonly number[]): GraphFormat {
  const own = sanitizeGraphFormat(template.format);
  if (own) return own;
  const base = captureGraphFormat(s(), plotted);
  return { ...base, series: (template.seriesStyles ?? []).map(seriesStyleFromExport) };
}

export async function saveStageGraphTemplate(s: StoreGet): Promise<void> {
  const plotted = plottedSeries(s, "Save Graph Template");
  if (!plotted) return;
  const params = await askParams("Save Graph Template", [
    { key: "name", label: "Template name", type: "text", default: "My graph style" },
  ], { confirmLabel: "Save" });
  const name = params ? String(params.name).trim() : "";
  if (!name) return;
  const state = s();
  saveGraphTemplate({
    name,
    style: "default",
    overrides: null,
    seriesStyles: buildExportStyles(plotted, state.seriesStyles),
    format: captureGraphFormat(state, plotted),
  });
  state.setStatus(`graph template "${name}" saved`);
}

export async function applyStageGraphTemplate(s: StoreGet): Promise<void> {
  const templates = loadGraphTemplates();
  if (templates.length === 0) {
    s().setStatus("Apply Graph Template: no saved templates yet — use Save Graph Template… first");
    return;
  }
  const params = await askParams("Apply Graph Template", [
    { key: "name", label: "Template", type: "select", default: templates[0].name, options: templates.map((t) => t.name) },
  ], { confirmLabel: "Apply" });
  if (!params) return;
  const template = templates.find((t) => t.name === params.name);
  const plotted = plottedSeries(s, "Apply Graph Template");
  if (!template || !plotted) return;
  recordUse({ kind: "graph", scope: "global", id: template.name });
  if (applyFormat(s, templateFormat(template, s, plotted), "Apply Graph Template")) {
    s().setStatus(`graph template "${template.name}" applied`);
  }
}
