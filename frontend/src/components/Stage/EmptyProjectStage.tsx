import { chooseAndImport } from "../../lib/importEntry";
import { useApp } from "../../store/useApp";

/** Lightweight center workspace used after Remove all and on a fresh project. */
export default function EmptyProjectStage() {
  const importFiles = useApp((s) => s.importFiles);
  const importPaths = useApp((s) => s.importPaths);
  const setImportWizardOpen = useApp((s) => s.setImportWizardOpen);
  return (
    <section className="qzk-stage-cell qzk-empty-project" aria-label="Empty project">
      <div>
        <h2>No data loaded</h2>
        <p>Import a dataset or drop files into the Library to begin.</p>
        <button className="qz-btn" type="button" onClick={() => void chooseAndImport({ importFiles, importPaths })}>
          Import data…
        </button>
        <button className="qz-btn qz-ghost" type="button" onClick={() => setImportWizardOpen(true)}>
          Guided import…
        </button>
      </div>
    </section>
  );
}
