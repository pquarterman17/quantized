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
import { cancelled, exportActive, stemFromName, type StoreGet } from "./exportActive";
import { chooseExcludedRows } from "./excludedRowsChoice";
import { excludedChoiceMatters } from "./excludedRowsExport";
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
import { beginOp, endOp } from "../store/pendingOps";
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
 *  picker, new-report name, caption, embed format, style and greyscale
 *  fields cannot drift between the two — only `captionDefault` (a dataset
 *  stem vs. a saved figure's own name), `targetDefault` (the currently open
 *  report, if any) and `newReportNameDefault` (the caller's own
 *  `"<stem> figures"` convention) differ per caller.
 *
 *  The "New report name" field is ALWAYS present (finding #8, P3.6 review
 *  round 2) rather than a second modal shown only after picking "New
 *  report": `askParams`/`ParamField` has no way to show a field
 *  conditionally on another field's live value, so this is the one honest
 *  way to fold the two dialogs into one. Its hint says plainly that it is
 *  used only for that choice. */
function sendToReportFields(
  targetOptions: readonly string[],
  targetDefault: string,
  captionDefault: string,
  newReportNameDefault: string,
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
      key: "newReportName",
      label: "New report name",
      type: "text",
      default: newReportNameDefault,
      hint: `Used only when Report is "${NEW_REPORT}"; a blank name falls back to this default`,
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

/** What the ONE Send dialog resolves to; `null` means cancelled. `opts`
 *  excludes `title`/`xLabel`/`yLabel` on purpose: those are read from LIVE
 *  state (or the document) AFTER this resolves, exactly as before — see
 *  each caller's own comment on why that ordering matters. `newReportName`
 *  is always a non-empty, trimmed string, resolved unconditionally (used
 *  only when `targetId` is `null`) so `addFigureToReport` never has to fall
 *  back on its own (finding #7). */
interface SendToReportChoice {
  targetId: string | null;
  caption: string;
  opts: { fmt: "svg" | "png"; style: string; greyscale: boolean };
  newReportName: string;
}

/** The ONE dialog both send paths open (finding #6/#8, P3.6 review round 2:
 *  this replaces both the ~20 lines that used to be duplicated between the
 *  two `run*` functions below AND the second "name the new report" modal).
 *  Resolves the picked target to an id NOW: the report list can change while
 *  a caller resolves its dataset afterward — `addFigureToReport` re-checks
 *  the target still exists before writing. Returns `null` on cancel; a
 *  caller must stop right there, before recording any history or touching
 *  `reports`/`editableFigures`. */
async function askSendToReport(
  s: StoreGet,
  captionDefault: string,
  defaultReportName: string,
): Promise<SendToReportChoice | null> {
  const reports = s().reports;
  const labels = reportChoices(reports);
  const openIdx = reports.findIndex((r) => r.id === s().openReportId);
  const params = await askParams(
    "Send figure to report",
    sendToReportFields(labels, openIdx >= 0 ? labels[openIdx] : NEW_REPORT, captionDefault, defaultReportName),
  );
  if (!params) return null;
  const pick = labels.indexOf(String(params.target));
  const targetId = pick >= 0 ? reports[pick].id : null;
  const caption = typeof params.caption === "string" ? params.caption : "";
  const fmt = params.fmt === "png" ? "png" : "svg";
  const style = typeof params.style === "string" ? params.style : "default";
  const greyscale = params.greyscale === true;
  const typedName = typeof params.newReportName === "string" ? params.newReportName.trim() : "";
  return { targetId, caption, opts: { fmt, style, greyscale }, newReportName: typedName || defaultReportName };
}

/** Put `block` into report `targetId`, or into a new report named
 *  `newReportName` when `null`, as one undo step, and open the viewer on it.
 *  The block is renamed to `stem`, `stem-2`, … — unique among the target's
 *  figures, decided against its LIVE sheet — so export warnings and LaTeX
 *  file stems tell figures apart. `refs` (figure and/or dataset back-
 *  references) are merged into the sheet's `source_refs` via
 *  {@link withSourceRefs}, deduped against whatever the target already
 *  carries — the SAME call both send paths (the active-plot command and the
 *  Library editable-figure action) make. `datasetId` also becomes the new
 *  `ReportEntry.datasetId` back-reference when creating a report (ported
 *  from #454's `reportsFigureDocs.ts`: `datasetId: dataset?.id ?? null` —
 *  `null` for a frozen source with no live dataset). `newReportName` is
 *  used ONLY when `targetId` is `null`, and both callers always resolve one
 *  via {@link askSendToReport} — never defaulted here (finding #7: the old
 *  `` `${stem} figures` `` fallback in this function was dead code, since
 *  neither caller could ever reach it without one; the one default now
 *  lives in `sendToReportFields`'s own field default). Throws (surfaced by
 *  `exportActive` as a failed send) when the target was deleted meanwhile. */
export function addFigureToReport(
  s: StoreGet,
  targetId: string | null,
  block: ReportFigureBlock,
  stem: string,
  datasetId: string | null,
  newReportName: string,
  refs: readonly ReportSourceRef[] = [],
): void {
  const st = s();
  if (targetId === null) {
    // `addReport` itself records no history (none of the report-library
    // actions do); the send is still one user gesture, so it is one undo step.
    st.recordHistory(SEND_UNDO_LABEL);
    st.addReport(
      newReportName,
      withSourceRefs(newFigureReport(newReportName, { ...block, name: stem }), refs),
      datasetId,
    );
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

// One active-plot send per store, including the dialog and lazy data resolve.
// Guard the shared command so menu, palette, and context-menu callers agree.
const sendingPlots = new WeakSet<StoreGet>();

export async function runSendFigureToReportCommand(s: StoreGet): Promise<void> {
  if (sendingPlots.has(s)) return;
  sendingPlots.add(s);
  try {
    await sendActivePlot(s);
  } finally {
    sendingPlots.delete(s);
  }
}

async function sendActivePlot(s: StoreGet): Promise<void> {
  // Finding #3 (P3.6 review round 2): checked BEFORE any dialog opens, not
  // after the user has already answered target/caption/style/etc — asking
  // those questions only to then discover there is nothing to send wastes
  // the answers and implies the dialog would have done something. Same
  // message/toast `exportActive` itself gives for the same condition; that
  // chokepoint is still reached below and re-checks it for the async race
  // where the active dataset vanishes WHILE the dialog is open.
  const active = s().datasets.find((d) => d.id === s().activeId);
  if (!active) {
    s().setStatus("no dataset to send");
    toast("no dataset to send", "danger");
    return;
  }
  const choice = await askSendToReport(s, s().plotTitle, `${stemFromName(active.name)} figures`);
  if (!choice) return;
  const { targetId, caption, opts, newReportName } = choice;
  await exportActive(
    s,
    async (stem, ds) => {
      // Title and axis labels come from the live view AFTER the dataset
      // resolved — the moment `buildStageFigureSpec` reads the focused
      // window — exactly as "Copy figure" takes them (lib/copyFigureCommand.ts),
      // so a refocus during a lazy book's resolve cannot pair one window's
      // labels with another window's figure.
      const renderOpts: FigureRenderOpts = {
        ...opts,
        dpi: REPORT_FIGURE_DPI,
        title: s().plotTitle,
        xLabel: s().xAxisLabel,
        yLabel: s().yAxisLabel,
      };
      // F4.2c (a): a figure with excluded rows asks "greyed or omitted?".
      const picked = await chooseExcludedRows(
        (greyExcluded) => buildStageFigureSpec(s, ds, stem, { ...renderOpts, greyExcluded }),
        excludedChoiceMatters,
        s().excludedDisplay,
      );
      if (!picked) return false;
      const block = figureBlockFromSpec(picked.value, stem, caption);
      addFigureToReport(
        s, targetId, block, stem, ds.id, newReportName, [{ kind: "dataset", id: ds.id, name: ds.name }],
      );
      // Estimated by walking the spec, never by serializing it (see
      // estimateJsonBytes): a heads-up, not a refusal — the copy is the point.
      const notice = largeSpecNotice(estimateJsonBytes(block.spec));
      if (notice) toast(notice, "info", { ttlMs: TOAST_ACTION_TTL });
    },
    { verb: "send", past: "sent to report:" },
  );
}

/** Figures currently mid-send (finding #2, P3.6 review round 2), so a rapid
 *  duplicate invocation — a double-click on "Add to Report…" — cannot add
 *  the same figure to a report twice. An entry is added BEFORE the dialog's
 *  first `await` and removed unconditionally in the `finally` below: JS runs
 *  each call synchronously up to its first `await`, so the SECOND of two
 *  near-simultaneous calls always finds the first one's entry already there
 *  and fails closed instead of racing it to a second write. */
const sendingFigures = new Set<string>();

/** "Add to Report…" — the Library editable-figure counterpart of
 *  {@link runSendFigureToReportCommand} above, for a SAVED figure
 *  (`editableFigures`) rather than the focused plot window. Same dialog (via
 *  {@link askSendToReport}), the same unique-name-within-target and >5MB-spec
 *  notice behaviour, and the same {@link addFigureToReport} choke point — a
 *  report built by either path is indistinguishable from the other.
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
 *  Finding #1 (P3.6 review round 2): the figure's `(data.mode,
 *  bindings.datasetId)` pair is snapshotted BEFORE the dialog opens and
 *  re-checked, against a FRESH read of the figure, after EVERY await below
 *  (the dialog, then the dataset resolve) — a rebind, or a live/frozen flip,
 *  while either is in flight fails closed with a toast rather than pairing a
 *  stale binding's already-resolved dataset with the figure's NEW one, which
 *  would otherwise write a mismatched `source_ref`/`ReportEntry.datasetId`.
 *
 *  Finding #2: the dataset resolve is wrapped in the same `beginOp`/`endOp`
 *  pendingOps busy entry `exportActive` registers for the plot path, with
 *  the same Cancel affordance — `exportActive` itself does not fit here
 *  since it is keyed to the store's single `activeId`, not an arbitrary
 *  saved figure's own dataset binding.
 *
 *  Fails closed with a clear status/toast and adds nothing when the figure
 *  (or, for a live document, its dataset) is no longer available, when its
 *  binding changed underneath, or when it is already mid-send. Picking "New
 *  report" uses the SAME dialog's "New report name" field, defaulted to
 *  `"<figure name> figures"`; cancelling the dialog leaves the store
 *  untouched. */
export async function runSendEditableFigureToReport(s: StoreGet, figureId: string): Promise<void> {
  const fail = (message: string): void => {
    s().setStatus(message);
    toast(message, "danger");
  };
  const readFigure = () => s().editableFigures.find((f) => f.id === figureId);
  const binding = (d: NonNullable<ReturnType<typeof readFigure>>) =>
    `${d.data.mode}:${d.bindings.datasetId ?? ""}`;

  const document = readFigure();
  if (!document) {
    fail("send failed: the source figure is no longer available");
    return;
  }
  if (sendingFigures.has(figureId)) {
    fail(`send failed: "${document.name}" is already being sent`);
    return;
  }
  sendingFigures.add(figureId);
  try {
    const initialBinding = binding(document);
    const choice = await askSendToReport(s, document.name, `${stemFromName(document.name)} figures`);
    if (!choice) return;

    // Re-read after the dialog closed: the figure can have been edited,
    // rebound, or deleted from the Library while it was open.
    let current = readFigure();
    if (!current) {
      fail("send failed: the source figure is no longer available");
      return;
    }
    if (binding(current) !== initialBinding) {
      fail("send failed: the figure's binding changed while the dialog was open");
      return;
    }

    const controller = new AbortController();
    const opId = beginOp(`Sending ${current.name} to report…`, () => controller.abort());
    try {
      let dataset;
      try {
        dataset = current.data.mode === "live" && current.bindings.datasetId
          ? await s().resolveDataset(current.bindings.datasetId)
          : undefined;
      } catch (error) {
        if (controller.signal.aborted) {
          cancelled(s, "send");
          return;
        }
        fail(`send failed: ${error instanceof Error ? error.message : "the dataset could not be resolved"}`);
        return;
      }
      if (controller.signal.aborted) {
        cancelled(s, "send");
        return;
      }

      // Re-read again after the async resolve: same rebind/delete race as
      // above, now also guarding the just-resolved `dataset` against a
      // binding that moved on while it was in flight.
      current = readFigure();
      if (!current) {
        fail("send failed: the source figure is no longer available");
        return;
      }
      if (binding(current) !== initialBinding) {
        fail("send failed: the figure's binding changed while it was sending");
        return;
      }

      const stem = stemFromName(current.name);
      const doc = current;
      let picked;
      try {
        // F4.2c (a): a figure with excluded rows asks "greyed or omitted?".
        picked = await chooseExcludedRows(
          (greyExcluded) =>
            buildFigureSpecFromDocument(doc, dataset, stem, { ...choice.opts, dpi: REPORT_FIGURE_DPI, greyExcluded }),
          excludedChoiceMatters,
          s().excludedDisplay,
        );
      } catch (error) {
        fail(`send failed: ${error instanceof Error ? error.message : "the figure could not be rendered"}`);
        return;
      }
      if (!picked) {
        cancelled(s, "send");
        return;
      }
      // The question is one more await: the same rebind/delete race as above.
      const after = readFigure();
      if (!after || binding(after) !== initialBinding) {
        fail("send failed: the figure changed while it was sending");
        return;
      }
      const spec = picked.value;
      const block = figureBlockFromSpec(spec, stem, choice.caption);
      const refs: ReportSourceRef[] = [{ kind: "figure", id: current.id, name: current.name }];
      if (dataset) refs.push({ kind: "dataset", id: dataset.id, name: dataset.name });
      try {
        addFigureToReport(s, choice.targetId, block, stem, dataset?.id ?? null, choice.newReportName, refs);
      } catch (error) {
        fail(`send failed: ${error instanceof Error ? error.message : "error"}`);
        return;
      }
      toast(`sent to report: ${stem}`, "ok");
      // Estimated by walking the spec, never by serializing it (see
      // estimateJsonBytes): a heads-up, not a refusal — the send already happened.
      const notice = largeSpecNotice(estimateJsonBytes(block.spec));
      if (notice) toast(notice, "info", { ttlMs: TOAST_ACTION_TTL });
    } finally {
      endOp(opId);
    }
  } finally {
    sendingFigures.delete(figureId);
  }
}
