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
import type { ReportEntry, ReportFigureBlock } from "./report";
import { exportActive, type StoreGet } from "./exportActive";
import { FIGURE_STYLES, GREYSCALE_FIELD } from "./exportFigureCommand";
import { buildStageFigureSpec } from "./figureSpecStage";
import type { FigureRenderOpts } from "./figureSpec";
import { appendFigureBlock, figureBlockFromSpec, newFigureReport } from "./reportBlocks";

/** The "make a new report" choice in the Report picker. */
export const NEW_REPORT = "New report";
/** The raster resolution the spec asks for — the Export dialog's own default.
 *  (Word/PowerPoint always embed the backend's 300-DPI render; this matters
 *  for an HTML export of a PNG-embedded figure.) */
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

/** Put `block` into report `targetId`, or into a new report when `null`, as
 *  one undo step, and open the viewer on it. Throws (surfaced by
 *  `exportActive` as a failed send) when the target was deleted meanwhile. */
export function addFigureToReport(
  s: StoreGet,
  targetId: string | null,
  block: ReportFigureBlock,
  stem: string,
  datasetId: string,
): void {
  const st = s();
  if (targetId === null) {
    const name = `${stem} figures`;
    // `addReport` itself records no history (none of the report-library
    // actions do); the send is still one user gesture, so it is one undo step.
    st.recordHistory(SEND_UNDO_LABEL);
    st.addReport(name, newFigureReport(name, block), datasetId);
    return;
  }
  if (!st.updateReportSheet(targetId, (sheet) => appendFigureBlock(sheet, block), SEND_UNDO_LABEL)) {
    throw new Error("that report was deleted before the figure was added");
  }
  st.setOpenReport(targetId);
  st.setStatus(`figure added to report "${s().reports.find((r) => r.id === targetId)?.name ?? ""}"`);
}

export async function runSendFigureToReportCommand(s: StoreGet): Promise<void> {
  const reports = s().reports;
  const labels = reportChoices(reports);
  const openIdx = reports.findIndex((r) => r.id === s().openReportId);
  const params = await askParams("Send figure to report", [
    {
      key: "target",
      label: "Report",
      type: "select",
      default: openIdx >= 0 ? labels[openIdx] : NEW_REPORT,
      options: [NEW_REPORT, ...labels],
      hint: "The figure is added to its Figures section",
    },
    {
      key: "caption",
      label: "Caption",
      type: "text",
      default: s().plotTitle,
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
  ]);
  if (!params) return;
  const pick = labels.indexOf(String(params.target));
  // Resolve the picked report to its id NOW: the report list can change
  // while the dataset resolves below (addFigureToReport re-checks it).
  const targetId = pick >= 0 ? reports[pick].id : null;
  const caption = typeof params.caption === "string" ? params.caption : "";
  const fmt = params.fmt === "png" ? "png" : "svg";
  const style = typeof params.style === "string" ? params.style : "default";
  const greyscale = params.greyscale === true;
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
      addFigureToReport(s, targetId, block, stem, ds.id);
    },
    { verb: "send", past: "sent to report:" },
  );
}
