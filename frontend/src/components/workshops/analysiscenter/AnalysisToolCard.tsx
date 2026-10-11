import type { AnalysisTool } from "../../../lib/analysisCenter";
import { Badge, Button } from "../../primitives";

interface Props {
  tool: AnalysisTool;
  favorite: boolean;
  busy: boolean;
  blocked: boolean;
  onFavorite: () => void;
  onOpen: () => void;
}

export default function AnalysisToolCard({ tool, favorite, busy, blocked, onFavorite, onOpen }: Props) {
  const label = tool.action.label.replace(/…$/, "");
  return (
    <article className={`qzk-analysis-tool${tool.available ? "" : " unavailable"}`}>
      <div className="qzk-analysis-tool-head">
        <div>
          <Badge>{tool.category}</Badge>
          {tool.recommended && <Badge tone="accent">Recommended</Badge>}
        </div>
        <button
          type="button"
          className={`qzk-analysis-favorite${favorite ? " active" : ""}`}
          aria-pressed={favorite}
          aria-label={`${favorite ? "Remove" : "Add"} ${label} ${favorite ? "from" : "to"} favorites`}
          title={favorite ? "Remove from favorites" : "Add to favorites"}
          onClick={onFavorite}
        >
          {favorite ? "★" : "☆"}
        </button>
      </div>
      <h3>{label}</h3>
      <p>{tool.action.description}</p>
      <p className="qzk-analysis-requires"><strong>Needs:</strong> {tool.requiredInputs}.</p>
      {!tool.available && <p className="qzk-analysis-unavailable">{tool.unavailableReason}</p>}
      <Button size="sm" variant={tool.available ? "primary" : "default"} disabled={!tool.available || blocked} title={tool.unavailableReason} onClick={onOpen}>
        {busy ? "Loading…" : "Open tool"}
      </Button>
    </article>
  );
}
