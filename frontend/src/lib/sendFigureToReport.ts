// "Send figure to report…" (PRIMARY_SOFTWARE_AUDIT_PLAN P3.6, frontend half):
// appends the current plot to a report as a spec-carrying figure block, so a
// Word / PowerPoint / HTML report export embeds the real rendered figure.
//
// The spec is built by `lib/figureSpecStage.buildStageFigureSpec` — the ONE
// builder "Export figure…" and "Copy figure" already share — and the backend
// renders it through the SAME function `/api/export/figure` runs
// (`routes.export_figures.render_figure_request`). So a report figure is the
// figure Export would produce for the same choices, by construction; do not
// grow a second spec builder here. The dataset is resolved through
// `exportActive`, the chokepoint that keeps every export off a lazy book's
// preview-only rows (#38), and the send is ONE undo step.
//
// The block holds a SNAPSHOT of the plot at send time (the spec carries its
// own copy of the plotted data), not a live link: later edits to the plot
// do not change a figure already in a report. Loaded lazily (Plot menu / plot
// context menu, `commands/plotCommands.ts`), so none of this is eager.

// askParams from its store home, not the ParamDialog component's re-export:
// lib/ must not DIRECTLY import components/ (architecture.test.ts's lib
// layering guard). GREYSCALE_FIELD/FIGURE_STYLES below come from
// ./exportFigureCommand, a grandfathered module that does import ParamDialog
// itself — shared deliberately so this dialog's style list and greyscale
// field cannot drift from "Export figure…"'s.
import { askParams } from "../store/paramDialog";
import type { ParamField } from "./params";
import type { ReportEntry, ReportFigureBlock, ReportSheet, ReportSourceRef } from "./report";
import { exportActive, type StoreGet } from "./exportActive";
import { FIGURE_STYLES, GREYSCALE_FIELD } from "./exportFigureCommand";
import { buildFigureSpecFromDocument } from "./figureSpec";
import type { FigureRenderOpts } from "./figureSpec";
import { buildStageFigureSpec } from "./figureSpecStage";
import {
  appendFigureBlock,
  estimateJsonBytes,
  figureBlockFromSpec,
  largeSpecNotice,
  newFigureReport,
  uniqueFigureName,
  withSourceRefs,
} from "./reportBlocks";
import { TOAST_ACTION_TTL, toast } from "../store/toasts";

/** The "make a new report" choice in the Report picker. */
export const NEW_REPORT = "New report";
/** The spec's `dpi` — the Export dialog's own default, sent so the spec
 *  matches what "Export figure…" would post. The report renderer does NOT
 *  use it: `routes.report_figures.render_spec` rasterises every report PNG
 *  (Word/PowerPoint, and HTML's raster/fallback) at its own `OFFICE_DPI`
 *  (300), and an SVG has no DPI. */
export const REPORT_FIGURE_DPI = 300;
/** The one undo label every send records. */
export const SEND_UNDO_LABEL = "send figure to report";

/** One picker label per report, index-aligned with `reports` and unique
 *  (a select can only hand back the label): the report's name, with its id
 *  appended when that name collides — with another report, with
 *  {@link NEW_REPORT}, or with another report's id-suffixed label (a second
 *  pass). A pathological set still colliding after that is numbered by
 *  position, which is unique by construction. */
export function reportChoices(reports: readonly ReportEntry[]): string[] {
  const colliding = (ls: string[]) =>
    ls.map((l) => l === NEW_REPORT || ls.indexOf(l) !== ls.lastIndexOf(l));
  let labels = reports.map((r) => r.name);
  for (let pass = 0; pass < 2; pass++) {
    const bad = colliding(labels);
    labels = labels.map((l, i) => (bad[i] && l === reports[i].name ? `${l} (${reports[i].id})` : l));
  }
  return colliding(labels).some(Boolean) ? labels.map((l, i) => `${i + 1}. ${l}`) : labels;
}

/** The Send dialog's field list, shared by both send paths (the active-plot
 *  command and the Library editable-figure action below) so the target
 *  picker, caption, embed format, style and greyscale fields cannot drift
 *  between the two — only `captionDefault` (a dataset stem vs. a saved
 *  figure's own name) and `targetDefault` (the currently open report, if
 *  any) differ per caller. */
