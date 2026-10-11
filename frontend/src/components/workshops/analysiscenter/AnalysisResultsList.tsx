import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset } from "../../../lib/types";
import { Badge, Button } from "../../primitives";

interface Props {
  results: readonly AnalysisResult[];
  datasets: readonly Dataset[];
  activeId: string | null;
  query: string;
  onOpen: (id: string) => void;
}

export default function AnalysisResultsList({ results, datasets, activeId, query, onOpen }: Props) {
  const names = new Map(datasets.map((dataset) => [dataset.id, dataset.name]));
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = [...results]
    .filter((result) => terms.every((term) => [result.name, result.producer.label, ...result.sources.map((source) => names.get(source.datasetId) ?? "")].join(" ").toLocaleLowerCase().includes(term)))
    .sort((a, b) => {
      const aCurrent = a.sources.some((source) => source.datasetId === activeId);
      const bCurrent = b.sources.some((source) => source.datasetId === activeId);
      return Number(bCurrent) - Number(aCurrent) || Date.parse(b.updatedAt ?? b.createdAt) - Date.parse(a.updatedAt ?? a.createdAt);
    });

  if (visible.length === 0) {
    return <div className="qzk-analysis-empty">{query ? "No saved results match this search." : "No saved analysis results yet."}</div>;
  }

  return (
    <div className="qzk-analysis-results" aria-label="Existing analysis results">
      {visible.map((result) => {
        const current = result.sources.some((source) => source.datasetId === activeId);
        const sourceNames = result.sources.map((source) => names.get(source.datasetId) ?? "Missing worksheet").join(", ");
        return (
          <article key={result.id} className="qzk-analysis-result">
            <div>
              <h3>{result.name}</h3>
              <p>{result.producer.label} · {sourceNames || "No source worksheet"}</p>
              <span>{new Date(result.updatedAt ?? result.createdAt).toLocaleString()}</span>
            </div>
            <div className="qzk-analysis-result-actions">
              {current && <Badge tone="accent">Current worksheet</Badge>}
              {result.stale && <Badge tone="warn">Stale</Badge>}
              <Button size="sm" onClick={() => onOpen(result.id)}>Open result</Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
