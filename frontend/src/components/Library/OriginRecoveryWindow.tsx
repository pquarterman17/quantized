// Focused recovery UI for an Origin graph whose recorded source workbook or
// columns could not be matched automatically.  Manual recovery is explicit:
// it never rewrites the imported metadata or pretends the guess is exact.

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { figureLabel, figureLayerFamily, type OriginFigureEntry } from "../../lib/originFigures";
import { resolveOriginFigureSources, resolveOriginSourceManually } from "../../lib/originSources";
import { useApp } from "../../store/useApp";
import ToolWindow from "../overlays/ToolWindow";
import { Button } from "../primitives";

export default function OriginRecoveryWindow({
  entry,
  onClose,
}: {
  entry: OriginFigureEntry;
  onClose: () => void;
}) {
  const figures = useApp((s) => s.originFigures);
  const datasets = useApp((s) => s.datasets);
  const openSource = useApp((s) => s.openOriginFigureSource);
  const remake = useApp((s) => s.remakeOriginFigure);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<{ datasetId: string; action: "inspect" | "rebuild" } | null>(null);
  const resolution = resolveOriginFigureSources(entry, figures, datasets);
  const candidates = useMemo(() => {
    const family = figureLayerFamily(entry, figures);
    return datasets
      .filter((dataset) => entry.siblingIds.includes(dataset.id))
      .map((dataset) => ({
        dataset,
        inspectSource: resolveOriginSourceManually(entry, family.length ? family : [entry], dataset),
        layerSource: resolveOriginSourceManually(entry, [entry], dataset),
        rebuildSource: resolveOriginSourceManually(entry, [entry], dataset, { requireFinite: true }),
      }))
      .sort((a, b) => {
        const aCompatible = a.inspectSource ? 1 : 0;
        const bCompatible = b.inspectSource ? 1 : 0;
        return bCompatible - aCompatible || a.dataset.name.localeCompare(b.dataset.name, undefined, { numeric: true });
      });
  }, [datasets, entry, figures]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleCandidates = normalizedQuery
    ? candidates.filter(({ dataset, inspectSource }) =>
        dataset.name.toLocaleLowerCase().includes(normalizedQuery)
        || inspectSource?.book.toLocaleLowerCase().includes(normalizedQuery))
    : candidates;

  const run = async (
    datasetId: string,
    action: "inspect" | "rebuild",
    operation: () => Promise<boolean>,
  ) => {
    if (busy) return;
    setBusy({ datasetId, action });
    try {
      if (await operation()) onClose();
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <ToolWindow
      id={`origin-recovery-${entry.id}`}
      title={`Recover Origin graph · ${figureLabel(entry)}`}
      x={Math.max(24, window.innerWidth - 620)}
      y={96}
      width={560}
      onClose={onClose}
    >
      <section className="qzk-origin-recovery" aria-label={`Recover ${figureLabel(entry)}`}>
        <p>
          Quantized could not match every saved curve to an imported workbook.
          Choose a compatible workbook to inspect its columns or rebuild an editable plot.
        </p>
        {resolution.unresolved.length > 0 && (
          <div className="qzk-origin-recovery-hints">
            <strong>Saved references</strong>
            <ul>
              {resolution.unresolved.map((binding, index) => (
                <li key={`${binding.book}-${binding.x}-${binding.y}-${index}`}>
                  {binding.book}: {binding.x} → {binding.y}
                  <span>{binding.reason.replaceAll("_", " ")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {candidates.length > 6 && (
          <label className="qzk-origin-recovery-search">
            <span>Find workbook</span>
            <input
              className="qz-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by workbook name…"
            />
          </label>
        )}
        <div className="qzk-origin-recovery-list">
          {visibleCandidates.map(({ dataset, inspectSource, layerSource, rebuildSource }) => (
            <div className="qzk-origin-recovery-candidate" key={dataset.id}>
              <div>
                <strong>{dataset.name}</strong>
                <small>
                  {inspectSource
                    ? rebuildSource
                      ? `${rebuildSource.yColumns.length} compatible Y column${rebuildSource.yColumns.length === 1 ? "" : "s"}`
                      : layerSource
                        ? "Saved columns found, but this layer has no numeric data"
                        : "Compatible columns were found only for another layer"
                    : "Saved column letters do not exist in this workbook"}
                </small>
              </div>
              <div className="qz-btn-row">
                <Button
                  size="sm"
                  disabled={!inspectSource || busy !== null}
                  onClick={() => void run(
                    dataset.id,
                    "inspect",
                    () => openSource(entry.id, dataset.id, { manual: true }),
                  )}
                >
                  {busy?.datasetId === dataset.id && busy.action === "inspect" ? "Opening…" : "Inspect columns"}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!rebuildSource || busy !== null}
                  title={!rebuildSource && inspectSource
                    ? layerSource
                      ? "The selected graph layer has no numeric data to plot"
                      : "This workbook matches another layer, but not the selected graph layer"
                    : undefined}
                  onClick={() => void run(
                    dataset.id,
                    "rebuild",
                    () => remake(entry.id, dataset.id),
                  )}
                >
                  {busy?.datasetId === dataset.id && busy.action === "rebuild" ? "Rebuilding…" : "Rebuild plot"}
                </Button>
              </div>
            </div>
          ))}
          {candidates.length === 0 && (
            <p className="qz-muted">No workbooks from this import are available.</p>
          )}
          {candidates.length > 0 && visibleCandidates.length === 0 && (
            <p className="qz-muted">No workbooks match “{query.trim()}”.</p>
          )}
        </div>
        <small>
          Manual recovery does not alter the source file. Verify the chosen columns before using the result.
        </small>
      </section>
    </ToolWindow>,
    document.body,
  );
}