function sendToReportFields(
  targetOptions: readonly string[],
  targetDefault: string,
  captionDefault: string,
): ParamField[] {
  return [
    {
      key: "target",
      label: "Report",
      type: "select",
      default: targetDefault,
      options: [NEW_REPORT, ...targetOptions],
      hint: "The figure is added to its Figures section",
    },
    {
      key: "caption",
      label: "Caption",
      type: "text",
      default: captionDefault,
      hint: "Printed under the figure; also its alt text",
    },
    {
      key: "fmt",
      label: "Embed as",
      type: "select",
      default: "svg",
      options: ["svg", "png"],
      hint: "SVG is vector (Word/PowerPoint also get a 300-DPI PNG fallback); PNG is raster only",
    },
    {
      key: "style",
      label: "Style",
      type: "select",
      default: "default",
      options: FIGURE_STYLES,
      hint: "Publication preset, as in Export figure…",
    },
    GREYSCALE_FIELD,
  ];
}

/** "New report" (#454 parity, `commands/addFigureToReport.ts`'s create-name
 *  step): ask for the new report's name, defaulting to `defaultName` (this
 *  module's own `"<stem> figures"` convention — callers compute it from a
 *  stem known SYNCHRONOUSLY, before any dataset resolve, since a dataset's
 *  `.name` never changes across one). `null` means cancelled — the caller
 *  must stop right there, before recording any history or touching
 *  `reports`. An emptied answer falls back to `defaultName` rather than
 *  creating a blank-named report. */
async function promptNewReportName(defaultName: string): Promise<string | null> {
  const params = await askParams("Name the new report", [
    { key: "name", label: "Report name", type: "text", default: defaultName },
  ]);
  if (!params) return null;
  const typed = typeof params.name === "string" ? params.name.trim() : "";
  return typed || defaultName;
}

/** Put `block` into report `targetId`, or into a new report when `null`, as
 *  one undo step, and open the viewer on it. The block is renamed to
 *  `stem`, `stem-2`, … — unique among the target's figures, decided against
 *  its LIVE sheet — so export warnings and LaTeX file stems tell figures
 *  apart. `refs` (figure and/or dataset back-references) are merged into
 *  the sheet's `source_refs` via {@link withSourceRefs}, deduped against
 *  whatever the target already carries — the SAME call both send paths
 *  (the active-plot command below and the Library editable-figure action)
 *  make. `datasetId` also becomes the new `ReportEntry.datasetId` back-
 *  reference when creating a report (ported from #454's
 *  `reportsFigureDocs.ts`: `datasetId: dataset?.id ?? null` — `null` for a
 *  frozen source with no live dataset). `newReportName`, when given,
 *  names a freshly created report instead of the `"<stem> figures"`
 *  default — the caller has already prompted for it (and for a cancelled
 *  prompt, never calls this at all). Throws (surfaced by `exportActive` as
 *  a failed send) when the target was deleted meanwhile. */
export function addFigureToReport(
  s: StoreGet,
  targetId: string | null,
  block: ReportFigureBlock,
  stem: string,
  datasetId: string | null,
  refs: readonly ReportSourceRef[] = [],
  newReportName?: string,
): void {
  const st = s();
  if (targetId === null) {
    const name = newReportName?.trim() || `${stem} figures`;
    // `addReport` itself records no history (none of the report-library
    // actions do); the send is still one user gesture, so it is one undo step.
    st.recordHistory(SEND_UNDO_LABEL);
    st.addReport(name, withSourceRefs(newFigureReport(name, { ...block, name: stem }), refs), datasetId);
    return;
  }
  const append = (sheet: ReportSheet) =>
    withSourceRefs(appendFigureBlock(sheet, { ...block, name: uniqueFigureName(sheet, stem) }), refs);
  if (!st.updateReportSheet(targetId, append, SEND_UNDO_LABEL)) {
    throw new Error("that report was deleted before the figure was added");
  }
  st.setOpenReport(targetId);
  st.setStatus(`figure added to report "${s().reports.find((r) => r.id === targetId)?.name ?? ""}"`);
}

