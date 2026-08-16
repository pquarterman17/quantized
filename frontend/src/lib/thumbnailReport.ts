import type { ReportBlock } from "./report";
import type { ThumbnailRequest, ThumbnailResult } from "./thumbnailCache";
import { escapeSvg, svgResult } from "./thumbnailSvg";

export async function generateReportThumbnail(request: ThumbnailRequest, signal: AbortSignal): Promise<ThumbnailResult> {
  if (request.node.kind !== "report") throw new Error(`report generator got "${request.node.kind}"`);
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const report = request.node.entity.report;
  const section = report.sections[0];
  const blocks = section?.blocks.slice(0, 3) ?? [];
  let y = 52;
  const rows = blocks.map((block) => {
    const line = blockLine(block);
    const result = `<circle cx="22" cy="${y - 4}" r="3" fill="#6d5bd0"/><text x="34" y="${y}" fill="#445063" font-family="system-ui,sans-serif" font-size="12">${escapeSvg(line)}</text>`;
    y += 31;
    return result;
  }).join("");
  const empty = blocks.length === 0 ? `<text x="160" y="100" text-anchor="middle" fill="#778190" font-family="system-ui,sans-serif" font-size="13">Empty report</text>` : "";
  return svgResult(`<rect width="320" height="180" rx="8" fill="#ffffff"/><rect x="0" y="0" width="7" height="180" fill="#6d5bd0"/><text x="22" y="27" fill="#202938" font-family="system-ui,sans-serif" font-size="15" font-weight="650">${escapeSvg((report.title || request.node.name).slice(0, 54))}</text>${rows}${empty}`, request.node.name);
}

function blockLine(block: ReportBlock): string {
  if (block.type === "text") return block.text.slice(0, 42);
  if (block.type === "table") return `${block.caption || "Table"} · ${block.rows.length} rows × ${block.columns.length} columns`;
  if (block.type === "params") return `${block.caption || "Fit parameters"} · ${block.params.length} values`;
  return `${block.caption || block.name || "Figure"} · embedded figure`;
}
