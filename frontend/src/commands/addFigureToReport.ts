// Small chooser shared by the Plot menu and editable-figure Library menus.
// It gathers intent only; store/reportsFigureDocs owns the immutable snapshot,
// validation, undo entry, and report mutation.

import { askParams } from "../components/overlays/ParamDialog";
import type { FigureReportSource } from "../store/reportsFigureDocs";
import { useApp } from "../store/useApp";

const NEW_REPORT = "New report…";

function destinationOptions(): { labels: string[]; ids: (string | null)[] } {
  const reports = useApp.getState().reports;
  const totals = new Map<string, number>();
  for (const report of reports) totals.set(report.name, (totals.get(report.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = reports.map((report) => {
    const n = (seen.get(report.name) ?? 0) + 1;
    seen.set(report.name, n);
    return (totals.get(report.name) ?? 0) > 1 ? `${report.name} (${n})` : report.name;
  });
  return { labels: [NEW_REPORT, ...labels], ids: [null, ...reports.map((report) => report.id)] };
}

export async function promptAddFigureToReport(source: FigureReportSource, figureName: string): Promise<boolean> {
  const { labels, ids } = destinationOptions();
  const openId = useApp.getState().openReportId;
  const openIndex = openId ? ids.indexOf(openId) : -1;
  const params = await askParams("Add figure to report", [
    {
      key: "destination", label: "Report", type: "select",
      default: labels[openIndex >= 0 ? openIndex : 0], options: labels,
      hint: "The report receives a fixed snapshot of the figure as it looks now",
    },
    { key: "caption", label: "Caption", type: "text", default: figureName },
  ]);
  if (!params) return false;
  const picked = labels.indexOf(String(params.destination));
  if (picked < 0) return false;
  const caption = String(params.caption);
  const reportId = ids[picked];
  if (reportId) {
    return await useApp.getState().addFigureToReport(source, { kind: "existing", reportId }, caption);
  }
  const create = await askParams("Create report", [
    { key: "name", label: "Report name", type: "text", default: `${figureName} report` },
  ]);
  if (!create) return false;
  return await useApp.getState().addFigureToReport(
    source,
    { kind: "new", name: String(create.name) },
    caption,
  );
}