export async function runSendFigureToReportCommand(s: StoreGet): Promise<void> {
  const reports = s().reports;
  const labels = reportChoices(reports);
  const openIdx = reports.findIndex((r) => r.id === s().openReportId);
  const params = await askParams(
    "Send figure to report",
    sendToReportFields(labels, openIdx >= 0 ? labels[openIdx] : NEW_REPORT, s().plotTitle),
  );
  if (!params) return;
  const pick = labels.indexOf(String(params.target));
  // Resolve the picked report to its id NOW: the report list can change
  // while the dataset resolves below (addFigureToReport re-checks it).
  const targetId = pick >= 0 ? reports[pick].id : null;
  const caption = typeof params.caption === "string" ? params.caption : "";
  const fmt = params.fmt === "png" ? "png" : "svg";
  const style = typeof params.style === "string" ? params.style : "default";
  const greyscale = params.greyscale === true;
  // "New report": prompt for its name up front — BEFORE `exportActive` below
  // resolves anything — defaulted from the same active-dataset stub it will
  // resolve (its `.name` is stable across a lazy-book resolve, only `.data`
  // changes), so the default shown here always matches the stem the report
  // would otherwise get. Cancelling changes nothing: no history recorded,
  // nothing resolved yet.
  let newReportName: string | undefined;
  if (targetId === null) {
    const activeStem = (s().datasets.find((d) => d.id === s().activeId)?.name ?? "figure").replace(/\.[^.]+$/, "");
    const chosen = await promptNewReportName(`${activeStem} figures`);
    if (chosen === null) return;
    newReportName = chosen;
  }
  await exportActive(
    s,
    async (stem, ds) => {
      // Title and axis labels come from the live view AFTER the dataset
      // resolved — the moment `buildStageFigureSpec` reads the focused
      // window — exactly as "Copy figure" takes them (lib/copyFigureCommand.ts),
      // so a refocus during a lazy book's resolve cannot pair one window's
      // labels with another window's figure.
      const opts: FigureRenderOpts = {
        fmt,
        style,
        dpi: REPORT_FIGURE_DPI,
        title: s().plotTitle,
        xLabel: s().xAxisLabel,
        yLabel: s().yAxisLabel,
        greyscale,
      };
      const block = figureBlockFromSpec(buildStageFigureSpec(s, ds, stem, opts), stem, caption);
      addFigureToReport(
        s, targetId, block, stem, ds.id, [{ kind: "dataset", id: ds.id, name: ds.name }], newReportName,
      );
      // Estimated by walking the spec, never by serializing it (see
      // estimateJsonBytes): a heads-up, not a refusal — the copy is the point.
      const notice = largeSpecNotice(estimateJsonBytes(block.spec));
      if (notice) toast(notice, "info", { ttlMs: TOAST_ACTION_TTL });
    },
    { verb: "send", past: "sent to report:" },
  );
}

/** "Add to Report…" — the Library editable-figure counterpart of
 *  {@link runSendFigureToReportCommand} above, for a SAVED figure
 *  (`editableFigures`) rather than the focused plot window. Same dialog,
 *  the same unique-name-within-target and >5MB-spec notice behaviour, and
 *  the same {@link addFigureToReport} choke point — a report built by
 *  either path is indistinguishable from the other.
 *
 *  The spec is built through `buildFigureSpecFromDocument` — the canonical
 *  document adapter, "uncycled" (no `autoSeriesStyles`) because a SAVED
 *  figure's styling is already fixed, unlike the live Stage canvas the
 *  plot path's `buildStageFigureSpec` may still be cycling.
 *
 *  A LIVE document's dataset is resolved through `s().resolveDataset`
 *  BEFORE the spec is built — the #38 discipline `exportActive` enforces
 *  for the plot path — never read off `s().datasets` directly: the source
 *  bug this closes (found porting PR #454) embedded a still-pending lazy
 *  book's small preview-only rows into the sent figure instead of its real
 *  data. A FROZEN document renders its own inline snapshot and needs no
 *  dataset at all.
 *
 *  Fails closed with a clear status/toast and adds nothing when the figure
 *  (or, for a live document, its dataset) is no longer available — whether
 *  that is true up front or only once the async dataset resolve finishes
 *  (the figure can be deleted from the Library while it runs). Picking "New
 *  report" prompts for its name via {@link promptNewReportName}, same as the
 *  plot path; cancelling that second prompt leaves the store untouched. */
