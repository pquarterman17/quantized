// One report block in the viewer (#36), split out of ReportPanel.tsx for
// P3.6: the block body (text / params / table / figure) plus the per-block
// move-up / move-down / remove controls. A figure block carrying a `spec`
// (sent from a plot by "Send figure to report…") renders as a rendered-figure
// card — caption, an indicator badge, and what the export will embed — since
// the panel itself never renders the figure (the backend does, on export).

import { fmtNum } from "../../../lib/format";
import type { ReportBlock, ReportFigureBlock, ReportParam } from "../../../lib/report";
import { Badge } from "../../primitives";
import { IconButton } from "../../primitives/IconButton";

/** value ± error [unit], error omitted when absent. */
function paramText(p: ReportParam): string {
  const v = p.value === null ? "—" : fmtNum(p.value);
  const e = p.error !== undefined ? ` ± ${fmtNum(p.error)}` : "";
  const u = p.unit ? ` ${p.unit}` : "";
  return `${v}${e}${u}`;
}

/** What each export format does with a spec figure — mirrors the backend's
 *  `routes.report_figures` rule, per target: a vector `fmt` (svg/pdf) gives
 *  Word/PowerPoint an SVG plus a 300-DPI PNG fallback and HTML an inline SVG;
 *  any other `fmt` embeds the PNG. LaTeX renders nothing (a single .tex only
 *  references a figure file to export beside it). */
function embedNote(spec: Record<string, unknown>): string {
  const fmt = typeof spec.fmt === "string" ? spec.fmt : "pdf"; // FigureRequest's own default
  return fmt === "svg" || fmt === "pdf"
    ? "Word/PowerPoint embed SVG with a PNG fallback, HTML inline SVG"
    : "Word/PowerPoint/HTML embed PNG";
}

function RenderedFigure({ block, spec }: { block: ReportFigureBlock; spec: Record<string, unknown> }) {
  return (
    <div className="qzk-report-figure" data-testid="report-rendered-figure">
      <Badge tone="accent">◩ rendered figure</Badge>
      <p className="qzk-report-text">{block.caption ?? block.name}</p>
      <div className="qzk-report-caption">
        {`snapshot of "${block.name}" · rendered on export: ${embedNote(spec)}; LaTeX only references a figure file`}
      </div>
    </div>
  );
}

export function BlockView({ block }: { block: ReportBlock }) {
  switch (block.type) {
    case "text":
      return <p className="qzk-report-text">{block.text}</p>;
    case "params":
      return (
        <div className="qzk-report-tablewrap">
          <table className="qz-table">
            <tbody>
              {block.params.map((p, i) => (
                <tr key={i}>
                  <td>{p.name}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{paramText(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {block.caption && <div className="qzk-report-caption">{block.caption}</div>}
        </div>
      );
    case "table":
      return (
        <div className="qzk-report-tablewrap" style={{ overflowX: "auto" }}>
          <table className="qz-table">
            <thead>
              <tr>
                {block.columns.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} style={{ fontVariantNumeric: "tabular-nums" }}>
                      {cell === null ? "—" : typeof cell === "number" ? fmtNum(cell) : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {block.caption && <div className="qzk-report-caption">{block.caption}</div>}
        </div>
      );
    case "figure":
      // A spec wins over an attached image, as it does in the backend export.
      if (block.spec) return <RenderedFigure block={block} spec={block.spec} />;
      return block.image ? (
        <figure style={{ margin: 0 }}>
          <img
            src={`data:${block.image.mime};base64,${block.image.data}`}
            alt={block.caption ?? block.name}
            style={{ maxWidth: "100%" }}
          />
          {block.caption && <figcaption className="qzk-report-caption">{block.caption}</figcaption>}
        </figure>
      ) : (
        <p className="qzk-report-text" style={{ color: "var(--text-faint)" }}>
          ▦ figure: {block.caption ?? block.name}
        </p>
      );
  }
}

/** A block plus its move/remove controls. `index`/`count` are the block's
 *  position within its section (moves never cross sections). `blockKey`
 *  (lib/reportBlocks.reportBlockKey) and each control's `data-ctl` are what
 *  the viewer's focus restore targets after a move or remove. */
export function EditableBlock({
  block,
  blockKey,
  index,
  count,
  onMove,
  onRemove,
}: {
  block: ReportBlock;
  blockKey: string;
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const what = block.type === "figure" ? "figure" : "block";
  return (
    <div className="qzk-report-block" data-block-key={blockKey}>
      <div className="qzk-report-block-body">
        <BlockView block={block} />
      </div>
      <div className="qzk-report-block-ctl">
        <IconButton
          aria-label={`Move ${what} up`}
          title="Move up"
          data-ctl="up"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          ↑
        </IconButton>
        <IconButton
          aria-label={`Move ${what} down`}
          title="Move down"
          data-ctl="down"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          ↓
        </IconButton>
        <IconButton aria-label={`Remove ${what}`} title="Remove (Undo restores it)" data-ctl="remove" onClick={onRemove}>
          ✕
        </IconButton>
      </div>
    </div>
  );
}
