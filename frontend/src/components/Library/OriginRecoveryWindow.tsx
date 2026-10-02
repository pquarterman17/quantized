// Focused recovery UI for an Origin graph whose recorded source workbook or
// columns could not be matched automatically.  Manual recovery is explicit:
// it never rewrites the imported metadata or pretends the guess is exact.

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
  const resolution = resolveOriginFigureSources(entry, figures, datasets);
  const siblings = datasets.filter((ds) => entry.siblingIds.includes(ds.id));
  const family = figureLayerFamily(entry, figures);
  const candidates = siblings.map((dataset) => ({
    dataset,
    source: resolveOriginSourceManually(entry, family.length ? family : [entry], dataset),
  }));

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
        <div className="qzk-origin-recovery-list">
          {candidates.map(({ dataset, source }) => (
            <div className="qzk-origin-recovery-candidate" key={dataset.id}>
              <div>
                <strong>{dataset.name}</strong>
                <small>
                  {source
                    ? `${source.yColumns.length} compatible Y column${source.yColumns.length === 1 ? "" : "s"}`
                    : "Saved column letters do not exist in this workbook"}
                </small>
              </div>
              <div className="qz-btn-row">
                <Button
                  size="sm"
                  disabled={!source}
                  onClick={() => void openSource(entry.id, dataset.id, { manual: true }).then(onClose)}
                >
                  Inspect columns
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!source}
                  onClick={() => void remake(entry.id, dataset.id).then(onClose)}
                >
                  Rebuild plot
                </Button>
              </div>
            </div>
          ))}
          {candidates.length === 0 && (
            <p className="qz-muted">No workbooks from this import are available.</p>
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