export async function runSendEditableFigureToReport(s: StoreGet, figureId: string): Promise<void> {
  const fail = (message: string): void => {
    s().setStatus(message);
    toast(message, "danger");
  };
  const document = s().editableFigures.find((f) => f.id === figureId);
  if (!document) {
    fail("send failed: the source figure is no longer available");
    return;
  }
  const reports = s().reports;
  const labels = reportChoices(reports);
  const openIdx = reports.findIndex((r) => r.id === s().openReportId);
  const params = await askParams(
    "Send figure to report",
    sendToReportFields(labels, openIdx >= 0 ? labels[openIdx] : NEW_REPORT, document.name),
  );
  if (!params) return;
  const pick = labels.indexOf(String(params.target));
  // Resolve the picked report to its id NOW, mirroring the plot path: the
  // report list can change while the dataset resolves below (addFigureToReport
  // re-checks it before writing).
  const targetId = pick >= 0 ? reports[pick].id : null;
  const caption = typeof params.caption === "string" ? params.caption : "";
  const fmt = params.fmt === "png" ? "png" : "svg";
  const style = typeof params.style === "string" ? params.style : "default";
  const greyscale = params.greyscale === true;
  // "New report": prompt for its name up front — mirrors
  // `runSendFigureToReportCommand`'s own prompt, BEFORE the dataset resolve
  // below, so cancelling here changes nothing (no history, no resolve).
  let newReportName: string | undefined;
  if (targetId === null) {
    const chosen = await promptNewReportName(`${document.name} figures`);
    if (chosen === null) return;
    newReportName = chosen;
  }

  // #38 discipline: resolve a still-pending (lazy-book preview-only) live
  // dataset to full data BEFORE building the spec. A frozen document needs
  // no dataset — it renders its own snapshot regardless. Caught explicitly
  // (mirroring exportActive's own try/catch around the identical call): a
  // rejected resolve (a failed fetch for a still-pending lazy book) must
  // fail closed with a status/toast, not an unhandled rejection — this
  // function is reached only via `runLazy(...).then(onRun, onLoadFailure)`,
  // whose `onLoadFailure` covers the CHUNK load only, never a handler throw.
  let dataset;
  try {
    dataset = document.data.mode === "live" && document.bindings.datasetId
      ? await s().resolveDataset(document.bindings.datasetId)
      : undefined;
  } catch (error) {
    fail(`send failed: ${error instanceof Error ? error.message : "the dataset could not be resolved"}`);
    return;
  }

  // Re-read after the async resolve: the figure can have been deleted from
  // the Library while the dataset was resolving.
  const current = s().editableFigures.find((f) => f.id === figureId);
  if (!current) {
    fail("send failed: the source figure is no longer available");
    return;
  }
  const stem = current.name;
  let spec;
  try {
    spec = buildFigureSpecFromDocument(current, dataset, stem, { fmt, style, dpi: REPORT_FIGURE_DPI, greyscale });
  } catch (error) {
    fail(`send failed: ${error instanceof Error ? error.message : "the figure could not be rendered"}`);
    return;
  }
  const block = figureBlockFromSpec(spec, stem, caption);
  const refs: ReportSourceRef[] = [{ kind: "figure", id: current.id, name: current.name }];
  if (dataset) refs.push({ kind: "dataset", id: dataset.id, name: dataset.name });
  try {
    addFigureToReport(s, targetId, block, stem, dataset?.id ?? null, refs, newReportName);
  } catch (error) {
    fail(`send failed: ${error instanceof Error ? error.message : "error"}`);
    return;
  }
  toast(`sent to report: ${stem}`, "ok");
  // Estimated by walking the spec, never by serializing it (see
  // estimateJsonBytes): a heads-up, not a refusal — the send already happened.
  const notice = largeSpecNotice(estimateJsonBytes(block.spec));
  if (notice) toast(notice, "info", { ttlMs: TOAST_ACTION_TTL });
}
